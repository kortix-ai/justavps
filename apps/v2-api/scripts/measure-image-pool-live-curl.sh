#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${V2_API_URL:-http://localhost:4200}"
ADMIN_TOKEN="${V2_E2E_ADMIN_TOKEN:-${V2_ADMIN_TOKEN:-v2e2e-admin}}"
ACCOUNT_ID="${V2_E2E_ACCOUNT_ID:-image-pool-measure-$(date +%s)}"
RUNS="${V2_E2E_POOL_MEASURE_RUNS:-1}"

TMP_DIR="$(mktemp -d)"
CREATED_POLICIES=""
CREATED_MACHINES=""
RESULTS_FILE="$TMP_DIR/results.ndjson"

log() { printf '[image-pool-measure] %s\n' "$*"; }
fail() { printf '[image-pool-measure] ERROR: %s\n' "$*" >&2; exit 1; }

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
  for policy_id in $CREATED_POLICIES; do
    curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID" "$API_URL/warm-pool-policies/$policy_id" || true
  done
  for machine_id in $CREATED_MACHINES; do
    curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$machine_id" || true
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ms() { python3 - "$1" <<'PY'
import sys
print(round(float(sys.argv[1])*1000))
PY
}

extract_pool_row() {
  local admin_file="$1"
  local policy_id="$2"
  local out_file="$3"
  python3 - "$admin_file" "$policy_id" "$out_file" <<'PY'
import json, sys
admin=json.load(open(sys.argv[1]))
policy_id=sys.argv[2]
rows=[r for r in admin.get('machines', []) if r.get('policy_id') == policy_id]
if not rows:
    raise SystemExit(f'no ready pool row for policy {policy_id}')
json.dump(rows[0], open(sys.argv[3], 'w'), separators=(',', ':'))
PY
}

claim_and_measure() {
  local label="$1"
  local machine_type="$2"
  local image_id="$3"
  local vcpu="$4"
  local memory_gb="$5"
  local disk_gb="$6"
  local run_index="$7"
  local prefix="$TMP_DIR/$label-$run_index"

  log "[$label#$run_index] create image-only pool policy image=$image_id type=$machine_type"
  cat > "$prefix-policy.json" <<JSON
{"name":"measure-$label-$run_index","region":"eu","type":"$machine_type","resources":{"vcpu":$vcpu,"memory_gb":$memory_gb,"disk_gb":$disk_gb},"source":{"type":"image","image_id":"$image_id"},"target":1,"metadata":{"e2e":"image-pool-measure","label":"$label","run":$run_index}}
JSON
  request POST /warm-pool-policies "$prefix-policy.json" "$prefix-policy.out.json"
  local policy_create_ms policy_id refill_ms create_ms machine_id exec_ms file_write_ms file_read_ms proxy_ms request_id
  policy_create_ms="$(ms "$(cat "$prefix-policy.out.json.time_total")")"
  policy_id="$(json_get "$prefix-policy.out.json" policy.id)"
  CREATED_POLICIES="$CREATED_POLICIES $policy_id"

  log "[$label#$run_index] refill policy and capture priming metadata"
  request POST "/warm-pool-policies/$policy_id/refill" '' "$prefix-refill.out.json"
  refill_ms="$(ms "$(cat "$prefix-refill.out.json.time_total")")"
  request GET /admin/warm-pool '' "$prefix-admin-before.json"
  extract_pool_row "$prefix-admin-before.json" "$policy_id" "$prefix-pool-row.json"

  request_id="measure-$label-$run_index-$ACCOUNT_ID"
  cat > "$prefix-claim.json" <<JSON
{"region":"eu","type":"$machine_type","name":"measure-$label-$run_index","resources":{"vcpu":$vcpu,"memory_gb":$memory_gb,"disk_gb":$disk_gb},"source":{"type":"image","image_id":"$image_id"}}
JSON
  log "[$label#$run_index] claim pool slot and wait for actual-live create response"
  request POST /machines "$prefix-claim.json" "$prefix-claim.out.json" "X-JustAVPS-Request-Id: $request_id"
  create_ms="$(ms "$(cat "$prefix-claim.out.json.time_total")")"
  machine_id="$(json_get "$prefix-claim.out.json" machine.id)"
  CREATED_MACHINES="$CREATED_MACHINES $machine_id"

  log "[$label#$run_index] immediate post-create probes"
  cat > "$prefix-exec.json" <<'JSON'
{"command":"printf image-pool-live","timeout_ms":20000}
JSON
  request POST "/machines/$machine_id/exec" "$prefix-exec.json" "$prefix-exec.out.json"
  exec_ms="$(ms "$(cat "$prefix-exec.out.json.time_total")")"

  cat > "$prefix-file.json" <<'JSON'
{"path":"/tmp/justavps-image-pool-live.txt","content":"image-pool-live","create_dirs":true}
JSON
  request PUT "/machines/$machine_id/files" "$prefix-file.json" "$prefix-file-write.out.json"
  file_write_ms="$(ms "$(cat "$prefix-file-write.out.json.time_total")")"
  request GET "/machines/$machine_id/files?path=/tmp/justavps-image-pool-live.txt" '' "$prefix-file-read.out.json"
  file_read_ms="$(ms "$(cat "$prefix-file-read.out.json.time_total")")"
  request GET "/proxy/80--$machine_id/daemon/health" '' "$prefix-proxy.out.json"
  proxy_ms="$(ms "$(cat "$prefix-proxy.out.json.time_total")")"

  request GET "/admin/telemetry/creations/$request_id" '' "$prefix-trace.json"
  request GET "/machines/$machine_id" '' "$prefix-machine.json"

  python3 - "$label" "$run_index" "$machine_type" "$image_id" "$policy_create_ms" "$refill_ms" "$create_ms" "$exec_ms" "$file_write_ms" "$file_read_ms" "$proxy_ms" "$prefix-pool-row.json" "$prefix-trace.json" "$prefix-machine.json" <<'PY' | tee -a "$RESULTS_FILE"
import json, sys
label, run_index, machine_type, image_id = sys.argv[1:5]
policy_create_ms, refill_http_ms, create_http_ms, exec_ms, file_write_ms, file_read_ms, proxy_ms = map(int, sys.argv[5:12])
pool_row=json.load(open(sys.argv[12]))
trace=json.load(open(sys.argv[13]))['trace']
machine=json.load(open(sys.argv[14]))['machine']
warm=pool_row.get('warm_pool') or {}
metadata=machine.get('metadata') or {}
usability=metadata.get('usability') or {}
def spans(names):
    return {s.get('name'): s.get('duration_ms') for s in trace.get('spans', []) if s.get('name') in names}
def prefix_spans(prefix):
    return [{k:s.get(k) for k in ('name','duration_ms','status','details')} for s in trace.get('spans', []) if str(s.get('name','')).startswith(prefix)]
def step_summary(obj):
    steps=obj.get('steps') or []
    return [{k:s.get(k) for k in ('name','duration_ms','status','result','reason')} for s in steps]
out={
  'label': label,
  'run': int(run_index),
  'type': machine_type,
  'image': image_id,
  'policy_create_http_ms': policy_create_ms,
  'refill_http_ms': refill_http_ms,
  'prime_usability_ms': warm.get('prime_usability_ms'),
  'prime_steps': step_summary(warm.get('prime_telemetry') or {}),
  'second_boot_usability_ms': warm.get('second_boot_usability_ms'),
  'second_boot_steps': step_summary(warm.get('second_boot_telemetry') or {}),
  'create_http_ms': create_http_ms,
  'trace_ms': trace.get('duration_ms'),
  'claim_spans_ms': spans(['warm pool: load active policies','warm pool: load template candidates','warm pool: reserve candidate row','warm pool: incus start stopped instance','warm pool: verify running template slot','warm pool: persist claimed machine row']),
  'usable_spans': prefix_spans('usable:'),
  'claim_usability_ms': ((metadata.get('warm_pool') or {}).get('claim_usability') or {}).get('duration_ms'),
  'machine_usability_steps': step_summary(usability),
  'post_create_exec_ms': exec_ms,
  'post_create_file_write_ms': file_write_ms,
  'post_create_file_read_ms': file_read_ms,
  'post_create_proxy_daemon_health_ms': proxy_ms,
  'warm_pool_hit': trace.get('labels', {}).get('warm_pool_hit'),
  'machine_id': machine.get('id'),
}
print(json.dumps(out, separators=(',', ':')))
PY
}

log "preflight api=$API_URL account=$ACCOUNT_ID runs=$RUNS"
request GET /health '' "$TMP_DIR/health.json"

for i in $(seq 1 "$RUNS"); do
  claim_and_measure container container justavps-ubuntu-24.04-template 2 2 10 "$i"
done

log 'summary'
python3 - "$RESULTS_FILE" <<'PY'
import json, statistics, sys
rows=[json.loads(line) for line in open(sys.argv[1]) if line.strip()]
for label in sorted({r['label'] for r in rows}):
    subset=[r for r in rows if r['label']==label]
    def avg(key):
        values=[r[key] for r in subset if isinstance(r.get(key), (int,float))]
        return round(statistics.mean(values)) if values else None
    print(json.dumps({
        'label': label,
        'runs': len(subset),
        'avg_refill_http_ms': avg('refill_http_ms'),
        'avg_prime_usability_ms': avg('prime_usability_ms'),
        'avg_second_boot_usability_ms': avg('second_boot_usability_ms'),
        'avg_create_http_ms': avg('create_http_ms'),
        'avg_post_create_exec_ms': avg('post_create_exec_ms'),
        'avg_post_create_proxy_daemon_health_ms': avg('post_create_proxy_daemon_health_ms'),
    }, separators=(',', ':')))
PY

log "PASS image pool live measurement account=$ACCOUNT_ID"
