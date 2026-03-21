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

interface CloudInitOpts {
  slug: string;
  sshPublicKey: string;
  machineToken: string;
  platformCallbackUrl: string;
  proxyDomain: string;
  envVars?: Record<string, string>;
  dockerImage?: string;
  entrypoint?: string;
  command?: string;
  extraSSHKeys?: string[];
  daemonChannel?: 'dev' | 'latest';
}

export function buildCloudInit(opts: CloudInitOpts): string {
  const envEntries: Record<string, string> = {
    JUSTAVPS_SLUG: opts.slug,
    JUSTAVPS_MACHINE_TOKEN: opts.machineToken,
    ...opts.envVars,
  };

  const envLines = Object.entries(envEntries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const envLinesBase64 = Buffer.from(envLines).toString('base64');

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

  const dockerImageBase64 = opts.dockerImage
    ? Buffer.from(opts.dockerImage).toString('base64')
    : '';
  const dockerEntrypointBase64 = opts.entrypoint
    ? Buffer.from(opts.entrypoint).toString('base64')
    : '';
  const dockerCommandBase64 = opts.command
    ? Buffer.from(opts.command).toString('base64')
    : '';

  const dockerBlock = opts.dockerImage ? `
# ── Configure Docker workload ─────────────────────────────────────────────
${stageCallback('docker_pulling', 'Configuring Docker workload...')}

cat > /etc/systemd/system/justavps-docker.service << 'DOCKERSERVICEEOF'
[Unit]
Description=JustAVPS Docker workload
After=network-online.target docker.service
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-docker-start.sh
Restart=always
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
DOCKERSERVICEEOF

cat > /usr/local/bin/justavps-docker-start.sh << 'DOCKERSTARTEOF'
#!/bin/bash
set -e

ENV_FILE="/etc/justavps/env"
for i in $(seq 1 60); do
  [ -s "$ENV_FILE" ] && break
  sleep 1
done
if [ ! -s "$ENV_FILE" ]; then
  touch "$ENV_FILE"
fi

DOCKER_IMAGE="$(printf '%s' '${dockerImageBase64}' | base64 -d)"
DOCKER_ENTRYPOINT="$(printf '%s' '${dockerEntrypointBase64}' | base64 -d 2>/dev/null || true)"
DOCKER_COMMAND="$(printf '%s' '${dockerCommandBase64}' | base64 -d 2>/dev/null || true)"

append_command_args() {
  local command_text="$1"
  [ -n "$command_text" ] || return 0

  while IFS= read -r -d '' arg; do
    RUN_ARGS+=("$arg")
  done < <(python3 - "$command_text" <<'PY'
import shlex
import sys

for token in shlex.split(sys.argv[1]):
    sys.stdout.buffer.write(token.encode('utf-8') + b'\\0')
PY
)
}

resolve_host_port() {
  case "$1" in
    80) echo 8080 ;;
    443) echo 8443 ;;
    22) echo 22222 ;;
    *) echo "$1" ;;
  esac
}

PORT_ARGS=()
HOST_PORTS=()
while IFS= read -r exposed; do
  [ -n "$exposed" ] || continue
  port="\${exposed%/*}"
  [ -n "$port" ] || continue
  host_port="$(resolve_host_port "$port")"
  PORT_ARGS+=("-p" "\${host_port}:\${port}")
  HOST_PORTS+=("$host_port")
done < <(docker image inspect "$DOCKER_IMAGE" --format '{{range $port, $_ := .Config.ExposedPorts}}{{println $port}}{{end}}' 2>/dev/null || true)

if [ \${#PORT_ARGS[@]} -eq 0 ]; then
  PORT_ARGS=(
    -p 3000:3000
    -p 3456:3456
    -p 8000:8000
    -p 8080:8080
    -p 6080:6080
    -p 6081:6081
    -p 3111:3111
    -p 3210:3210
    -p 3211:3211
    -p 9223:9223
    -p 9224:9224
    -p 22222:22
  )
  HOST_PORTS=(3000 3456 8000 8080 6080 6081 3111 3210 3211 9223 9224 22222)
fi

docker rm -f justavps-workload 2>/dev/null || true

RUN_ARGS=(
  docker run --rm
  --name justavps-workload
  --env-file "$ENV_FILE"
  --cap-add SYS_ADMIN
  --security-opt seccomp=unconfined
  --shm-size 2g
  -v justavps-data:/workspace
)
for arg in "\${PORT_ARGS[@]}"; do
  RUN_ARGS+=("$arg")
done
if [ -n "$DOCKER_ENTRYPOINT" ]; then
  RUN_ARGS+=(--entrypoint "$DOCKER_ENTRYPOINT")
fi
RUN_ARGS+=("$DOCKER_IMAGE")
append_command_args "$DOCKER_COMMAND"

printf '%s\n' "\${HOST_PORTS[@]}" > /etc/justavps/docker-host-ports

exec "\${RUN_ARGS[@]}"
DOCKERSTARTEOF
chmod +x /usr/local/bin/justavps-docker-start.sh

BOOT_DOCKER_IMAGE="$(printf '%s' '${dockerImageBase64}' | base64 -d)"
if ! docker image inspect "$BOOT_DOCKER_IMAGE" >/dev/null 2>&1; then
  echo "[justavps] Pulling $BOOT_DOCKER_IMAGE..."
  docker pull "$BOOT_DOCKER_IMAGE"
fi

systemctl daemon-reload
systemctl enable justavps-docker 2>/dev/null || true
systemctl restart justavps-docker

echo "[justavps] Waiting for Docker workload..."
for i in $(seq 1 120); do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q justavps-workload; then
    ${stageCallback('docker_running', 'Docker container started')}
    break
  fi
  sleep 2
done

echo "[justavps] Waiting for services to be ready..."
for i in $(seq 1 120); do
  while IFS= read -r host_port; do
    [ -n "$host_port" ] || continue
    if curl -sf "http://localhost:\${host_port}/" >/dev/null 2>&1 || curl -sf "http://localhost:\${host_port}/health" >/dev/null 2>&1; then
      ${stageCallback('services_ready', 'All services are up')}
      break 2
    fi
  done < /etc/justavps/docker-host-ports
  sleep 2
done
` : '';

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

# ── User account ──────────────────────────────────────────────────────────
id -u user &>/dev/null || useradd -m -s /bin/bash -G sudo,docker user
echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user

# ── SSH keys ──────────────────────────────────────────────────────────────
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
chage -M -1 root 2>/dev/null || true
chage -E -1 root 2>/dev/null || true
passwd -l root 2>/dev/null || true

sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null || true
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

# ── Lock down network exposure (proxy-only public access) ─────────────────
if command -v ufw &>/dev/null; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
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

${stageCallback('cloud_init_done', 'Starting services')}

# ── Start services ────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now justavps-docker-guard 2>/dev/null || true
systemctl enable justavps-daemon 2>/dev/null || true
systemctl restart justavps-daemon 2>/dev/null || true
systemctl enable --now sandbox-agent 2>/dev/null || true
systemctl enable --now opencode-web 2>/dev/null || true
systemctl enable --now justavps-watchdog.timer 2>/dev/null || true
${dockerBlock}
echo "[justavps] Machine ${opts.slug} ready!"
`;
}
