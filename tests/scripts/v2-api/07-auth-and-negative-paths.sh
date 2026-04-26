#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

status_no_auth() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X "$method" --data "$body" "$BASE_URL$path" || true
  else
    curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$BASE_URL$path" || true
  fi
}

status_with_auth() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -o /dev/null -w '%{http_code}' "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' -X "$method" --data "$body" "$BASE_URL$path" || true
  else
    curl -sS -o /dev/null -w '%{http_code}' "${AUTH_ARGS[@]}" -X "$method" "$BASE_URL$path" || true
  fi
}

expect_status() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [ "$actual" != "$expected" ]; then
    echo "$label expected HTTP $expected, got $actual"
    exit 1
  fi
}

if [ -n "${V2_ADMIN_TOKEN:-}" ]; then
  expect_status admin-auth "$(status_no_auth GET /admin/clusters)" 401
  expect_status create-auth "$(status_no_auth POST /machines '{"region":"eu"}')" 401
  expect_status lifecycle-auth "$(status_no_auth POST /machines/v2e2e-does-not-exist/start)" 401
  expect_status delete-auth "$(status_no_auth DELETE /machines/v2e2e-does-not-exist)" 401
  expect_status image-auth "$(status_no_auth POST /images '{"machine_id":"v2e2e-does-not-exist"}')" 401
  expect_status toolbox-config-auth "$(status_no_auth GET /machines/v2e2e-does-not-exist/toolbox-config)" 401
else
  echo "Skipping auth rejection checks: V2_ADMIN_TOKEN is not set."
fi

expect_status bad-create "$(status_with_auth POST /machines '{"region":"eu","type":"container","resources":{"vcpu":0,"memory_gb":0,"disk_gb":0},"source":{"type":"image","image_id":"missing"}}')" 400
expect_status missing-snapshot-source "$(status_with_auth POST /machines '{"region":"eu","type":"container","resources":{"vcpu":1,"memory_gb":1,"disk_gb":10},"source":{"type":"snapshot","snapshot_id":"missing"}}')" 404
expect_status unsupported-backup-source "$(status_with_auth POST /machines '{"region":"eu","type":"container","resources":{"vcpu":1,"memory_gb":1,"disk_gb":10},"source":{"type":"backup","backup_id":"missing"}}')" 501
expect_status missing-machine "$(status_with_auth GET /machines/v2e2e-does-not-exist)" 404
expect_status backup-restore-unimplemented "$(status_with_auth POST /machines/v2e2e-does-not-exist/backups/nope/restore '{}')" 501
expect_status missing-toolbox-config "$(status_with_auth GET /machines/v2e2e-does-not-exist/toolbox-config)" 404
expect_status missing-toolbox-command "$(status_with_auth POST /machines/v2e2e-does-not-exist/toolbox-command '{"command":"true"}')" 404

echo "v2-api auth/negative paths ok"
