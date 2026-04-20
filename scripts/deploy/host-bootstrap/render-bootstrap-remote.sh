#!/usr/bin/env bash
set -euo pipefail

: "${INCUS_CHANNEL:=stable}"
: "${STORAGE_DRIVER:=zfs}"
: "${INCUS_PROJECT:=justavps-platform}"
: "${JUSTAVPS_INCUS_PLATFORM_PROJECT:=justavps-platform}"
: "${JUSTAVPS_INCUS_OPERATOR_PROJECT:=justavps-operator}"
: "${JUSTAVPS_INCUS_CONTAINER_DEFAULT_PROFILE:=platform-container-default}"
: "${JUSTAVPS_INCUS_CONTAINER_HARDENED_PROFILE:=platform-container-hardened}"
: "${JUSTAVPS_INCUS_VM_DEFAULT_PROFILE:=platform-vm-default}"
: "${JUSTAVPS_INCUS_WARM_POOL_PROFILE:=platform-warm-pool}"
: "${JUSTAVPS_INCUS_OPERATOR_DEBUG_PROFILE:=platform-operator-debug}"
: "${RUNNER_PORT:=7779}"

cat <<EOF
set -euo pipefail
export INCUS_CHANNEL=${INCUS_CHANNEL}
export STORAGE_DRIVER=${STORAGE_DRIVER}
export INCUS_PROJECT=${INCUS_PROJECT}
export JUSTAVPS_INCUS_PLATFORM_PROJECT=${JUSTAVPS_INCUS_PLATFORM_PROJECT}
export JUSTAVPS_INCUS_OPERATOR_PROJECT=${JUSTAVPS_INCUS_OPERATOR_PROJECT}
export JUSTAVPS_INCUS_CONTAINER_DEFAULT_PROFILE=${JUSTAVPS_INCUS_CONTAINER_DEFAULT_PROFILE}
export JUSTAVPS_INCUS_CONTAINER_HARDENED_PROFILE=${JUSTAVPS_INCUS_CONTAINER_HARDENED_PROFILE}
export JUSTAVPS_INCUS_VM_DEFAULT_PROFILE=${JUSTAVPS_INCUS_VM_DEFAULT_PROFILE}
export JUSTAVPS_INCUS_WARM_POOL_PROFILE=${JUSTAVPS_INCUS_WARM_POOL_PROFILE}
export JUSTAVPS_INCUS_OPERATOR_DEBUG_PROFILE=${JUSTAVPS_INCUS_OPERATOR_DEBUG_PROFILE}
export RUNNER_PORT=${RUNNER_PORT}
for phase in \
  /opt/justavps-host-bootstrap/00-prereqs.sh \
  /opt/justavps-host-bootstrap/10-install-incus.sh \
  /opt/justavps-host-bootstrap/20-configure-incus.sh \
  /opt/justavps-host-bootstrap/25-seed-incus-baseline.sh \
  /opt/justavps-host-bootstrap/30-install-runnerd.sh \
  /opt/justavps-host-bootstrap/40-install-backups.sh \
  /opt/justavps-host-bootstrap/50-configure-oci-remotes.sh; do
  bash "\$phase"
done
bash /opt/justavps-host-bootstrap/doctor.sh >/var/log/justavps-host-bootstrap-doctor.json
EOF
