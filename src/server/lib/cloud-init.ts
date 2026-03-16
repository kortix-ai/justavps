/**
 * Cloud-init template generator.
 *
 * Single unified image: every machine gets code-server + Claude Code + OpenCode.
 * No template selection — one snapshot to rule them all.
 */

interface CloudInitOpts {
  slug: string;
  codeServerPassword: string;
  sshPublicKey: string;
  machineToken: string;
  platformCallbackUrl: string;
  proxyDomain: string;
}

/**
 * Build the full cloud-init user_data script.
 * Installs everything: code-server, Claude Code, OpenCode, dev tools.
 */
export function buildCloudInit(opts: CloudInitOpts): string {
  return `#!/bin/bash
set -e

echo "[justavps] Configuring machine ${opts.slug}..."

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

# ── Configure Caddy (HTTPS with auto Let's Encrypt) ───────────────────────
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
  apt-get update && apt-get install -y caddy

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

# ── Start services ──────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now code-server
systemctl enable --now caddy
systemctl enable --now justavps-agent
systemctl enable --now opencode-web

echo "[justavps] Machine ${opts.slug} ready!"
`;
}
