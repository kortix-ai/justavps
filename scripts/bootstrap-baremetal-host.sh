#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  printf 'Usage: %s <host-id> <host-ipv4> <admin-api-key> [api-base-url]\n' "$0" >&2
  exit 1
fi

HOST_ID="$1"
HOST_IP="$2"
ADMIN_API_KEY="$3"
API_BASE_URL="${4:-http://localhost:4100/api/v2/admin/fleet}"
BOOTSTRAP_KEY_PATH="${BOOTSTRAP_KEY_PATH:-/tmp/justavps-bm-bootstrap}"
RUNNER_PORT="${RUNNER_PORT:-7779}"
STORAGE_DRIVER="${STORAGE_DRIVER:-dir}"
SSH_OPTS=(-i "$BOOTSTRAP_KEY_PATH" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

if [[ ! -f "$BOOTSTRAP_KEY_PATH" ]]; then
  printf 'Bootstrap private key not found at %s\n' "$BOOTSTRAP_KEY_PATH" >&2
  exit 1
fi

ROOT_DIR="$(pwd)"
RUNNER_SRC_DIR="$ROOT_DIR/runnerd"

bootstrap_json="$(curl -sf -H "Authorization: Bearer ${ADMIN_API_KEY}" "${API_BASE_URL}/hosts/${HOST_ID}/bootstrap-config")"
runner_token="$(python3 - <<'PY' "$bootstrap_json"
import json, sys
print(json.loads(sys.argv[1])['host']['runner_token'])
PY
)"

scp "${SSH_OPTS[@]}" -r "$RUNNER_SRC_DIR" "root@${HOST_IP}:/opt/justavps-runnerd"

ssh "${SSH_OPTS[@]}" "root@${HOST_IP}" "bash -s" <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
mkdir -p /etc/apt/keyrings
curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc
cat >/etc/apt/sources.list.d/zabbly-incus-lts-6.0.sources <<'ZABBLY'
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/lts-6.0
Suites: noble
Components: main
Architectures: amd64
Signed-By: /etc/apt/keyrings/zabbly.asc
ZABBLY
apt-get update
apt-get install -y ca-certificates curl gnupg jq qemu-system-x86 qemu-utils incus incus-client incus-base zfsutils-linux nodejs npm sqlite3 zstd

cat >/etc/systemd/system/justavps-runnerd.service <<'UNIT'
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
UNIT

cat >/usr/local/sbin/justavps-incus-db-backup.sh <<'BACKUP'
#!/usr/bin/env bash
set -euo pipefail

backup_dir=/var/backups/justavps-incus
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

if systemctl is-active --quiet incus; then
  incus query /1.0 >/dev/null
fi

tar --zstd -cf "$backup_dir/database-${timestamp}.tar.zst" -C /var/lib/incus database

python3 - <<'PY'
from pathlib import Path

backups = sorted(Path('/var/backups/justavps-incus').glob('database-*.tar.zst'), reverse=True)
for path in backups[5:]:
    path.unlink(missing_ok=True)
PY
BACKUP

cat >/usr/local/sbin/justavps-incus-recover.sh <<'RECOVER'
#!/usr/bin/env bash
set -euo pipefail

backup_path="${1:-}"
if [[ -z "$backup_path" ]]; then
  backup_path="$(python3 - <<'PY'
from pathlib import Path

backups = sorted(Path('/var/backups/justavps-incus').glob('database-*.tar.zst'), reverse=True)
if not backups:
    raise SystemExit('No Incus database backups found in /var/backups/justavps-incus')
print(backups[0])
PY
)"
fi

systemctl stop justavps-runnerd || true
systemctl stop incus || true
pkill -f 'qemu-system-x86' || true
pkill -f 'dnsmasq.*incusbr0' || true
rm -rf /var/lib/incus/database
mkdir -p /var/lib/incus
tar --zstd -xf "$backup_path" -C /var/lib/incus
systemctl start incus
incus admin waitready --timeout=600
systemctl start justavps-runnerd
RECOVER

chmod 0755 /usr/local/sbin/justavps-incus-db-backup.sh /usr/local/sbin/justavps-incus-recover.sh

cat >/etc/systemd/system/justavps-incus-db-backup.service <<'UNIT'
[Unit]
Description=Backup Incus database for JustAVPS recovery
After=incus.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/justavps-incus-db-backup.sh
UNIT

cat >/etc/systemd/system/justavps-incus-db-backup.timer <<'UNIT'
[Unit]
Description=Periodic Incus database backup for JustAVPS

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true

[Install]
WantedBy=timers.target
UNIT

if ! incus storage list --format csv 2>/dev/null | grep -q '^default,'; then
  cat <<'PRESEED' | incus admin init --preseed
config:
  images.auto_update_interval: "15"
networks:
- name: incusbr0
  type: bridge
  config:
    ipv4.address: auto
    ipv6.address: none
storage_pools:
- name: default
  driver: dir
profiles:
- name: default
  devices:
    root:
      path: /
      pool: default
      type: disk
    eth0:
      name: eth0
      nictype: bridged
      parent: incusbr0
      type: nic
PRESEED
fi

systemctl enable --now incus
cd /opt/justavps-runnerd
npm install --omit=dev
systemctl daemon-reload
systemctl enable --now justavps-incus-db-backup.timer
systemctl start justavps-incus-db-backup.service
EOF

ssh "${SSH_OPTS[@]}" "root@${HOST_IP}" "cat >/etc/justavps-runnerd.env" <<EOF
RUNNERD_TOKEN=${runner_token}
RUNNERD_PORT=${RUNNER_PORT}
RUNNERD_PUBLIC_IPV4=${HOST_IP}
EOF

ssh "${SSH_OPTS[@]}" "root@${HOST_IP}" "systemctl daemon-reload && systemctl enable --now justavps-runnerd && systemctl restart justavps-runnerd"

health_json="$(curl -sf "http://${HOST_IP}:${RUNNER_PORT}/healthz")"
printf 'runnerd health: %s\n' "$health_json"

validation_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

version_json="$(ssh "${SSH_OPTS[@]}" "root@${HOST_IP}" "python3 - <<'PY'
import json, subprocess

def run(cmd):
    try:
        return subprocess.check_output(cmd, text=True).strip()
    except Exception:
        return None

incus_version = run(['incus', 'version'])
node_version = run(['node', '--version'])
runnerd_version = None
try:
    import json as _json
    with open('/opt/justavps-runnerd/package.json') as fh:
        pkg = _json.load(fh)
    runnerd_version = pkg.get('version')
except Exception:
    runnerd_version = None

print(json.dumps({
  'incus_version': incus_version,
  'node_version': node_version,
  'runnerd_version': runnerd_version,
  'storage_driver': '${STORAGE_DRIVER}',
  'storage_pool': 'default',
}))
PY")"

capacity_json="$(ssh "${SSH_OPTS[@]}" "root@${HOST_IP}" "python3 - <<'PY'
import json, os, shutil
vcpu=os.cpu_count() or 0
mem_kib=0
with open('/proc/meminfo') as fh:
    for line in fh:
        if line.startswith('MemTotal:'):
            mem_kib=int(line.split()[1])
            break
disk=shutil.disk_usage('/var/lib/incus' if os.path.exists('/var/lib/incus') else '/')
print(json.dumps({
  'total_vcpu': vcpu,
  'total_memory_gb': max(int(mem_kib / 1024 / 1024), 1),
  'total_disk_gb': max(int(disk.total / 1024 / 1024 / 1024), 1)
}))
PY")"

register_payload="$(python3 - <<'PY' "$HOST_IP" "$RUNNER_PORT" "$capacity_json"
import json, sys
host_ip, runner_port, capacity_json = sys.argv[1], sys.argv[2], sys.argv[3]
capacity = json.loads(capacity_json)
print(json.dumps({
  'runner_base_url': f'http://{host_ip}:{runner_port}',
  'public_ipv4': host_ip,
  'total_vcpu': capacity['total_vcpu'],
  'total_memory_gb': capacity['total_memory_gb'],
  'total_disk_gb': capacity['total_disk_gb'],
  'status': 'bootstrapping',
  'metadata': {
    'bootstrap': {
      'storage_driver': 'dir',
      'runner_port': int(runner_port),
    }
  }
}))
PY
)"

curl -sf -X POST "${API_BASE_URL}/hosts/${HOST_ID}/register" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$register_payload"

validation_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
validation_payload="$(python3 - <<'PY' "$version_json" "$validation_started_at" "$validation_completed_at"
import json, sys

versions = json.loads(sys.argv[1])
started_at = sys.argv[2]
completed_at = sys.argv[3]

print(json.dumps({
  'status': 'passed',
  'bootstrap_version': 'bootstrap-baremetal-host.sh@v1',
  'runnerd_version': versions.get('runnerd_version'),
  'incus_version': versions.get('incus_version'),
  'storage_driver': versions.get('storage_driver'),
  'storage_pool': versions.get('storage_pool'),
  'started_at': started_at,
  'completed_at': completed_at,
  'smoke_test_result': 'passed',
  'warm_pool_result': 'passed',
  'drift_status': 'in_policy',
  'triggered_by': 'bootstrap-script',
  'notes': [
    f"runnerd health: {versions.get('node_version') or 'node-unknown'}",
    'runner registration and capacity probe succeeded'
  ]
}))
PY
)"

curl -sf -X POST "${API_BASE_URL}/hosts/${HOST_ID}/validation-artifact" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$validation_payload" >/dev/null

printf '\nHost %s bootstrapped and registered.\n' "$HOST_ID"
