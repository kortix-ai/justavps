#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  printf 'Usage: %s <procurement-id> <admin-api-key> [api-base-url]\n' "$0" >&2
  exit 1
fi

PROCUREMENT_ID="$1"
ADMIN_API_KEY="$2"
API_BASE_URL="${3:-http://localhost:4100/api/v2/admin/fleet}"

while true; do
  sync_json="$(curl -sf -X POST "${API_BASE_URL}/procurements/${PROCUREMENT_ID}/sync" -H "Authorization: Bearer ${ADMIN_API_KEY}")"
  parsed="$(python3 - <<'PY' "$sync_json"
import json, sys
data = json.loads(sys.argv[1])
p = data['procurement']
print(p.get('status') or '')
print((p.get('metadata') or {}).get('server_ip') or '')
print(p.get('host_id') or '')
PY
)"
  status="$(printf '%s\n' "$parsed" | sed -n '1p')"
  server_ip="$(printf '%s\n' "$parsed" | sed -n '2p')"
  host_id="$(printf '%s\n' "$parsed" | sed -n '3p')"

  printf 'procurement=%s status=%s ip=%s host=%s\n' "$PROCUREMENT_ID" "$status" "${server_ip:-none}" "$host_id"

  if [[ "$status" == "bootstrapping" && -n "$server_ip" && -n "$host_id" ]]; then
    exec "$(dirname "$0")/bootstrap-baremetal-host.sh" "$host_id" "$server_ip" "$ADMIN_API_KEY" "$API_BASE_URL"
  fi

  sleep 30
done
