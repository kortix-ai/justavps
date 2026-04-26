#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4200}"
AUTH_ARGS=()
if [ -n "${V2_ADMIN_TOKEN:-}" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer ${V2_ADMIN_TOKEN}")
fi

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' -X "$method" --data "$body" "$BASE_URL$path"
  else
    curl -fsS "${AUTH_ARGS[@]}" -X "$method" "$BASE_URL$path"
  fi
}

json_get() {
  node -e 'const path=process.argv[1].split("."); let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { let value=JSON.parse(data); for (const key of path) value=value?.[key]; if (typeof value === "object") console.log(JSON.stringify(value)); else if (value !== undefined && value !== null) console.log(String(value)); });' "$1"
}

json_assert() {
  local label="$1"
  local expr="$2"
  node -e 'const label=process.argv[1]; const expr=process.argv[2]; let input=""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => { const data=JSON.parse(input); const ok=Function("data", `return (${expr});`)(data); if (!ok) { console.error(`JSON assertion failed: ${label}`); process.exit(1); } });' "$label" "$expr"
}

require_live() {
  if [ "${V2_E2E_LIVE:-}" != "true" ]; then
    echo "Skipping live Incus E2E: set V2_E2E_LIVE=true to create/delete real instances."
    exit 0
  fi
}

require_image() {
  if [ -z "${V2_E2E_IMAGE:-}" ]; then
    echo "V2_E2E_IMAGE is required for live machine E2E."
    exit 1
  fi
}

require_vm_image() {
  if [ -z "${V2_E2E_VM_IMAGE:-}" ]; then
    echo "V2_E2E_VM_IMAGE is required for live VM E2E."
    exit 1
  fi
}
