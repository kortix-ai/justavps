#!/usr/bin/env python3
"""
JustAVPS Python SDK — Comprehensive E2E Test

Tests every single method on the ergonomic SDK wrapper against a live VPS.

Usage:
    API_KEY=sk_live_xxx MACHINE_ID=xxx python3 src/sdk/python/e2e_test.py
    API_KEY=sk_live_xxx MACHINE_ID=xxx BASE_URL=http://localhost:4100/api/v1 python3 src/sdk/python/e2e_test.py
"""

import os
import sys
import time

# Add parent dir to path so we can import justavps.py
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from justavps import JustAVPS, JustAVPSError

API_KEY = os.environ.get("API_KEY", "")
MACHINE_ID = os.environ.get("MACHINE_ID", "")
BASE_URL = os.environ.get("BASE_URL", "http://localhost:4100/api/v1")

if not API_KEY or not MACHINE_ID:
    print("Usage: API_KEY=sk_live_xxx MACHINE_ID=xxx python3 src/sdk/python/e2e_test.py")
    sys.exit(1)

client = JustAVPS(API_KEY, base_url=BASE_URL)
TEST_DIR = f"/tmp/py-sdk-e2e-{int(time.time())}"

passed = 0
failed = 0


def ok(name: str):
    global passed
    passed += 1
    print(f"  \033[32m✓\033[0m {name}")


def no(name: str, detail: str = ""):
    global failed
    failed += 1
    print(f"  \033[31m✗\033[0m {name}" + (f" ({detail})" if detail else ""))


def check(cond: bool, name: str, detail: str = ""):
    if cond:
        ok(name)
    else:
        no(name, detail)


# ═══════════════════════════════════════════════════════════════════════

print()
print("\033[36m═══════════════════════════════════════════════════════════\033[0m")
print("\033[36m  Python SDK — E2E Test\033[0m")
print(f"\033[36m  Base: \033[1m{BASE_URL}\033[0m")
print(f"\033[36m  Machine: \033[1m{MACHINE_ID}\033[0m")
print("\033[36m═══════════════════════════════════════════════════════════\033[0m")
print()

# ── Machines ─────────────────────────────────────────────────────────
print("\033[36m[SDK]\033[0m \033[1mMachines\033[0m")

try:
    machines = client.machines.list()
    check(isinstance(machines, list), "machines.list() returns list")
    check(len(machines) >= 1, f"machines.list() has {len(machines)} machines")
    m = machines[0]
    check("id" in m, "machine has id")
    check("slug" in m, "machine has slug")
    check("status" in m, "machine has status")
except Exception as e:
    no("machines.list()", str(e))

try:
    m = client.machines.get(MACHINE_ID)
    check(m["id"] == MACHINE_ID, "machines.get() correct id")
    check(isinstance(m.get("ip"), str) and len(m["ip"]) > 0, f"machine has ip: {m.get('ip')}")
    check(m["status"] == "ready", "machine status is ready")
except Exception as e:
    no("machines.get()", str(e))

# ── Server Types ─────────────────────────────────────────────────────
print("\n\033[36m[SDK]\033[0m \033[1mServer Types\033[0m")

try:
    providers = client.server_types.providers()
    check(isinstance(providers, list), "server_types.providers()")
    check(len(providers) >= 1, f"has {len(providers)} providers")
except Exception as e:
    no("server_types.providers()", str(e))

try:
    regions = client.server_types.regions()
    check(isinstance(regions, list), "server_types.regions()")
    check(len(regions) >= 1, f"has {len(regions)} regions")
except Exception as e:
    no("server_types.regions()", str(e))

try:
    types = client.server_types.list("hel1")
    check(isinstance(types, list), "server_types.list()")
    check(len(types) >= 1, f"has {len(types)} server types")
except Exception as e:
    no("server_types.list()", str(e))

# ── Images ───────────────────────────────────────────────────────────
print("\n\033[36m[SDK]\033[0m \033[1mImages\033[0m")

try:
    images = client.images.list()
    check(isinstance(images, list), "images.list()")
except Exception as e:
    no("images.list()", str(e))

# ── Toolbox: Filesystem ─────────────────────────────────────────────
print("\n\033[36m[SDK]\033[0m \033[1mToolbox: Filesystem\033[0m")
tb = client.toolbox(MACHINE_ID)

# mkdir
try:
    r = tb.files.mkdir(TEST_DIR)
    check(r["created"] is True, "files.mkdir()")
except Exception as e:
    no("files.mkdir()", str(e))

try:
    r = tb.files.mkdir(f"{TEST_DIR}/a/b/c", "700")
    check(r["created"] is True, "files.mkdir() nested with mode")
except Exception as e:
    no("files.mkdir() nested", str(e))

try:
    r = tb.files.mkdir(TEST_DIR)
    check(r["created"] is False, "files.mkdir() already exists → created=false")
except Exception as e:
    no("files.mkdir() exists", str(e))

# upload
try:
    r = tb.files.upload(f"{TEST_DIR}/hello.txt", "Hello SDK!")
    check(r["size"] == 10, f"files.upload() text size={r['size']}")
    check(r["name"] == "hello.txt", f"files.upload() name={r['name']}")
except Exception as e:
    no("files.upload() text", str(e))

try:
    r = tb.files.upload(f"{TEST_DIR}/exec.sh", "#!/bin/bash\necho hi", mode="755")
    check(r["size"] > 0, "files.upload() with mode=755")
except Exception as e:
    no("files.upload() mode", str(e))

try:
    tb.files.upload(f"{TEST_DIR}/hello.txt", "nope")
    # Overwrite is default true, so this should succeed
    ok("files.upload() overwrite=true (default)")
except Exception as e:
    no("files.upload() overwrite", str(e))

try:
    r = tb.files.upload(f"{TEST_DIR}/deep/nested/file.txt", "deep")
    check(r["size"] == 4, "files.upload() auto-create parents")
except Exception as e:
    no("files.upload() parents", str(e))

# Re-upload original content
tb.files.upload(f"{TEST_DIR}/hello.txt", "Hello SDK!")

# download
try:
    content = tb.files.download(f"{TEST_DIR}/hello.txt")
    check(content == "Hello SDK!", f"files.download() content={repr(content)}")
except Exception as e:
    no("files.download()", str(e))

try:
    data = tb.files.download_bytes(f"{TEST_DIR}/hello.txt")
    check(isinstance(data, bytes), "files.download_bytes() returns bytes")
    check(len(data) == 10, f"files.download_bytes() len={len(data)}")
except Exception as e:
    no("files.download_bytes()", str(e))

try:
    tb.files.download(f"{TEST_DIR}/nonexistent")
    no("files.download() not found", "should have raised")
except JustAVPSError as e:
    check(e.status == 404, "files.download() not found → 404")

# exists
try:
    r = tb.files.exists(f"{TEST_DIR}/hello.txt")
    check(r["exists"] is True, "files.exists() true")
    check(r["type"] == "file", "files.exists() type=file")
except Exception as e:
    no("files.exists() true", str(e))

try:
    r = tb.files.exists(TEST_DIR)
    check(r["exists"] is True, "files.exists() dir true")
    check(r["type"] == "dir", "files.exists() type=dir")
except Exception as e:
    no("files.exists() dir", str(e))

try:
    r = tb.files.exists(f"{TEST_DIR}/nope")
    check(r["exists"] is False, "files.exists() false")
except Exception as e:
    no("files.exists() false", str(e))

# info
try:
    info = tb.files.info(f"{TEST_DIR}/hello.txt")
    check(info["name"] == "hello.txt", f"files.info() name={info['name']}")
    check(info["type"] == "file", f"files.info() type={info['type']}")
    check(info["size"] == 10, f"files.info() size={info['size']}")
    check(info["owner"] == "root", f"files.info() owner={info['owner']}")
    check("mode_bits" in info, "files.info() has mode_bits")
    check("mod_time" in info, "files.info() has mod_time")
except Exception as e:
    no("files.info()", str(e))

try:
    info = tb.files.info(f"{TEST_DIR}/exec.sh")
    check(info["mode_bits"] == "755", f"files.info() mode persisted={info['mode_bits']}")
except Exception as e:
    no("files.info() mode", str(e))

# list
try:
    entries = tb.files.list(TEST_DIR)
    check(isinstance(entries, list), "files.list() returns list")
    check(len(entries) >= 4, f"files.list() {len(entries)} entries")
    hello = next((e for e in entries if e["name"] == "hello.txt"), None)
    check(hello is not None, "files.list() finds hello.txt")
    check(hello["type"] == "file", "files.list() hello.txt type=file")
except Exception as e:
    no("files.list()", str(e))

try:
    entries = tb.files.list(TEST_DIR, depth=3)
    check(len(entries) >= 6, f"files.list() depth=3 → {len(entries)} entries")
except Exception as e:
    no("files.list() depth", str(e))

# find
try:
    tb.files.upload(f"{TEST_DIR}/search.txt", "hello world\ngoodbye world\nhello again")
    r = tb.files.find(TEST_DIR, "hello")
    check(r["total"] >= 2, f"files.find() total={r['total']}")
    check(len(r["matches"]) >= 2, f"files.find() matches={len(r['matches'])}")
    check("file" in r["matches"][0], "match has file")
    check("line" in r["matches"][0], "match has line")
except Exception as e:
    no("files.find()", str(e))

try:
    r = tb.files.find(TEST_DIR, "hello", include="*.sh")
    check(r["total"] == 0, "files.find() include filter")
except Exception as e:
    no("files.find() include", str(e))

try:
    r = tb.files.find(TEST_DIR, "hello", max_results=1)
    check(r["total"] == 1, "files.find() max_results=1")
    check(r["truncated"] is True, "files.find() truncated=true")
except Exception as e:
    no("files.find() max_results", str(e))

# replace
try:
    r = tb.files.replace([f"{TEST_DIR}/search.txt"], "hello", "hi")
    check(r["results"][0]["replacements"] >= 2, f"files.replace() replacements={r['results'][0]['replacements']}")
    content = tb.files.download(f"{TEST_DIR}/search.txt")
    check("hi world" in content, "files.replace() content verified")
    check("goodbye" in content, "files.replace() unreplaced preserved")
except Exception as e:
    no("files.replace()", str(e))

# chmod
try:
    r = tb.files.chmod(f"{TEST_DIR}/hello.txt", "600")
    check(r["mode"] == "600", f"files.chmod() mode={r['mode']}")
    info = tb.files.info(f"{TEST_DIR}/hello.txt")
    check(info["mode_bits"] == "600", "files.chmod() persisted")
except Exception as e:
    no("files.chmod()", str(e))

# move
try:
    r = tb.files.move(f"{TEST_DIR}/hello.txt", f"{TEST_DIR}/moved.txt")
    check(r["destination"] == f"{TEST_DIR}/moved.txt", "files.move() destination")
    gone = tb.files.exists(f"{TEST_DIR}/hello.txt")
    check(gone["exists"] is False, "files.move() old path gone")
    there = tb.files.exists(f"{TEST_DIR}/moved.txt")
    check(there["exists"] is True, "files.move() new path exists")
except Exception as e:
    no("files.move()", str(e))

# remove
try:
    r = tb.files.remove(f"{TEST_DIR}/exec.sh")
    check(r["deleted"] is True, "files.remove() file")
    gone = tb.files.exists(f"{TEST_DIR}/exec.sh")
    check(gone["exists"] is False, "files.remove() file gone")
except Exception as e:
    no("files.remove() file", str(e))

try:
    tb.files.remove(TEST_DIR)
    no("files.remove() non-empty", "should have raised")
except JustAVPSError as e:
    check(e.status == 400, "files.remove() non-empty → 400")

try:
    tb.files.remove("/root", recursive=True)
    no("files.remove() protected", "should have raised")
except JustAVPSError as e:
    check(e.status == 403, "files.remove() protected → 403")

# ── Toolbox: Process ─────────────────────────────────────────────────
print("\n\033[36m[SDK]\033[0m \033[1mToolbox: Process\033[0m")

# exec
try:
    r = tb.process.exec("echo sdk_test")
    check(r["exit_code"] == 0, f"process.exec() exit={r['exit_code']}")
    check(r["stdout"].strip() == "sdk_test", f"process.exec() stdout={repr(r['stdout'].strip())}")
    check("duration_ms" in r, "process.exec() has duration_ms")
except Exception as e:
    no("process.exec()", str(e))

try:
    r = tb.process.exec("echo err >&2")
    check(r["stderr"].strip() == "err", f"process.exec() stderr={repr(r['stderr'].strip())}")
except Exception as e:
    no("process.exec() stderr", str(e))

try:
    r = tb.process.exec("exit 42")
    check(r["exit_code"] == 42, f"process.exec() exit_code={r['exit_code']}")
except Exception as e:
    no("process.exec() exit code", str(e))

try:
    r = tb.process.exec("pwd", cwd="/tmp")
    check(r["stdout"].strip() == "/tmp", f"process.exec() cwd stdout={r['stdout'].strip()}")
except Exception as e:
    no("process.exec() cwd", str(e))

try:
    r = tb.process.exec("echo $SDK_VAR", env={"SDK_VAR": "test_123"})
    check(r["stdout"].strip() == "test_123", f"process.exec() env stdout={r['stdout'].strip()}")
except Exception as e:
    no("process.exec() env", str(e))

try:
    r = tb.process.exec('echo "a b c" | wc -w')
    check(r["stdout"].strip() == "3", f"process.exec() pipe stdout={r['stdout'].strip()}")
except Exception as e:
    no("process.exec() pipe", str(e))

try:
    r = tb.process.exec("echo l1 && echo l2 && echo l3")
    lines = r["stdout"].strip().split("\n")
    check(len(lines) == 3, f"process.exec() multi-line: {len(lines)} lines")
except Exception as e:
    no("process.exec() multi-line", str(e))

# code_run
try:
    r = tb.process.code_run("echo bash_ok", language="bash")
    check(r["stdout"].strip() == "bash_ok", "process.code_run() bash")
    check(r["exit_code"] == 0, "process.code_run() bash exit=0")
except Exception as e:
    no("process.code_run() bash", str(e))

try:
    r = tb.process.code_run("print(6 * 7)", language="python")
    check(r["stdout"].strip() == "42", "process.code_run() python 6*7=42")
except Exception as e:
    no("process.code_run() python", str(e))

try:
    r = tb.process.code_run('console.log(JSON.stringify({ok:true}))', language="node")
    check(r["stdout"].strip() == '{"ok":true}', "process.code_run() node")
except Exception as e:
    no("process.code_run() node", str(e))

try:
    r = tb.process.code_run('print("auto")')
    check(r["stdout"].strip() == "auto", "process.code_run() auto-detect python")
except Exception as e:
    no("process.code_run() auto-detect", str(e))

try:
    r = tb.process.code_run("echo $CR_ENV", language="bash")
    # No env passed, so should be empty
    check(r["exit_code"] == 0, "process.code_run() no env")
except Exception as e:
    no("process.code_run() no env", str(e))

# list
try:
    procs = tb.process.list()
    check(isinstance(procs, list), "process.list() returns list")
    check(len(procs) >= 5, f"process.list() {len(procs)} processes")
    check("pid" in procs[0], "process has pid")
    check("command" in procs[0], "process has command")
    daemon = any("justavps-daemon" in p.get("command", "") for p in procs)
    check(daemon, "daemon in process list")
except Exception as e:
    no("process.list()", str(e))

# kill
try:
    tb.process.kill(1)
    no("process.kill() PID 1", "should have raised")
except JustAVPSError as e:
    check(e.status == 403, "process.kill() PID 1 → 403")

# ── Integration ──────────────────────────────────────────────────────
print("\n\033[36m[SDK]\033[0m \033[1mIntegration\033[0m")

try:
    tb.process.exec(f"echo exec_content > {TEST_DIR}/from-exec.txt")
    content = tb.files.download(f"{TEST_DIR}/from-exec.txt")
    check(content.strip() == "exec_content", "exec → files roundtrip")
except Exception as e:
    no("exec → files", str(e))

try:
    tb.files.upload(f"{TEST_DIR}/from-sdk.txt", "sdk_content")
    r = tb.process.exec(f"cat {TEST_DIR}/from-sdk.txt")
    check(r["stdout"].strip() == "sdk_content", "files → exec roundtrip")
except Exception as e:
    no("files → exec", str(e))

try:
    tb.files.info("/nonexistent/path/xyz")
    no("error handling", "should have raised")
except JustAVPSError as e:
    check(isinstance(e, JustAVPSError), "raises JustAVPSError")
    check(e.status == 404, f"error status={e.status}")
    check(isinstance(str(e), str), "error has message")

# ── Cleanup ──────────────────────────────────────────────────────────
print("\n\033[36m[SDK]\033[0m Cleanup")

try:
    r = tb.files.remove(TEST_DIR, recursive=True)
    check(r["deleted"] is True, "cleanup done")
except Exception as e:
    no("cleanup", str(e))

client.close()

# ── Results ──────────────────────────────────────────────────────────
print()
print("\033[36m═══════════════════════════════════════════════════════════\033[0m")
total = passed + failed
if failed == 0:
    print(f"  \033[32m\033[1mALL {passed} TESTS PASSED\033[0m ({total} total)")
else:
    print(f"  \033[31m\033[1m{failed} FAILED\033[0m, \033[32m{passed} passed\033[0m ({total} total)")
print("\033[36m═══════════════════════════════════════════════════════════\033[0m")
print()
sys.exit(1 if failed > 0 else 0)
