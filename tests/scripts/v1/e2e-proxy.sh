#!/bin/bash
# E2E test script for proxy infrastructure (Worker + daemon + port forwarding).
#
# Tests both dev and prod Workers, auth flows, port routing, and SSH integration.
#
# Usage:
#   bash tests/scripts/v1/e2e-proxy.sh
#
# Prerequisites:
#   - PROXY_AUTH_SECRET env var set (or sourced from .env)
#   - A running dev machine with SSH access
#   - Both Workers deployed

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────
source "$(dirname "$0")/../.env" 2>/dev/null || true

# Dev machine for testing (update these for your test machine)
DEV_SLUG="${E2E_DEV_SLUG:-bwxur2xf}"
DEV_IP="${E2E_DEV_IP:-95.217.233.69}"
DEV_DOMAIN="kortix-dev.cloud"
PROD_DOMAIN="kortix.cloud"

PROXY_SECRET="${PROXY_AUTH_SECRET:-}"
if [ -z "$PROXY_SECRET" ]; then
  echo "ERROR: PROXY_AUTH_SECRET not set. Source .env or export it."
  exit 1
fi

PASS=0
FAIL=0

check() {
  local name="$1" expected="$2" got="$3"
  if [ "$expected" = "$got" ]; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name (expected: $expected, got: $got)"
    FAIL=$((FAIL + 1))
  fi
}

# Generate a valid JWT for the dev machine owner
gen_token() {
  local sub="$1"
  PROXY_AUTH_SECRET="$PROXY_SECRET" node -e "
const crypto = require('crypto');
const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const p = Buffer.from(JSON.stringify({sub:'$sub',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400})).toString('base64url');
const s = crypto.createHmac('sha256', process.env.PROXY_AUTH_SECRET).update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);
"
}

OWNER_ID="973d8dc5-8f77-492e-8cd3-4e45eaa8e0b3"
VALID_TOKEN=$(gen_token "$OWNER_ID")
WRONG_TOKEN=$(gen_token "bad-user-id-00000000")

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  E2E Proxy Tests — $(date)"
echo "════════════════════════════════════════════════════════════"

# ── Dev Worker Tests ─────────────────────────────────────────────────────
echo ""
echo "── Dev Worker (*.${DEV_DOMAIN}) ──"

# T1: No auth → redirect to dev.justavps.com
redirect=$(curl -s -D - -o /dev/null "https://${DEV_SLUG}.${DEV_DOMAIN}/" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0" 2>&1 | grep -i "^location:" | sed 's/location: //i' | tr -d '\r')
check "No auth → dev.justavps.com redirect" "true" "$(echo "$redirect" | grep -q 'dev.justavps.com/api/proxy-auth' && echo true || echo false)"

# T2: Valid token → auth passes (503 = machine up but services loading, or 200)
code=$(curl -s -w "%{http_code}" -o /dev/null "https://${DEV_SLUG}.${DEV_DOMAIN}/?token=${VALID_TOKEN}" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0")
check "Valid token → auth passes (5xx/2xx)" "true" "$([ "$code" -ge 200 ] && [ "$code" -lt 600 ] && [ "$code" -ne 401 ] && [ "$code" -ne 403 ] && [ "$code" -ne 302 ] && echo true || echo false)"

# T3: Wrong user → 403
code=$(curl -s -w "%{http_code}" -o /dev/null "https://${DEV_SLUG}.${DEV_DOMAIN}/?token=${WRONG_TOKEN}" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0")
check "Wrong user token → 403" "403" "$code"

# T4: Stale cookie + valid token → token wins
code=$(curl -s -w "%{http_code}" -o /dev/null "https://${DEV_SLUG}.${DEV_DOMAIN}/?token=${VALID_TOKEN}" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0" -H "Cookie: __justavps_proxy=${WRONG_TOKEN}")
check "Stale cookie + valid token → token wins" "true" "$([ "$code" -ne 401 ] && [ "$code" -ne 403 ] && [ "$code" -ne 302 ] && echo true || echo false)"

# T5: PORT--SLUG routing
code=$(curl -s -w "%{http_code}" -o /dev/null "https://4096--${DEV_SLUG}.${DEV_DOMAIN}/?token=${VALID_TOKEN}" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0")
check "PORT--SLUG routing → auth passes" "true" "$([ "$code" -ne 401 ] && [ "$code" -ne 403 ] && [ "$code" -ne 302 ] && echo true || echo false)"

# T6: Terminal page contains link rewriting code
terminal_html=$(curl -s "https://${DEV_SLUG}.${DEV_DOMAIN}/_terminal?token=${VALID_TOKEN}" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0")
has_link_provider=$(echo "$terminal_html" | grep -c "LocalhostLinkProvider" || echo 0)
has_dev_domain=$(echo "$terminal_html" | grep -c "${DEV_DOMAIN}" || echo 0)
check "Terminal has LocalhostLinkProvider" "true" "$([ "$has_link_provider" -gt 0 ] && echo true || echo false)"
check "Terminal has dev domain" "true" "$([ "$has_dev_domain" -gt 0 ] && echo true || echo false)"

# ── Prod Worker Isolation Tests ──────────────────────────────────────────
echo ""
echo "── Prod Worker Isolation (*.${PROD_DOMAIN}) ──"

# T7: Prod redirect goes to justavps.com NOT dev
redirect=$(curl -s -D - -o /dev/null "https://${DEV_SLUG}.${PROD_DOMAIN}/" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0" 2>&1 | grep -i "^location:" | sed 's/location: //i' | tr -d '\r')
check "Prod redirect → justavps.com (not dev)" "true" "$(echo "$redirect" | grep -q 'justavps.com/api/proxy-auth' && ! echo "$redirect" | grep -q 'dev.justavps.com' && echo true || echo false)"

# T8: Dev token on prod → machine not found (separate KV)
code=$(curl -s -w "%{http_code}" -o /dev/null "https://${DEV_SLUG}.${PROD_DOMAIN}/?token=${VALID_TOKEN}" \
  -H "Accept: text/html" -H "User-Agent: Mozilla/5.0")
check "Dev token on prod → redirects (machine not in prod KV)" "302" "$code"

# ── SSH Integration Tests (requires SSH access) ─────────────────────────
echo ""
echo "── SSH Integration (${DEV_IP}) ──"

if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 root@"$DEV_IP" "echo ok" &>/dev/null; then
  # T9: porturl command
  porturl_out=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$DEV_IP" "porturl 3000" 2>/dev/null)
  check "porturl 3000 → correct URL" "https://3000--${DEV_SLUG}.${DEV_DOMAIN}" "$porturl_out"

  # T10: Env vars set
  env_slug=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$DEV_IP" "source /etc/profile.d/justavps-ports.sh 2>/dev/null; echo \$JUSTAVPS_SLUG" 2>/dev/null)
  check "JUSTAVPS_SLUG env var" "$DEV_SLUG" "$env_slug"

  env_domain=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$DEV_IP" "source /etc/profile.d/justavps-ports.sh 2>/dev/null; echo \$JUSTAVPS_DOMAIN" 2>/dev/null)
  check "JUSTAVPS_DOMAIN env var" "$DEV_DOMAIN" "$env_domain"

  # T11: Port watcher detects new ports
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$DEV_IP" "
    python3 -m http.server 19999 --bind 127.0.0.1 &>/dev/null &
    PID=\$!
    sleep 4
    FOUND=\$(grep -c '19999' /run/justavps/port-events 2>/dev/null || echo 0)
    kill \$PID 2>/dev/null; wait \$PID 2>/dev/null
    echo \$FOUND
  " 2>/dev/null | read -r found_count
  found_count=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$DEV_IP" "
    python3 -m http.server 19998 --bind 127.0.0.1 &>/dev/null &
    PID=\$!; sleep 4
    grep -c 19998 /run/justavps/port-events 2>/dev/null || echo 0
    kill \$PID 2>/dev/null; wait \$PID 2>/dev/null
  " 2>/dev/null)
  check "Port watcher detects new port" "true" "$([ "${found_count:-0}" -gt 0 ] && echo true || echo false)"

  # T12: Terminal page from daemon has correct domain
  term_domain=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@"$DEV_IP" "curl -s http://127.0.0.1:80/_terminal | grep -o \"DOMAIN = '[^']*'\" | head -1" 2>/dev/null)
  check "Daemon terminal page domain" "DOMAIN = '${DEV_DOMAIN}'" "$term_domain"
else
  echo "  ⚠️  SSH not reachable — skipping SSH tests"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "════════════════════════════════════════════════════════════"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
