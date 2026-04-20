#!/usr/bin/env bash
set -euo pipefail

: "${STORAGE_DRIVER:=zfs}"
: "${STORAGE_SOURCE:=}"
: "${INCUS_STORAGE_POOL:=default}"
: "${INCUS_MANAGED_NETWORK:=incusbr0}"

if ! incus storage list --format csv 2>/dev/null | grep -q "^${INCUS_STORAGE_POOL},"; then
  storage_source_block=""
  if [[ -n "${STORAGE_SOURCE}" ]]; then
    storage_source_block="    source: ${STORAGE_SOURCE}"
  fi

  cat <<EOF | incus admin init --preseed
config:
  images.auto_update_interval: "15"
networks:
- name: ${INCUS_MANAGED_NETWORK}
  type: bridge
  config:
    ipv4.address: auto
    ipv6.address: none
storage_pools:
- name: ${INCUS_STORAGE_POOL}
  driver: ${STORAGE_DRIVER}
${storage_source_block}
profiles:
- name: default
  devices:
    root:
      path: /
      pool: ${INCUS_STORAGE_POOL}
      type: disk
    eth0:
      name: eth0
      nictype: bridged
      parent: ${INCUS_MANAGED_NETWORK}
      type: nic
EOF
fi
