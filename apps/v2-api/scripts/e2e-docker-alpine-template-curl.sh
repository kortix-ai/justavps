#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${V2_API_URL:-http://localhost:4200}"
ADMIN_TOKEN="${V2_E2E_ADMIN_TOKEN:-${V2_ADMIN_TOKEN:-v2e2e-admin}}"
ACCOUNT_ID="${V2_E2E_ACCOUNT_ID:-docker-alpine-template-e2e-$(date +%s)}"
ALPINE_REF="${V2_E2E_ALPINE_DOCKER_REF:-alpine:3.20}"
TEMPLATE_SLUG="${V2_E2E_ALPINE_TEMPLATE_SLUG:-e2e-alpine-docker-$(date +%s)}"

TMP_DIR="$(mktemp -d)"
TEMPLATE_ID=""
MACHINE_ID=""

log() { printf '[docker-alpine-template-e2e] %s\n' "$*"; }
fail() { printf '[docker-alpine-template-e2e] ERROR: %s\n' "$*" >&2; exit 1; }

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
  [[ -n "$MACHINE_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$MACHINE_ID" || true
  [[ -n "$TEMPLATE_ID" ]] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID" "$API_URL/machine-templates/$TEMPLATE_ID" || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ms() { python3 - "$1" <<'PY'
import sys
print(round(float(sys.argv[1])*1000))
PY
}

log "preflight api=$API_URL account=$ACCOUNT_ID docker=$ALPINE_REF slug=$TEMPLATE_SLUG"
request GET /health '' "$TMP_DIR/health.json"

log 'create Machine Template from Docker Alpine and require runtime daemon injection + second boot verification'
cat > "$TMP_DIR/template.json" <<JSON
{"name":"E2E Alpine Docker","slug":"$TEMPLATE_SLUG","region":"eu","visibility":"private","default_resources":{"vcpu":1,"memory_gb":1,"disk_gb":10},"source":{"type":"docker","ref":"$ALPINE_REF"},"metadata":{"e2e":"docker-alpine-template"}}
JSON
request POST /machine-templates "$TMP_DIR/template.json" "$TMP_DIR/template.out.json"
TEMPLATE_CREATE_MS="$(ms "$(cat "$TMP_DIR/template.out.json.time_total")")"
TEMPLATE_ID="$(json_get "$TMP_DIR/template.out.json" template.id)"

python3 - "$TMP_DIR/template.out.json" "$ALPINE_REF" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))['template']
readiness=d.get('readiness') or {}
props=((d.get('image') or {}).get('properties') or {})
prep=((d.get('metadata') or {}).get('justavps_preparation') or {})
assert d.get('status') == 'active', d
assert (d.get('source') or {}).get('type') == 'docker', d.get('source')
assert sys.argv[2] in str((d.get('source') or {}).get('ref')), d.get('source')
assert readiness.get('ready') is True, readiness
assert readiness.get('daemon_runtime_injected') is True, readiness
assert readiness.get('daemon_second_boot_verified') is True, readiness
assert props.get('justavps.daemon_baked') == 'false', props
assert props.get('justavps.daemon_runtime_injected') == 'true', props
assert props.get('justavps.daemon_second_boot_verified') == 'true', props
assert (prep.get('first_usability') or {}).get('ok') is True, prep
assert (prep.get('second_boot_usability') or {}).get('ok') is True, prep
assert ((prep.get('first_usability') or {}).get('managed_daemon') or {}).get('daemon_source') in ('injected-push','injected-mount'), prep
assert ((prep.get('second_boot_usability') or {}).get('managed_daemon') or {}).get('daemon_source') in ('injected-push','injected-mount'), prep
print(json.dumps({'template_id': d.get('id'), 'alias': (d.get('image') or {}).get('alias'), 'readiness': readiness}, separators=(',', ':')))
PY

log 'create cold Machine from Alpine Template and verify Alpine OS + daemon API'
REQUEST_ID="docker-alpine-template-$ACCOUNT_ID"
cat > "$TMP_DIR/machine.json" <<JSON
{"type":"container","name":"alpine-template-machine","template_id":"$TEMPLATE_ID","start_strategy":"cold"}
JSON
request POST /machines "$TMP_DIR/machine.json" "$TMP_DIR/machine.out.json" "X-JustAVPS-Request-Id: $REQUEST_ID"
MACHINE_CREATE_MS="$(ms "$(cat "$TMP_DIR/machine.out.json.time_total")")"
MACHINE_ID="$(json_get "$TMP_DIR/machine.out.json" machine.id)"

python3 - "$TMP_DIR/machine.out.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))['machine']
meta=d.get('metadata') or {}
daemon=meta.get('managed_daemon') or {}
usability=meta.get('usability') or {}
cloud=usability.get('cloud_init') or {}
assert daemon.get('daemon_source') in ('injected-push','injected-mount'), daemon
assert daemon.get('ok') is True, daemon
assert cloud.get('skipped') is True or cloud.get('present') is False, cloud
print(json.dumps({'machine_daemon_source': daemon.get('daemon_source'), 'machine_cloud_init': cloud}, separators=(',', ':')))
PY

cat > "$TMP_DIR/os-release.json" <<'JSON'
{"command":"cat /etc/os-release && printf '\njustavps=' && /usr/local/bin/justavps-daemon --version","timeout_ms":30000}
JSON
request POST "/machines/$MACHINE_ID/exec" "$TMP_DIR/os-release.json" "$TMP_DIR/os-release.out.json"
python3 - "$TMP_DIR/os-release.out.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
stdout=d.get('stdout') or ''
assert d.get('exit_code') == 0, d
assert 'ID=alpine' in stdout, stdout
assert 'justavps=' in stdout, stdout
PY

cat > "$TMP_DIR/file.json" <<'JSON'
{"path":"/tmp/justavps-alpine-template.txt","content":"alpine-template-file","create_dirs":true}
JSON
request PUT "/machines/$MACHINE_ID/files" "$TMP_DIR/file.json" "$TMP_DIR/file-write.out.json"
request GET "/machines/$MACHINE_ID/files?path=/tmp/justavps-alpine-template.txt" '' "$TMP_DIR/file-read.out.json"
python3 - "$TMP_DIR/file-read.out.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d.get('content') == 'alpine-template-file', d
PY

request GET "/proxy/80--$MACHINE_ID/daemon/health" '' "$TMP_DIR/proxy-daemon-health.out.json"
python3 - "$TMP_DIR/proxy-daemon-health.out.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d.get('status') == 'ok', d
PY

request GET "/admin/telemetry/creations/$REQUEST_ID" '' "$TMP_DIR/trace.out.json"
python3 - "$TMP_DIR/trace.out.json" "$TEMPLATE_CREATE_MS" "$MACHINE_CREATE_MS" <<'PY'
import json, sys
trace=json.load(open(sys.argv[1]))['trace']
labels=trace.get('labels') or {}
assert labels.get('start_strategy') == 'cold', labels
assert labels.get('source_justavps_ready') is True, labels
assert labels.get('warm_pool_hit') in (None, False), labels
print(json.dumps({'template_create_ms': int(sys.argv[2]), 'machine_create_ms': int(sys.argv[3]), 'trace_ms': trace.get('duration_ms'), 'labels': labels}, separators=(',', ':')))
PY

log "PASS Docker Alpine Template E2E template=$TEMPLATE_ID machine=$MACHINE_ID"
