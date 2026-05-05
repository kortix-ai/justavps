#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${V2_API_URL:-http://localhost:4200}"
ADMIN_TOKEN="${V2_E2E_ADMIN_TOKEN:-${V2_ADMIN_TOKEN:-v2e2e-admin}}"
ACCOUNT_ID="${V2_E2E_ACCOUNT_ID:-actual-live-pool-e2e-$(date +%s)}"
TEMPLATE_ID="${V2_E2E_TEMPLATE_ID:-${V2_E2E_IMAGE_ID:-justavps-ubuntu-24.04-template}}"
CLAIM_VCPU="${V2_E2E_CLAIM_VCPU:-3}"
CLAIM_MEMORY_GB="${V2_E2E_CLAIM_MEMORY_GB:-3}"
CLAIM_DISK_GB="${V2_E2E_CLAIM_DISK_GB:-11}"

TMP_DIR="$(mktemp -d)"
MACHINE_ID=""

log() { printf '[actual-live-pool-e2e] %s\n' "$*"; }
fail() { printf '[actual-live-pool-e2e] ERROR: %s\n' "$*" >&2; exit 1; }

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
  curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID" "$API_URL/machine-templates/$TEMPLATE_ID/pool?mode=running" || true
  curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID" "$API_URL/machine-templates/$TEMPLATE_ID/pool?mode=stopped" || true
  [[ -n "$MACHINE_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$MACHINE_ID" || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ms() { python3 - "$1" <<'PY'
import sys
print(round(float(sys.argv[1])*1000))
PY
}

log "preflight api=$API_URL account=$ACCOUNT_ID template=$TEMPLATE_ID"
request GET /health '' "$TMP_DIR/health.json"

log 'create/refill stopped and running Template pools'
cat > "$TMP_DIR/stopped-policy.json" <<JSON
{"target":1,"mode":"stopped"}
JSON
request PUT "/machine-templates/$TEMPLATE_ID/pool" "$TMP_DIR/stopped-policy.json" "$TMP_DIR/stopped-policy.out.json"
cat > "$TMP_DIR/running-policy.json" <<JSON
{"target":1,"mode":"running"}
JSON
request PUT "/machine-templates/$TEMPLATE_ID/pool" "$TMP_DIR/running-policy.json" "$TMP_DIR/running-policy.out.json"
request POST "/machine-templates/$TEMPLATE_ID/pool/refill?mode=stopped" '' "$TMP_DIR/refill.out.json"
request POST "/machine-templates/$TEMPLATE_ID/pool/refill?mode=running" '' "$TMP_DIR/running-refill.out.json"
request GET "/machine-templates/$TEMPLATE_ID/pool" '' "$TMP_DIR/policy.ready.json"
python3 - "$TMP_DIR/policy.ready.json" <<'PY'
import json, sys
payload=json.load(open(sys.argv[1]))
pools=payload['pools']
d=pools['stopped']
running=pools['running']
b=d.get('billing') or {}
assert d.get('ready', 0) >= 1, d
assert running and running.get('ready', 0) >= 1, running
assert running.get('billing', {}).get('hot_resource_eur_month', 0) > 0, running.get('billing')
assert b.get('measured_instances', 0) >= 1, b
assert b.get('billable_gib', 0) > 0, b
assert b.get('billable_gib', 0) < b.get('disk_limit_gb_total_cap', 0), b
assert b.get('total_eur_month', 0) > 0, b
print(json.dumps({'pool_storage_gib': b.get('billable_gib'), 'pool_storage_eur_month': b.get('total_eur_month')}, separators=(',', ':')))
PY

log "claim pool slot with resize to ${CLAIM_VCPU}c/${CLAIM_MEMORY_GB}GB/${CLAIM_DISK_GB}GB; create must return only after actual-live readiness"
REQUEST_ID="actual-live-claim-$ACCOUNT_ID"
cat > "$TMP_DIR/claim.json" <<JSON
{"type":"container","name":"actual-live-claim","template_id":"$TEMPLATE_ID","start_strategy":"stopped_pool","resources":{"vcpu":$CLAIM_VCPU,"memory_gb":$CLAIM_MEMORY_GB,"disk_gb":$CLAIM_DISK_GB}}
JSON
request POST /machines "$TMP_DIR/claim.json" "$TMP_DIR/claim.out.json" "X-JustAVPS-Request-Id: $REQUEST_ID"
CREATE_HTTP_MS="$(ms "$(cat "$TMP_DIR/claim.out.json.time_total")")"
MACHINE_ID="$(json_get "$TMP_DIR/claim.out.json" machine.id)"

log 'immediate post-create user API checks'
cat > "$TMP_DIR/exec.json" <<'JSON'
{"command":"printf actual-live-command","timeout_ms":15000}
JSON
request POST "/machines/$MACHINE_ID/exec" "$TMP_DIR/exec.json" "$TMP_DIR/exec.out.json"
EXEC_MS="$(ms "$(cat "$TMP_DIR/exec.out.json.time_total")")"
python3 - "$TMP_DIR/exec.out.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d.get('exit_code') == 0 and d.get('stdout') == 'actual-live-command', d
PY

cat > "$TMP_DIR/file.json" <<'JSON'
{"path":"/tmp/justavps-actual-live.txt","content":"actual-live-file","create_dirs":true}
JSON
request PUT "/machines/$MACHINE_ID/files" "$TMP_DIR/file.json" "$TMP_DIR/file-write.out.json"
FILE_WRITE_MS="$(ms "$(cat "$TMP_DIR/file-write.out.json.time_total")")"
request GET "/machines/$MACHINE_ID/files?path=/tmp/justavps-actual-live.txt" '' "$TMP_DIR/file-read.out.json"
FILE_READ_MS="$(ms "$(cat "$TMP_DIR/file-read.out.json.time_total")")"
python3 - "$TMP_DIR/file-read.out.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d.get('content') == 'actual-live-file', d
PY

request GET "/proxy/80--$MACHINE_ID/daemon/health" '' "$TMP_DIR/proxy-daemon-health.out.json"
PROXY_MS="$(ms "$(cat "$TMP_DIR/proxy-daemon-health.out.json.time_total")")"
python3 - "$TMP_DIR/proxy-daemon-health.out.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d.get('status') == 'ok', d
PY

request GET "/admin/telemetry/creations/$REQUEST_ID" '' "$TMP_DIR/trace.out.json"
python3 - "$TMP_DIR/trace.out.json" "$CREATE_HTTP_MS" "$EXEC_MS" "$FILE_WRITE_MS" "$FILE_READ_MS" "$PROXY_MS" <<'PY'
import json, sys
trace=json.load(open(sys.argv[1]))['trace']
names=[s.get('name') for s in trace.get('spans', [])]
actual=next((s for s in trace.get('spans', []) if s.get('name') == 'usable: actual live: command file daemon'), None)
resize=next((s for s in trace.get('spans', []) if s.get('name') == 'warm pool: resize template slot'), None)
assert trace.get('labels', {}).get('warm_pool_hit') is True, trace
assert trace.get('labels', {}).get('warm_pool_resized_on_claim') is True, trace.get('labels')
assert actual, names
assert resize, names
print(json.dumps({
  'create_http_ms': int(sys.argv[2]),
  'trace_ms': trace.get('duration_ms'),
  'resize_span_ms': resize.get('duration_ms'),
  'actual_live_span_ms': actual.get('duration_ms'),
  'post_create_exec_ms': int(sys.argv[3]),
  'post_create_file_write_ms': int(sys.argv[4]),
  'post_create_file_read_ms': int(sys.argv[5]),
  'post_create_proxy_daemon_health_ms': int(sys.argv[6]),
  'usable_spans': [{k:s.get(k) for k in ('name','duration_ms','status')} for s in trace.get('spans', []) if str(s.get('name','')).startswith('usable:')],
}, separators=(',', ':')))
PY

log "PASS actual live pool E2E machine=$MACHINE_ID"
