#!/bin/bash
#
# ═══════════════════════════════════════════════════════════════════════
#  JustAVPS — Toolbox API E2E Test (through Core Hono API)
# ═══════════════════════════════════════════════════════════════════════
#
# Tests every toolbox endpoint through the authenticated Core API layer.
# This validates the full stack: API key auth → Hono route → proxy → daemon.
#
# Usage:
#   API_KEY=sk_live_xxx MACHINE_ID=xxx bash tests/scripts/v1/e2e-toolbox-api.sh
#   API_KEY=sk_live_xxx MACHINE_ID=xxx BASE_URL=https://justavps.com bash tests/scripts/v1/e2e-toolbox-api.sh
#

set -euo pipefail

API_KEY="${API_KEY:-}"
MACHINE_ID="${MACHINE_ID:-}"
BASE="${BASE_URL:-http://localhost:4100}/api/v1"

if [ -z "$API_KEY" ] || [ -z "$MACHINE_ID" ]; then
  echo "Usage: API_KEY=sk_live_xxx MACHINE_ID=xxx $0"
  exit 1
fi

# ─── State ───────────────────────────────────────────────────────────────
PASS=0 FAIL=0 TOTAL=0
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' C='\033[0;36m' N='\033[0m' B='\033[1m'
pass() { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo -e "  ${G}✓${N} $*"; }
fail() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); echo -e "  ${R}✗${N} $*"; }
log()  { echo -e "${C}[API E2E]${N} $*"; }

AUTH="Authorization: Bearer $API_KEY"
TB="$BASE/machines/$MACHINE_ID/toolbox"

api_get()  { curl -sf -H "$AUTH" "$TB$1" 2>/dev/null; }
api_post() { curl -sf -H "$AUTH" -H "Content-Type: application/json" -X POST "$TB$1" -d "$2" 2>/dev/null; }
api_post_raw() { curl -sf -H "$AUTH" -H "Content-Type: application/octet-stream" -X POST "$TB$1" --data-binary "$2" 2>/dev/null; }
api_del()  { curl -sf -H "$AUTH" -X DELETE "$TB$1" 2>/dev/null; }
api_code() { curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$@" 2>/dev/null; }
py() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); $1" 2>/dev/null; }

echo ""
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo -e "${C}  JustAVPS — Toolbox Core API E2E Test${N}"
echo -e "${C}  Base: ${B}$BASE${N}"
echo -e "${C}  Machine: ${B}$MACHINE_ID${N}"
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo ""

# ── Preflight ────────────────────────────────────────────────────────────

log "Preflight..."
CODE=$(api_code "$BASE/machines" -H "$AUTH")
[ "$CODE" = "200" ] && pass "API auth works" || { fail "API auth (code=$CODE)"; exit 1; }

CODE=$(api_code "$TB/files?path=/tmp" -H "$AUTH")
[ "$CODE" = "200" ] && pass "Toolbox reachable through API" || { fail "Toolbox unreachable (code=$CODE)"; exit 1; }

# Clean up previous test artifacts
api_del "/files?path=/tmp/api-e2e-test&recursive=true" > /dev/null 2>&1 || true

# ── Auth tests ───────────────────────────────────────────────────────────
echo ""
log "${B}Auth Tests${N}"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$TB/files?path=/tmp" 2>/dev/null)
[ "$CODE" = "401" ] && pass "No auth → 401" || fail "No auth (code=$CODE)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer sk_live_invalid" "$TB/files?path=/tmp" 2>/dev/null)
[ "$CODE" = "401" ] && pass "Bad API key → 401" || fail "Bad key (code=$CODE)"

# ═════════════════════════════════════════════════════════════════════════
#  FILESYSTEM via Core API
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "${B}Filesystem API (through Core API)${N}"

# ── Create folder ────────────────────────────────────────────────────────
log "  Create folder"
RESP=$(api_post "/files/folder?path=/tmp/api-e2e-test" "")
CREATED=$(echo "$RESP" | py "print(d.get('created',''))")
[ "$CREATED" = "True" ] && pass "Create folder /tmp/api-e2e-test" || fail "Create folder (resp=$RESP)"

RESP=$(api_post "/files/folder?path=/tmp/api-e2e-test/sub/deep&mode=700" "")
CREATED=$(echo "$RESP" | py "print(d.get('created',''))")
[ "$CREATED" = "True" ] && pass "Create nested folder" || fail "Nested folder"

# ── Upload ───────────────────────────────────────────────────────────────
echo ""
log "  Upload files"
RESP=$(api_post_raw "/files/upload?path=/tmp/api-e2e-test/hello.txt" "Hello from Core API E2E!")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
[ "$SIZE" = "24" ] && pass "Upload hello.txt (24 bytes)" || fail "Upload hello.txt (size=$SIZE, resp=$RESP)"

RESP=$(api_post_raw "/files/upload?path=/tmp/api-e2e-test/script.sh&mode=755" "#!/bin/bash\necho works")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
[ "$SIZE" -gt 0 ] && pass "Upload script.sh mode=755" || fail "Upload script.sh"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H "Content-Type: application/octet-stream" -X POST "$TB/files/upload?path=/tmp/api-e2e-test/hello.txt&overwrite=false" --data-binary "should fail" 2>/dev/null)
[ "$CODE" = "409" ] && pass "Upload overwrite=false → 409" || fail "Overwrite=false (code=$CODE)"

# ── Download ─────────────────────────────────────────────────────────────
echo ""
log "  Download files"
CONTENT=$(api_get "/files/download?path=/tmp/api-e2e-test/hello.txt")
[ "$CONTENT" = "Hello from Core API E2E!" ] && pass "Download content matches" || fail "Download content='$CONTENT'"

CODE=$(api_code "$TB/files/download?path=/tmp/nonexistent_xyz" -H "$AUTH")
[ "$CODE" = "404" ] && pass "Download nonexistent → 404" || fail "Download 404 (code=$CODE)"

# ── List ─────────────────────────────────────────────────────────────────
echo ""
log "  List files"
RESP=$(api_get "/files?path=/tmp/api-e2e-test")
COUNT=$(echo "$RESP" | py "print(len(d.get('entries',[])))")
[ "$COUNT" -ge 3 ] && pass "List → $COUNT entries" || fail "List (count=$COUNT)"

HAS_FIELDS=$(echo "$RESP" | py "e=d['entries'][0]; print('ok' if all(k in e for k in ['name','path','type','size','mode','owner']) else 'miss')")
[ "$HAS_FIELDS" = "ok" ] && pass "Entries have full metadata" || fail "Entry fields"

RESP=$(api_get "/files?path=/tmp/api-e2e-test&depth=3")
COUNT=$(echo "$RESP" | py "print(len(d.get('entries',[])))")
[ "$COUNT" -ge 4 ] && pass "List depth=3 → $COUNT entries" || fail "Depth (count=$COUNT)"

# ── Info ─────────────────────────────────────────────────────────────────
echo ""
log "  File info"
RESP=$(api_get "/files/info?path=/tmp/api-e2e-test/hello.txt")
NAME=$(echo "$RESP" | py "print(d.get('name',''))")
TYPE=$(echo "$RESP" | py "print(d.get('type',''))")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
OWNER=$(echo "$RESP" | py "print(d.get('owner',''))")
[ "$NAME" = "hello.txt" ] && pass "Info name=hello.txt" || fail "Info name=$NAME"
[ "$TYPE" = "file" ] && pass "Info type=file" || fail "Info type=$TYPE"
[ "$SIZE" = "24" ] && pass "Info size=24" || fail "Info size=$SIZE"
[ "$OWNER" = "root" ] && pass "Info owner=root" || fail "Info owner=$OWNER"

RESP=$(api_get "/files/info?path=/tmp/api-e2e-test/script.sh")
MODE=$(echo "$RESP" | py "print(d.get('mode_bits',''))")
[ "$MODE" = "755" ] && pass "Script mode=755 persisted" || fail "Script mode=$MODE"

# ── Exists ───────────────────────────────────────────────────────────────
echo ""
log "  Exists check"
RESP=$(api_get "/files/exists?path=/tmp/api-e2e-test/hello.txt")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
[ "$EXISTS" = "True" ] && pass "Exists hello.txt → true" || fail "Exists=$EXISTS"

RESP=$(api_get "/files/exists?path=/tmp/nonexistent_xyz_abc")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
[ "$EXISTS" = "False" ] && pass "Exists nonexistent → false" || fail "Exists nonexistent=$EXISTS"

# ── Find text ────────────────────────────────────────────────────────────
echo ""
log "  Find text"

# Upload search target
api_post_raw "/files/upload?path=/tmp/api-e2e-test/search.txt" "hello world
goodbye world
hello again" > /dev/null

RESP=$(api_get "/files/find?path=/tmp/api-e2e-test&pattern=hello")
TOTAL_MATCHES=$(echo "$RESP" | py "print(d.get('total',0))")
[ "$TOTAL_MATCHES" -ge 2 ] && pass "Find 'hello' → $TOTAL_MATCHES matches" || fail "Find (matches=$TOTAL_MATCHES)"

RESP=$(api_get "/files/find?path=/tmp/api-e2e-test&pattern=hello&max_results=1")
TRUNCATED=$(echo "$RESP" | py "print(d.get('truncated',''))")
[ "$TRUNCATED" = "True" ] && pass "Find truncated=true" || fail "Truncated=$TRUNCATED"

# ── Replace text ─────────────────────────────────────────────────────────
echo ""
log "  Replace text"
RESP=$(api_post "/files/replace" '{"files":["/tmp/api-e2e-test/search.txt"],"pattern":"hello","new_value":"hi"}')
REPS=$(echo "$RESP" | py "print(d['results'][0]['replacements'])")
[ "$REPS" -ge 2 ] && pass "Replace hello→hi ($REPS replacements)" || fail "Replace (reps=$REPS)"

CONTENT=$(api_get "/files/download?path=/tmp/api-e2e-test/search.txt")
echo "$CONTENT" | grep -q "hi world" && pass "Replaced content verified" || fail "Replace verify"

# ── Permissions ──────────────────────────────────────────────────────────
echo ""
log "  Permissions"
RESP=$(curl -sf -H "$AUTH" -H "Content-Type: application/json" -X POST "$TB/files/permissions?path=/tmp/api-e2e-test/hello.txt" -d '{"mode":"600"}' 2>/dev/null)
MODE=$(echo "$RESP" | py "print(d.get('mode',''))")
[ "$MODE" = "600" ] && pass "Set permissions mode=600" || fail "Perms mode=$MODE"

RESP=$(api_get "/files/info?path=/tmp/api-e2e-test/hello.txt")
MODE=$(echo "$RESP" | py "print(d.get('mode_bits',''))")
[ "$MODE" = "600" ] && pass "Permissions persisted" || fail "Perms persist=$MODE"

# ── Move ─────────────────────────────────────────────────────────────────
echo ""
log "  Move/rename"
RESP=$(api_post "/files/move?source=/tmp/api-e2e-test/hello.txt&destination=/tmp/api-e2e-test/renamed.txt" "")
DST=$(echo "$RESP" | py "print(d.get('destination',''))")
[ "$DST" = "/tmp/api-e2e-test/renamed.txt" ] && pass "Move hello.txt → renamed.txt" || fail "Move dst=$DST"

RESP=$(api_get "/files/exists?path=/tmp/api-e2e-test/hello.txt")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
[ "$EXISTS" = "False" ] && pass "Old path gone" || fail "Old still exists"

# ── Bulk download ────────────────────────────────────────────────────────
echo ""
log "  Bulk download"
RESP=$(curl -sf -H "$AUTH" -H "Content-Type: application/json" -X POST "$TB/files/bulk-download" -d '{"paths":["/tmp/api-e2e-test/script.sh","/tmp/api-e2e-test/search.txt"]}' -o /tmp/api-e2e-bulk.zip -w '%{http_code}' 2>/dev/null)
[ "$RESP" = "200" ] && pass "Bulk download → 200" || fail "Bulk download (code=$RESP)"
if [ -f /tmp/api-e2e-bulk.zip ]; then
  FILE_COUNT=$(unzip -l /tmp/api-e2e-bulk.zip 2>/dev/null | tail -1 | awk '{print $2}')
  [ "$FILE_COUNT" = "2" ] && pass "Zip contains 2 files" || fail "Zip files=$FILE_COUNT"
  rm -f /tmp/api-e2e-bulk.zip
fi

# ── Delete ───────────────────────────────────────────────────────────────
echo ""
log "  Delete"
RESP=$(api_del "/files?path=/tmp/api-e2e-test/script.sh")
DELETED=$(echo "$RESP" | py "print(d.get('deleted',''))")
[ "$DELETED" = "True" ] && pass "Delete script.sh" || fail "Delete"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -X DELETE "$TB/files?path=/tmp/api-e2e-test" 2>/dev/null)
[ "$CODE" = "400" ] && pass "Delete non-empty dir → 400" || fail "Delete non-empty (code=$CODE)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -X DELETE "$TB/files?path=/root&recursive=true" 2>/dev/null)
[ "$CODE" = "403" ] && pass "Delete /root → 403" || fail "Delete root (code=$CODE)"

# ═════════════════════════════════════════════════════════════════════════
#  PROCESS/EXEC via Core API
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "${B}Process/Exec API (through Core API)${N}"

# ── Execute ──────────────────────────────────────────────────────────────
echo ""
log "  Execute command"
RESP=$(api_post "/process/execute" '{"command":"echo api_exec_test"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
EXIT=$(echo "$RESP" | py "print(int(d.get('exit_code',999)))")
[ "$STDOUT" = "api_exec_test" ] && pass "Execute echo → correct output" || fail "Execute (stdout=$STDOUT)"
[ "$EXIT" = "0" ] && pass "Execute exit_code=0" || fail "Exit=$EXIT"

RESP=$(api_post "/process/execute" '{"command":"pwd","cwd":"/tmp"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "/tmp" ] && pass "Execute with cwd=/tmp" || fail "Cwd (stdout=$STDOUT)"

RESP=$(api_post "/process/execute" '{"command":"echo $API_VAR","env":{"API_VAR":"env_works"}}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "env_works" ] && pass "Execute with env" || fail "Env (stdout=$STDOUT)"

RESP=$(api_post "/process/execute" '{"command":"echo err >&2"}')
STDERR=$(echo "$RESP" | py "print(d.get('stderr','').strip())")
[ "$STDERR" = "err" ] && pass "Execute captures stderr" || fail "Stderr=$STDERR"

RESP=$(api_post "/process/execute" '{"command":"exit 99"}')
EXIT=$(echo "$RESP" | py "print(int(d.get('exit_code',0)))")
[ "$EXIT" = "99" ] && pass "Execute exit_code=99" || fail "Exit=$EXIT"

# ── Stream ───────────────────────────────────────────────────────────────
echo ""
log "  Execute stream (SSE)"
RESP=$(curl -sf -H "$AUTH" -H "Content-Type: application/json" -X POST "$TB/process/execute/stream" -d '{"command":"echo sse_api_test"}' 2>/dev/null)
echo "$RESP" | grep -q "event: stdout" && pass "SSE stdout events" || fail "SSE stdout"
echo "$RESP" | grep -q "event: exit" && pass "SSE exit event" || fail "SSE exit"
echo "$RESP" | grep -q "sse_api_test" && pass "SSE output data" || fail "SSE data"

# ── Code run ─────────────────────────────────────────────────────────────
echo ""
log "  Code run"
RESP=$(api_post "/process/code-run" '{"code":"echo code_api_test","language":"bash"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "code_api_test" ] && pass "Code run bash" || fail "Code bash=$STDOUT"

RESP=$(api_post "/process/code-run" '{"code":"print(6*7)","language":"python"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "42" ] && pass "Code run python (6*7=42)" || fail "Code python=$STDOUT"

RESP=$(api_post "/process/code-run" '{"code":"console.log(\"node_ok\")","language":"node"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "node_ok" ] && pass "Code run node" || fail "Code node=$STDOUT"

# ── List processes ───────────────────────────────────────────────────────
echo ""
log "  List processes"
RESP=$(api_get "/process/list")
COUNT=$(echo "$RESP" | py "print(len(d.get('processes',[])))")
[ "$COUNT" -ge 5 ] && pass "List processes → $COUNT" || fail "List (count=$COUNT)"

HAS_DAEMON=$(echo "$RESP" | py "print('yes' if any('justavps-daemon' in p.get('command','') for p in d.get('processes',[])) else 'no')")
[ "$HAS_DAEMON" = "yes" ] && pass "Daemon in process list" || fail "Daemon not found"

# ── Kill process ─────────────────────────────────────────────────────────
echo ""
log "  Kill process"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H "Content-Type: application/json" -X POST "$TB/process/kill" -d '{"pid":1,"signal":"SIGTERM"}' 2>/dev/null)
[ "$CODE" = "403" ] && pass "Kill PID 1 → 403" || fail "Kill PID1 (code=$CODE)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H "Content-Type: application/json" -X POST "$TB/process/kill" -d '{"pid":99999,"signal":"SIGFOO"}' 2>/dev/null)
[ "$CODE" = "400" ] && pass "Kill invalid signal → 400" || fail "Kill signal (code=$CODE)"

# ═════════════════════════════════════════════════════════════════════════
#  CROSS-MODULE INTEGRATION
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "${B}Integration${N}"

# Create file via exec → read via FS
api_post "/process/execute" '{"command":"echo integration_via_exec > /tmp/api-e2e-test/exec-file.txt"}' > /dev/null
CONTENT=$(api_get "/files/download?path=/tmp/api-e2e-test/exec-file.txt")
echo "$CONTENT" | grep -q "integration_via_exec" && pass "Exec→FS: read file created by exec" || fail "Exec→FS"

# Upload via FS → read via exec
api_post_raw "/files/upload?path=/tmp/api-e2e-test/fs-file.txt" "api_fs_content" > /dev/null
RESP=$(api_post "/process/execute" '{"command":"cat /tmp/api-e2e-test/fs-file.txt"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "api_fs_content" ] && pass "FS→Exec: exec reads file uploaded via API" || fail "FS→Exec ($STDOUT)"

# ── Cleanup ──────────────────────────────────────────────────────────────
echo ""
log "Cleanup..."
RESP=$(api_del "/files?path=/tmp/api-e2e-test&recursive=true")
DELETED=$(echo "$RESP" | py "print(d.get('deleted',''))")
[ "$DELETED" = "True" ] && pass "Cleanup: deleted test directory" || fail "Cleanup"

# ═════════════════════════════════════════════════════════════════════════
#  OpenAPI Spec Validation
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "${B}OpenAPI Spec${N}"
SPEC_BASE="${BASE_URL:-http://localhost:4100}/api"

SPEC=$(curl -sf "$SPEC_BASE/docs/openapi.json" 2>/dev/null)
TOOLBOX_PATHS=$(echo "$SPEC" | py "print(len([p for p in d.get('paths',{}).keys() if 'toolbox' in p]))")
[ "$TOOLBOX_PATHS" = "16" ] && pass "OpenAPI spec has 16 toolbox endpoints" || fail "Spec paths=$TOOLBOX_PATHS"

HAS_FS_TAG=$(echo "$SPEC" | py "print('yes' if any(t['name']=='Toolbox: Filesystem' for t in d.get('tags',[])) else 'no')")
[ "$HAS_FS_TAG" = "yes" ] && pass "OpenAPI has 'Toolbox: Filesystem' tag" || fail "FS tag missing"

HAS_PROC_TAG=$(echo "$SPEC" | py "print('yes' if any(t['name']=='Toolbox: Process' for t in d.get('tags',[])) else 'no')")
[ "$HAS_PROC_TAG" = "yes" ] && pass "OpenAPI has 'Toolbox: Process' tag" || fail "Process tag missing"

# Check no double /api/v1/api/v1
HAS_DOUBLE=$(echo "$SPEC" | py "print('yes' if any('/api/v1/api/v1' in p for p in d.get('paths',{}).keys()) else 'no')")
[ "$HAS_DOUBLE" = "no" ] && pass "No double /api/v1/api/v1 in paths" || fail "Double prefix found!"

SERVERS=$(echo "$SPEC" | py "print([s['url'] for s in d.get('servers',[])])")
echo "$SERVERS" | grep -qv "/api/v1" && pass "Server URLs don't include /api/v1 suffix" || fail "Server URL has /api/v1"

# Scalar docs reachable
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SPEC_BASE/docs" 2>/dev/null)
[ "$CODE" = "200" ] && pass "Scalar docs page loads (200)" || fail "Scalar docs (code=$CODE)"

# ═════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${G}${B}ALL $PASS TESTS PASSED${N} ($TOTAL total)"
else
  echo -e "  ${R}${B}$FAIL FAILED${N}, ${G}$PASS passed${N} ($TOTAL total)"
fi
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo ""
exit "$FAIL"
