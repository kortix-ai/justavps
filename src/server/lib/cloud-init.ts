/**
 * Cloud-init generator for machine boot.
 *
 * Runs on boot from a pre-built base image. Does machine-specific config
 * and ensures critical services are installed.
 *
 * The justavps-daemon is the ONLY service that needs to run on :80.
 * It handles reverse proxying, PTY terminal, port forwarding, health — everything.
 * No Caddy, no Nginx, no external reverse proxy.
 */

import { config } from './config';

interface CloudInitOpts {
  slug: string;
  sshPublicKey: string;
  machineToken: string;
  platformCallbackUrl: string;
  proxyDomain: string;
  envVars?: Record<string, string>;
  extraSSHKeys?: string[];
  cloudInitScript?: string;
  daemonChannel?: 'dev' | 'latest';
}

export function buildCloudInit(opts: CloudInitOpts): string {
  const brokerUfwRules = config.brokerSourceIPs()
    .map((ip) => `  ufw allow from ${ip} to any port 80 proto tcp`)
    .join('\n');
  const envEntries: Record<string, string> = {
    JUSTAVPS_SLUG: opts.slug,
    JUSTAVPS_MACHINE_TOKEN: opts.machineToken,
    ...opts.envVars,
  };

  const envLines = Object.entries(envEntries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const envLinesBase64 = Buffer.from(envLines).toString('base64');
  const cloudInitScriptBase64 = opts.cloudInitScript
    ? Buffer.from(opts.cloudInitScript).toString('base64')
    : '';

  const stageCallback = (stage: string, message: string) =>
    `curl -sf -X POST "${opts.platformCallbackUrl}/api/v1/internal/stage" ` +
    `-H "Content-Type: application/json" ` +
    `-d '{"slug":"${opts.slug}","machine_token":"${opts.machineToken}","stage":"${stage}","message":"${message}"}' ` +
    `>/dev/null 2>&1 || true`;

  const extraSSHKeysBlock = (opts.extraSSHKeys && opts.extraSSHKeys.length > 0)
    ? opts.extraSSHKeys
      .map((key) => `echo '${key}' >> /root/.ssh/authorized_keys\necho '${key}' >> /home/user/.ssh/authorized_keys`)
      .join('\n')
    : '';

  return `#!/bin/bash
export HOME=/root
export DEBIAN_FRONTEND=noninteractive

# ── Error reporting ───────────────────────────────────────────────────
report_error() {
  local msg="\$1"
  echo "[justavps] ERROR: \$msg"
  ${stageCallback('cloud_init_error', '"\$msg"')}
}
trap 'report_error "cloud-init failed at line $LINENO"' ERR

echo "[justavps] Configuring machine ${opts.slug}..."
${stageCallback('cloud_init_running', 'Cloud-init started')}

# ── Prerequisites for raw cloud images ───────────────────────────────────
if ! command -v curl &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null 2>&1 || true
fi

# ── User account ──────────────────────────────────────────────────────────
# Create the machine user before Docker exists. The docker group is appended
# later after Docker is installed, otherwise useradd fails on raw Ubuntu.
id -u user &>/dev/null || useradd -m -s /bin/bash -G sudo user
mkdir -p /home/user
chown -R user:user /home/user
echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user

# ── SSH keys ──────────────────────────────────────────────────────────────
if ! command -v sshd &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq openssh-server >/dev/null 2>&1 || report_error "openssh-server install failed"
fi

mkdir -p /root/.ssh
echo '${opts.sshPublicKey}' >> /root/.ssh/authorized_keys
chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys

mkdir -p /home/user/.ssh
echo '${opts.sshPublicKey}' > /home/user/.ssh/authorized_keys
${extraSSHKeysBlock}
chmod 700 /home/user/.ssh && chmod 600 /home/user/.ssh/authorized_keys
chown -R user:user /home/user/.ssh

# ── Lock down password auth (SSH-key-only access) ────────────────────────
passwd -d root 2>/dev/null || true
chage -d -1 root 2>/dev/null || true
chage -M -1 root 2>/dev/null || true
chage -E -1 root 2>/dev/null || true
passwd -l root 2>/dev/null || true

if [ -f /etc/ssh/sshd_config ]; then
  sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config || true
  sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config || true
  sed -i 's/^#\\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config || true
  sed -i 's/^#\\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config || true
fi
rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null || true
systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || true
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true

# ── Platform config ───────────────────────────────────────────────────────
mkdir -p /etc/justavps
cat > /etc/justavps/config.json << 'CONFIGEOF'
{
  "slug": "${opts.slug}",
  "callback_url": "${opts.platformCallbackUrl}",
  "machine_token": "${opts.machineToken}",
  "proxy_domain": "${opts.proxyDomain}"
}
CONFIGEOF

# ── Environment variables ─────────────────────────────────────────────────
echo '${envLinesBase64}' | base64 -d > /etc/justavps/env

# ── Update daemon to latest (skip download if snapshot has it) ────────────
DAEMON_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/${opts.daemonChannel === 'dev' ? 'daemon/dev/latest' : 'daemon/latest'}/justavps-daemon-linux-amd64"
if [ -x /usr/local/bin/justavps-daemon ]; then
  echo "[justavps] Daemon exists in snapshot, background-updating..."
  (curl -fsSL -o /tmp/justavps-daemon-new "$DAEMON_URL" \
    && mv /tmp/justavps-daemon-new /usr/local/bin/justavps-daemon \
    && chmod +x /usr/local/bin/justavps-daemon \
    || echo "[justavps] WARNING: background daemon update failed, using snapshot version") &
else
  echo "[justavps] Downloading daemon..."
  curl -fsSL -o /usr/local/bin/justavps-daemon "$DAEMON_URL" \
    || report_error "daemon download failed"
  chmod +x /usr/local/bin/justavps-daemon 2>/dev/null || true
fi

# ── Disable Caddy (daemon handles :80 now) ────────────────────────────────
systemctl disable --now caddy 2>/dev/null || true

# ── Install Docker if missing (raw Ubuntu boot without base snapshot) ─────
if ! command -v docker &>/dev/null; then
  echo "[justavps] Docker not found, installing..."
  curl -fsSL https://get.docker.com | sh || report_error "Docker install failed"
  usermod -aG docker user 2>/dev/null || true
  systemctl enable docker 2>/dev/null || true
  systemctl start docker 2>/dev/null || true
fi

# ── Lock down network exposure (proxy-only public access) ─────────────────
if command -v ufw &>/dev/null; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
${brokerUfwRules || '  ufw allow 80/tcp'}
  ufw --force enable
fi

# ── Install fail2ban (SSH brute-force protection) ─────────────────────────
if ! command -v fail2ban-server &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq fail2ban >/dev/null 2>&1 || true
fi
if command -v fail2ban-server &>/dev/null; then
  cat > /etc/fail2ban/jail.local << 'FAIL2BANEOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
FAIL2BANEOF
  systemctl enable fail2ban 2>/dev/null || true
  systemctl restart fail2ban 2>/dev/null || true
fi

if [ ! -f /usr/local/bin/justavps-docker-guard.sh ]; then
  cat > /usr/local/bin/justavps-docker-guard.sh << 'DOCKERGUARDEOF'
#!/bin/bash
set -euo pipefail

command -v iptables >/dev/null 2>&1 || exit 0

iptables -N JUSTAVPS-DOCKER-GUARD 2>/dev/null || true
iptables -F JUSTAVPS-DOCKER-GUARD
iptables -A JUSTAVPS-DOCKER-GUARD -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A JUSTAVPS-DOCKER-GUARD -i docker0 -j RETURN
iptables -A JUSTAVPS-DOCKER-GUARD -i br+ -j RETURN
iptables -A JUSTAVPS-DOCKER-GUARD -o docker0 -j DROP
iptables -A JUSTAVPS-DOCKER-GUARD -o br+ -j DROP
iptables -A JUSTAVPS-DOCKER-GUARD -j RETURN
iptables -C DOCKER-USER -j JUSTAVPS-DOCKER-GUARD 2>/dev/null || iptables -I DOCKER-USER 1 -j JUSTAVPS-DOCKER-GUARD

# IPv6 equivalent (required for IPv6-only hosts)
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -N JUSTAVPS-DOCKER-GUARD 2>/dev/null || true
  ip6tables -F JUSTAVPS-DOCKER-GUARD
  ip6tables -A JUSTAVPS-DOCKER-GUARD -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  ip6tables -A JUSTAVPS-DOCKER-GUARD -i docker0 -j RETURN
  ip6tables -A JUSTAVPS-DOCKER-GUARD -i br+ -j RETURN
  ip6tables -A JUSTAVPS-DOCKER-GUARD -o docker0 -j DROP
  ip6tables -A JUSTAVPS-DOCKER-GUARD -o br+ -j DROP
  ip6tables -A JUSTAVPS-DOCKER-GUARD -j RETURN
  ip6tables -C DOCKER-USER -j JUSTAVPS-DOCKER-GUARD 2>/dev/null || ip6tables -I DOCKER-USER 1 -j JUSTAVPS-DOCKER-GUARD
fi
DOCKERGUARDEOF
  chmod +x /usr/local/bin/justavps-docker-guard.sh
fi

if [ ! -f /etc/systemd/system/justavps-docker-guard.service ]; then
  cat > /etc/systemd/system/justavps-docker-guard.service << 'DOCKERGUARDSERVICEEOF'
[Unit]
Description=JustAVPS Docker ingress guard
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/justavps-docker-guard.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
DOCKERGUARDSERVICEEOF
fi

# ── Install sandbox-agent (universal coding agent API by Rivet) ───────────
if ! command -v sandbox-agent &>/dev/null; then
  echo "[justavps] Installing sandbox-agent..."
  curl -fsSL https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh | sh || echo "[justavps] WARNING: sandbox-agent install failed"
  sandbox-agent install-agent --all 2>/dev/null || true
fi

# ── Install OpenCode web runtime (default root app on :3456) ───────────────
if [ ! -x /home/user/.opencode/bin/opencode ]; then
  echo "[justavps] Installing opencode..."
  su - user -c 'curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path' || echo "[justavps] WARNING: opencode install failed"
fi

# ── Systemd service: Sandbox Agent ────────────────────────────────────────
if [ ! -f /etc/systemd/system/sandbox-agent.service ]; then
  cat > /etc/systemd/system/sandbox-agent.service << 'SAEOF'
[Unit]
Description=Sandbox Agent (coding agent API)
After=network.target

[Service]
Type=simple
User=user
ExecStart=/usr/local/bin/sandbox-agent server --no-token --host 127.0.0.1 --port 2468
Restart=always
RestartSec=3
Environment=HOME=/home/user

[Install]
WantedBy=multi-user.target
SAEOF
fi

# ── Systemd service: OpenCode Web ──────────────────────────────────────────
cat > /etc/systemd/system/opencode-web.service << 'OPENCODEEOF'
[Unit]
Description=OpenCode Web UI
After=network.target

[Service]
Type=simple
User=user
Environment=HOME=/home/user
Environment=PATH=/home/user/.opencode/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WorkingDirectory=/home/user
ExecStart=/home/user/.opencode/bin/opencode serve --port 3456
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
OPENCODEEOF

# ── Harden daemon systemd service (overwrite snapshot version) ─────────────
cat > /etc/systemd/system/justavps-daemon.service << 'DAEMONSERVICEEOF'
[Unit]
Description=JustAVPS Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-daemon --config /etc/justavps/config.json
Restart=always
RestartSec=2
StartLimitIntervalSec=0
WatchdogSec=120

# Hardening: make it inconvenient to disable
# Service restarts immediately on any exit (including SIGKILL)
# StartLimitIntervalSec=0 means no restart rate limiting

[Install]
WantedBy=multi-user.target
DAEMONSERVICEEOF

# ── Daemon self-healing watchdog (runs every 2 minutes via systemd timer) ──
# If user kills daemon, disables the service, or deletes the binary:
#   1. Re-downloads the daemon if missing
#   2. Re-enables the systemd service
#   3. Restarts the daemon
#   4. Re-enables fail2ban and UFW if disabled
# The timer itself is harder to find/disable than a cron job.

DAEMON_WATCHDOG_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/${opts.daemonChannel === 'dev' ? 'daemon/dev/latest' : 'daemon/latest'}/justavps-daemon-linux-amd64"

cat > /usr/local/bin/justavps-watchdog.sh << WATCHDOGEOF
#!/bin/bash
# JustAVPS self-healing watchdog — ensures critical platform services stay running.
# Runs every 2 minutes via systemd timer.

DAEMON_URL="$DAEMON_WATCHDOG_URL"

# 1. Ensure daemon binary exists
if [ ! -x /usr/local/bin/justavps-daemon ]; then
  echo "[justavps-watchdog] Daemon binary missing, re-downloading..."
  curl -fsSL -o /usr/local/bin/justavps-daemon "\$DAEMON_URL" 2>/dev/null && \\
    chmod +x /usr/local/bin/justavps-daemon || true
fi

# 2. Ensure daemon service is enabled and running
if ! systemctl is-enabled --quiet justavps-daemon 2>/dev/null; then
  echo "[justavps-watchdog] Daemon service disabled, re-enabling..."
  systemctl enable justavps-daemon 2>/dev/null || true
fi
if ! systemctl is-active --quiet justavps-daemon 2>/dev/null; then
  echo "[justavps-watchdog] Daemon not running, starting..."
  systemctl start justavps-daemon 2>/dev/null || true
fi

# 3. Ensure fail2ban is running
if command -v fail2ban-server &>/dev/null; then
  if ! systemctl is-active --quiet fail2ban 2>/dev/null; then
    echo "[justavps-watchdog] fail2ban not running, starting..."
    systemctl enable fail2ban 2>/dev/null || true
    systemctl start fail2ban 2>/dev/null || true
  fi
fi

# 4. Ensure UFW is active
if command -v ufw &>/dev/null; then
  if ! ufw status | grep -q "Status: active" 2>/dev/null; then
    echo "[justavps-watchdog] UFW inactive, re-enabling..."
    ufw --force enable 2>/dev/null || true
  fi
fi

# 5. If the baked snapshot container started with stale env, restart it once the
# host's /etc/justavps/env has the correct machine-specific values. This heals
# both old snapshots and races where systemd started justavps-docker before
# cloud-init overwrote /etc/justavps/env.
if systemctl list-unit-files 2>/dev/null | grep -q '^justavps-docker.service'; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^justavps-workload$'; then
    HOST_SLUG="$(grep '^JUSTAVPS_SLUG=' /etc/justavps/env 2>/dev/null | cut -d= -f2- || true)"
    HOST_SERVICE_KEY="$(grep '^INTERNAL_SERVICE_KEY=' /etc/justavps/env 2>/dev/null | cut -d= -f2- || true)"
    CONTAINER_SLUG="$(docker inspect justavps-workload --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^JUSTAVPS_SLUG=' | cut -d= -f2- || true)"
    CONTAINER_SERVICE_KEY="$(docker inspect justavps-workload --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^INTERNAL_SERVICE_KEY=' | cut -d= -f2- || true)"

    if [ -n "$HOST_SERVICE_KEY" ] && { [ -z "$CONTAINER_SERVICE_KEY" ] || [ "$HOST_SLUG" != "$CONTAINER_SLUG" ]; }; then
      echo "[justavps-watchdog] Detected stale justavps-workload env, restarting justavps-docker..."
      systemctl restart justavps-docker 2>/dev/null || true
    fi
  fi
fi
WATCHDOGEOF
chmod +x /usr/local/bin/justavps-watchdog.sh

cat > /etc/systemd/system/justavps-watchdog.service << 'WDSERVICEEOF'
[Unit]
Description=JustAVPS self-healing watchdog

[Service]
Type=oneshot
ExecStart=/usr/local/bin/justavps-watchdog.sh
WDSERVICEEOF

cat > /etc/systemd/system/justavps-watchdog.timer << 'WDTIMEREOF'
[Unit]
Description=JustAVPS watchdog timer (every 2 minutes)

[Timer]
OnBootSec=60
OnUnitActiveSec=120
AccuracySec=30

[Install]
WantedBy=timers.target
WDTIMEREOF

# ── Start services ────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now justavps-docker-guard 2>/dev/null || true
systemctl enable justavps-daemon 2>/dev/null || true
systemctl restart justavps-daemon 2>/dev/null || true
systemctl enable --now sandbox-agent 2>/dev/null || true
systemctl enable --now opencode-web 2>/dev/null || true
systemctl enable --now justavps-watchdog.timer 2>/dev/null || true

# ── Optional customer-provided cloud-init extension ───────────────────────
if [ -n '${cloudInitScriptBase64}' ]; then
  echo '${cloudInitScriptBase64}' | base64 -d > /tmp/justavps-custom-cloud-init.sh
  chmod +x /tmp/justavps-custom-cloud-init.sh
  /bin/bash /tmp/justavps-custom-cloud-init.sh || report_error "custom cloud-init extension failed"
fi

# If the snapshot already has justavps-docker enabled, it may have started too
# early using the baked /etc/justavps/env from the image. Restart it now so the
# machine-specific env we just wrote is applied to the running container.
if systemctl list-unit-files 2>/dev/null | grep -q '^justavps-docker.service'; then
  systemctl restart justavps-docker 2>/dev/null || true
fi

${stageCallback('cloud_init_done', 'Configuration complete')}
echo "[justavps] Machine ${opts.slug} ready!"
`;
}
