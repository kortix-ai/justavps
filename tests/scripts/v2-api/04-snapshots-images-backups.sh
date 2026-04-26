#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"
require_live
require_image

machine_name="v2e2e-artifacts-${RANDOM}-${RANDOM}"
machine_id=""
snapshot_clone_name="v2e2e-snapshot-${RANDOM}-${RANDOM}"
snapshot_clone_id=""
empty_machine_name="v2e2e-empty-${RANDOM}-${RANDOM}"
empty_machine_id=""
snapshot_name="snap-${RANDOM}-${RANDOM}"
snapshot_id=""
backup_name="backup-${RANDOM}-${RANDOM}"
image_id=""

cleanup() {
  if [ -n "$snapshot_clone_id" ]; then
    request DELETE "/machines/$snapshot_clone_id" >/dev/null || true
  fi
  if [ -n "$empty_machine_id" ]; then
    request DELETE "/machines/$empty_machine_id" >/dev/null || true
  fi
  if [ -n "$machine_id" ]; then
    if [ -n "$image_id" ]; then
      request DELETE "/images/$image_id" >/dev/null || true
    fi
    request DELETE "/machines/$machine_id/backups/$backup_name" >/dev/null || true
    request DELETE "/machines/$machine_id/snapshots/$snapshot_name" >/dev/null || true
    request DELETE "/machines/$machine_id" >/dev/null || true
  fi
}
trap cleanup EXIT

create_body="$(node -e 'console.log(JSON.stringify({region:process.env.V2_E2E_REGION||"eu",type:process.env.V2_E2E_TYPE||"container",name:process.argv[1],resources:{vcpu:1,memory_gb:1,disk_gb:Number(process.env.V2_E2E_DISK_GB||10)},source:{type:"image",image_id:process.env.V2_E2E_IMAGE}}))' "$machine_name")"
create_json="$(request POST /machines "$create_body")"
printf '%s' "$create_json" | json_assert create-artifact-machine 'data.machine && data.machine.type === "container" && data.machine.incus && data.machine.incus.cluster_id'
machine_id="$(printf '%s' "$create_json" | json_get machine.id)"

snapshot_json="$(request POST "/machines/$machine_id/snapshots" "{\"name\":\"$snapshot_name\"}")"
printf '%s' "$snapshot_json" | json_assert create-snapshot 'data.snapshot && data.snapshot.id && data.operation && data.operation.status === "Success"'
snapshot_id="$(printf '%s' "$snapshot_json" | json_get snapshot.id)"
request GET "/machines/$machine_id/snapshots" | json_assert list-snapshots "Array.isArray(data.snapshots) && data.snapshots.some(snapshot => snapshot.name === '$snapshot_name')"
request POST "/machines/$machine_id/stop" | json_assert stop-for-restore 'data.ok === true'
request POST "/machines/$machine_id/snapshots/$snapshot_name/restore" '{}' | json_assert restore-snapshot 'data.ok === true'

snapshot_clone_body="$(node -e 'console.log(JSON.stringify({region:process.env.V2_E2E_REGION||"eu",type:"container",name:process.argv[1],resources:{vcpu:1,memory_gb:1,disk_gb:Number(process.env.V2_E2E_DISK_GB||10)},source:{type:"snapshot",snapshot_id:process.argv[2]}}))' "$snapshot_clone_name" "$snapshot_id")"
snapshot_clone_json="$(request POST /machines "$snapshot_clone_body")"
printf '%s' "$snapshot_clone_json" | json_assert create-from-snapshot 'data.machine && data.machine.source && data.machine.source.type === "snapshot" && data.machine.incus && data.machine.incus.cluster_id'
snapshot_clone_id="$(printf '%s' "$snapshot_clone_json" | json_get machine.id)"
request GET "/machines/$snapshot_clone_id" | json_assert get-snapshot-clone 'data.machine && data.machine.id && data.machine.incus && data.machine.incus.observed'

empty_body="$(node -e 'console.log(JSON.stringify({region:process.env.V2_E2E_REGION||"eu",type:"container",name:process.argv[1],resources:{vcpu:1,memory_gb:1,disk_gb:Number(process.env.V2_E2E_DISK_GB||10)},source:{type:"empty"}}))' "$empty_machine_name")"
empty_json="$(request POST /machines "$empty_body")"
printf '%s' "$empty_json" | json_assert create-empty-machine 'data.machine && data.machine.source && data.machine.source.type === "empty" && data.machine.incus && data.machine.incus.cluster_id'
empty_machine_id="$(printf '%s' "$empty_json" | json_get machine.id)"
request GET "/machines/$empty_machine_id" | json_assert get-empty-machine 'data.machine && data.machine.id && data.machine.incus && data.machine.incus.observed'

image_json="$(request POST /images "$(node -e 'console.log(JSON.stringify({machine_id:process.argv[1],snapshot_id:process.argv[2],name:`img-${process.argv[2]}`}))' "$machine_id" "$snapshot_name")")"
printf '%s' "$image_json" | json_assert create-image 'data.image && data.image.id && data.operation && data.operation.status === "Success"'
image_id="$(printf '%s' "$image_json" | json_get image.id)"

request POST "/machines/$machine_id/backups" "{\"name\":\"$backup_name\"}" | json_assert create-backup 'data.backup && data.operation && data.operation.status === "Success"'
request GET "/machines/$machine_id/backups" | json_assert list-backups "Array.isArray(data.backups) && data.backups.some(backup => backup.name === '$backup_name')"

echo "snapshots/images/backups ok: $machine_id"
