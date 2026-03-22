#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${1:-/tmp/kortix-broker}"
SERVICE_PATH="${2:-/tmp/kortix-broker.service}"
LISTEN_ADDR="${BROKER_LISTEN_ADDR:-:80}"
ENV_FILE="/etc/kortix-broker.env"
INSTALL_PATH="/usr/local/bin/kortix-broker"
SYSTEMD_PATH="/etc/systemd/system/kortix-broker.service"

if [[ -z "${BROKER_SHARED_SECRET:-}" ]]; then
  echo "BROKER_SHARED_SECRET is required" >&2
  exit 1
fi

if [[ ! -f "$ARTIFACT_PATH" ]]; then
  echo "Broker artifact not found: $ARTIFACT_PATH" >&2
  exit 1
fi

if [[ ! -f "$SERVICE_PATH" ]]; then
  echo "Broker service file not found: $SERVICE_PATH" >&2
  exit 1
fi

install -m 0755 "$ARTIFACT_PATH" "$INSTALL_PATH"
install -m 0644 "$SERVICE_PATH" "$SYSTEMD_PATH"

cat > "$ENV_FILE" <<EOF
BROKER_SHARED_SECRET=${BROKER_SHARED_SECRET}
BROKER_LISTEN_ADDR=${LISTEN_ADDR}
EOF
chmod 0600 "$ENV_FILE"

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl enable --now kortix-broker
systemctl restart kortix-broker
systemctl is-active --quiet kortix-broker
curl -fsS http://127.0.0.1/healthz >/dev/null

echo "kortix-broker installed and healthy"
