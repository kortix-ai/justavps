interface CloudInitOpts {
  slug: string;
  codeServerPassword: string;
  sshPublicKey: string;
  machineToken: string;
  platformCallbackUrl: string;
  proxyDomain: string;
  envVars?: Record<string, string>;
  dockerImage?: string;
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

  const dockerServiceBlock = opts.dockerImage ? `
# ── Docker workload ──────────────────────────────────────────────────────
cat > /usr/local/bin/justavps-docker-start.sh <<'DOCKERSTARTEOF'
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
  ${opts.dockerImage}
DOCKERSTARTEOF
chmod +x /usr/local/bin/justavps-docker-start.sh

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
` : '';

  // Stage callback helper — reports provisioning progress to JustAVPS API
  const stageCallback = (stage: string, message: string) =>
    `curl -sf -X POST "${opts.platformCallbackUrl}/api/v1/internal/stage" ` +
    `-H "Content-Type: application/json" ` +
    `-d '{"slug":"${opts.slug}","machine_token":"${opts.machineToken}","stage":"${stage}","message":"${message}"}' ` +
    `>/dev/null 2>&1 || true`;

  return `#!/bin/bash
set -e
export HOME=/root
export DEBIAN_FRONTEND=noninteractive

echo "[justavps] Configuring machine ${opts.slug}..."
${stageCallback('cloud_init_running', 'Cloud-init started')}

# ── Create user with SSH key ────────────────────────────────────────────────
if ! id user >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G sudo,docker user
  echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/user
fi

# Add SSH key for both root and user
mkdir -p /root/.ssh
echo '${opts.sshPublicKey}' >> /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys

mkdir -p /home/user/.ssh
echo '${opts.sshPublicKey}' > /home/user/.ssh/authorized_keys
chmod 700 /home/user/.ssh
chmod 600 /home/user/.ssh/authorized_keys
chown -R user:user /home/user/.ssh

# ── Write platform config ──────────────────────────────────────────────────
mkdir -p /etc/justavps
cat > /etc/justavps/config.json << 'CONFIGEOF'
{
  "slug": "${opts.slug}",
  "callback_url": "${opts.platformCallbackUrl}",
  "machine_token": "${opts.machineToken}",
  "proxy_domain": "${opts.proxyDomain}"
}
CONFIGEOF

# ── Write env vars ─────────────────────────────────────────────────────────
echo '${envLinesBase64}' | base64 -d > /etc/justavps/env

# ── Configure Caddy (HTTPS with auto Let's Encrypt) ───────────────────────
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile << CADDYEOF
${opts.slug}.${opts.proxyDomain} {
    reverse_proxy localhost:8080
}
CADDYEOF

# ── Configure code-server (for root — binds to all interfaces) ─────────────
mkdir -p /root/.config/code-server
cat > /root/.config/code-server/config.yaml << CSEOF
bind-addr: 0.0.0.0:8080
auth: password
password: ${opts.codeServerPassword}
cert: false
CSEOF

# Also for user
mkdir -p /home/user/.config/code-server
cp /root/.config/code-server/config.yaml /home/user/.config/code-server/config.yaml
chown -R user:user /home/user/.config

# ── Install software if not in snapshot ─────────────────────────────────────
if ! command -v code-server >/dev/null 2>&1; then
  echo "[justavps] No snapshot — installing from scratch..."

  # Docker
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker user

  # Node.js 22 LTS
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs

  # code-server
  curl -fsSL https://code-server.dev/install.sh | sh

  # Claude Code
  npm install -g @anthropic-ai/claude-code || true

  # OpenCode
  curl -fsSL -o /tmp/opencode.deb https://github.com/opencode-ai/opencode/releases/download/v0.0.55/opencode-linux-amd64.deb && dpkg -i /tmp/opencode.deb && rm /tmp/opencode.deb || true

  # Caddy (reverse proxy + auto SSL)
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y -o Dpkg::Options::="--force-confold" caddy

  # Dev tools
  apt-get install -y git curl wget build-essential unzip tmux vim htop nano python3 python3-pip

  # Create systemd services
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

  cat > /etc/systemd/system/justavps-agent.service << 'AGENTEOF'
[Unit]
Description=JustAVPS Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-agent --port 7777 --config /etc/justavps/config.json
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
AGENTEOF
fi

# ── Install Claude Code ─────────────────────────────────────────────────────
echo "[justavps] Installing Claude Code..."
curl -fsSL https://claude.ai/install.sh | bash || true

# ── Install OpenCode + auto-serve ────────────────────────────────────────────
echo "[justavps] Installing OpenCode..."
curl -fsSL https://opencode.ai/install | bash || true

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
${dockerServiceBlock}
# ── Report cloud-init complete ──────────────────────────────────────────────
${stageCallback('cloud_init_done', 'Cloud-init finished, starting services')}

# ── Start services ──────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now code-server
systemctl enable --now caddy
systemctl enable --now justavps-agent
systemctl enable --now opencode-web
${opts.dockerImage ? `${stageCallback('docker_pulling', 'Starting Docker workload...')}
systemctl enable --now justavps-docker` : ''}

${opts.dockerImage ? `# ── Wait for Docker workload to be ready ──────────────────────────────────
echo "[justavps] Waiting for Docker workload to start..."
for i in $(seq 1 120); do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q justavps-workload; then
    ${stageCallback('docker_running', 'Docker container started')}
    break
  fi
  sleep 2
done

# Wait for port 8000 (or first exposed port) to be ready
echo "[justavps] Waiting for services to be ready..."
for i in $(seq 1 120); do
  if curl -sf http://localhost:8000/ >/dev/null 2>&1 || curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ${stageCallback('services_ready', 'All services are up')}
    break
  fi
  sleep 2
done` : ''}

echo "[justavps] Machine ${opts.slug} ready!"
`;
}
