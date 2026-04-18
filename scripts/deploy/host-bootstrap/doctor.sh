#!/usr/bin/env bash
set -euo pipefail

node_version="$(node --version)"
incus_version="$(incus version | tr '\n' ' ' | sed 's/  */ /g')"
runnerd_active="$(systemctl is-active justavps-runnerd)"
incus_active="$(systemctl is-active incus)"
docker_remote="$(incus remote list --format csv | grep '^docker,' || true)"
backup_timer="$(systemctl is-enabled justavps-incus-db-backup.timer 2>/dev/null || true)"

python3 - <<PY
import json
print(json.dumps({
  'node_version': ${node_version@Q},
  'incus_version': ${incus_version@Q},
  'runnerd_active': ${runnerd_active@Q},
  'incus_active': ${incus_active@Q},
  'docker_remote': ${docker_remote@Q},
  'backup_timer': ${backup_timer@Q},
}, indent=2))
PY
