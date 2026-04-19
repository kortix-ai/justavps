#!/usr/bin/env bash
# Build the JustAVPS golden VM image — dev-ready out of the box.
#
# What's included:
# - Node.js 22 LTS + npm + bun + typescript + ts-node
# - Python 3.12 + pip + venv + uv
# - Docker CE
# - Common dev tools (git, curl, wget, jq, htop, tmux, vim, ripgrep, etc.)
# - openssh-server (pre-configured, host keys pre-generated)
# - justavps-daemon (Go binary — proxy, terminal, port detection, heartbeat)
#
# What's NOT included (users install what they need):
# - AI SDKs (openai, anthropic, langchain — pip install as needed)
# - Heavy ML packages (pytorch, tensorflow, etc.)
# - GUI/desktop (chromium, vnc, xfce)
# - Language servers
#
# Boot-time optimizations:
# - Cloud-init disabled (identity injection via incus exec)
# - SSH host keys pre-generated
# - GRUB timeout 0, quiet boot, mitigations=off
# - Unnecessary systemd services disabled/masked
# - Netplan pre-configured for DHCP
# - systemd default timeouts reduced

set -euo pipefail

IMAGE_ALIAS="justavps-golden"
BUILD_VM="golden-builder"
DAEMON_CHANNEL="${DAEMON_CHANNEL:-dev}"
DAEMON_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/${DAEMON_CHANNEL}/latest/justavps-daemon-linux-amd64"
HOST_DAEMON_BIN="${HOST_DAEMON_BIN:-}"

echo "[golden] Starting golden image build..."

# Clean up any previous build
incus delete "$BUILD_VM" --force 2>/dev/null || true

# Create build VM
echo "[golden] Creating build VM..."
incus init images:ubuntu/noble/cloud "$BUILD_VM" --vm
incus config set "$BUILD_VM" limits.cpu 4
incus config set "$BUILD_VM" limits.memory 4GiB
incus start "$BUILD_VM"

# Wait for cloud-init
echo "[golden] Waiting for VM to boot..."
for i in $(seq 1 180); do
  if incus exec "$BUILD_VM" -- cloud-init status 2>/dev/null | grep -q "done"; then
    break
  fi
  sleep 1
done
echo "[golden] VM booted."

USE_HOST_DAEMON=0
if [[ -n "$HOST_DAEMON_BIN" && -f "$HOST_DAEMON_BIN" ]]; then
  echo "[golden] Injecting daemon binary from host path: $HOST_DAEMON_BIN"
  incus file push "$HOST_DAEMON_BIN" "$BUILD_VM/usr/local/bin/justavps-daemon"
  incus exec "$BUILD_VM" -- chmod +x /usr/local/bin/justavps-daemon
  USE_HOST_DAEMON=1
fi

# ─── Install everything ──────────────────────────────────────────────────────
incus exec "$BUILD_VM" -- bash -c '
set -e
export DEBIAN_FRONTEND=noninteractive

echo "[golden] === Phase 1: System packages ==="
apt-get update -qq

apt-get install -y -qq --no-install-recommends \
  curl ca-certificates wget gnupg lsb-release \
  openssh-server \
  git git-lfs \
  jq htop tmux vim nano less \
  ripgrep fd-find tree unzip zip \
  build-essential gcc g++ make cmake \
  sudo \
  >/dev/null 2>&1

echo "[golden] === Phase 2: Python 3 ==="
apt-get install -y -qq --no-install-recommends \
  python3 python3-pip python3-venv python3-dev \
  >/dev/null 2>&1

# Install uv (fast Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh 2>/dev/null

# Symlink python → python3
ln -sf /usr/bin/python3 /usr/bin/python 2>/dev/null || true

echo "[golden] === Phase 3: Node.js 22 LTS ==="
# Install Node.js 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
apt-get install -y -qq nodejs >/dev/null 2>&1

# Install bun
curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
ln -sf /root/.bun/bin/bun /usr/local/bin/bun 2>/dev/null || true

# Global npm packages
npm install -g --no-audit --no-fund \
  typescript ts-node pnpm \
  >/dev/null 2>&1

echo "[golden] === Phase 4: Docker CE ==="
curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
systemctl enable docker

echo "[golden] === Phase 5: JustAVPS daemon ==="
if [ "'"$USE_HOST_DAEMON"'" = "1" ] && [ -s /usr/local/bin/justavps-daemon ]; then
  echo "[golden] Using injected daemon binary"
else
  curl --retry 5 --retry-delay 2 --retry-all-errors -fsSL -o /usr/local/bin/justavps-daemon "'"$DAEMON_URL"'"
  chmod +x /usr/local/bin/justavps-daemon
fi

test -s /usr/local/bin/justavps-daemon

echo "[golden] === Phase 6: User setup ==="
# Create user account
id -u user &>/dev/null || useradd -m -s /bin/bash -G sudo,docker user
echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user
chmod 440 /etc/sudoers.d/user

# Also add root to docker group
usermod -aG docker root 2>/dev/null || true

echo "[golden] === Phase 7: SSH hardening ==="
sed -i "s/^#\?PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config
sed -i "s/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/" /etc/ssh/sshd_config
sed -i "s/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/" /etc/ssh/sshd_config
echo "UseDNS no" >> /etc/ssh/sshd_config
echo "GSSAPIAuthentication no" >> /etc/ssh/sshd_config

# Pre-generate SSH host keys (skip cloud-init regen on every boot)
ssh-keygen -A 2>/dev/null || true

echo "[golden] === Phase 8: Daemon systemd unit ==="
cat > /etc/systemd/system/justavps-daemon.service << "DAEONSVC"
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

[Install]
WantedBy=multi-user.target
DAEONSVC

mkdir -p /etc/justavps
systemctl daemon-reload
systemctl enable justavps-daemon

echo "[golden] === Phase 9: Boot speed optimizations ==="

# Disable cloud-init SSH key regeneration
mkdir -p /etc/cloud/cloud.cfg.d
cat > /etc/cloud/cloud.cfg.d/99-fast-boot.cfg << "CLOUDCFGEOF"
ssh_deletekeys: false
ssh_genkeytypes: []
datasource_list: [NoCloud]
cloud_init_modules:
  - migrator
  - seed_random
  - bootcmd
  - write_files
  - growpart
  - resizefs
  - set_hostname
  - update_hostname
cloud_config_modules:
  - runcmd
  - locale
  - ntp
cloud_final_modules:
  - scripts_user
  - final_message
CLOUDCFGEOF

# Disable unnecessary systemd services
systemctl disable \
  apt-daily.timer \
  apt-daily-upgrade.timer \
  motd-news.timer \
  fwupd-refresh.timer \
  e2scrub_all.timer \
  man-db.timer \
  update-notifier-download.timer \
  update-notifier-motd.timer \
  dpkg-db-backup.timer \
  systemd-networkd-wait-online.service \
  networkd-wait-online.service \
  multipathd.service \
  multipathd.socket \
  ModemManager.service \
  unattended-upgrades.service \
  apport.service \
  2>/dev/null || true

systemctl mask \
  systemd-networkd-wait-online.service \
  networkd-wait-online.service \
  apt-daily.service \
  apt-daily-upgrade.service \
  2>/dev/null || true

# Pre-configure DHCP
mkdir -p /etc/netplan
rm -f /etc/netplan/*.yaml
cat > /etc/netplan/01-dhcp.yaml << "NETPLANEOF"
network:
  version: 2
  ethernets:
    uplink:
      match:
        name: "e*"
      dhcp4: true
      dhcp4-overrides:
        send-hostname: false
        use-hostname: false
      dhcp-identifier: mac
NETPLANEOF
chmod 600 /etc/netplan/01-dhcp.yaml

# NOTE: Leave GRUB defaults intact.
# Aggressive GRUB tuning caused published Incus images on new hosts to boot into a raw
# `grub>` prompt instead of Linux, which breaks the golden-image fast path entirely.
# Bootability matters more than the tiny boot-time savings here.

# Reduce systemd timeouts
mkdir -p /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/fast-boot.conf << "SDCONFEOF"
[Manager]
DefaultTimeoutStartSec=10s
DefaultTimeoutStopSec=5s
DefaultDeviceTimeoutSec=10s
SDCONFEOF

echo "[golden] === Phase 10: Clean machine identity ==="
# Remove cloud-init instance data
rm -rf /var/lib/cloud/instance /var/lib/cloud/data /var/lib/cloud/sem
rm -rf /var/log/cloud-init*.log
rm -f /var/lib/dbus/machine-id
: > /etc/machine-id
truncate -s0 /etc/hostname
rm -f /etc/justavps/config.json /etc/justavps/env
rm -f /root/.ssh/authorized_keys /home/user/.ssh/authorized_keys 2>/dev/null || true
rm -rf /tmp/* /var/tmp/*

# Stop services (they start fresh on clone)
systemctl stop justavps-daemon docker 2>/dev/null || true

# Cleanup
apt-get clean
rm -rf /var/cache/apt/archives/*.deb /var/lib/apt/lists/*
journalctl --rotate 2>/dev/null || true
journalctl --vacuum-time=1s 2>/dev/null || true
fstrim -av 2>/dev/null || true

echo ""
echo "====================================="
echo " Versions:"
echo "   Python:     $(python3 --version 2>&1)"
echo "   Node:       $(node --version 2>&1)"
echo "   npm:        $(npm --version 2>&1)"
echo "   bun:        $(bun --version 2>&1)"
echo "   pnpm:       $(pnpm --version 2>&1)"
echo "   Docker:     $(docker --version 2>&1)"
echo "   git:        $(git --version 2>&1)"
echo "   uv:         $(uv --version 2>&1)"
echo "   Daemon:     $(justavps-daemon --version 2>&1 || echo present)"
echo "====================================="
echo "[golden] Build VM prepared."
'

echo "[golden] Stopping build VM..."
incus stop "$BUILD_VM" --force

echo "[golden] Publishing golden image..."
incus image delete "$IMAGE_ALIAS" 2>/dev/null || true
incus publish "$BUILD_VM" --alias "$IMAGE_ALIAS" --reuse

echo "[golden] Cleaning up build VM..."
incus delete "$BUILD_VM" --force

# Warm the image volume on ZFS
echo "[golden] Warming image on zfs-pool..."
incus init "$IMAGE_ALIAS" golden-warm-test --vm --storage zfs-pool 2>/dev/null || true
incus delete golden-warm-test --force 2>/dev/null || true

IMAGE_SIZE=$(incus image list "$IMAGE_ALIAS" --format csv | awk -F, '{print $7}')
echo ""
echo "========================================"
echo " JustAVPS Golden Image Built!"
echo " Alias: $IMAGE_ALIAS"
echo " Size:  $IMAGE_SIZE"
echo " Includes: Python 3, Node 22, Docker,"
echo "   bun, pnpm, typescript, git, tmux,"
echo "   vim, htop, ripgrep, uv, daemon"
echo "========================================"
