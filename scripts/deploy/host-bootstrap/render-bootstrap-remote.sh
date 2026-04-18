#!/usr/bin/env bash
set -euo pipefail

: "${INCUS_CHANNEL:=stable}"
: "${STORAGE_DRIVER:=dir}"
: "${RUNNER_PORT:=7779}"

cat <<EOF
set -euo pipefail
export INCUS_CHANNEL=${INCUS_CHANNEL}
export STORAGE_DRIVER=${STORAGE_DRIVER}
export RUNNER_PORT=${RUNNER_PORT}
for phase in \
  /opt/justavps-host-bootstrap/00-prereqs.sh \
  /opt/justavps-host-bootstrap/10-install-incus.sh \
  /opt/justavps-host-bootstrap/20-configure-incus.sh \
  /opt/justavps-host-bootstrap/30-install-runnerd.sh \
  /opt/justavps-host-bootstrap/40-install-backups.sh \
  /opt/justavps-host-bootstrap/50-configure-oci-remotes.sh; do
  bash "\$phase"
done
bash /opt/justavps-host-bootstrap/doctor.sh >/var/log/justavps-host-bootstrap-doctor.json
EOF
