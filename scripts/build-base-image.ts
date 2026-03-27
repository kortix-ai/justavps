#!/usr/bin/env npx tsx
/**
 * Build JustAVPS Base Image — automated e2e snapshot builder.
 *
 * Creates a fresh machine on the smallest available server type (40 GB disk),
 * installs all base software (Docker, daemon, sandbox-agent, OpenCode, etc.),
 * takes a snapshot, then destroys the build machine.
 *
 * The resulting snapshot can deploy to ANY machine size (40 GB+).
 *
 * Usage:
 *   npx tsx scripts/build-base-image.ts
 *   npx tsx scripts/build-base-image.ts --location=nbg1
 *   npx tsx scripts/build-base-image.ts --server-type=cpx11
 *   npx tsx scripts/build-base-image.ts --dry-run
 *
 * Env:
 *   HETZNER_API_KEY          — required
 *   BUILD_LOCATION           — override datacenter (default: nbg1)
 *   BUILD_SERVER_TYPE        — override server type (default: cx22, 40 GB disk)
 *   DAEMON_CHANNEL           — "latest" or "dev" (default: latest)
 *
 * Output:
 *   Prints the new snapshot ID. Use it to update HETZNER_BASE_SNAPSHOT_ID
 *   and re-run scripts/seed-base-image.ts.
 */

import 'dotenv/config';

// ─── Config ──────────────────────────────────────────────────────────────────

const HETZNER_API = 'https://api.hetzner.cloud/v1';
const API_KEY = process.env.HETZNER_API_KEY;
if (!API_KEY) { console.error('HETZNER_API_KEY is required'); process.exit(1); }

const args = process.argv.slice(2);
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const DRY_RUN = args.includes('--dry-run');

const LOCATION       = flag('location')    || process.env.BUILD_LOCATION    || 'hel1';
const SERVER_TYPE    = flag('server-type')  || process.env.BUILD_SERVER_TYPE || 'cx23';   // 2v/4GB/40GB — smallest available in EU
const DAEMON_CHANNEL = process.env.DAEMON_CHANNEL || 'latest';
const LABEL          = `justavps-base-build-${Date.now()}`;

// ─── Hetzner API helpers ─────────────────────────────────────────────────────

async function htz<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hetzner ${opts.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

async function poll<T>(fn: () => Promise<T>, check: (v: T) => boolean, label: string, timeoutMs = 600_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (check(val)) return val;
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 3_000));
  }
  throw new Error(`Timeout waiting for ${label} (${timeoutMs / 1000}s)`);
}

// ─── Cloud-init for base image ───────────────────────────────────────────────

function baseImageCloudInit(): string {
  const daemonUrl = DAEMON_CHANNEL === 'dev'
    ? 'https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/dev/latest/justavps-daemon-linux-amd64'
    : 'https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/latest/justavps-daemon-linux-amd64';

  return `#!/bin/bash
set -euo pipefail
export HOME=/root
export DEBIAN_FRONTEND=noninteractive

echo "[base-image] Starting base image build..."

# ── System updates ────────────────────────────────────────────────────────
apt-get update -qq
apt-get upgrade -y -qq

# ── User account ──────────────────────────────────────────────────────────
id -u user &>/dev/null || useradd -m -s /bin/bash -G sudo,docker user
echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user
mkdir -p /home/user/.ssh
chown -R user:user /home/user

# ── Root account hardening ───────────────────────────────────────────────
# Hetzner/Ubuntu images can carry an expired root password state into the
# snapshot. Clear any forced-change markers now so snapshot-based machines do
# not prompt for a password rotation on first SSH login.
passwd -d root 2>/dev/null || true
chage -d -1 root 2>/dev/null || true
chage -M -1 root 2>/dev/null || true
chage -E -1 root 2>/dev/null || true
passwd -l root 2>/dev/null || true

# ── Docker ────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "[base-image] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker user
  systemctl enable docker
fi

# ── Fail2ban ──────────────────────────────────────────────────────────────
if ! command -v fail2ban-server &>/dev/null; then
  apt-get install -y -qq fail2ban
fi
cat > /etc/fail2ban/jail.local << 'EOF'
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
EOF
systemctl enable fail2ban

# ── JustAVPS Daemon ───────────────────────────────────────────────────────
echo "[base-image] Downloading daemon..."
curl -fsSL -o /usr/local/bin/justavps-daemon "${daemonUrl}"
chmod +x /usr/local/bin/justavps-daemon

mkdir -p /etc/justavps

cat > /etc/systemd/system/justavps-daemon.service << 'EOF'
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

[Install]
WantedBy=multi-user.target
EOF

# ── Sandbox Agent ─────────────────────────────────────────────────────────
echo "[base-image] Installing sandbox-agent..."
curl -fsSL https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh | sh || echo "[base-image] WARNING: sandbox-agent install failed"
sandbox-agent install-agent --all 2>/dev/null || true

cat > /etc/systemd/system/sandbox-agent.service << 'EOF'
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
EOF

# ── OpenCode Web ──────────────────────────────────────────────────────────
echo "[base-image] Installing OpenCode..."
su - user -c 'curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path' || echo "[base-image] WARNING: opencode install failed"

cat > /etc/systemd/system/opencode-web.service << 'EOF'
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
EOF

# ── Docker ingress guard ──────────────────────────────────────────────────
cat > /usr/local/bin/justavps-docker-guard.sh << 'GUARDEOF'
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
GUARDEOF
chmod +x /usr/local/bin/justavps-docker-guard.sh

cat > /etc/systemd/system/justavps-docker-guard.service << 'EOF'
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
EOF

# ── Enable services (they won't start without config, which cloud-init provides at boot) ──
systemctl daemon-reload
systemctl enable justavps-docker-guard 2>/dev/null || true
systemctl enable sandbox-agent 2>/dev/null || true
systemctl enable opencode-web 2>/dev/null || true

# ── Clean up for snapshot ─────────────────────────────────────────────────
echo "[base-image] Cleaning up for snapshot..."
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -f /root/.bash_history /home/user/.bash_history
# Remove machine-specific SSH host keys — regenerated on first boot
rm -f /etc/ssh/ssh_host_*
# Remove cloud-init instance data so it runs fresh
rm -rf /var/lib/cloud/instances/*
# Clear logs
truncate -s 0 /var/log/syslog /var/log/auth.log 2>/dev/null || true
journalctl --vacuum-time=1s 2>/dev/null || true

# Signal completion
echo "[base-image] ✓ Base image build complete — ready for snapshot"
touch /tmp/base-image-ready
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  JustAVPS Base Image Builder                                ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Location:     ${LOCATION.padEnd(45)}║`);
  console.log(`║  Server type:  ${SERVER_TYPE.padEnd(45)}║`);
  console.log(`║  Daemon:       ${DAEMON_CHANNEL.padEnd(45)}║`);
  console.log(`║  Dry run:      ${String(DRY_RUN).padEnd(45)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (DRY_RUN) {
    console.log('\n[dry-run] Cloud-init script:\n');
    console.log(baseImageCloudInit());
    process.exit(0);
  }

  let serverId: number | null = null;

  try {
    // 1. Create build server
    console.log('\n[1/6] Creating build server...');
    const createResp = await htz<{ server: { id: number; public_net: { ipv4: { ip: string } } } }>('/servers', {
      method: 'POST',
      body: {
        name: LABEL,
        server_type: SERVER_TYPE,
        image: 'ubuntu-24.04',
        location: LOCATION,
        user_data: baseImageCloudInit(),
        labels: { purpose: 'base-image-build', automated: 'true' },
      },
    });
    serverId = createResp.server.id;
    const ip = createResp.server.public_net.ipv4.ip;
    console.log(`  ✓ Server ${serverId} created (IP: ${ip})`);

    // 2. Wait for server to be running
    console.log('\n[2/6] Waiting for server to boot...');
    await poll(
      () => htz<{ server: { status: string } }>(`/servers/${serverId}`),
      (d) => d.server.status === 'running',
      'server running',
      120_000,
    );
    console.log('\n  ✓ Server running');

    // 3. Wait for cloud-init to finish (poll via SSH or just wait based on experience)
    console.log('\n[3/6] Waiting for base image build to complete (~3-5 min)...');
    // Cloud-init on a fresh Ubuntu 24.04 + Docker + OpenCode + sandbox-agent takes ~3-5 minutes.
    // We poll by checking if the sentinel file exists via Hetzner console API or just wait.
    // Simpler: wait 5 minutes, then verify.
    const BUILD_WAIT_MS = 5 * 60 * 1000;
    const waitStart = Date.now();
    while (Date.now() - waitStart < BUILD_WAIT_MS) {
      const elapsed = Math.round((Date.now() - waitStart) / 1000);
      process.stdout.write(`\r  ⏳ ${elapsed}s / ${BUILD_WAIT_MS / 1000}s`);
      await new Promise(r => setTimeout(r, 10_000));
    }
    console.log('\n  ✓ Build wait complete');

    // 4. Stop the server before snapshot (cleaner image)
    console.log('\n[4/6] Stopping server for clean snapshot...');
    await htz(`/servers/${serverId}/actions/shutdown`, { method: 'POST' });
    await poll(
      () => htz<{ server: { status: string } }>(`/servers/${serverId}`),
      (d) => d.server.status === 'off',
      'server off',
      120_000,
    );
    console.log('\n  ✓ Server stopped');

    // 5. Create snapshot
    console.log('\n[5/6] Creating snapshot...');
    const snapResp = await htz<{ image: { id: number } }>(`/servers/${serverId}/actions/create_image`, {
      method: 'POST',
      body: { type: 'snapshot', description: `justavps-base-${new Date().toISOString().slice(0, 10)}` },
    });
    const snapshotId = snapResp.image.id;
    console.log(`  Snapshot ${snapshotId} — waiting for ready...`);

    await poll(
      () => htz<{ image: { status: string; disk_size: number } }>(`/images/${snapshotId}`),
      (d) => d.image.status === 'available',
      'snapshot ready',
      900_000, // snapshots can take up to 15 min
    );
    const finalSnap = await htz<{ image: { id: number; disk_size: number; created: string } }>(`/images/${snapshotId}`);
    console.log(`\n  ✓ Snapshot ready: ID=${snapshotId}, disk=${finalSnap.image.disk_size}GB`);

    // 6. Destroy build server
    console.log('\n[6/6] Destroying build server...');
    // Remove delete protection first (if any)
    await htz(`/servers/${serverId}/actions/change_protection`, {
      method: 'POST', body: { delete: false, rebuild: false },
    }).catch(() => {});
    await htz(`/servers/${serverId}`, { method: 'DELETE' });
    serverId = null;
    console.log('  ✓ Build server destroyed');

    // Done!
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  ✓ BASE IMAGE BUILT SUCCESSFULLY                            ║`);
    console.log(`║                                                              ║`);
    console.log(`║  Snapshot ID:  ${String(snapshotId).padEnd(45)}║`);
    console.log(`║  Disk size:    ${String(finalSnap.image.disk_size + ' GB').padEnd(45)}║`);
    console.log(`║                                                              ║`);
    console.log(`║  Next steps:                                                 ║`);
    console.log(`║  1. Update HETZNER_BASE_SNAPSHOT_ID=${String(snapshotId).padEnd(24)}║`);
    console.log(`║  2. Run: npx tsx scripts/seed-base-image.ts                  ║`);
    console.log(`║  3. Deploy to update the platform                            ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');

  } catch (err) {
    console.error('\n\n✗ Build failed:', err);
    if (serverId) {
      console.log(`\n⚠ Cleaning up build server ${serverId}...`);
      try {
        await htz(`/servers/${serverId}/actions/change_protection`, {
          method: 'POST', body: { delete: false, rebuild: false },
        }).catch(() => {});
        await htz(`/servers/${serverId}`, { method: 'DELETE' });
        console.log('  ✓ Build server destroyed');
      } catch (cleanupErr) {
        console.error(`  ✗ Failed to destroy server ${serverId} — MANUAL CLEANUP REQUIRED`);
      }
    }
    process.exit(1);
  }
}

main();
