import type { Prisma } from '@prisma/client';

import type { AppConfig } from '../config.js';
import type { IncusClient } from '../incus/client.js';
import type { IncusInstanceState } from '../incus/types.js';

export type EnsureGuestSshResult = {
  ok: boolean;
  ensured_at: string;
  user: string;
  install: { exit_code: number | null; stdout: string; stderr: string };
  target_host?: string | null;
  target_port: number;
  error?: string;
};

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function firstIpv4(state: IncusInstanceState) {
  const networks = state.network ?? {};
  for (const net of Object.values(networks)) {
    for (const addr of net.addresses ?? []) {
      if (addr.family === 'inet' && addr.address && addr.scope !== 'link' && !addr.address.startsWith('127.')) return addr.address;
    }
  }
  return null;
}

function ensureSshScript(publicKey: string) {
  return `set -eu
fail() { echo "JUSTAVPS_SSH_ENSURE_ERROR: $*" >&2; exit 1; }

if ! command -v sshd >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq openssh-server >/dev/null 2>&1 || fail "failed to install openssh-server"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache openssh >/dev/null 2>&1 || fail "failed to install openssh"
  else
    fail "openssh-server is missing and no supported package manager was found"
  fi
fi

ssh-keygen -A >/dev/null 2>&1 || true
mkdir -p /run/sshd

SSH_USER="root"
if id user >/dev/null 2>&1; then SSH_USER="user"; fi
HOME_DIR=$(getent passwd "$SSH_USER" | cut -d: -f6)
[ -n "$HOME_DIR" ] || HOME_DIR="/root"
mkdir -p "$HOME_DIR/.ssh"
touch "$HOME_DIR/.ssh/authorized_keys"
chmod 700 "$HOME_DIR/.ssh"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"
grep -qxF ${shellQuote(publicKey)} "$HOME_DIR/.ssh/authorized_keys" || echo ${shellQuote(publicKey)} >> "$HOME_DIR/.ssh/authorized_keys"
chown -R "$SSH_USER:$SSH_USER" "$HOME_DIR/.ssh" 2>/dev/null || true

if [ -f /etc/ssh/sshd_config ]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config || true
  sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config || true
  sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config || true
  sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config || true
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config || true
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now ssh >/dev/null 2>&1 || systemctl enable --now sshd >/dev/null 2>&1 || true
  systemctl restart ssh >/dev/null 2>&1 || systemctl restart sshd >/dev/null 2>&1 || true
fi
if ! (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ':22 '; then
  service ssh restart >/dev/null 2>&1 || service sshd restart >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || true
fi
(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ':22 ' || fail "sshd is not listening on port 22"
echo "JUSTAVPS_SSH_USER=$SSH_USER"
echo "JUSTAVPS_SSH_ENSURE_OK"
`;
}

export async function ensureGuestSshAccess(input: {
  config: AppConfig;
  client: IncusClient;
  instanceName: string;
}): Promise<EnsureGuestSshResult> {
  const ensuredAt = new Date().toISOString();
  if (!input.config.sshGatewayPublicKey) {
    return { ok: false, ensured_at: ensuredAt, user: 'user', target_port: 22, install: { exit_code: 1, stdout: '', stderr: 'V2_SSH_GATEWAY_PUBLIC_KEY is not configured' }, error: 'V2_SSH_GATEWAY_PUBLIC_KEY is not configured' };
  }

  const install = await input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-c', ensureSshScript(input.config.sshGatewayPublicKey)],
    timeoutMs: 180_000,
  }).catch((error) => ({ exit_code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
  const user = install.stdout.match(/JUSTAVPS_SSH_USER=(\S+)/)?.[1] ?? 'user';
  if (install.exit_code !== 0) {
    return { ok: false, ensured_at: ensuredAt, user, target_port: 22, install, error: install.stderr || install.stdout || 'SSH ensure failed' };
  }

  const state = await input.client.getInstanceState(input.instanceName).catch(() => null);
  const targetHost = state ? firstIpv4(state) : null;
  return {
    ok: Boolean(targetHost),
    ensured_at: ensuredAt,
    user,
    install,
    target_host: targetHost,
    target_port: 22,
    ...(targetHost ? {} : { error: 'Could not determine guest IPv4 address for SSH gateway routing' }),
  };
}

export function mergeSshMetadata(metadata: unknown, value: unknown): Prisma.InputJsonValue {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return { ...base, ssh_access: value } as Prisma.InputJsonValue;
}
