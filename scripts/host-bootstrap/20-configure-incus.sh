#!/usr/bin/env bash
set -euo pipefail

: "${STORAGE_DRIVER:=dir}"

if ! incus storage list --format csv 2>/dev/null | grep -q '^default,'; then
  cat <<EOF | incus admin init --preseed
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
  driver: ${STORAGE_DRIVER}
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
EOF
fi
