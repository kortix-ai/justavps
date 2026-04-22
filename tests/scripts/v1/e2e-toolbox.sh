#!/bin/bash
#
# ═══════════════════════════════════════════════════════════════════════
#  JustAVPS — Toolbox E2E Test (Filesystem + Process API)
# ═══════════════════════════════════════════════════════════════════════
#
# Runs a comprehensive end-to-end test of every toolbox endpoint
# against a live VPS daemon via SSH tunneling.
#
# Usage:
#   bash tests/scripts/v1/e2e-toolbox.sh <machine_ip> <ssh_key_file>
#   bash tests/scripts/v1/e2e-toolbox.sh 95.217.233.69 /tmp/justavps_e2e_key
#

set -euo pipefail

MACHINE_IP="${1:-}"
SSH_KEY="${2:-/tmp/justavps_e2e_key}"

if [ -z "$MACHINE_IP" ]; then
  echo "Usage: $0 <machine_ip> [ssh_key_file]"
  exit 1
fi

# ─── State ───────────────────────────────────────────────────────────────
PASS=0 FAIL=0 TOTAL=0
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' C='\033[0;36m' N='\033[0m' B='\033[1m'
pass() { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo -e "  ${G}✓${N} $*"; }
fail() { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); echo -e "  ${R}✗${N} $*"; }
log()  { echo -e "${C}[TOOLBOX E2E]${N} $*"; }

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10"
remote() { $SSH_CMD root@"$MACHINE_IP" "$@" 2>/dev/null; }
toolbox() { remote "curl -sf 'http://localhost$1'" 2>/dev/null; }
toolbox_post() { remote "curl -sf -X POST -H 'Content-Type: application/json' 'http://localhost$1' -d '$2'" 2>/dev/null; }
toolbox_delete() { remote "curl -sf -X DELETE 'http://localhost$1'" 2>/dev/null; }
toolbox_upload() { remote "curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost$1' --data-binary '$2'" 2>/dev/null; }

py() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); $1" 2>/dev/null; }

echo ""
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo -e "${C}  JustAVPS — Toolbox E2E Test${N}"
echo -e "${C}  Target: ${B}$MACHINE_IP${N}"
echo -e "${C}═══════════════════════════════════════════════════════════${N}"
echo ""

# ── Preflight ────────────────────────────────────────────────────────────

log "Preflight checks..."
HEALTH=$(remote "curl -sf http://localhost:7777/health" | py "print(d.get('status',''))")
if [ "$HEALTH" = "ok" ]; then
  pass "Daemon healthy"
else
  fail "Daemon not healthy: $HEALTH"
  exit 1
fi

# Clean up any previous test artifacts
remote "rm -rf /tmp/toolbox-e2e-test" 2>/dev/null || true

# ═════════════════════════════════════════════════════════════════════════
#  PHASE 1: Filesystem API
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "${B}Phase 1: Filesystem API${N}"

# ── 1.1 Create Folder ────────────────────────────────────────────────────
echo ""
log "  1.1 Create Folder"

RESP=$(toolbox_post "/toolbox/files/folder?path=/tmp/toolbox-e2e-test" "")
CREATED=$(echo "$RESP" | py "print(d.get('created',''))")
if [ "$CREATED" = "True" ]; then
  pass "Create folder /tmp/toolbox-e2e-test"
else
  fail "Create folder (created=$CREATED, resp=$RESP)"
fi

# Nested
RESP=$(toolbox_post "/toolbox/files/folder?path=/tmp/toolbox-e2e-test/a/b/c&mode=700" "")
CREATED=$(echo "$RESP" | py "print(d.get('created',''))")
[ "$CREATED" = "True" ] && pass "Create nested folder /tmp/toolbox-e2e-test/a/b/c" || fail "Create nested folder"

# Already exists
RESP=$(toolbox_post "/toolbox/files/folder?path=/tmp/toolbox-e2e-test" "")
CREATED=$(echo "$RESP" | py "print(d.get('created',''))")
[ "$CREATED" = "False" ] && pass "Folder already exists → created=false" || fail "Already-exists check"

# ── 1.2 Upload Files ────────────────────────────────────────────────────
echo ""
log "  1.2 Upload Files"

# Upload text file
RESP=$(remote "curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/hello.txt' --data-binary 'Hello from E2E test!'")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
[ "$SIZE" = "20" ] && pass "Upload hello.txt (20 bytes)" || fail "Upload hello.txt (size=$SIZE)"

# Upload with specific mode
RESP=$(remote "curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/script.sh&mode=755' --data-binary '#!/bin/bash\necho hello'")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
[ "$SIZE" -gt 0 ] && pass "Upload script.sh with mode=755" || fail "Upload script.sh"

# Upload into nested dir (auto-create parents)
RESP=$(remote "curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/deep/nested/file.txt' --data-binary 'deep content'")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
[ "$SIZE" = "12" ] && pass "Upload to deep/nested/file.txt (auto-create parents)" || fail "Upload deep file"

# Upload binary data
RESP=$(remote "dd if=/dev/urandom bs=1024 count=10 2>/dev/null | curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/binary.bin' --data-binary @-")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
[ "$SIZE" = "10240" ] && pass "Upload binary.bin (10KB random)" || fail "Upload binary (size=$SIZE)"

# Upload with overwrite=false on existing
RESP=$(remote "curl -s -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/hello.txt&overwrite=false' --data-binary 'should not overwrite' -w '\n%{http_code}'" | tail -1)
[ "$RESP" = "409" ] && pass "Upload overwrite=false → 409" || fail "Upload overwrite=false (code=$RESP)"

# ── 1.3 Download Files ──────────────────────────────────────────────────
echo ""
log "  1.3 Download Files"

# Download text
CONTENT=$(toolbox "/toolbox/files/download?path=/tmp/toolbox-e2e-test/hello.txt")
[ "$CONTENT" = "Hello from E2E test!" ] && pass "Download hello.txt content matches" || fail "Download hello.txt (got='$CONTENT')"

# Download binary roundtrip
remote "dd if=/dev/urandom bs=1 count=256 of=/tmp/toolbox-e2e-test/roundtrip.bin 2>/dev/null"
ORIG_MD5=$(remote "md5sum /tmp/toolbox-e2e-test/roundtrip.bin | cut -d' ' -f1")
DL_MD5=$(remote "curl -sf 'http://localhost/toolbox/files/download?path=/tmp/toolbox-e2e-test/roundtrip.bin' | md5sum | cut -d' ' -f1")
[ "$ORIG_MD5" = "$DL_MD5" ] && pass "Binary download MD5 matches ($ORIG_MD5)" || fail "Binary download MD5 mismatch (orig=$ORIG_MD5 dl=$DL_MD5)"

# Download nonexistent
CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' 'http://localhost/toolbox/files/download?path=/tmp/nonexistent_xyz'")
[ "$CODE" = "404" ] && pass "Download nonexistent → 404" || fail "Download nonexistent (code=$CODE)"

# Download directory
CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' 'http://localhost/toolbox/files/download?path=/tmp/toolbox-e2e-test'")
[ "$CODE" = "400" ] && pass "Download directory → 400" || fail "Download directory (code=$CODE)"

# ── 1.4 List Files ──────────────────────────────────────────────────────
echo ""
log "  1.4 List Files"

RESP=$(toolbox "/toolbox/files?path=/tmp/toolbox-e2e-test")
COUNT=$(echo "$RESP" | py "print(len(d.get('entries',[])))")
[ "$COUNT" -ge 4 ] && pass "List /tmp/toolbox-e2e-test → $COUNT entries" || fail "List files (count=$COUNT)"

# Check entries have required fields
HAS_FIELDS=$(echo "$RESP" | py "e=d['entries'][0]; print('ok' if all(k in e for k in ['name','path','type','size','mode','mode_bits','owner','group','mod_time']) else 'missing')")
[ "$HAS_FIELDS" = "ok" ] && pass "List entries have all required fields" || fail "List entries missing fields"

# Depth test
RESP=$(toolbox "/toolbox/files?path=/tmp/toolbox-e2e-test&depth=3")
COUNT=$(echo "$RESP" | py "print(len(d.get('entries',[])))")
[ "$COUNT" -ge 6 ] && pass "List depth=3 → $COUNT entries (includes nested)" || fail "List depth=3 (count=$COUNT)"

# List nonexistent
CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' 'http://localhost/toolbox/files?path=/tmp/nonexistent_xyz123'")
[ "$CODE" = "404" ] && pass "List nonexistent → 404" || fail "List nonexistent (code=$CODE)"

# ── 1.5 File Info ────────────────────────────────────────────────────────
echo ""
log "  1.5 File Info"

RESP=$(toolbox "/toolbox/files/info?path=/tmp/toolbox-e2e-test/hello.txt")
NAME=$(echo "$RESP" | py "print(d.get('name',''))")
TYPE=$(echo "$RESP" | py "print(d.get('type',''))")
SIZE=$(echo "$RESP" | py "print(int(d.get('size',0)))")
OWNER=$(echo "$RESP" | py "print(d.get('owner',''))")
[ "$NAME" = "hello.txt" ] && pass "File info name=hello.txt" || fail "File info name=$NAME"
[ "$TYPE" = "file" ] && pass "File info type=file" || fail "File info type=$TYPE"
[ "$SIZE" = "20" ] && pass "File info size=20" || fail "File info size=$SIZE"
[ "$OWNER" = "root" ] && pass "File info owner=root" || fail "File info owner=$OWNER"

# Dir info
RESP=$(toolbox "/toolbox/files/info?path=/tmp/toolbox-e2e-test")
TYPE=$(echo "$RESP" | py "print(d.get('type',''))")
[ "$TYPE" = "dir" ] && pass "Dir info type=dir" || fail "Dir info type=$TYPE"

# Script mode check
RESP=$(toolbox "/toolbox/files/info?path=/tmp/toolbox-e2e-test/script.sh")
MODE=$(echo "$RESP" | py "print(d.get('mode_bits',''))")
[ "$MODE" = "755" ] && pass "Script.sh mode=755 persisted" || fail "Script.sh mode=$MODE"

# ── 1.6 Exists Check ────────────────────────────────────────────────────
echo ""
log "  1.6 Exists Check"

RESP=$(toolbox "/toolbox/files/exists?path=/tmp/toolbox-e2e-test/hello.txt")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
TYPE=$(echo "$RESP" | py "print(d.get('type',''))")
[ "$EXISTS" = "True" ] && pass "Exists hello.txt → true" || fail "Exists hello.txt=$EXISTS"
[ "$TYPE" = "file" ] && pass "Exists type=file" || fail "Exists type=$TYPE"

RESP=$(toolbox "/toolbox/files/exists?path=/tmp/toolbox-e2e-test")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
TYPE=$(echo "$RESP" | py "print(d.get('type',''))")
[ "$EXISTS" = "True" ] && pass "Exists dir → true" || fail "Exists dir=$EXISTS"
[ "$TYPE" = "dir" ] && pass "Exists dir type=dir" || fail "Exists dir type=$TYPE"

RESP=$(toolbox "/toolbox/files/exists?path=/tmp/nonexistent_xyz_abc")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
[ "$EXISTS" = "False" ] && pass "Exists nonexistent → false" || fail "Exists nonexistent=$EXISTS"

# ── 1.7 Find Text ────────────────────────────────────────────────────────
echo ""
log "  1.7 Find Text"

# Upload more files for searching
remote "curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/search1.txt' --data-binary 'hello world
goodbye world
hello again'" > /dev/null
remote "curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/search2.go' --data-binary 'package main
func hello() {}
func goodbye() {}'" > /dev/null

RESP=$(toolbox "/toolbox/files/find?path=/tmp/toolbox-e2e-test&pattern=hello")
TOTAL_MATCHES=$(echo "$RESP" | py "print(d.get('total',0))")
[ "$TOTAL_MATCHES" -ge 3 ] && pass "Find 'hello' → $TOTAL_MATCHES matches" || fail "Find hello (matches=$TOTAL_MATCHES)"

# With include filter
RESP=$(toolbox "/toolbox/files/find?path=/tmp/toolbox-e2e-test&pattern=hello&include=*.go")
TOTAL_MATCHES=$(echo "$RESP" | py "print(d.get('total',0))")
[ "$TOTAL_MATCHES" = "1" ] && pass "Find 'hello' include=*.go → 1 match" || fail "Find with include (matches=$TOTAL_MATCHES)"

# Max results
RESP=$(toolbox "/toolbox/files/find?path=/tmp/toolbox-e2e-test&pattern=hello&max_results=1")
TOTAL_MATCHES=$(echo "$RESP" | py "print(d.get('total',0))")
TRUNCATED=$(echo "$RESP" | py "print(d.get('truncated',''))")
[ "$TOTAL_MATCHES" = "1" ] && pass "Find max_results=1 → 1 match" || fail "Find max_results"
[ "$TRUNCATED" = "True" ] && pass "Find truncated=true" || fail "Find truncated=$TRUNCATED"

# Verify match structure
HAS_FIELDS=$(echo "$RESP" | py "m=d['matches'][0]; print('ok' if all(k in m for k in ['file','line','content']) else 'missing')")
[ "$HAS_FIELDS" = "ok" ] && pass "Find match has file/line/content fields" || fail "Find match fields"

# ── 1.8 Replace Text ────────────────────────────────────────────────────
echo ""
log "  1.8 Replace Text"

RESP=$(toolbox_post "/toolbox/files/replace" "{\"files\":[\"/tmp/toolbox-e2e-test/search1.txt\"],\"pattern\":\"hello\",\"new_value\":\"hi\"}")
REPLACEMENTS=$(echo "$RESP" | py "print(d['results'][0]['replacements'])")
[ "$REPLACEMENTS" -ge 2 ] && pass "Replace 'hello'→'hi' in search1.txt ($REPLACEMENTS replacements)" || fail "Replace (replacements=$REPLACEMENTS)"

# Verify replacement
CONTENT=$(toolbox "/toolbox/files/download?path=/tmp/toolbox-e2e-test/search1.txt")
echo "$CONTENT" | grep -q "hi world" && pass "Replaced content contains 'hi world'" || fail "Replaced content check"
echo "$CONTENT" | grep -q "goodbye" && pass "Unreplaced content 'goodbye' preserved" || fail "Preserved content check"

# ── 1.9 Set Permissions ─────────────────────────────────────────────────
echo ""
log "  1.9 Set Permissions"

RESP=$(remote "curl -sf -X POST -H 'Content-Type: application/json' 'http://localhost/toolbox/files/permissions?path=/tmp/toolbox-e2e-test/hello.txt' -d '{\"mode\":\"600\"}'")
MODE=$(echo "$RESP" | py "print(d.get('mode',''))")
[ "$MODE" = "600" ] && pass "Set permissions mode=600" || fail "Set permissions mode=$MODE"

# Verify via info
RESP=$(toolbox "/toolbox/files/info?path=/tmp/toolbox-e2e-test/hello.txt")
MODE=$(echo "$RESP" | py "print(d.get('mode_bits',''))")
[ "$MODE" = "600" ] && pass "Permissions persisted in info (600)" || fail "Permissions persist=$MODE"

# Set back to 644
remote "curl -sf -X POST -H 'Content-Type: application/json' 'http://localhost/toolbox/files/permissions?path=/tmp/toolbox-e2e-test/hello.txt' -d '{\"mode\":\"644\"}'" > /dev/null

# ── 1.10 Move/Rename ────────────────────────────────────────────────────
echo ""
log "  1.10 Move/Rename"

RESP=$(toolbox_post "/toolbox/files/move?source=/tmp/toolbox-e2e-test/hello.txt&destination=/tmp/toolbox-e2e-test/hello_renamed.txt" "")
DST=$(echo "$RESP" | py "print(d.get('destination',''))")
[ "$DST" = "/tmp/toolbox-e2e-test/hello_renamed.txt" ] && pass "Move hello.txt → hello_renamed.txt" || fail "Move ($DST)"

# Verify old gone, new exists
RESP=$(toolbox "/toolbox/files/exists?path=/tmp/toolbox-e2e-test/hello.txt")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
[ "$EXISTS" = "False" ] && pass "Old path gone after move" || fail "Old path still exists"

RESP=$(toolbox "/toolbox/files/exists?path=/tmp/toolbox-e2e-test/hello_renamed.txt")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
[ "$EXISTS" = "True" ] && pass "New path exists after move" || fail "New path not found"

# Move to create parent dirs
RESP=$(toolbox_post "/toolbox/files/move?source=/tmp/toolbox-e2e-test/hello_renamed.txt&destination=/tmp/toolbox-e2e-test/moved/dir/hello.txt" "")
DST=$(echo "$RESP" | py "print(d.get('destination',''))")
[ "$DST" = "/tmp/toolbox-e2e-test/moved/dir/hello.txt" ] && pass "Move with parent dir creation" || fail "Move with parents"

# ── 1.11 Bulk Download ──────────────────────────────────────────────────
echo ""
log "  1.11 Bulk Download"

RESP=$(remote "curl -sf -X POST -H 'Content-Type: application/json' 'http://localhost/toolbox/files/bulk-download' -d '{\"paths\":[\"/tmp/toolbox-e2e-test/search2.go\",\"/tmp/toolbox-e2e-test/script.sh\"]}' -o /tmp/bulk-test.zip && unzip -l /tmp/bulk-test.zip 2>/dev/null | tail -1")
echo "$RESP" | grep -q "2 files" && pass "Bulk download → zip with 2 files" || fail "Bulk download ($RESP)"

# ── 1.12 Delete ──────────────────────────────────────────────────────────
echo ""
log "  1.12 Delete"

# Delete single file
RESP=$(toolbox_delete "/toolbox/files?path=/tmp/toolbox-e2e-test/script.sh")
DELETED=$(echo "$RESP" | py "print(d.get('deleted',''))")
[ "$DELETED" = "True" ] && pass "Delete script.sh" || fail "Delete script.sh"

# Verify gone
RESP=$(toolbox "/toolbox/files/exists?path=/tmp/toolbox-e2e-test/script.sh")
EXISTS=$(echo "$RESP" | py "print(d.get('exists',''))")
[ "$EXISTS" = "False" ] && pass "script.sh gone after delete" || fail "script.sh still exists"

# Delete non-empty dir without recursive → should fail
CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' -X DELETE 'http://localhost/toolbox/files?path=/tmp/toolbox-e2e-test'")
[ "$CODE" = "400" ] && pass "Delete non-empty dir without recursive → 400" || fail "Delete non-empty (code=$CODE)"

# Protected paths
CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' -X DELETE 'http://localhost/toolbox/files?path=/root&recursive=true'")
[ "$CODE" = "403" ] && pass "Delete /root → 403 (protected)" || fail "Delete /root (code=$CODE)"

# ═════════════════════════════════════════════════════════════════════════
#  PHASE 2: Process/Exec API
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "${B}Phase 2: Process/Exec API${N}"

# ── 2.1 Execute Command ─────────────────────────────────────────────────
echo ""
log "  2.1 Execute Command"

RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"echo e2e_test_output"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
EXIT=$(echo "$RESP" | py "print(int(d.get('exit_code',999)))")
DURATION=$(echo "$RESP" | py "print(d.get('duration_ms',0))")
[ "$STDOUT" = "e2e_test_output" ] && pass "Execute echo → correct stdout" || fail "Execute echo (stdout=$STDOUT)"
[ "$EXIT" = "0" ] && pass "Execute exit_code=0" || fail "Execute exit_code=$EXIT"
[ "$DURATION" -ge 0 ] && pass "Execute duration_ms=$DURATION" || fail "Execute duration"

# With cwd
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"pwd","cwd":"/tmp/toolbox-e2e-test"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "/tmp/toolbox-e2e-test" ] && pass "Execute with cwd=/tmp/toolbox-e2e-test" || fail "Execute cwd (stdout=$STDOUT)"

# With env vars
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"echo $E2E_VAR","env":{"E2E_VAR":"test_val_42"}}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "test_val_42" ] && pass "Execute with env var" || fail "Execute env (stdout=$STDOUT)"

# Stderr
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"echo err_msg >&2"}')
STDERR=$(echo "$RESP" | py "print(d.get('stderr','').strip())")
[ "$STDERR" = "err_msg" ] && pass "Execute captures stderr" || fail "Execute stderr=$STDERR"

# Non-zero exit code
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"exit 42"}')
EXIT=$(echo "$RESP" | py "print(int(d.get('exit_code',0)))")
[ "$EXIT" = "42" ] && pass "Execute exit_code=42" || fail "Execute exit_code=$EXIT"

# Pipe
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"echo \"one two three\" | wc -w"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "3" ] && pass "Execute pipe (wc -w)" || fail "Execute pipe (stdout=$STDOUT)"

# Multi-line
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"echo line1 && echo line2 && echo line3"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
echo "$STDOUT" | grep -q "line1" && echo "$STDOUT" | grep -q "line3" && pass "Execute multi-line output" || fail "Execute multi-line"

# ── 2.2 Execute Stream (SSE) ────────────────────────────────────────────
echo ""
log "  2.2 Execute Stream (SSE)"

RESP=$(remote "curl -sf -X POST -H 'Content-Type: application/json' 'http://localhost/toolbox/process/execute/stream' -d '{\"command\":\"echo sse_line_1 && echo sse_line_2\"}'")
echo "$RESP" | grep -q "event: stdout" && pass "SSE has stdout events" || fail "SSE stdout events"
echo "$RESP" | grep -q "event: exit" && pass "SSE has exit event" || fail "SSE exit event"
echo "$RESP" | grep -q "sse_line_1" && pass "SSE contains output data" || fail "SSE output data"
echo "$RESP" | grep -q '"exit_code": 0' && pass "SSE exit_code=0" || echo "$RESP" | grep -q '"exit_code":0' && pass "SSE exit_code=0" || fail "SSE exit_code"

# ── 2.3 Code Run ────────────────────────────────────────────────────────
echo ""
log "  2.3 Code Run"

# Bash
RESP=$(toolbox_post "/toolbox/process/code-run" '{"code":"echo code_run_bash","language":"bash"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "code_run_bash" ] && pass "Code run bash" || fail "Code run bash (stdout=$STDOUT)"

# Python
RESP=$(toolbox_post "/toolbox/process/code-run" '{"code":"print(2 + 2)","language":"python"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "4" ] && pass "Code run python (2+2=4)" || fail "Code run python (stdout=$STDOUT)"

# Node (if installed)
RESP=$(toolbox_post "/toolbox/process/code-run" '{"code":"console.log(3*7)","language":"node"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
if [ "$STDOUT" = "21" ]; then
  pass "Code run node (3*7=21)"
else
  EXIT=$(echo "$RESP" | py "print(int(d.get('exit_code',999)))")
  if [ "$EXIT" != "0" ]; then
    echo -e "  ${Y}⊘${N} Code run node (node not installed, skipping)"
    TOTAL=$((TOTAL+1))
  else
    fail "Code run node (stdout=$STDOUT)"
  fi
fi

# Auto-detect python
RESP=$(toolbox_post "/toolbox/process/code-run" '{"code":"print(\"auto_detected\")"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "auto_detected" ] && pass "Code run auto-detect python" || fail "Code run auto-detect (stdout=$STDOUT)"

# Code run with env
RESP=$(toolbox_post "/toolbox/process/code-run" '{"code":"echo $CR_VAR","language":"bash","env":{"CR_VAR":"code_env_ok"}}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "code_env_ok" ] && pass "Code run with env" || fail "Code run env (stdout=$STDOUT)"

# ── 2.4 List Processes ──────────────────────────────────────────────────
echo ""
log "  2.4 List Processes"

RESP=$(toolbox "/toolbox/process/list")
COUNT=$(echo "$RESP" | py "print(len(d.get('processes',[])))")
[ "$COUNT" -ge 5 ] && pass "List processes → $COUNT processes" || fail "List processes (count=$COUNT)"

# Verify process structure
HAS_FIELDS=$(echo "$RESP" | py "p=d['processes'][0]; print('ok' if all(k in p for k in ['pid','command','state']) else 'missing')")
[ "$HAS_FIELDS" = "ok" ] && pass "Process entries have pid/command/state" || fail "Process entry fields"

# Can find our daemon
HAS_DAEMON=$(echo "$RESP" | py "print('yes' if any('justavps-daemon' in p.get('command','') for p in d.get('processes',[])) else 'no')")
[ "$HAS_DAEMON" = "yes" ] && pass "Daemon found in process list" || fail "Daemon not in process list"

# ── 2.5 Kill Process ────────────────────────────────────────────────────
echo ""
log "  2.5 Kill Process"

# Start a background process to kill (nohup + redirect to detach from SSH)
remote "nohup sleep 300 </dev/null >/dev/null 2>&1 & echo started"
SLEEP_PID=$(remote "pgrep -f 'sleep 300' | head -1")
if [ -n "$SLEEP_PID" ]; then
  RESP=$(toolbox_post "/toolbox/process/kill" "{\"pid\":$SLEEP_PID,\"signal\":\"SIGTERM\"}")
  KILLED=$(echo "$RESP" | py "print(d.get('killed',''))")
  [ "$KILLED" = "True" ] && pass "Kill process (PID=$SLEEP_PID)" || fail "Kill process"
else
  fail "Could not start test process to kill"
fi

# Protected PID 1
CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' 'http://localhost/toolbox/process/kill' -d '{\"pid\":1,\"signal\":\"SIGTERM\"}'")
[ "$CODE" = "403" ] && pass "Kill PID 1 → 403 (protected)" || fail "Kill PID 1 (code=$CODE)"

# Invalid signal
CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' 'http://localhost/toolbox/process/kill' -d '{\"pid\":99999,\"signal\":\"SIGFOO\"}'")
[ "$CODE" = "400" ] && pass "Kill invalid signal → 400" || fail "Kill invalid signal (code=$CODE)"

# ═════════════════════════════════════════════════════════════════════════
#  PHASE 3: Cross-Module Integration
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "${B}Phase 3: Cross-Module Integration${N}"

# Create file via exec, read via filesystem
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"echo integration_test_content > /tmp/toolbox-e2e-test/exec-created.txt"}')
EXIT=$(echo "$RESP" | py "print(int(d.get('exit_code',999)))")
[ "$EXIT" = "0" ] && pass "Create file via exec" || fail "Create file via exec"

CONTENT=$(toolbox "/toolbox/files/download?path=/tmp/toolbox-e2e-test/exec-created.txt")
echo "$CONTENT" | grep -q "integration_test_content" && pass "Read exec-created file via FS API" || fail "Read exec-created file"

# Upload file via FS, verify via exec
remote "curl -sf -X POST -H 'Content-Type: application/octet-stream' 'http://localhost/toolbox/files/upload?path=/tmp/toolbox-e2e-test/fs-created.txt' --data-binary 'fs_api_content'" > /dev/null
RESP=$(toolbox_post "/toolbox/process/execute" '{"command":"cat /tmp/toolbox-e2e-test/fs-created.txt"}')
STDOUT=$(echo "$RESP" | py "print(d.get('stdout','').strip())")
[ "$STDOUT" = "fs_api_content" ] && pass "Read FS-created file via exec" || fail "Read FS-created file (stdout=$STDOUT)"

# Large file upload + download roundtrip
remote "dd if=/dev/urandom bs=1024 count=1024 of=/tmp/toolbox-e2e-test/large.bin 2>/dev/null"
ORIG_SIZE=$(remote "stat -c%s /tmp/toolbox-e2e-test/large.bin")
DL_SIZE=$(remote "curl -sf 'http://localhost/toolbox/files/download?path=/tmp/toolbox-e2e-test/large.bin' | wc -c")
[ "$ORIG_SIZE" = "$DL_SIZE" ] && pass "1MB file roundtrip (size=$ORIG_SIZE)" || fail "1MB file roundtrip (orig=$ORIG_SIZE dl=$DL_SIZE)"

# ═════════════════════════════════════════════════════════════════════════
#  Cleanup
# ═════════════════════════════════════════════════════════════════════════

echo ""
log "Cleanup..."
RESP=$(toolbox_delete "/toolbox/files?path=/tmp/toolbox-e2e-test&recursive=true")
DELETED=$(echo "$RESP" | py "print(d.get('deleted',''))")
[ "$DELETED" = "True" ] && pass "Cleanup: deleted test directory" || fail "Cleanup failed"
remote "rm -f /tmp/bulk-test.zip" 2>/dev/null || true

# ═════════════════════════════════════════════════════════════════════════
#  Results
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
