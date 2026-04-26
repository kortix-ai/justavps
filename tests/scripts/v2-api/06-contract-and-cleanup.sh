#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

request GET /health | json_assert health-contract 'data.status === "ok" && typeof data.database_configured === "boolean" && typeof data.incus_clusters_configured === "number"'
request GET /regions | json_assert regions-contract 'Array.isArray(data.regions) && data.regions.every(region => typeof region === "string" && region.length > 0)'
request GET /images | json_assert images-contract 'Array.isArray(data.images) && data.images.every(image => image.id && image.cluster && Array.isArray(image.aliases))'
request GET /machines | json_assert machines-contract 'Array.isArray(data.machines) && data.machines.every(machine => machine.id && machine.incus)'

if [ "${V2_E2E_LIVE:-}" = "true" ]; then
  request GET /machines | json_assert live-machine-cleanup 'Array.isArray(data.machines) && !data.machines.some(machine => String(machine.id || "").startsWith("v2e2e-") || String(machine.name || "").startsWith("v2e2e-"))'
  request GET /images | json_assert live-image-cleanup 'Array.isArray(data.images) && !data.images.some(image => (image.aliases || []).some(alias => String(alias.name || "").startsWith("img-snap-")))'
fi

echo "v2-api contract/cleanup ok"
