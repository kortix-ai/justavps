#!/bin/bash
# Run infrastructure E2E tests against live Hetzner.
# Requires dev server on port 4100 + valid API key.
#
# Usage: ./scripts/run-e2e.sh [API_KEY]

set -e

export PLATFORM_E2E=1
export E2E_API_KEY="${E2E_API_KEY:-${1:-sk_live_48af5f414a8e7eddd2a56bfef48ebb0a2378c244e4575892502054c48de513c6}}"

echo "Running E2E lifecycle tests..."
echo "  PLATFORM_E2E=$PLATFORM_E2E"
echo "  E2E_API_KEY=${E2E_API_KEY:0:20}..."
echo ""

npx vitest run --config vitest.e2e.config.ts src/__tests__/e2e/machine-lifecycle.test.ts
