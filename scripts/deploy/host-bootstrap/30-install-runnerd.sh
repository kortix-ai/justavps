#!/usr/bin/env bash
set -euo pipefail

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

cd /opt/justavps-runnerd
npm install --omit=dev
systemctl daemon-reload
