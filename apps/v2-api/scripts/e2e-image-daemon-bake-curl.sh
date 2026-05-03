#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${V2_API_URL:-http://localhost:4200}"
ADMIN_TOKEN="${V2_E2E_ADMIN_TOKEN:-${V2_ADMIN_TOKEN:-v2e2e-admin}}"
ACCOUNT_ID="${V2_E2E_ACCOUNT_ID:-image-daemon-bake-e2e-$(date +%s)}"
IMAGE_ALIAS="${V2_E2E_IMAGE_ALIAS:-jvps-baked-$(date +%s)}"

TMP_DIR="$(mktemp -d)"
SOURCE_MACHINE_ID=""
CLAIM_MACHINE_ID=""
POLICY_ID=""

log() { printf '[image-daemon-bake-e2e] %s\n' "$*"; }
fail() { printf '[image-daemon-bake-e2e] ERROR: %s\n' "$*" >&2; exit 1; }

json_get() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    value = json.load(f)
for part in sys.argv[2].split('.'):
    if part == '':
        continue
    value = value[int(part)] if isinstance(value, list) else value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value, separators=(',', ':')))
elif value is None:
    print('')
else:
    print(value)
PY
}

request() {
  local method="$1"
  local path="$2"
  local body_file="${3:-}"
  local out_file="$4"
  shift 4 || true
  local meta_file="$TMP_DIR/meta-$(date +%s)-$RANDOM.txt"
  local curl_args=(-fsS -o "$out_file" -w '%{http_code} %{time_total}' -X "$method" -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID")
  for header in "$@"; do curl_args+=(-H "$header"); done
  if [[ -n "$body_file" ]]; then curl_args+=(-H 'Content-Type: application/json' --data-binary "@$body_file"); fi
  curl_args+=("$API_URL$path")
  if ! curl "${curl_args[@]}" > "$meta_file"; then
    [[ -s "$out_file" ]] && cat "$out_file" >&2 || true
    fail "curl failed for $method $path"
  fi
  local code time_total
  read -r code time_total < "$meta_file" || true
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    cat "$out_file" >&2 || true
    fail "$method $path returned HTTP $code"
  fi
  printf '%s' "$time_total" > "$out_file.time_total"
}

cleanup() {
  set +e
  log "cleanup account=$ACCOUNT_ID alias=$IMAGE_ALIAS"
  [[ -n "$POLICY_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID" "$API_URL/warm-pool-policies/$POLICY_ID" || true
  [[ -n "$CLAIM_MACHINE_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$CLAIM_MACHINE_ID" || true
  [[ -n "$SOURCE_MACHINE_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$SOURCE_MACHINE_ID" || true
  curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/images/$IMAGE_ALIAS" || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log "preflight api=$API_URL account=$ACCOUNT_ID alias=$IMAGE_ALIAS"
request GET /health '' "$TMP_DIR/health.json"

log 'create source container machine'
cat > "$TMP_DIR/source-machine.json" <<JSON
{"region":"eu","type":"container","name":"image-bake-source","resources":{"vcpu":1,"memory_gb":1,"disk_gb":10},"source":{"type":"image","image_id":"justavps-golden-container"}}
JSON
request POST /machines "$TMP_DIR/source-machine.json" "$TMP_DIR/source-machine.out.json" "X-JustAVPS-Request-Id: image-bake-source-$ACCOUNT_ID"
SOURCE_MACHINE_ID="$(json_get "$TMP_DIR/source-machine.out.json" machine.id)"

log 'publish daemon-baked image from source machine'
cat > "$TMP_DIR/create-image.json" <<JSON
{"machine_id":"$SOURCE_MACHINE_ID","name":"$IMAGE_ALIAS","public":false,"properties":{"e2e":"image-daemon-bake"}}
JSON
request POST /images "$TMP_DIR/create-image.json" "$TMP_DIR/create-image.out.json"
python3 - "$TMP_DIR/create-image.out.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
prep = d.get('justavps_preparation') or {}
assert prep.get('first_usability', {}).get('ok') is True, prep
assert prep.get('initial_bake', {}).get('ok') is True, prep
assert prep.get('second_boot_usability', {}).get('ok') is True, prep
assert prep.get('final_bake', {}).get('ok') is True, prep
print(json.dumps({
  'image_prepared': True,
  'first_usability_ms': prep.get('first_usability', {}).get('duration_ms'),
  'second_boot_usability_ms': prep.get('second_boot_usability', {}).get('duration_ms'),
}, separators=(',', ':')))
PY

log 'create pool policy from baked image and refill'
cat > "$TMP_DIR/policy.json" <<JSON
{"name":"image-bake-pool","region":"eu","type":"container","resources":{"vcpu":1,"memory_gb":1,"disk_gb":10},"source":{"type":"image","image_id":"$IMAGE_ALIAS"},"target":1,"metadata":{"e2e":"image-daemon-bake"}}
JSON
request POST /warm-pool-policies "$TMP_DIR/policy.json" "$TMP_DIR/policy.out.json"
POLICY_ID="$(json_get "$TMP_DIR/policy.out.json" policy.id)"
request POST "/warm-pool-policies/$POLICY_ID/refill" '' "$TMP_DIR/refill.out.json"
request GET /admin/warm-pool '' "$TMP_DIR/admin-warm.out.json"
python3 - "$TMP_DIR/admin-warm.out.json" "$POLICY_ID" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
policy = sys.argv[2]
rows = [m for m in d.get('machines', []) if m.get('policy_id') == policy]
assert rows, d
warm = rows[0].get('warm_pool') or {}
assert warm.get('primed') is True, warm
assert warm.get('second_boot_validated') is True, warm
prime = warm.get('prime_telemetry') or {}
daemon = prime.get('managed_daemon') or {}
assert daemon.get('daemon_source') == 'baked', daemon
print(json.dumps({'pool_primed_from_baked_daemon': True, 'prime_ms': warm.get('prime_usability_ms'), 'second_boot_ms': warm.get('second_boot_usability_ms')}, separators=(',', ':')))
PY

log 'claim baked-image pool slot without daemon repair latency'
REQUEST_ID="image-bake-claim-$ACCOUNT_ID"
cat > "$TMP_DIR/claim.json" <<JSON
{"region":"eu","type":"container","name":"image-bake-claim","resources":{"vcpu":1,"memory_gb":1,"disk_gb":10},"source":{"type":"image","image_id":"$IMAGE_ALIAS"}}
JSON
request POST /machines "$TMP_DIR/claim.json" "$TMP_DIR/claim.out.json" "X-JustAVPS-Request-Id: $REQUEST_ID"
CLAIM_MACHINE_ID="$(json_get "$TMP_DIR/claim.out.json" machine.id)"
request GET "/admin/telemetry/creations/$REQUEST_ID" '' "$TMP_DIR/trace.out.json"
python3 - "$TMP_DIR/trace.out.json" <<'PY'
import json, sys
trace = json.load(open(sys.argv[1]))['trace']
names = [s.get('name') for s in trace.get('spans', [])]
assert trace.get('labels', {}).get('warm_pool_hit') is True, trace
assert 'usable: repair managed daemon' not in names, names
assert 'usable: restart managed daemon service' not in names, names
assert any(name in ('usable: actual live: command file daemon', 'usable: managed daemon health') for name in names), names
print(json.dumps({'claim_ms': trace.get('duration_ms'), 'spans': [n for n in names if n.startswith('usable:')]}, separators=(',', ':')))
PY

log 'PASS image daemon bake E2E'
