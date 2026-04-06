#!/usr/bin/env bash
# Build the JustAVPS golden VM image on a baremetal host.
#
# This creates a temporary VM, installs all heavy dependencies (Docker, daemon,
# sandbox-agent, opencode, fail2ban, etc.), cleans machine-specific state, then
# publishes it as a local Incus image.
#
# After this, new VMs clone from this image in ~2-5 seconds instead of running
# a full cloud-init install (~60-90 seconds).
#
# Usage: ssh root@HOST < scripts/build-golden-image.sh
#   or:  ssh root@HOST "bash -s" < scripts/build-golden-image.sh

set -euo pipefail

IMAGE_ALIAS="justavps-golden"
BUILD_VM="golden-builder"
DAEMON_CHANNEL="${DAEMON_CHANNEL:-dev}"
DAEMON_URL="https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev/daemon/${DAEMON_CHANNEL}/latest/justavps-daemon-linux-amd64"

echo "[golden] Starting golden image build..."

# Clean up any previous build
incus delete "$BUILD_VM" --force 2>/dev/null || true

# Create build VM from stock Ubuntu
echo "[golden] Creating build VM..."
incus init images:ubuntu/noble/cloud "$BUILD_VM" --vm
incus config set "$BUILD_VM" limits.cpu 4
incus config set "$BUILD_VM" limits.memory 4GiB
incus start "$BUILD_VM"

# Wait for cloud-init to finish on stock image
echo "[golden] Waiting for VM to boot..."
for i in $(seq 1 120); do
  if incus exec "$BUILD_VM" -- cloud-init status 2>/dev/null | grep -q "done"; then
    break
  fi
  sleep 1
done
echo "[golden] VM booted."

# Install everything heavy inside the VM
echo "[golden] Installing packages..."
incus exec "$BUILD_VM" -- bash -c '
export DEBIAN_FRONTEND=noninteractive

echo "[golden] Updating packages..."
apt-get update -qq
apt-get upgrade -y -qq

echo "[golden] Installing base packages..."
apt-get install -y -qq \
  curl ca-certificates wget git jq unzip htop tmux \
  ufw fail2ban openssh-server \
  >/dev/null 2>&1

echo "[golden] Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker

echo "[golden] Creating user account..."
id -u user &>/dev/null || useradd -m -s /bin/bash -G sudo,docker user
echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user

echo "[golden] Downloading justavps-daemon..."
curl -fsSL -o /usr/local/bin/justavps-daemon "'"$DAEMON_URL"'"
chmod +x /usr/local/bin/justavps-daemon

echo "[golden] Installing sandbox-agent..."
curl -fsSL https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh | sh || true
sandbox-agent install-agent --all 2>/dev/null || true

echo "[golden] Installing opencode..."
su - user -c "curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path" || true

echo "[golden] Configuring SSH hardening..."
sed -i "s/^#\?PasswordAuthentication.*/PasswordAuthentication no/" /etc/ssh/sshd_config
sed -i "s/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/" /etc/ssh/sshd_config
sed -i "s/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/" /etc/ssh/sshd_config

echo "[golden] Configuring UFW defaults..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable

echo "[golden] Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << EOF
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

echo "[golden] Writing systemd services..."

cat > /etc/systemd/system/justavps-daemon.service << EOF
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
EOF

cat > /etc/systemd/system/sandbox-agent.service << EOF
[Unit]
Description=Sandbox Agent
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

cat > /etc/systemd/system/opencode-web.service << EOF
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

# Docker ingress guard
cat > /usr/local/bin/justavps-docker-guard.sh << "GUARDEOF"
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
GUARDEOF
chmod +x /usr/local/bin/justavps-docker-guard.sh

cat > /etc/systemd/system/justavps-docker-guard.service << EOF
[Unit]
Description=JustAVPS Docker ingress guard
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/justavps-docker-guard.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

# Enable services (they will start on next boot when config exists)
systemctl daemon-reload
systemctl enable justavps-daemon sandbox-agent opencode-web justavps-docker-guard

# Pre-create config directory
mkdir -p /etc/justavps

echo "[golden] Cleaning machine-specific state..."
# Clean cloud-init instance data (NOT --logs which removes service files)
# Just remove the instance marker so cloud-init runs fresh on next boot
rm -rf /var/lib/cloud/instance /var/lib/cloud/data /var/lib/cloud/sem
rm -rf /var/log/cloud-init*.log
rm -f /etc/machine-id
: > /etc/machine-id
rm -f /var/lib/dbus/machine-id
truncate -s0 /etc/hostname
rm -f /etc/justavps/config.json /etc/justavps/env
rm -rf /root/.ssh/authorized_keys /home/user/.ssh/authorized_keys
rm -rf /tmp/* /var/tmp/*
# Stop services (they restart on clone via cloud-init user-data)
# IMPORTANT: do NOT disable or mask — cloud-init user-data will enable+start them
systemctl stop justavps-daemon 2>/dev/null || true
systemctl stop sandbox-agent 2>/dev/null || true
systemctl stop opencode-web 2>/dev/null || true
# Ensure they stay enabled and NOT masked
systemctl unmask justavps-daemon sandbox-agent opencode-web 2>/dev/null || true
systemctl enable justavps-daemon sandbox-agent opencode-web 2>/dev/null || true
# Ensure DHCP is configured for the network interface
mkdir -p /etc/netplan
cat > /etc/netplan/50-dhcp.yaml << NETPLANEOF
network:
  version: 2
  ethernets:
    enp5s0:
      dhcp4: true
    eth0:
      dhcp4: true
NETPLANEOF
apt-get clean
journalctl --rotate && journalctl --vacuum-time=1s 2>/dev/null || true

echo "[golden] Build VM prepared."
'

# Stop and publish
echo "[golden] Stopping build VM..."
incus stop "$BUILD_VM" --force

echo "[golden] Publishing golden image (this may take a minute)..."
incus image delete "$IMAGE_ALIAS" 2>/dev/null || true
incus publish "$BUILD_VM" --alias "$IMAGE_ALIAS" --reuse

echo "[golden] Cleaning up build VM..."
incus delete "$BUILD_VM" --force

# Warm the image volume so first clone is fast
echo "[golden] Warming image volume..."
incus init "$IMAGE_ALIAS" golden-warm-test --vm 2>/dev/null || true
incus delete golden-warm-test --force 2>/dev/null || true

IMAGE_FINGERPRINT=$(incus image info "$IMAGE_ALIAS" | grep "Fingerprint:" | awk '{print $2}')
echo ""
echo "========================================"
echo " Golden image built successfully!"
echo " Alias: $IMAGE_ALIAS"
echo " Fingerprint: $IMAGE_FINGERPRINT"
echo " New VMs will clone from this image."
echo "========================================"
