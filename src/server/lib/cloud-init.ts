/**
 * Cloud-init generator for machine boot.
 *
 * This script runs when a machine boots. It has smart install detection:
 * - If booting from a pre-built image (code-server already installed), it skips
 *   all package installs and only does machine-specific configuration.
 * - If booting from fresh Ubuntu 24.04, it installs everything first.
 *
 * Machine-specific configuration (always runs):
 *   - SSH keys
 *   - Machine token, slug, callback URL
 *   - Environment variables
 *   - Caddy config (subdomain)
 *   - code-server password
 *   - Docker workload startup (if configured)
 *   - Service enablement
 */

interface CloudInitOpts {
  slug: string;
  codeServerPassword: string;
  sshPublicKey: string;
  machineToken: string;
  platformCallbackUrl: string;
  proxyDomain: string;
  tunnelToken?: string;
  proxyAuthSecret?: string;
  envVars?: Record<string, string>;
  dockerImage?: string;
  entrypoint?: string;
}

export function buildCloudInit(opts: CloudInitOpts): string {
  const envEntries: Record<string, string> = {
    JUSTAVPS_SLUG: opts.slug,
    JUSTAVPS_MACHINE_TOKEN: opts.machineToken,
    ...opts.envVars,
  };
  const envLines = Object.entries(envEntries)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const envLinesBase64 = Buffer.from(envLines).toString('base64');

  // Stage callback helper — reports provisioning progress to JustAVPS API
  const stageCallback = (stage: string, message: string) =>
    `curl -sf -X POST "${opts.platformCallbackUrl}/api/v1/internal/stage" ` +
    `-H "Content-Type: application/json" ` +
    `-d '{"slug":"${opts.slug}","machine_token":"${opts.machineToken}","stage":"${stage}","message":"${message}"}' ` +
    `>/dev/null 2>&1 || true`;

  // Resolve Docker entrypoint — null means use image default CMD
  const resolvedEntrypoint = opts.entrypoint ?? '';

  // Docker workload block — only if a Docker image is specified
  const dockerBlock = opts.dockerImage ? `
# ── Configure Docker workload ─────────────────────────────────────────────
${stageCallback('docker_pulling', 'Configuring Docker workload...')}

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

docker rm -f justavps-workload 2>/dev/null || true
exec docker run --rm --name justavps-workload \\
  --env-file "$ENV_FILE" \\
  --cap-add SYS_ADMIN \\
  --security-opt seccomp=unconfined \\
  --shm-size 2g \\
  -p 8000:8000 \\
  -p 6080:6080 \\
  -p 6081:6081 \\
  -p 3456:3456 \\
  -p 3111:3111 \\
  -p 3210:3210 \\
  -p 9223:9223 \\
  -p 9224:9224 \\
  -p 22222:22 \\
  -v justavps-data:/workspace \\
  ${opts.dockerImage}${resolvedEntrypoint ? ` ${resolvedEntrypoint}` : ''}
DOCKERSTARTEOF
chmod +x /usr/local/bin/justavps-docker-start.sh

# Pull image if not already cached in snapshot
if ! docker image inspect ${opts.dockerImage} >/dev/null 2>&1; then
  echo "[justavps] Docker image not cached — pulling ${opts.dockerImage}..."
  docker pull ${opts.dockerImage}
fi

systemctl enable --now justavps-docker

# Wait for Docker workload to start
echo "[justavps] Waiting for Docker workload..."
for i in $(seq 1 120); do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q justavps-workload; then
    ${stageCallback('docker_running', 'Docker container started')}
    break
  fi
  sleep 2
done

# Wait for port 8000 to be ready
echo "[justavps] Waiting for services to be ready..."
for i in $(seq 1 120); do
  if curl -sf http://localhost:8000/ >/dev/null 2>&1 || curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ${stageCallback('services_ready', 'All services are up')}
    break
  fi
  sleep 2
done
` : '';

  return `#!/bin/bash
set -e
export HOME=/root
export DEBIAN_FRONTEND=noninteractive

echo "[justavps] Configuring machine ${opts.slug}..."
${stageCallback('cloud_init_running', 'Cloud-init started')}

# ── Smart install: only install platform software on fresh Ubuntu ─────────
if ! command -v code-server &>/dev/null; then
  echo "[justavps] Fresh Ubuntu detected — installing platform software..."

  # ── Disable forced root password change ─────────────────────────────────
  chage -d 99999 root 2>/dev/null || true
  sed -i 's/^root:.*$/root:*:19000:0:99999:7:::/' /etc/shadow 2>/dev/null || true

  # ── System packages ─────────────────────────────────────────────────────
  apt-get update -qq
  apt-get install -y -qq \\
    ca-certificates curl wget git build-essential unzip \\
    tmux vim htop nano \\
    python3 python3-pip \\
    debian-keyring debian-archive-keyring apt-transport-https \\
    jq

  # ── Docker CE ───────────────────────────────────────────────────────────
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io

  # ── cloudflared (Cloudflare Tunnel connector) ───────────────────────────
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq
  apt-get install -y -qq cloudflared

  # ── Node.js 22 LTS ─────────────────────────────────────────────────────
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs

  # ── code-server ─────────────────────────────────────────────────────────
  curl -fsSL https://code-server.dev/install.sh | sh

  # ── Caddy (reverse proxy + auto HTTPS) ─────────────────────────────────
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq -o Dpkg::Options::="--force-confold" caddy

  # ── Claude Code ─────────────────────────────────────────────────────────
  npm install -g @anthropic-ai/claude-code 2>/dev/null || true

  # ── OpenCode ────────────────────────────────────────────────────────────
  curl -fsSL -o /tmp/opencode.deb https://github.com/opencode-ai/opencode/releases/download/v0.0.55/opencode-linux-amd64.deb && dpkg -i /tmp/opencode.deb && rm /tmp/opencode.deb || true

  # ── Sandbox Agent (universal coding agent API by Rivet) ────────────────
  curl -fsSL https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh | sh
  sandbox-agent install-agent --all 2>/dev/null || true

  # ── Create 'user' account ──────────────────────────────────────────────
  id -u user &>/dev/null || useradd -m -s /bin/bash -G sudo,docker user
  echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/user

  # ── Systemd service: code-server ───────────────────────────────────────
  cat > /etc/systemd/system/code-server.service << 'SVCEOF'
[Unit]
Description=code-server
After=network.target

[Service]
Type=simple
User=user
ExecStart=/usr/bin/code-server --config /home/user/.config/code-server/config.yaml
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVCEOF

  # ── Systemd service: OpenCode Web UI ──────────────────────────────────
  cat > /etc/systemd/system/opencode-web.service << 'OCEOF'
[Unit]
Description=OpenCode Web UI
After=network.target

[Service]
Type=simple
User=user
ExecStart=/usr/local/bin/opencode serve --port 3456
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
OCEOF

  # ── Systemd service: Sandbox Agent ────────────────────────────────────
  cat > /etc/systemd/system/sandbox-agent.service << 'SAEOF'
[Unit]
Description=Sandbox Agent (coding agent API)
After=network.target

[Service]
Type=simple
User=user
ExecStart=/usr/local/bin/sandbox-agent server --no-token --host 0.0.0.0 --port 2468
Restart=always
RestartSec=3
Environment=HOME=/home/user

[Install]
WantedBy=multi-user.target
SAEOF

  # ── Systemd service: Docker workload (template — configured at boot) ──
  cat > /etc/systemd/system/justavps-docker.service << 'DSVEOF'
[Unit]
Description=JustAVPS Docker Workload
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-docker-start.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
DSVEOF

  # ── Docker start script placeholder ────────────────────────────────────
  cat > /usr/local/bin/justavps-docker-start.sh << 'DSEOF'
#!/bin/bash
echo "[justavps] No Docker workload configured. Exiting."
exit 0
DSEOF
  chmod +x /usr/local/bin/justavps-docker-start.sh

  # ── Cleanup ─────────────────────────────────────────────────────────────
  apt-get clean
  rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

  echo "[justavps] Platform software installed."
fi

# ── justavps-daemon (ALWAYS update to latest — runs outside install guard) ─
DAEMON_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/latest/justavps-daemon-linux-amd64"
echo "[justavps] Downloading justavps-daemon..."
curl -fsSL -o /usr/local/bin/justavps-daemon "$DAEMON_URL" \\
  || echo "[justavps] WARNING: Failed to download daemon"
chmod +x /usr/local/bin/justavps-daemon 2>/dev/null || true

# Systemd service for daemon (idempotent — safe to overwrite)
cat > /etc/systemd/system/justavps-daemon.service << 'DAEMONEOF'
[Unit]
Description=JustAVPS Platform Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-daemon --config /etc/justavps/config.json
Restart=always
RestartSec=5
Environment=JUSTAVPS_PORT=7777

[Install]
WantedBy=multi-user.target
DAEMONEOF

# ── SSH keys for root + user ──────────────────────────────────────────────
mkdir -p /root/.ssh
echo '${opts.sshPublicKey}' >> /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys

mkdir -p /home/user/.ssh
echo '${opts.sshPublicKey}' > /home/user/.ssh/authorized_keys
chmod 700 /home/user/.ssh
chmod 600 /home/user/.ssh/authorized_keys
chown -R user:user /home/user/.ssh

# ── Platform config ───────────────────────────────────────────────────────
mkdir -p /etc/justavps
cat > /etc/justavps/config.json << 'CONFIGEOF'
{
  "slug": "${opts.slug}",
  "callback_url": "${opts.platformCallbackUrl}",
  "machine_token": "${opts.machineToken}",
  "proxy_domain": "${opts.proxyDomain}",
  "proxy_auth_secret": "${opts.proxyAuthSecret || ''}"
}
CONFIGEOF

# ── Environment variables ─────────────────────────────────────────────────
echo '${envLinesBase64}' | base64 -d > /etc/justavps/env

# ── Caddy config (HTTP reverse proxy — Cloudflare handles TLS) ─────────────
# The CF Worker proxies HTTPS → VPS:8080 (code-server directly).
# Caddy runs on :80 as a local reverse proxy for path-based routing to
# other services. Cloudflare connects to the origin over HTTP.
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile << CADDYEOF
:80 {
    # code-server (default — web IDE)
    reverse_proxy localhost:8080

    # Sandbox Agent API + Inspector UI
    handle_path /agent/* {
        reverse_proxy localhost:2468
    }

    # OpenCode Web UI
    handle_path /opencode/* {
        reverse_proxy localhost:3456
    }

    # justavps-daemon local API
    handle_path /daemon/* {
        reverse_proxy localhost:7777
    }
}
CADDYEOF

# ── code-server config (no auth — CF Worker handles authentication) ────────
mkdir -p /root/.config/code-server /home/user/.config/code-server
cat > /home/user/.config/code-server/config.yaml << CSEOF
bind-addr: 127.0.0.1:8080
auth: none
cert: false
CSEOF
cp /home/user/.config/code-server/config.yaml /root/.config/code-server/config.yaml
chown -R user:user /home/user/.config

# ── Firewall: deny ALL inbound except SSH ──────────────────────────────────
# cloudflared tunnel is outbound-only — no inbound ports needed for web traffic.
# Only SSH (22) is open for direct access.
echo "[justavps] Configuring firewall (outbound tunnel, SSH only inbound)..."
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow 22/tcp >/dev/null 2>&1
ufw --force enable >/dev/null 2>&1
echo "[justavps] Firewall active: SSH only inbound, all web via tunnel."

${stageCallback('cloud_init_done', 'Configuration complete, starting services')}

# ── Start pre-installed services ──────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now justavps-daemon 2>/dev/null || true
systemctl enable --now code-server
systemctl enable --now sandbox-agent 2>/dev/null || true

# Caddy: restart to pick up our Caddyfile (apt-get install auto-starts with default)
systemctl enable caddy
systemctl restart caddy

# ── Cloudflare Tunnel (connects VPS to Cloudflare edge) ───────────────────
# cloudflared was installed in the install phase. Now connect to the shared tunnel.
${opts.tunnelToken ? `
echo "[justavps] Starting Cloudflare Tunnel..."
cloudflared service install ${opts.tunnelToken}
echo "[justavps] Tunnel connected."
` : '# No tunnel token — skipping cloudflared'}

systemctl enable --now opencode-web
${dockerBlock}
echo "[justavps] Machine ${opts.slug} ready!"
`;
}
