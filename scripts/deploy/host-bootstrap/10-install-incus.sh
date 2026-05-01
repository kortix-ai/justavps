#!/usr/bin/env bash
set -euo pipefail

# lts-6.0 is the conservative LTS branch (6.0.6 as of 2026-04). The
# `stable` channel currently ships 6.23 which has a managed-bridge race
# in cluster joins; LTS predates the regression. Override per-cluster
# via INCUS_CHANNEL (e.g. `daily` for nightly main).
: "${INCUS_CHANNEL:=lts-6.0}"

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
