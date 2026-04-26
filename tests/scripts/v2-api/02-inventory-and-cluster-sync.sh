#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

hetzner_json="$(request POST /admin/vendors/hetzner/sync)"
printf '%s' "$hetzner_json" | json_assert hetzner-sync 'typeof data.synced === "number" && Array.isArray(data.hosts) && data.hosts.length === data.synced && data.hosts.every(host => host.vendor === "hetzner_robot" && host.publicIpv4 && host.status)'
hetzner_count="$(printf '%s' "$hetzner_json" | json_get synced)"
echo "hetzner synced $hetzner_count hosts"

clusters_json="$(request GET /admin/clusters)"
printf '%s' "$clusters_json" | json_assert clusters-shape 'Array.isArray(data.clusters)'
cluster_count="$(printf '%s' "$clusters_json" | node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>console.log((JSON.parse(d).clusters||[]).length));')"

if [ "$cluster_count" = "0" ]; then
  echo "No Incus clusters configured; cluster sync skipped."
  exit 0
fi

cluster_id="$(printf '%s' "$clusters_json" | node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>console.log(JSON.parse(d).clusters[0].id));')"
cluster_sync_json="$(request POST "/admin/clusters/$cluster_id/sync")"
printf '%s' "$cluster_sync_json" | json_assert cluster-sync 'data.cluster && data.cluster.id && data.synced && data.synced.cluster_id === data.cluster.id && data.synced.members >= 1 && data.synced.images >= 1'
node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{const data=JSON.parse(d); console.log(`cluster ${data.cluster.id} synced: ${JSON.stringify(data.synced)}`);});' <<<"$cluster_sync_json"

request GET /admin/hosts/inventory | json_assert synced-host-inventory 'Array.isArray(data.hosts) && data.hosts.some(host => host.incusClusterId && host.incusMemberName && host.schedulable === true) && data.hosts.some(host => host.schedulable === false)'
