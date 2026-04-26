#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"
require_live
require_image

machine_name="v2e2e-${RANDOM}-${RANDOM}"
machine_id=""

cleanup() {
  if [ -n "$machine_id" ]; then
    request DELETE "/machines/$machine_id" >/dev/null || true
  fi
}
trap cleanup EXIT

create_body="$(node -e 'console.log(JSON.stringify({region:process.env.V2_E2E_REGION||"eu",type:process.env.V2_E2E_TYPE||"container",name:process.argv[1],resources:{vcpu:1,memory_gb:1,disk_gb:Number(process.env.V2_E2E_DISK_GB||10)},source:{type:"image",image_id:process.env.V2_E2E_IMAGE}}))' "$machine_name")"
create_json="$(request POST /machines "$create_body")"
printf '%s' "$create_json" | json_assert create-machine 'data.machine && data.machine.type === "container" && data.machine.incus && data.machine.incus.cluster_id'
machine_id="$(printf '%s' "$create_json" | json_get machine.id)"

request GET "/machines/$machine_id" | json_assert get-machine 'data.machine && data.machine.id && data.machine.incus && data.machine.incus.observed'
request POST "/machines/$machine_id/start" | json_assert start-machine 'data.ok === true'
request POST "/machines/$machine_id/reboot" | json_assert reboot-machine 'data.ok === true'
request POST "/machines/$machine_id/stop" | json_assert stop-machine 'data.ok === true'

echo "machine lifecycle ok: $machine_id"
