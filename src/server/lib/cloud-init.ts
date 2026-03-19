/**
 * Cloud-init generator for machine boot.
 *
 * Runs on boot from a pre-built base image. ONLY does machine-specific config.
 * All software is pre-installed in the base image.
 *
 * The justavps-daemon is the ONLY service that needs to run on :80.
 * It handles reverse proxying, PTY terminal, port forwarding, health — everything.
 * No Caddy, no Nginx, no external reverse proxy.
 *
 * What this script does:
 *   1. SSH keys (unique per machine)
 *   2. Platform config (slug, token, callback URL)
 *   3. Environment variables
 *   4. Update daemon binary to latest
 *   5. Start daemon + upstream services
 *   6. Docker workload (if configured)
 *
 * Security model (direct IP proxy — no tunnels):
 *   - CF Worker authenticates all requests at edge
 *   - Provider firewall allows only CF IPs on port 80
 *   - Daemon on :80 reverse-proxies to local services
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
  /** Additional SSH public keys (user-managed) to authorize on the machine */
  extraSSHKeys?: string[];
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

  const stageCallback = (stage: string, message: string) =>
    `curl -sf -X POST "${opts.platformCallbackUrl}/api/v1/internal/stage" ` +
    `-H "Content-Type: application/json" ` +
    `-d '{"slug":"${opts.slug}","machine_token":"${opts.machineToken}","stage":"${stage}","message":"${message}"}' ` +
    `>/dev/null 2>&1 || true`;

  const resolvedEntrypoint = opts.entrypoint ?? '';

  // Build extra SSH keys block (user-managed keys to add alongside the auto-generated one)
  const extraSSHKeysBlock = (opts.extraSSHKeys && opts.extraSSHKeys.length > 0)
    ? opts.extraSSHKeys.map(k => `echo '${k}' >> /root/.ssh/authorized_keys\necho '${k}' >> /home/user/.ssh/authorized_keys`).join('\n')
    : '';

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

if ! docker image inspect ${opts.dockerImage} >/dev/null 2>&1; then
  echo "[justavps] Pulling ${opts.dockerImage}..."
  docker pull ${opts.dockerImage}
fi

systemctl enable --now justavps-docker

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
  if curl -sf http://localhost:8000/ >/dev/null 2>&1 || curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ${stageCallback('services_ready', 'All services are up')}
    break
  fi
  sleep 2
done
` : '';

  return `#!/bin/bash
export HOME=/root
export DEBIAN_FRONTEND=noninteractive

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
# Clear any forced password expiry set by the provider image
passwd -d root 2>/dev/null || true
chage -M -1 root 2>/dev/null || true
chage -E -1 root 2>/dev/null || true
passwd -l root 2>/dev/null || true

# Ensure sshd only allows key-based auth
sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
# Drop any cloud-init overrides that might re-enable password auth
rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null || true
systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true

# ── Platform config ───────────────────────────────────────────────────────
mkdir -p /etc/justavps
cat > /etc/justavps/config.json << 'CONFIGEOF'
{
  "slug": "${opts.slug}",
  "callback_url": "${opts.platformCallbackUrl}",
  "machine_token": "${opts.machineToken}"
}
CONFIGEOF

# ── Environment variables ─────────────────────────────────────────────────
echo '${envLinesBase64}' | base64 -d > /etc/justavps/env

# ── Update daemon to latest ───────────────────────────────────────────────
DAEMON_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/latest/justavps-daemon-linux-amd64"
curl -fsSL -o /usr/local/bin/justavps-daemon "$DAEMON_URL" \\
  || echo "[justavps] WARNING: daemon download failed, using image version"
chmod +x /usr/local/bin/justavps-daemon 2>/dev/null || true

# ── Disable Caddy (daemon handles :80 now) ────────────────────────────────
systemctl disable --now caddy 2>/dev/null || true

${stageCallback('cloud_init_done', 'Starting services')}

# ── Start services ────────────────────────────────────────────────────────
# justavps-daemon on :80 is the ONLY front door (reverse proxy + PTY + health)
systemctl daemon-reload
systemctl enable --now justavps-daemon 2>/dev/null || true
systemctl enable --now sandbox-agent 2>/dev/null || true
systemctl enable --now opencode-web 2>/dev/null || true
${dockerBlock}
echo "[justavps] Machine ${opts.slug} ready!"
`;
}
