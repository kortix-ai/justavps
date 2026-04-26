#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"
require_live
require_vm_image

machine_name="v2e2e-vm-${RANDOM}-${RANDOM}"
machine_id=""

cleanup() {
  if [ -n "$machine_id" ]; then
    request DELETE "/machines/$machine_id" >/dev/null || true
  fi
}
trap cleanup EXIT

create_body="$(node -e 'console.log(JSON.stringify({region:process.env.V2_E2E_REGION||"eu",type:"vm",name:process.argv[1],resources:{vcpu:1,memory_gb:2,disk_gb:Number(process.env.V2_E2E_VM_DISK_GB||20)},source:{type:"image",image_id:process.env.V2_E2E_VM_IMAGE}}))' "$machine_name")"
create_json="$(request POST /machines "$create_body")"
printf '%s' "$create_json" | json_assert create-vm 'data.machine && data.machine.type === "vm" && data.machine.incus && data.machine.incus.cluster_id'
machine_id="$(printf '%s' "$create_json" | json_get machine.id)"

request GET "/machines/$machine_id" | json_assert get-vm 'data.machine && data.machine.type === "vm" && data.machine.incus && data.machine.incus.observed'
request POST "/machines/$machine_id/start" | json_assert start-vm 'data.ok === true'
request POST "/machines/$machine_id/reboot" | json_assert reboot-vm 'data.ok === true'
request POST "/machines/$machine_id/stop" | json_assert stop-vm 'data.ok === true'

echo "vm lifecycle ok: $machine_id"
