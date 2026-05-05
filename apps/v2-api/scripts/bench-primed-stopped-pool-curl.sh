#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${V2_API_URL:-http://localhost:4200}"
ADMIN_TOKEN="${V2_E2E_ADMIN_TOKEN:-${V2_ADMIN_TOKEN:-v2e2e-admin}}"
ACCOUNT_ID="${V2_BENCH_ACCOUNT_ID:-primed-warm-pool-bench-$(date +%s)}"
MACHINE_TYPE="${V2_BENCH_MACHINE_TYPE:-container}"
IMAGE_ID="${V2_BENCH_IMAGE_ID:-justavps-ubuntu-24.04-template}"
VCPU="${V2_BENCH_VCPU:-2}"
MEMORY_GB="${V2_BENCH_MEMORY_GB:-2}"
DISK_GB="${V2_BENCH_DISK_GB:-10}"

TMP_DIR="$(mktemp -d)"
POLICY_ID=""
MACHINE_ID=""

log() { printf '[primed-warm-pool-bench] %s\n' "$*"; }
fail() { printf '[primed-warm-pool-bench] ERROR: %s\n' "$*" >&2; exit 1; }

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
  log "cleanup account=$ACCOUNT_ID"
  [[ -n "$POLICY_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID" "$API_URL/warm-pool-policies/$POLICY_ID" || true
  [[ -n "$MACHINE_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$MACHINE_ID" || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log "preflight api=$API_URL account=$ACCOUNT_ID type=$MACHINE_TYPE image=$IMAGE_ID shape=${VCPU}c/${MEMORY_GB}g/${DISK_GB}d"
request GET /health '' "$TMP_DIR/health.json"

cat > "$TMP_DIR/policy.json" <<JSON
{"name":"bench-primed-$MACHINE_TYPE","region":"eu","type":"$MACHINE_TYPE","resources":{"vcpu":$VCPU,"memory_gb":$MEMORY_GB,"disk_gb":$DISK_GB},"source":{"type":"image","image_id":"$IMAGE_ID"},"target":1,"metadata":{"bench":"primed-stopped-pool"}}
JSON

request POST /warm-pool-policies "$TMP_DIR/policy.json" "$TMP_DIR/policy.out.json"
POLICY_ID="$(json_get "$TMP_DIR/policy.out.json" policy.id)"

log "refill/prime policy=$POLICY_ID"
request POST "/warm-pool-policies/$POLICY_ID/refill" '' "$TMP_DIR/refill.json"
PRIME_HTTP_SECONDS="$(cat "$TMP_DIR/refill.json.time_total")"

request GET /admin/warm-pool '' "$TMP_DIR/admin-warm.json"
REQUEST_ID="bench-primed-$ACCOUNT_ID"

cat > "$TMP_DIR/machine.json" <<JSON
{"region":"eu","type":"$MACHINE_TYPE","name":"bench-primed-claim","resources":{"vcpu":$VCPU,"memory_gb":$MEMORY_GB,"disk_gb":$DISK_GB},"source":{"type":"image","image_id":"$IMAGE_ID"}}
JSON

log "claim primed stopped standby"
request POST /machines "$TMP_DIR/machine.json" "$TMP_DIR/machine.out.json" "X-JustAVPS-Request-Id: $REQUEST_ID"
MACHINE_ID="$(json_get "$TMP_DIR/machine.out.json" machine.id)"
CLAIM_HTTP_SECONDS="$(cat "$TMP_DIR/machine.out.json.time_total")"

request GET "/admin/telemetry/creations/$REQUEST_ID" '' "$TMP_DIR/trace.json"

python3 - "$TMP_DIR/refill.json" "$TMP_DIR/admin-warm.json" "$TMP_DIR/trace.json" "$POLICY_ID" "$PRIME_HTTP_SECONDS" "$CLAIM_HTTP_SECONDS" <<'PY'
import json, sys
refill = json.load(open(sys.argv[1]))
admin = json.load(open(sys.argv[2]))
trace = json.load(open(sys.argv[3]))['trace']
policy_id = sys.argv[4]
prime_http_ms = round(float(sys.argv[5]) * 1000)
claim_http_ms = round(float(sys.argv[6]) * 1000)
rows = [m for m in admin.get('machines', []) if m.get('policy_id') == policy_id]
if not rows:
    raise SystemExit('no warm pool row found after refill')
row = rows[0]
warm = row.get('warm_pool') or {}
if warm.get('primed') is not True:
    raise SystemExit(f'warm row is not primed: {warm}')
usable_spans = [s for s in trace.get('spans', []) if s.get('name', '').startswith('usable:')]
claim_span = next((s for s in trace.get('spans', []) if s.get('name') == 'claim warm pool machine'), None)
summary = {
    'policy_id': policy_id,
    'machine_id': trace.get('labels', {}).get('machine_id'),
    'refill': refill,
    'prime_http_ms': prime_http_ms,
    'prime_usability_ms': warm.get('prime_usability_ms'),
    'prime_steps': (warm.get('prime_telemetry') or {}).get('steps'),
    'claim_http_ms': claim_http_ms,
    'claim_trace_ms': trace.get('duration_ms'),
    'claim_span_ms': claim_span.get('duration_ms') if claim_span else None,
    'claim_usable_spans': [{k: s.get(k) for k in ('name', 'duration_ms', 'status')} for s in usable_spans],
    'member_name': row.get('member_name'),
    'managed_daemon_state': row.get('managed_daemon_state'),
}
print(json.dumps(summary, indent=2))
PY

log "PASS primed stopped pool benchmark machine=$MACHINE_ID policy=$POLICY_ID"
