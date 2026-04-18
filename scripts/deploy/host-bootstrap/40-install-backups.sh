#!/usr/bin/env bash
set -euo pipefail

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

systemctl enable --now justavps-incus-db-backup.timer
systemctl start justavps-incus-db-backup.service
