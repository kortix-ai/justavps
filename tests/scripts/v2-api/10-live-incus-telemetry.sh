#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"
require_live
require_image

machine_name="v2e2e-live-telemetry-${RANDOM}-${RANDOM}"
machine_id=""

cleanup() {
  if [ -n "$machine_id" ]; then
    request DELETE "/machines/$machine_id" >/dev/null || true
  fi
}
trap cleanup EXIT

create_body="$(node -e 'console.log(JSON.stringify({region:process.env.V2_E2E_REGION||"eu",type:process.env.V2_E2E_TYPE||"container",name:process.argv[1],resources:{vcpu:1,memory_gb:1,disk_gb:Number(process.env.V2_E2E_DISK_GB||10)},source:{type:"image",image_id:process.env.V2_E2E_IMAGE},labels:{e2e:"live-telemetry"}}))' "$machine_name")"
create_json="$(request POST /machines "$create_body")"
printf '%s' "$create_json" | json_assert create-live-telemetry-machine 'data.machine && data.machine.id && data.machine.incus && data.machine.incus.cluster_id && data.machine.metadata && data.machine.metadata.managed_daemon_state === "ready"'
machine_id="$(printf '%s' "$create_json" | json_get machine.id)"

request GET "/machines/$machine_id" | json_assert get-live-telemetry-machine 'data.machine && data.machine.id && data.machine.incus && data.machine.incus.observed'

request POST "/machines/$machine_id/exec" '{"command":"printf live-telemetry-command","timeout_ms":15000}' | json_assert live-exec 'data.exit_code === 0 && data.stdout === "live-telemetry-command"'
request PUT "/machines/$machine_id/files" '{"path":"/tmp/justavps-live-telemetry.txt","content":"live-telemetry-file","create_dirs":true}' | json_assert live-file-write 'data.ok === true'
request GET "/machines/$machine_id/files?path=/tmp/justavps-live-telemetry.txt" | json_assert live-file-read 'data.content === "live-telemetry-file"'
request GET "/proxy/80--$machine_id/daemon/health" | json_assert live-daemon-proxy-health 'data.status === "ok"'

request GET "/admin/telemetry/machines/$machine_id/logs?limit=100&source=process.stdout" | json_assert live-exec-stdout-log 'Array.isArray(data.logs) && data.logs.some((log) => String(log.body || "").includes("live-telemetry-command"))'
request GET "/admin/telemetry/machines/$machine_id/traces?limit=100&operation=toolbox.exec" | json_assert live-exec-trace 'Array.isArray(data.traces) && data.traces.some((trace) => String(trace.name || "").includes("printf live-telemetry-command"))'

deadline=$((SECONDS + 180))
latest_ok=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if request GET "/admin/telemetry/machines/$machine_id/latest" | json_assert live-daemon-latest-metrics 'data.latest && data.latest.health === "healthy" && data.latest.metrics && data.latest.metrics["justavps.sandbox.cpu.utilization"] && data.latest.metrics["justavps.daemon.up"]'; then
    latest_ok=1
    break
  fi
  sleep 5
done

if [ "$latest_ok" != "1" ]; then
  request GET "/admin/telemetry/machines/$machine_id/latest" >&2 || true
  echo "live daemon metrics did not arrive before timeout" >&2
  exit 1
fi

request GET "/admin/telemetry/machines/$machine_id/events?limit=100" | json_assert live-telemetry-events 'Array.isArray(data.events) && data.events.some((event) => event.type === "sandbox.telemetry.metrics")'

echo "live incus telemetry ok: $machine_id"
