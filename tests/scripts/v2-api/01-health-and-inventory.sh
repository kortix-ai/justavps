#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

request GET /health | json_assert health 'data.status === "ok" && data.service === "justavps-v2-api"'
request GET /regions | json_assert regions 'Array.isArray(data.regions)'
request GET /admin/clusters | json_assert clusters 'Array.isArray(data.clusters)'
request GET /admin/hosts | json_assert hosts 'Array.isArray(data.hosts)'
request GET /admin/hosts/inventory | json_assert inventory 'Array.isArray(data.hosts) && typeof data.persisted === "boolean"'
request GET /images | json_assert images 'Array.isArray(data.images)'
request GET /machines | json_assert machines 'Array.isArray(data.machines)'

echo "v2-api health/inventory ok"
