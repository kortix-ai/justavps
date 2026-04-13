#!/usr/bin/env bash
set -euo pipefail

: "${INCUS_CHANNEL:=stable}"

mkdir -p /etc/apt/keyrings
curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc
rm -f /etc/apt/sources.list.d/zabbly-incus-*.sources
cat >"/etc/apt/sources.list.d/zabbly-incus-${INCUS_CHANNEL}.sources" <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/${INCUS_CHANNEL}
Suites: noble
Components: main
Architectures: amd64
Signed-By: /etc/apt/keyrings/zabbly.asc
EOF
apt-get update
apt-get install -y qemu-system-x86 qemu-utils incus incus-client incus-base zfsutils-linux skopeo umoci
systemctl enable --now incus
incus admin waitready --timeout=600
