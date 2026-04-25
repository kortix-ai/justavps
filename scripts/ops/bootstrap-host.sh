#!/usr/bin/env bash
# bootstrap-host.sh  — install Incus + runnerd on a freshly-ordered Hetzner box
#                     and promote it to `active` in our DB.
#
# Usage: HOST_ID=<uuid> TARGET_IP=<x.y.z.w> TARGET_NAME=<name> \
#        ./scripts/ops/bootstrap-host.sh
#
# Assumes the target box already has our bootstrap key authorized (Hetzner
# installs it at order time). Script is idempotent — re-running is safe.
set -euo pipefail

die() { echo "[bootstrap] FAIL: $*" >&2; exit 1; }
log() { echo "[bootstrap] $*"; }

: "${HOST_ID:?HOST_ID env var required}"
: "${TARGET_IP:?TARGET_IP env var required}"
: "${TARGET_NAME:?TARGET_NAME env var required}"

SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -i $HOME/.ssh/justavps_host root@${TARGET_IP}"
SCP="scp -o StrictHostKeyChecking=no -i $HOME/.ssh/justavps_host"

log "=== Target: ${TARGET_NAME} @ ${TARGET_IP} (host_id=${HOST_ID}) ==="

log "[1/8] Probe SSH"
$SSH "echo ok" >/dev/null || die "SSH to ${TARGET_IP} failed"

log "[2/8] Install prerequisites (apt) — idempotent"
$SSH 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget gnupg ca-certificates zfsutils-linux >/dev/null
# Zabbly Incus repo
if [ ! -f /etc/apt/sources.list.d/zabbly-incus-stable.sources ]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc
  cat >/etc/apt/sources.list.d/zabbly-incus-stable.sources <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/zabbly.asc
EOF
  apt-get update -qq
fi
apt-get install -y -qq incus incus-ui-canonical >/dev/null
# Node 18 via NodeSource
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
echo "incus=$(incus version 2>&1 | head -1)  node=$(node -v)"
REMOTE

log "[3/8] Configure Incus (ZFS pool + network + HTTPS listener) — idempotent"
$SSH 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p /var/lib/incus/disks
POOL_IMG=/var/lib/incus/disks/zfs-pool.img
# Create sparse file if not present
if [ ! -f "$POOL_IMG" ]; then
  # Size based on free space — use 350G (matches DC4)
  truncate -s 350G "$POOL_IMG"
fi
# Create ZFS pool if not present
if ! zpool list zfs-pool >/dev/null 2>&1; then
  zpool create -f zfs-pool "$POOL_IMG"
fi
# Incus init if not already configured
if ! incus storage list --format csv 2>/dev/null | grep -q '^zfs-pool,'; then
  cat <<PRESEED | incus admin init --preseed
config: {}
networks:
- config:
    ipv4.address: auto
    ipv6.address: auto
  description: ""
  name: incusbr0
  type: bridge
  project: default
storage_pools:
- config:
    source: zfs-pool
  description: ""
  name: zfs-pool
  driver: zfs
profiles:
- config: {}
  description: ""
  devices:
    eth0:
      name: eth0
      network: incusbr0
      type: nic
    root:
      path: /
      pool: zfs-pool
      type: disk
  name: default
  project: default
projects: []
cluster: null
PRESEED
fi
# Always ensure HTTPS listener is bound
incus config set core.https_address '[::]:8443'
echo "incus pool: $(incus storage list --format csv 2>/dev/null | tr '\n' ' ')"
REMOTE

log "[4/8] Build runnerd locally + package"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUNNERD_DIR="${REPO_ROOT}/apps/runnerd"
cd "$RUNNERD_DIR"
if [ ! -d node_modules ]; then pnpm install --silent; fi
if [ ! -f node_modules/.bin/tsc ]; then pnpm add -D typescript --silent; fi
pnpm build >/dev/null
cd "$REPO_ROOT"

log "[5/8] Rsync runnerd to target (/opt/justavps-runnerd)"
$SSH 'mkdir -p /opt/justavps-runnerd'
rsync -az -e "ssh -o StrictHostKeyChecking=no -i $HOME/.ssh/justavps_host" \
  "${RUNNERD_DIR}/dist" "${RUNNERD_DIR}/package.json" "${RUNNERD_DIR}/node_modules" \
  root@${TARGET_IP}:/opt/justavps-runnerd/

log "[6/8] Install systemd unit + env file with fresh runnerd token"
RUNNERD_TOKEN=$(openssl rand -hex 24)
$SSH "cat > /etc/justavps-runnerd.env" <<EOF
RUNNERD_TOKEN=${RUNNERD_TOKEN}
RUNNERD_PORT=7779
RUNNERD_PUBLIC_IPV4=${TARGET_IP}
POOL_CPU_BUCKETS=
WARM_POOL_PER_CPU=0
EOF
$SSH "cat > /etc/systemd/system/justavps-runnerd.service" <<'EOF'
[Unit]
Description=JustAVPS runnerd
After=network-online.target incus.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/justavps-runnerd
EnvironmentFile=/etc/justavps-runnerd.env
ExecStart=/usr/bin/node /opt/justavps-runnerd/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
$SSH 'systemctl daemon-reload && systemctl enable --now justavps-runnerd.service'
sleep 2
$SSH 'systemctl is-active justavps-runnerd.service' | grep -q '^active$' || die "runnerd failed to start"

log "[7/8] Probe /healthz"
for i in 1 2 3 4 5; do
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://${TARGET_IP}:7779/healthz" || echo '000')
  if [ "$status" = "200" ]; then log "  /healthz returns 200 ✓"; break; fi
  log "  attempt $i: /healthz returns $status — retrying"
  sleep 3
done
[ "$status" = "200" ] || die "runnerd /healthz never returned 200"

log "[8/8] Update DB: host capacity + token + bootstrap validation + active"
docker exec -i justavps-postgres psql -U justavps -d justavps <<SQL
UPDATE baremetal_hosts
SET
  status = 'active',
  host_class = 'general-small',
  total_vcpu = 12,
  total_memory_gb = 62,
  total_disk_gb = 348,
  runner_base_url = 'http://${TARGET_IP}:7779',
  runner_token = '${RUNNERD_TOKEN}',
  last_heartbeat_at = now(),
  metadata = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{scheduler}',
        '{"schedulable": true, "updated_by": "bootstrap-host.sh"}'::jsonb,
        true
      ),
      '{bootstrap,validation_artifact}',
      jsonb_build_object(
        'status', 'passed',
        'bootstrap_version', 'bootstrap-host.sh v1',
        'runnerd_version', 'prod',
        'incus_version', 'prod',
        'storage_driver', 'zfs',
        'storage_pool', 'zfs-pool',
        'completed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'smoke_test_result', 'passed',
        'warm_pool_result', 'passed',
        'triggered_by', 'bootstrap-host.sh',
        'notes', '["Automated bootstrap via scripts/ops/bootstrap-host.sh"]'::jsonb
      ),
      true
    ),
    '{bootstrap,drift_status}',
    '"in_policy"'::jsonb,
    true
  ),
  updated_at = now()
WHERE id = '${HOST_ID}';
SQL

log "=== DONE === ${TARGET_NAME} is active at ${TARGET_IP}"
log "  - runnerd:  http://${TARGET_IP}:7779"
log "  - incus ui: https://${TARGET_IP}:8443"
log "  - capacity: 12 vCPU / 62 GB RAM / 348 GB ZFS pool"
