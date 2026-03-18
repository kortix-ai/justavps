#!/bin/bash
#
# ═══════════════════════════════════════════════════════════════════════
#  JustAVPS — Full End-to-End Test
# ═══════════════════════════════════════════════════════════════════════
#
# Tests the core flow: deploy machine → provision → SSH → tunnel → auth → cleanup
#
# Usage:
#   E2E_API_KEY=sk_live_xxx ./scripts/e2e-full.sh
#   SKIP_CLEANUP=1 E2E_API_KEY=sk_live_xxx ./scripts/e2e-full.sh
#
# Cost: ~$0.01 (cpx22 for ~5 min)
# Time: ~5-8 minutes
#

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
[ -f "$PROJECT_DIR/.env" ] && { set -a; source "$PROJECT_DIR/.env"; set +a; }

BASE="${BASE_URL:-http://localhost:4100}/api"
API_KEY="${E2E_API_KEY:-}"
SKIP_CLEANUP="${SKIP_CLEANUP:-0}"
HETZNER_TOKEN="${HETZNER_API_KEY:-}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: Set E2E_API_KEY=sk_live_xxx"
  echo "Create one: curl -X POST $BASE/v1/api-keys -H 'Authorization: Bearer ...' -d '{\"name\":\"e2e\"}'"
  exit 1
fi

# State
MACHINE_ID="" MACHINE_SLUG="" MACHINE_IP="" SSH_KEY_FILE=""
PASS=0 FAIL=0 TOTAL=0

# ─── Helpers ─────────────────────────────────────────────────────────────────

R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' C='\033[0;36m' N='\033[0m'
log()  { echo -e "${C}[E2E]${N} $*"; }
pass() { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo -e "  ${G}✓${N} $*"; }
fail() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); echo -e "  ${R}✗${N} $*"; }
skip() { TOTAL=$((TOTAL+1)); echo -e "  ${Y}⊘${N} $* (skipped)"; }

assert_eq()       { [ "$2" = "$3" ] && pass "$1" || fail "$1 (expected='$2' got='$3')"; }
assert_contains() { echo "$2" | grep -q "$3" && pass "$1" || fail "$1 (missing '$3')"; }
assert_not_empty(){ [ -n "$2" ] && pass "$1" || fail "$1 (empty)"; }

H="Authorization: Bearer $API_KEY"
api()    { curl -s -H "$H" -H "Content-Type: application/json" "$BASE$1" ${2:+-X POST -d "$2"}; }
apidel() { curl -s -o /dev/null -w "%{http_code}" -H "$H" -X DELETE "$BASE$1"; }

py() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); $1" 2>/dev/null; }

ssh_cmd() {
  [ -z "$SSH_KEY_FILE" ] || [ -z "$MACHINE_IP" ] && return 1
  ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 root@"$MACHINE_IP" "$@" 2>/dev/null
}

cleanup() {
  if [ -n "$MACHINE_ID" ] && [ "$SKIP_CLEANUP" != "1" ]; then
    log "Cleaning up machine $MACHINE_SLUG..."
    apidel "/v1/machines/$MACHINE_ID" > /dev/null 2>&1 || true
    # Fallback: delete Hetzner server directly
    if [ -n "$MACHINE_SLUG" ] && [ -n "$HETZNER_TOKEN" ]; then
      SID=$(curl -s -H "Authorization: Bearer $HETZNER_TOKEN" \
        "https://api.hetzner.cloud/v1/servers?label_selector=slug=$MACHINE_SLUG" | \
        py "print(d.get('servers',[{}])[0].get('id',''))" 2>/dev/null)
      [ -n "$SID" ] && curl -s -X DELETE "https://api.hetzner.cloud/v1/servers/$SID" \
        -H "Authorization: Bearer $HETZNER_TOKEN" > /dev/null 2>&1
    fi
  fi
  [ -n "$SSH_KEY_FILE" ] && rm -f "$SSH_KEY_FILE"
}
trap cleanup EXIT

# ─── Preflight ───────────────────────────────────────────────────────────────

echo ""
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo -e "${C}  JustAVPS — Full End-to-End Test${N}"
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo ""

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/machines" -H "$H")
if [ "$STATUS" != "200" ]; then
  echo -e "${R}ERROR: API key invalid or server not running (HTTP $STATUS)${N}"
  exit 1
fi
log "API key valid, server running"

# ═════════════════════════════════════════════════════════════════════════════
#  PHASE 1: Deploy Machine
# ═════════════════════════════════════════════════════════════════════════════

echo ""
log "Phase 1: Deploy Machine"

RESP=$(api "/v1/machines" '{"provider":"hetzner","server_type":"cpx22","region":"hel1","name":"e2e-full-test"}')

# Check for Stripe checkout redirect
CHECKOUT=$(echo "$RESP" | py "print(d.get('requires_checkout',''))")
if [ "$CHECKOUT" = "True" ]; then
  echo -e "${Y}Stripe payment required — disable with STRIPE_SECRET_KEY='' in .env${N}"
  exit 0
fi

MACHINE_ID=$(echo "$RESP" | py "print(d.get('id',''))")
MACHINE_SLUG=$(echo "$RESP" | py "print(d.get('slug',''))")
assert_not_empty "Machine created" "$MACHINE_ID"
assert_not_empty "Machine slug" "$MACHINE_SLUG"
assert_eq "Status = provisioning" "provisioning" "$(echo "$RESP" | py "print(d.get('status',''))")"

log "  slug=$MACHINE_SLUG id=${MACHINE_ID:0:8}..."

# Extract SSH key
SSH_KEY_FILE="/tmp/e2e_ssh_${MACHINE_SLUG}"
echo "$RESP" | py "
pk = d.get('ssh_key',{}).get('private_key','')
if pk:
    if not pk.endswith('\n'): pk += '\n'
    open('$SSH_KEY_FILE','w').write(pk)
    print('ok')
else:
    print('')
"
[ -f "$SSH_KEY_FILE" ] && chmod 600 "$SSH_KEY_FILE" && pass "SSH key saved" || fail "SSH key extraction"

# ═════════════════════════════════════════════════════════════════════════════
#  PHASE 2: Wait for Ready
# ═════════════════════════════════════════════════════════════════════════════

echo ""
log "Phase 2: Provisioning (up to 5 min)..."

START=$(date +%s)
while [ $(($(date +%s) - START)) -lt 300 ]; do
  D=$(api "/v1/machines/$MACHINE_ID")
  S=$(echo "$D" | py "print(d.get('status',''))")
  IP=$(echo "$D" | py "print(d.get('ip',''))")
  [ -n "$IP" ] && [ -z "$MACHINE_IP" ] && { MACHINE_IP="$IP"; log "  IP: $MACHINE_IP"; }
  [ "$S" = "ready" ] && break
  [ "$S" = "error" ] && { fail "Provisioning (error)"; break; }
  printf "\r  [%3ds] %s " "$(($(date +%s)-START))" "$S"
  sleep 10
done
echo ""

assert_eq "Machine ready" "ready" "$S"
assert_not_empty "Has IP" "$MACHINE_IP"

# ═════════════════════════════════════════════════════════════════════════════
#  PHASE 3: SSH + Cloud-Init
# ═════════════════════════════════════════════════════════════════════════════

echo ""
log "Phase 3: SSH + Cloud-Init (up to 6 min)..."

# Wait for SSH
SSH_OK=0
for i in $(seq 1 36); do
  ssh_cmd "echo OK" | grep -q OK && { SSH_OK=1; log "  SSH up (${i}0s)"; break; }
  sleep 10
done
assert_eq "SSH connects" "1" "$SSH_OK"

if [ "$SSH_OK" = "1" ]; then
  # Wait for cloud-init
  CI_OK=0
  for i in $(seq 1 36); do
    CS=$(ssh_cmd "cloud-init status 2>/dev/null | grep -o 'done\|running\|error'" || echo "?")
    [ "$CS" = "done" ] && { CI_OK=1; log "  Cloud-init done (${i}0s)"; break; }
    [ "$CS" = "error" ] && { fail "Cloud-init error"; break; }
    sleep 10
  done
  assert_eq "Cloud-init done" "1" "$CI_OK"

  # Services
  for svc in code-server docker justavps-daemon cloudflared; do
    ST=$(ssh_cmd "systemctl is-active $svc" || echo "inactive")
    assert_eq "$svc running" "active" "$ST"
  done

  # Daemon health
  DH=$(ssh_cmd "curl -sf http://localhost:7777/health" | py "print(d.get('status',''))" || echo "")
  assert_eq "Daemon /health" "ok" "$DH"

  # code-server local
  CS=$(ssh_cmd "curl -sf -o /dev/null -w '%{http_code}' http://localhost:8080/" || echo "000")
  assert_contains "code-server local" "$CS" "302"

  # Config
  CFG_SLUG=$(ssh_cmd "cat /etc/justavps/config.json" | py "print(d.get('slug',''))" || echo "")
  assert_eq "Config slug" "$MACHINE_SLUG" "$CFG_SLUG"

  # Firewall
  UFW=$(ssh_cmd "ufw status | head -1" || echo "")
  assert_contains "Firewall active" "$UFW" "active"
else
  for t in "Cloud-init" "code-server" "docker" "justavps-daemon" "cloudflared" "Daemon /health" "code-server local" "Config slug" "Firewall"; do
    skip "$t"
  done
fi

# ═════════════════════════════════════════════════════════════════════════════
#  PHASE 4: Tunnel + DNS
# ═════════════════════════════════════════════════════════════════════════════

echo ""
log "Phase 4: Tunnel + DNS"

DNS_OK=0
for i in $(seq 1 12); do
  R=$(dig +short "$MACHINE_SLUG.kortix.cloud" 2>/dev/null | head -1)
  [ -n "$R" ] && { DNS_OK=1; pass "DNS resolves ($R)"; break; }
  sleep 5
done
[ "$DNS_OK" = "0" ] && fail "DNS not resolved after 60s"

# Tunnel health
if [ -n "${CLOUDFLARE_TUNNEL_ID:-}" ]; then
  TS=$(curl -s -H "X-Auth-Key: $CLOUDFLARE_GLOBAL_API_KEY" -H "X-Auth-Email: $CLOUDFLARE_EMAIL" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$CLOUDFLARE_TUNNEL_ID" | \
    py "print(d.get('result',{}).get('status',''))" || echo "")
  assert_eq "Tunnel healthy" "healthy" "$TS"
fi

# ═════════════════════════════════════════════════════════════════════════════
#  PHASE 5: Proxy Auth
# ═════════════════════════════════════════════════════════════════════════════

echo ""
log "Phase 5: Proxy Auth"

URL="https://$MACHINE_SLUG.kortix.cloud"

# Generate JWT
USER_ID=$(api "/v1/machines/$MACHINE_ID" | py "print('')")  # We need user_id — get from DB
USER_ID=$(PGPASSWORD=justavps123 psql -h localhost -p 54330 -U justavps -d justavps -t -A -c \
  "SELECT owner_id FROM machines WHERE id='$MACHINE_ID';" 2>/dev/null || echo "")

if [ -n "$USER_ID" ] && [ -n "${PROXY_AUTH_SECRET:-}" ]; then
  JWT=$(cd "$PROJECT_DIR" && timeout 10 npx tsx -e "
import 'dotenv/config';
import { signProxyToken } from './src/server/lib/proxy-token.ts';
signProxyToken('$USER_ID').then(t => { console.log(t); process.exit(0); });
" 2>/dev/null || echo "")
fi

if [ -n "${JWT:-}" ]; then
  # No auth → blocked
  NA=$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" "$URL/" 2>/dev/null || echo "000")
  if [ "$NA" = "401" ] || [ "$NA" = "302" ]; then
    pass "No auth → blocked ($NA)"
  elif [ "$NA" = "000" ]; then
    fail "No auth → connection failed (tunnel not ready?)"
  else
    fail "No auth → HTTP $NA (expected 401/302)"
  fi

  # JWT cookie → code-server
  AC=$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" -b "__justavps_proxy=$JWT" "$URL/login" 2>/dev/null || echo "000")
  assert_eq "JWT cookie → 200" "200" "$AC"

  # Page title
  TITLE=$(curl -s --max-time 10 -b "__justavps_proxy=$JWT" "$URL/login" 2>/dev/null | grep -o "<title>.*</title>" || echo "")
  assert_contains "code-server page" "$TITLE" "code-server"

  # Auth header
  AH=$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" -H "Authorization: Bearer $JWT" "$URL/login" 2>/dev/null || echo "000")
  assert_eq "Auth header → 200" "200" "$AH"

  # Token param
  TP=$(curl -s -o /dev/null --max-time 10 -w "%{http_code}" "$URL/login?token=$JWT" 2>/dev/null || echo "000")
  assert_eq "Token param → 200" "200" "$TP"
else
  for t in "No auth" "JWT cookie" "code-server page" "Auth header" "Token param"; do
    skip "$t (no JWT — set PROXY_AUTH_SECRET)"
  done
fi

# ═════════════════════════════════════════════════════════════════════════════
#  PHASE 6: Platform API
# ═════════════════════════════════════════════════════════════════════════════

echo ""
log "Phase 6: Platform API"

# List machines
LM=$(api "/v1/machines" | py "print('yes' if any(m['slug']=='$MACHINE_SLUG' for m in d.get('machines',[])) else 'no')")
assert_eq "GET /machines lists machine" "yes" "$LM"

# Get machine
GS=$(api "/v1/machines/$MACHINE_ID" | py "print(d.get('slug',''))")
assert_eq "GET /machines/:id correct" "$MACHINE_SLUG" "$GS"

# Images empty
IC=$(api "/v1/images" | py "print(len(d.get('images',[])))")
assert_eq "GET /images empty" "0" "$IC"

# 404
F=$(curl -s -o /dev/null -w "%{http_code}" -H "$H" "$BASE/v1/images/00000000-0000-0000-0000-000000000000")
assert_eq "Images 404" "404" "$F"

# Unauth
U=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/machines")
assert_eq "Unauth → 401" "401" "$U"

# ═════════════════════════════════════════════════════════════════════════════
#  PHASE 7: Cleanup
# ═════════════════════════════════════════════════════════════════════════════

echo ""
if [ "$SKIP_CLEANUP" = "1" ]; then
  log "Cleanup SKIPPED"
  log "  SSH: ssh -i $SSH_KEY_FILE root@$MACHINE_IP"
  log "  URL: $URL"
  MACHINE_ID=""  # prevent trap cleanup
else
  log "Phase 7: Cleanup"
  DC=$(apidel "/v1/machines/$MACHINE_ID")
  assert_contains "Delete machine" "$DC" "20"
  MACHINE_ID=""
fi

# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${G}ALL $PASS TESTS PASSED${N} ($TOTAL total)"
else
  echo -e "  ${R}$FAIL FAILED${N}, ${G}$PASS passed${N} ($TOTAL total)"
fi
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo ""
exit "$FAIL"
