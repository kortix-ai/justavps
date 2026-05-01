import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Prisma } from '@prisma/client';

import type { AppConfig, IncusClusterConfig } from '../config.js';
import { getPrisma } from '../db/client.js';
import type { IncusClient } from '../incus/client.js';

export type EnsureManagedDaemonInput = {
  config: AppConfig;
  client: IncusClient;
  instanceName: string;
  machineId: string;
  verifyPort?: number | null;
};

export type EnsureManagedDaemonResult = {
  ok: boolean;
  mode: 'guest-daemon';
  ensured_at: string;
  daemon_url: string;
  daemon_source: 'local-push' | 'download';
  token_prefix: string;
  token_sha256: string;
  install: { exit_code: number | null; stdout: string; stderr: string };
  active?: string;
  version?: string;
  health?: unknown;
  health_raw?: string;
  port_check?: { port: number; exit_code: number | null; stdout: string; stderr: string };
  error?: string;
};

type MachineRow = Awaited<ReturnType<ReturnType<typeof getPrisma>['machine']['findFirst']>>;

const READY_RECHECK_MS = 60 * 60 * 1000;
const FAILED_RETRY_MS = 5 * 60 * 1000;
const INSTALLING_STALE_MS = 3 * 60 * 1000;
const WORKER_INTERVAL_MS = 30_000;

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function daemonMeta(machine: NonNullable<MachineRow>) {
  return jsonRecord(machine.metadata);
}

export function shouldEnsureManagedDaemon(machine: NonNullable<MachineRow>, now = Date.now()) {
  if (machine.status === 'deleted' || machine.status === 'Stopped') return false;
  const meta = daemonMeta(machine);
  if (meta.managed_daemon_desired === false) return false;
  const state = typeof meta.managed_daemon_state === 'string' ? meta.managed_daemon_state : '';
  const checkedAt = typeof meta.managed_daemon_checked_at === 'string' ? Date.parse(meta.managed_daemon_checked_at) : 0;
  const queuedAt = typeof meta.managed_daemon_queued_at === 'string' ? Date.parse(meta.managed_daemon_queued_at) : 0;
  if (state === 'ready') return !checkedAt || now - checkedAt > READY_RECHECK_MS;
  if (state === 'installing') return !queuedAt || now - queuedAt > INSTALLING_STALE_MS;
  if (state === 'failed') return !checkedAt || now - checkedAt > FAILED_RETRY_MS;
  return true;
}

export async function markManagedDaemonQueued(machineId: string) {
  const prisma = getPrisma();
  const machine = await prisma.machine.findUnique({ where: { id: machineId } });
  if (!machine) return null;
  const metadata = {
    ...daemonMeta(machine),
    managed_daemon_desired: true,
    managed_daemon_state: 'installing',
    managed_daemon_queued_at: new Date().toISOString(),
  };
  return prisma.machine.update({
    where: { id: machineId },
    data: { metadata: metadata as Prisma.InputJsonValue },
  });
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function machineToken() {
  return `mt_${randomBytes(32).toString('base64url')}`;
}

function parseJsonMaybe(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function daemonPortUrlTemplate(config: AppConfig, machineId: string) {
  const appUrl = new URL(config.appUrl);
  if (appUrl.hostname === 'localhost') {
    const url = new URL(appUrl.toString());
    url.hostname = `{{port}}--${machineId}.localhost`;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  }
  return new URL(`/proxy/{{port}}--${machineId}/`, appUrl).toString();
}

function installScript(input: {
  configJson: string;
  daemonUrl: string;
  preloadedDaemonPath?: string | null;
}) {
  const preloadedDaemonPath = input.preloadedDaemonPath ?? '';
  return `set -eu
export DEBIAN_FRONTEND=noninteractive
fail() { echo "JUSTAVPS_DAEMON_ENSURE_ERROR: $*" >&2; exit 1; }

if ! command -v systemctl >/dev/null 2>&1; then
  fail "systemd/systemctl is required for managed JustAVPS machines"
fi

mkdir -p /etc/justavps /usr/local/bin /etc/systemd/system || fail "could not create platform directories"
cat > /etc/justavps/config.json <<'JUSTAVPS_CONFIG_JSON'
${input.configJson}
JUSTAVPS_CONFIG_JSON
chmod 0600 /etc/justavps/config.json || true

if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq ca-certificates curl >/dev/null 2>&1 || fail "failed to install curl"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache ca-certificates curl >/dev/null 2>&1 || fail "failed to install curl"
  else
    fail "curl is missing and no supported package manager was found"
  fi
fi

PRELOADED_DAEMON=${shellQuote(preloadedDaemonPath)}
if [ -n "$PRELOADED_DAEMON" ] && [ -s "$PRELOADED_DAEMON" ]; then
  chmod +x "$PRELOADED_DAEMON" || fail "could not chmod preloaded daemon"
  mv "$PRELOADED_DAEMON" /usr/local/bin/justavps-daemon || fail "could not install preloaded daemon binary"
else
  DAEMON_URL=${shellQuote(input.daemonUrl)}
  tmp="/tmp/justavps-daemon.$$"
  curl -fsSL -o "$tmp" "$DAEMON_URL" || fail "daemon download failed from $DAEMON_URL"
  chmod +x "$tmp" || fail "could not chmod downloaded daemon"
  mv "$tmp" /usr/local/bin/justavps-daemon || fail "could not install daemon binary"
fi
chmod 0755 /usr/local/bin/justavps-daemon || true

cat > /etc/systemd/system/justavps-daemon.service <<'JUSTAVPS_DAEMON_UNIT'
[Unit]
Description=JustAVPS Guest Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-daemon --config /etc/justavps/config.json
Restart=always
RestartSec=2
StartLimitIntervalSec=0
WatchdogSec=120

[Install]
WantedBy=multi-user.target
JUSTAVPS_DAEMON_UNIT

systemctl disable --now caddy >/dev/null 2>&1 || true
systemctl daemon-reload || fail "systemctl daemon-reload failed"
systemctl enable justavps-daemon >/dev/null 2>&1 || fail "failed to enable justavps-daemon"
systemctl restart justavps-daemon || fail "failed to restart justavps-daemon"

ok=0
i=0
while [ "$i" -lt 20 ]; do
  if curl -fsS http://127.0.0.1:7777/health >/dev/null 2>&1; then ok=1; break; fi
  i=$((i + 1))
  sleep 1
done
[ "$ok" = "1" ] || fail "daemon health endpoint did not become ready"

echo "JUSTAVPS_DAEMON_ENSURE_OK"
`;
}

export async function ensureManagedDaemon(input: EnsureManagedDaemonInput): Promise<EnsureManagedDaemonResult> {
  const token = machineToken();
  const daemonUrl = input.config.daemonDownloadUrl;
  const preloadedDaemonPath = input.config.daemonLocalPath ? '/tmp/justavps-daemon.next' : null;
  const ensuredAt = new Date().toISOString();
  const configJson = JSON.stringify({
    slug: input.machineId,
    callback_url: input.config.appUrl,
    machine_token: token,
    proxy_domain: input.config.proxyDomain,
    port_url_template: daemonPortUrlTemplate(input.config, input.machineId),
  }, null, 2);

  if (input.config.daemonLocalPath && preloadedDaemonPath) {
    const binary = readFileSync(input.config.daemonLocalPath);
    await input.client.pushFile(input.instanceName, preloadedDaemonPath, binary, { mode: 0o755 });
  }

  const install = await input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-c', installScript({ configJson, daemonUrl, preloadedDaemonPath })],
    timeoutMs: 180_000,
  }).catch((error) => ({
    exit_code: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  }));

  const base: EnsureManagedDaemonResult = {
    ok: false,
    mode: 'guest-daemon',
    ensured_at: ensuredAt,
    daemon_url: daemonUrl,
    daemon_source: preloadedDaemonPath ? 'local-push' : 'download',
    token_prefix: `${token.slice(0, 10)}…`,
    token_sha256: sha256Hex(token),
    install,
  };

  if (install.exit_code !== 0) {
    return { ...base, error: install.stderr || install.stdout || 'daemon install failed' };
  }

  const [active, version, health] = await Promise.all([
    input.client.exec(input.instanceName, { command: ['/bin/sh', '-c', 'systemctl is-active justavps-daemon || true'], timeoutMs: 10_000 }),
    input.client.exec(input.instanceName, { command: ['/usr/local/bin/justavps-daemon', '--version'], timeoutMs: 10_000 }).catch(() => ({ exit_code: 0, stdout: '', stderr: '' })),
    input.client.exec(input.instanceName, { command: ['curl', '-fsS', 'http://127.0.0.1:7777/health'], timeoutMs: 10_000 }),
  ]);

  let portCheck: EnsureManagedDaemonResult['port_check'];
  if (input.verifyPort) {
    const check = await input.client.exec(input.instanceName, {
      command: ['/bin/sh', '-c', `curl -sS -o /dev/null -w '%{http_code}' ${shellQuote(`http://127.0.0.1/_port/${input.verifyPort}/`)}`],
      timeoutMs: 15_000,
    }).catch((error) => ({ exit_code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
    portCheck = { port: input.verifyPort, ...check };
  }

  const activeText = active.stdout.trim();
  const healthRaw = health.stdout.trim();
  const ok = activeText === 'active' && health.exit_code === 0;
  return {
    ...base,
    ok,
    active: activeText,
    version: version.stdout.trim() || undefined,
    health: parseJsonMaybe(healthRaw),
    health_raw: healthRaw,
    port_check: portCheck,
    error: ok ? undefined : (health.stderr || active.stderr || 'daemon verification failed'),
  };
}

export async function ensureManagedDaemonForMachine(input: {
  config: AppConfig;
  machineId: string;
  findCluster: (id: string) => IncusClusterConfig | null;
  clientFor: (cluster: IncusClusterConfig) => IncusClient;
  verifyPort?: number | null;
}) {
  const prisma = getPrisma();
  const machine = await prisma.machine.findUnique({ where: { id: input.machineId } });
  if (!machine) return null;
  const cluster = input.findCluster(machine.incusClusterId);
  const checkedAt = new Date().toISOString();
  if (!cluster) {
    const metadata = {
      ...daemonMeta(machine),
      managed_daemon_desired: true,
      managed_daemon_state: 'failed',
      managed_daemon_checked_at: checkedAt,
      managed_daemon: { ok: false, error: `Configured Incus cluster ${machine.incusClusterId} not found`, ensured_at: checkedAt, mode: 'guest-daemon' },
    };
    return prisma.machine.update({ where: { id: machine.id }, data: { metadata: metadata as Prisma.InputJsonValue } });
  }

  const daemon = await ensureManagedDaemon({
    config: input.config,
    client: input.clientFor(cluster),
    instanceName: machine.incusInstanceName,
    machineId: machine.id,
    verifyPort: input.verifyPort ?? null,
  });
  const current = await prisma.machine.findUnique({ where: { id: machine.id } }).catch(() => null);
  const metadata = {
    ...daemonMeta(current ?? machine),
    managed_daemon_desired: true,
    managed_daemon_state: daemon.ok ? 'ready' : 'failed',
    managed_daemon_checked_at: daemon.ensured_at,
    managed_daemon: daemon,
  };
  return prisma.machine.update({ where: { id: machine.id }, data: { metadata: metadata as Prisma.InputJsonValue } });
}

export function startManagedDaemonEnsurer(input: {
  config: AppConfig;
  findCluster: (id: string) => IncusClusterConfig | null;
  clientFor: (cluster: IncusClusterConfig) => IncusClient;
}) {
  if (!input.config.databaseConfigured || !input.config.daemonEnsureWorker) return;

  const inFlight = new Set<string>();
  const tick = async () => {
    const prisma = getPrisma();
    const machines = await prisma.machine.findMany({ where: { status: { not: 'deleted' } }, take: 100 });
    const target = machines.find((machine) => !inFlight.has(machine.id) && shouldEnsureManagedDaemon(machine));
    if (!target) return;
    inFlight.add(target.id);
    await markManagedDaemonQueued(target.id).catch(() => undefined);
    ensureManagedDaemonForMachine({
      config: input.config,
      machineId: target.id,
      findCluster: input.findCluster,
      clientFor: input.clientFor,
    }).catch((error) => {
      console.warn(`[v2-api] managed daemon ensure failed for ${target.id}:`, error instanceof Error ? error.message : String(error));
    }).finally(() => {
      inFlight.delete(target.id);
    });
  };

  tick().catch((error) => console.warn('[v2-api] managed daemon ensure worker initial tick failed:', error instanceof Error ? error.message : String(error)));
  setInterval(() => {
    tick().catch((error) => console.warn('[v2-api] managed daemon ensure worker tick failed:', error instanceof Error ? error.message : String(error)));
  }, WORKER_INTERVAL_MS).unref?.();
}
