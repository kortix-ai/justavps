#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  JustAVPS V1 Script Flow"
echo "════════════════════════════════════════════════════════════"
echo ""

run_step() {
  local label="$1"
  shift
  echo "── $label"
  "$@"
  echo ""
}

skip_step() {
  local label="$1"
  local reason="$2"
  echo "── $label"
  echo "SKIP: $reason"
  echo ""
}

if [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  run_step "01 billing" pnpm e2e:v1:billing
  run_step "02 direct checkout" pnpm e2e:v1:direct-checkout
else
  skip_step "01 billing" "STRIPE_SECRET_KEY not set"
  skip_step "02 direct checkout" "STRIPE_SECRET_KEY not set"
fi

if [ -n "${E2E_API_KEY:-}" ]; then
  run_step "03 full live machine flow" pnpm e2e:v1:full-live
else
  skip_step "03 full live machine flow" "E2E_API_KEY not set"
fi

if [ -n "${PROXY_AUTH_SECRET:-}" ]; then
  run_step "04 proxy" pnpm e2e:v1:proxy
else
  skip_step "04 proxy" "PROXY_AUTH_SECRET not set"
fi

if [ -n "${API_KEY:-}" ] && [ -n "${MACHINE_ID:-}" ]; then
  run_step "05 toolbox api" pnpm e2e:v1:toolbox-api
else
  skip_step "05 toolbox api" "API_KEY and MACHINE_ID must be set"
fi

if [ $# -ge 2 ]; then
  run_step "06 toolbox direct" pnpm e2e:v1:toolbox -- "$@"
else
  skip_step "06 toolbox direct" "pass <machine_ip> <ssh_key_path> to tests/scripts/v1/run-all.sh"
fi

echo "V1 scripted flow complete"
