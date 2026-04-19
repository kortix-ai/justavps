#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${1:-/tmp/kortix-broker}"
SERVICE_PATH="${2:-/tmp/kortix-broker.service}"
LISTEN_ADDR="${BROKER_LISTEN_ADDR:-:80}"
ENV_FILE="/etc/kortix-broker.env"
INSTALL_PATH="/usr/local/bin/kortix-broker"
SYSTEMD_PATH="/etc/systemd/system/kortix-broker.service"
TLS_DIR="/etc/kortix-broker"
TLS_CERT_PATH="$TLS_DIR/origin.crt"
TLS_KEY_PATH="$TLS_DIR/origin.key"

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

mkdir -p "$TLS_DIR"
chmod 0700 "$TLS_DIR"

TLS_ENV=""
if [[ -n "${BROKER_TLS_CERT_B64:-}" && -n "${BROKER_TLS_KEY_B64:-}" ]]; then
  printf '%s' "$BROKER_TLS_CERT_B64" | base64 --decode > "$TLS_CERT_PATH"
  printf '%s' "$BROKER_TLS_KEY_B64" | base64 --decode > "$TLS_KEY_PATH"
  chmod 0600 "$TLS_CERT_PATH" "$TLS_KEY_PATH"
  TLS_ENV=$(cat <<EOF
BROKER_TLS_CERT_PATH=${TLS_CERT_PATH}
BROKER_TLS_KEY_PATH=${TLS_KEY_PATH}
BROKER_HTTPS_LISTEN_ADDR=:443
EOF
)
fi

cat > "$ENV_FILE" <<EOF
BROKER_SHARED_SECRET=${BROKER_SHARED_SECRET}
BROKER_LISTEN_ADDR=${LISTEN_ADDR}
${TLS_ENV}
EOF
chmod 0600 "$ENV_FILE"

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl enable --now kortix-broker
systemctl restart kortix-broker
systemctl is-active --quiet kortix-broker
curl -fsS http://127.0.0.1/healthz >/dev/null
if [[ -f "$TLS_CERT_PATH" && -f "$TLS_KEY_PATH" ]]; then
  curl -fsSk https://127.0.0.1/health >/dev/null
fi

echo "kortix-broker installed and healthy"
