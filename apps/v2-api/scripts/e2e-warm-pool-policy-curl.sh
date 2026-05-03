#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${V2_API_URL:-http://localhost:4200}"
ADMIN_TOKEN="${V2_E2E_ADMIN_TOKEN:-${V2_ADMIN_TOKEN:-v2e2e-admin}}"
ACCOUNT_ID="${V2_E2E_ACCOUNT_ID:-curl-warm-pool-e2e-$(date +%s)}"
MAX_WARM_CREATE_MS="${V2_E2E_MAX_WARM_CREATE_MS:-120000}"

TMP_DIR="$(mktemp -d)"
CREATED_POLICIES=""
CREATED_MACHINES=""
SNAPSHOT_MACHINE_ID=""
SNAPSHOT_NAME=""

log() { printf '[warm-pool-e2e] %s\n' "$*"; }
fail() { printf '[warm-pool-e2e] ERROR: %s\n' "$*" >&2; exit 1; }

json_get() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    value = json.load(f)
for part in sys.argv[2].split('.'):
    if part == '':
        continue
    if isinstance(value, list):
        value = value[int(part)]
    else:
        value = value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value, separators=(',', ':')))
elif value is None:
    print('')
else:
    print(value)
PY
}

json_assert() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
if not eval(sys.argv[2], {'__builtins__': {}}, {'d': d, 'len': len, 'any': any, 'all': all, 'int': int, 'float': float}):
    raise SystemExit(f'assertion failed: {sys.argv[2]}\njson={json.dumps(d)[:2000]}')
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
  for header in "$@"; do
    curl_args+=(-H "$header")
  done
  if [[ -n "$body_file" ]]; then
    curl_args+=(-H 'Content-Type: application/json' --data-binary "@$body_file")
  fi
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

request_expect_status() {
  local expected_status="$1"
  local method="$2"
  local path="$3"
  local body_file="${4:-}"
  local out_file="$5"
  local meta_file="$TMP_DIR/meta-$(date +%s)-$RANDOM.txt"
  local curl_args=(-sS -o "$out_file" -w '%{http_code} %{time_total}' -X "$method" -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID")
  if [[ -n "$body_file" ]]; then
    curl_args+=(-H 'Content-Type: application/json' --data-binary "@$body_file")
  fi
  curl_args+=("$API_URL$path")
  if ! curl "${curl_args[@]}" > "$meta_file"; then
    [[ -s "$out_file" ]] && cat "$out_file" >&2 || true
    fail "curl failed for $method $path"
  fi
  local code time_total
  read -r code time_total < "$meta_file" || true
  if [[ "$code" != "$expected_status" ]]; then
    cat "$out_file" >&2 || true
    fail "$method $path returned HTTP $code, expected $expected_status"
  fi
  printf '%s' "$time_total" > "$out_file.time_total"
}

cleanup() {
  set +e
  log "cleanup account=$ACCOUNT_ID"
  for policy_id in $CREATED_POLICIES; do
    curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID" "$API_URL/warm-pool-policies/$policy_id" || true
  done
  if [[ -n "$SNAPSHOT_MACHINE_ID" && -n "$SNAPSHOT_NAME" ]]; then
    curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$SNAPSHOT_MACHINE_ID/snapshots/$SNAPSHOT_NAME" || true
  fi
  for machine_id in $CREATED_MACHINES; do
    curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$machine_id" || true
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

assert_warm_rows_hidden() {
  local admin_file="$TMP_DIR/admin-warm-pool.json"
  local machines_file="$TMP_DIR/machines.json"
  request GET /admin/warm-pool '' "$admin_file"
  request GET /machines '' "$machines_file"
  python3 - "$admin_file" "$machines_file" "$ACCOUNT_ID" <<'PY'
import json, sys
admin = json.load(open(sys.argv[1]))
machines = json.load(open(sys.argv[2]))
account = sys.argv[3]
warm_ids = {m['id'] for m in admin.get('machines', []) if m.get('account_id') == account}
visible_ids = {m['id'] for m in machines.get('machines', [])}
intersection = sorted(warm_ids & visible_ids)
if intersection:
    raise SystemExit(f'warm pool rows leaked through /machines: {intersection}')
print(f'hidden_warm_rows_ok count={len(warm_ids)}')
PY
}

assert_warm_trace() {
  local request_id="$1"
  local trace_file="$TMP_DIR/trace-$request_id.json"
  request GET "/admin/telemetry/creations/$request_id" '' "$trace_file"
  python3 - "$trace_file" "$MAX_WARM_CREATE_MS" <<'PY'
import json, sys
trace = json.load(open(sys.argv[1]))['trace']
max_ms = int(sys.argv[2])
claim = next((s for s in trace['spans'] if s['name'] == 'claim warm pool machine'), None)
usable = [s for s in trace['spans'] if s['name'].startswith('usable:')]
if trace['status'] != 'ok':
    raise SystemExit(f'trace not ok: {trace}')
if trace['labels'].get('warm_pool_hit') is not True:
    raise SystemExit(f'warm_pool_hit was not true: {trace["labels"]}')
if not claim:
    raise SystemExit('claim warm pool machine span missing')
if not any(s['name'] in ('usable: actual live: command file daemon', 'usable: managed daemon health') for s in usable):
    raise SystemExit(f'usable actual-live/daemon-health span missing: {usable}')
if trace['duration_ms'] > max_ms:
    raise SystemExit(f'warm create too slow: {trace["duration_ms"]}ms > {max_ms}ms')
print(json.dumps({
    'request_id': trace['id'],
    'duration_ms': trace['duration_ms'],
    'claim_span_ms': claim.get('duration_ms'),
    'usable_spans': [{k: s.get(k) for k in ('name','duration_ms','status')} for s in usable],
    'warm_pool_hit': True,
}))
PY
}

create_policy() {
  local name="$1"
  local type="$2"
  local vcpu="$3"
  local memory_gb="$4"
  local disk_gb="$5"
  local source_json="$6"
  local mode="${7:-stopped}"
  local body="$TMP_DIR/policy-$name.json"
  local out="$TMP_DIR/policy-$name.out.json"
  cat > "$body" <<JSON
{"name":"$name","region":"eu","type":"$type","mode":"$mode","resources":{"vcpu":$vcpu,"memory_gb":$memory_gb,"disk_gb":$disk_gb},"source":$source_json,"target":1,"metadata":{"e2e":"warm-pool-policy-curl"}}
JSON
  request POST /warm-pool-policies "$body" "$out"
  local policy_id
  policy_id="$(json_get "$out" policy.id)"
  json_assert "$out" 'd["policy"]["status"] == "active" and d["policy"]["target"] == 1 and d["policy"]["billing"]["disk_limit_gb_total_cap"] == 10 and d["policy"]["billing"]["billable_gib"] >= 0'
  printf '%s' "$policy_id"
}

assert_running_pool_ready() {
  local policy_id="$1"
  local out="$TMP_DIR/running-ready-$policy_id.json"
  request GET /admin/warm-pool '' "$out"
  python3 - "$out" "$policy_id" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); pid=sys.argv[2]
rows=[m for m in d.get('machines', []) if m.get('policy_id') == pid]
if not rows:
    raise SystemExit('no pool rows for running policy')
running=[m for m in rows if (m.get('warm_pool') or {}).get('runtime_state') == 'running' and (m.get('warm_pool') or {}).get('mode') == 'primed_running_exact']
if not running:
    raise SystemExit(f'no running pool row: {rows}')
print(f'running_pool_rows_ok count={len(running)}')
PY
}

assert_running_trace() {
  local request_id="$1"
  local trace_file="$TMP_DIR/trace-running-$request_id.json"
  request GET "/admin/telemetry/creations/$request_id" '' "$trace_file"
  python3 - "$trace_file" <<'PY'
import json, sys
trace = json.load(open(sys.argv[1]))['trace']
names = [s.get('name') for s in trace.get('spans', [])]
verify = next((s for s in trace.get('spans', []) if s.get('name') == 'warm pool: verify running template slot'), None)
if trace.get('status') != 'ok':
    raise SystemExit(f'trace not ok: {trace}')
if trace.get('labels', {}).get('warm_pool_hit') is not True:
    raise SystemExit(f'warm_pool_hit false: {trace.get("labels")}')
if trace.get('labels', {}).get('warm_pool_running_takeover') is not True:
    raise SystemExit(f'running takeover label missing: {trace.get("labels")}')
if not verify:
    raise SystemExit(f'running verify span missing: {names}')
if any(name == 'warm pool: incus start stopped instance' for name in names):
    raise SystemExit(f'running pool should not start stopped instance: {names}')
print(json.dumps({
    'request_id': trace['id'],
    'duration_ms': trace.get('duration_ms'),
    'verify_running_span_ms': verify.get('duration_ms'),
    'warm_pool_running_takeover': True,
}, separators=(',', ':')))
PY
}

refill_policy() {
  local policy_id="$1"
  local out="$TMP_DIR/refill-$policy_id.json"
  request POST "/warm-pool-policies/$policy_id/refill" '' "$out"
  json_assert "$out" 'd["target"] == 1 and (d["ready"] + d["created"] + d["creating"]) >= 1'
}

assert_policy_ready() {
  local policy_id="$1"
  local out="$TMP_DIR/policy-ready-$policy_id.json"
  request GET "/warm-pool-policies/$policy_id" '' "$out"
  json_assert "$out" 'd["policy"]["ready"] >= 1 or d["policy"]["claiming"] >= 1'
  json_assert "$out" 'd["policy"]["billing"]["measured_instances"] >= 1 and d["policy"]["billing"]["billable_gib"] > 0 and d["policy"]["billing"]["total_eur_month"] > 0 and d["policy"]["billing"]["billable_gib"] < d["policy"]["billing"]["disk_limit_gb_total_cap"]'
}

create_machine() {
  local request_id="$1"
  local name="$2"
  local type="$3"
  local vcpu="$4"
  local memory_gb="$5"
  local disk_gb="$6"
  local source_json="$7"
  local body="$TMP_DIR/machine-$name.json"
  local out="$TMP_DIR/machine-$name.out.json"
  cat > "$body" <<JSON
{"region":"eu","type":"$type","name":"$name","resources":{"vcpu":$vcpu,"memory_gb":$memory_gb,"disk_gb":$disk_gb},"source":$source_json}
JSON
  request POST /machines "$body" "$out" "X-JustAVPS-Request-Id: $request_id"
  local machine_id
  machine_id="$(json_get "$out" machine.id)"
  json_assert "$out" 'd["machine"]["status"] == "Running"'
  printf '%s' "$machine_id"
}

log "preflight health api=$API_URL account=$ACCOUNT_ID"
request GET /health '' "$TMP_DIR/health.json"
json_assert "$TMP_DIR/health.json" 'd["status"] == "ok" and d["database_configured"] is True and d["incus_clusters_configured"] >= 1'

log 'snapshot-backed pool policies are disabled'
cat > "$TMP_DIR/snapshot-policy-disabled.json" <<'JSON'
{"name":"disabled-snapshot-pool","region":"eu","type":"container","resources":{"vcpu":1,"memory_gb":1,"disk_gb":9},"source":{"type":"snapshot","snapshot_id":"not-supported-for-pools"},"target":1}
JSON
request_expect_status 400 POST /warm-pool-policies "$TMP_DIR/snapshot-policy-disabled.json" "$TMP_DIR/snapshot-policy-disabled.out.json"

log 'vm pool policies are disabled'
cat > "$TMP_DIR/vm-policy-disabled.json" <<'JSON'
{"name":"disabled-vm-pool","region":"eu","type":"vm","resources":{"vcpu":2,"memory_gb":2,"disk_gb":10},"source":{"type":"image","image_id":"justavps-golden"},"target":1}
JSON
request_expect_status 400 POST /warm-pool-policies "$TMP_DIR/vm-policy-disabled.json" "$TMP_DIR/vm-policy-disabled.out.json"

log 'vm machine creates are disabled'
cat > "$TMP_DIR/vm-machine-disabled.json" <<'JSON'
{"region":"eu","type":"vm","name":"disabled-vm-machine","resources":{"vcpu":2,"memory_gb":2,"disk_gb":10},"source":{"type":"image","image_id":"justavps-golden"}}
JSON
request_expect_status 400 POST /machines "$TMP_DIR/vm-machine-disabled.json" "$TMP_DIR/vm-machine-disabled.out.json"

log 'image policy: create -> refill -> hidden -> warm claim -> telemetry'
IMAGE_POLICY_ID="$(create_policy policy-e2e-image-container container 2 2 10 '{"type":"image","image_id":"justavps-golden-container"}')"
CREATED_POLICIES="$CREATED_POLICIES $IMAGE_POLICY_ID"
refill_policy "$IMAGE_POLICY_ID"
assert_policy_ready "$IMAGE_POLICY_ID"
assert_warm_rows_hidden
IMAGE_REQUEST_ID="curl-e2e-image-$ACCOUNT_ID"
IMAGE_MACHINE_ID="$(create_machine "$IMAGE_REQUEST_ID" policy-e2e-image-machine container 2 2 10 '{"type":"image","image_id":"justavps-golden-container"}')"
CREATED_MACHINES="$CREATED_MACHINES $IMAGE_MACHINE_ID"
assert_warm_trace "$IMAGE_REQUEST_ID"
assert_warm_rows_hidden
log "image policy warm claim ok machine=$IMAGE_MACHINE_ID"

log 'running image policy: create -> refill running slot -> instant takeover'
RUNNING_POLICY_ID="$(create_policy policy-e2e-running-container container 2 2 10 '{"type":"image","image_id":"justavps-golden-container"}' running)"
CREATED_POLICIES="$CREATED_POLICIES $RUNNING_POLICY_ID"
refill_policy "$RUNNING_POLICY_ID"
assert_policy_ready "$RUNNING_POLICY_ID"
assert_running_pool_ready "$RUNNING_POLICY_ID"
RUNNING_REQUEST_ID="curl-e2e-running-$ACCOUNT_ID"
RUNNING_MACHINE_ID="$(create_machine "$RUNNING_REQUEST_ID" policy-e2e-running-machine container 2 2 10 '{"type":"image","image_id":"justavps-golden-container"}')"
CREATED_MACHINES="$CREATED_MACHINES $RUNNING_MACHINE_ID"
assert_running_trace "$RUNNING_REQUEST_ID"
log "running policy warm claim ok machine=$RUNNING_MACHINE_ID"

log 'final policy list check'
request GET /warm-pool-policies '' "$TMP_DIR/policies-final.json"
json_assert "$TMP_DIR/policies-final.json" 'len(d["policies"]) >= 1'

log 'PASS warm pool policy curl E2E'
