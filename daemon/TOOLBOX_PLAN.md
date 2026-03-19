# JustAVPS Daemon Toolbox — Full Design Plan

> Status: Design review  
> Last updated: March 19, 2026  
> After approval → implement in Go daemon + Core Hono API wrapper

---

## 0. Executive Summary

Build a **Daytona/E2B-grade toolbox** natively into `justavps-daemon` (Go). Every JustAVPS machine ships with a first-class **Filesystem API**, **Process/Exec API**, and **PTY API** out of the box — zero extra binaries needed for core operations.

**Architecture:**
```
SDK/Agent/Dashboard
       │
       ▼
┌──────────────────────────────────────────────┐
│  JustAVPS Core API  (Hono, Vercel)           │
│  /api/v1/machines/:id/toolbox/*              │
│  ↕ Auth (API key / session) → proxy to VPS   │
└──────────────────┬───────────────────────────┘
                   │ CF Worker auth → VPS :80
                   ▼
┌──────────────────────────────────────────────┐
│  justavps-daemon  (Go binary, :80 + :7777)   │
│                                              │
│  IN-PROCESS (native Go):                     │
│    /toolbox/files/*       ← Filesystem API   │
│    /toolbox/process/*     ← Process/Exec API │
│    /_pty                  ← PTY WebSocket    │
│    /daemon/*              ← Health/Info      │
│                                              │
│  REVERSE PROXY (to localhost services):      │
│    /agent/*    → :2468 (sandbox-agent)       │
│    /_port/N/*  → :N (dynamic port forward)   │
│    /*          → :3456 (OpenCode IDE)        │
└──────────────────────────────────────────────┘
```

**Why native in Go vs external binary:**
- Zero extra dependencies — daemon IS the toolbox
- Faster (no HTTP hop to localhost)
- Single process to manage/monitor
- Our API surface, our OpenAPI spec, our SDK
- sandbox-agent stays for coding agents (Claude Code, Codex sessions) — separate concern

---

## 1. Competitive API Comparison

| Feature | Daytona | E2B | **JustAVPS (planned)** |
|---------|---------|-----|------------------------|
| **List files** | `GET /files?path=` | `fs.list(path)` | `GET /toolbox/files?path=` |
| **File info** | `GET /files/info?path=` | `fs.getInfo(path)` | `GET /toolbox/files/info?path=` |
| **Read file** | `GET /files/download?path=` | `fs.read(path)` | `GET /toolbox/files/download?path=` |
| **Write file** | `POST /files/upload?path=` | `fs.write(path, data)` | `POST /toolbox/files/upload?path=` |
| **Create dir** | `POST /files/folder?path=` | `fs.makeDir(path)` | `POST /toolbox/files/folder?path=` |
| **Delete** | `DELETE /files?path=` | `fs.remove(path)` | `DELETE /toolbox/files?path=` |
| **Move/Rename** | `POST /files/move` | `fs.rename()` | `POST /toolbox/files/move` |
| **Find text** | `GET /files/find` | ❌ | `GET /toolbox/files/find` |
| **Replace text** | `POST /files/replace` | ❌ | `POST /toolbox/files/replace` |
| **Permissions** | `POST /files/permissions` | ❌ | `POST /toolbox/files/permissions` |
| **Exists check** | via info | `fs.exists()` | `GET /toolbox/files/exists?path=` |
| **Bulk upload** | `POST /files/bulk-upload` | `fs.writeFiles()` | `POST /toolbox/files/bulk-upload` |
| **Bulk download** | `POST /files/bulk-download` | ❌ | `POST /toolbox/files/bulk-download` |
| **Watch dir** | ❌ | `fs.watchDir()` (WS) | `WS /toolbox/files/watch` (v2) |
| **Exec command** | `POST /process/execute` | `commands.run()` | `POST /toolbox/process/execute` |
| **List processes** | `GET /process/session` | `commands.list()` | `GET /toolbox/process/list` |
| **Kill process** | ❌ | `commands.kill(pid)` | `POST /toolbox/process/kill` |
| **Send stdin** | session input endpoint | `commands.sendStdin()` | `POST /toolbox/process/stdin` |
| **Code run** | `POST /process/code-run` | ❌ | `POST /toolbox/process/code-run` |
| **PTY create** | `POST /process/pty` | `pty.create()` | Already exists: `WS /_pty` |
| **PTY sessions** | full CRUD | connect/kill/resize | Enhance existing |

**Our superset:** We take the best from both + add our own. Daytona's find/replace/permissions are killer for agents. E2B's exists check is simple and useful. We take both.

---

## 2. Filesystem API — Full Specification

All FS routes live under `/toolbox/files/` on the daemon.

### 2.1 List Files

```
GET /toolbox/files?path=<path>&depth=<n>
```

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | `/root` | Directory to list |
| `depth` | int | `1` | Depth for recursive listing (1 = immediate children only) |

**Response 200:**
```json
{
  "entries": [
    {
      "name": "src",
      "path": "/root/project/src",
      "type": "dir",
      "size": 4096,
      "mode": "drwxr-xr-x",
      "mode_bits": 755,
      "owner": "root",
      "group": "root",
      "mod_time": "2026-03-19T10:30:00Z"
    },
    {
      "name": "main.go",
      "path": "/root/project/main.go",
      "type": "file",
      "size": 2048,
      "mode": "-rw-r--r--",
      "mode_bits": 644,
      "owner": "root",
      "group": "root",
      "mod_time": "2026-03-19T10:25:00Z",
      "symlink_target": null
    }
  ]
}
```

### 2.2 File/Dir Info

```
GET /toolbox/files/info?path=<path>
```

**Response 200:**
```json
{
  "name": "main.go",
  "path": "/root/project/main.go",
  "type": "file",
  "size": 2048,
  "mode": "-rw-r--r--",
  "mode_bits": 644,
  "owner": "root",
  "group": "root",
  "mod_time": "2026-03-19T10:25:00Z",
  "symlink_target": null
}
```

### 2.3 Check Exists

```
GET /toolbox/files/exists?path=<path>
```

**Response 200:**
```json
{
  "exists": true,
  "type": "file"
}
```

### 2.4 Read/Download File

```
GET /toolbox/files/download?path=<path>
```

**Response 200:** Raw file content with appropriate `Content-Type` and `Content-Disposition` headers.

- `Content-Type`: detected via `http.DetectContentType` or extension mapping
- `Content-Disposition: attachment; filename="main.go"`
- For text files, add `X-File-Encoding: utf-8`

### 2.5 Write/Upload File

```
POST /toolbox/files/upload?path=<path>&mode=<mode>
```

**Body:** Raw file content (binary or text).  
**Content-Type:** `application/octet-stream` for binary, `text/plain` for text.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | required | Target file path |
| `mode` | string | `"644"` | File permissions (octal) |
| `overwrite` | bool | `true` | Overwrite if exists |

**Response 200:**
```json
{
  "path": "/root/project/new-file.txt",
  "name": "new-file.txt",
  "type": "file",
  "size": 1024
}
```

**Notes:**
- Creates parent directories automatically (`os.MkdirAll`)
- Supports multipart form upload (`multipart/form-data` with `file` field) as alternative
- Max file size: 100MB (configurable)

### 2.6 Bulk Upload

```
POST /toolbox/files/bulk-upload
Content-Type: multipart/form-data
```

**Form fields:**
- Multiple `file` fields with `filename` attributes containing the relative path
- OR a JSON `manifest` field with `[{"path": "...", "mode": "644"}]`

**Response 200:**
```json
{
  "uploaded": [
    {"path": "/root/project/a.txt", "size": 100},
    {"path": "/root/project/b.txt", "size": 200}
  ],
  "errors": []
}
```

### 2.7 Bulk Download

```
POST /toolbox/files/bulk-download
Content-Type: application/json
```

**Body:**
```json
{
  "paths": ["/root/project/a.txt", "/root/project/b.txt"]
}
```

**Response 200:** `application/zip` — streamed zip archive of requested files.

### 2.8 Create Directory

```
POST /toolbox/files/folder?path=<path>&mode=<mode>
```

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | required | Directory path to create |
| `mode` | string | `"755"` | Directory permissions |

Creates recursively (like `mkdir -p`).

**Response 200:**
```json
{
  "path": "/root/project/new-dir",
  "created": true
}
```

### 2.9 Delete File/Directory

```
DELETE /toolbox/files?path=<path>&recursive=<bool>
```

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | required | Path to delete |
| `recursive` | bool | `false` | Required `true` for non-empty directories |

**Response 200:**
```json
{
  "deleted": true,
  "path": "/root/project/old-file.txt"
}
```

### 2.10 Move/Rename

```
POST /toolbox/files/move?source=<src>&destination=<dst>
```

**Response 200:**
```json
{
  "source": "/root/project/old.txt",
  "destination": "/root/project/new.txt"
}
```

### 2.11 Find Text in Files

```
GET /toolbox/files/find?path=<dir>&pattern=<regex>
```

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | required | Directory to search |
| `pattern` | string | required | Regex pattern to match |
| `include` | string | `"*"` | Glob for file names to include (e.g. `"*.go"`) |
| `max_results` | int | `100` | Max matches to return |

Uses `grep -rn` under the hood (or native Go `regexp` + `filepath.Walk`).

**Response 200:**
```json
{
  "matches": [
    {
      "file": "/root/project/main.go",
      "line": 42,
      "content": "func handleRequest(w http.ResponseWriter, r *http.Request) {"
    }
  ],
  "truncated": false,
  "total": 3
}
```

### 2.12 Replace Text in Files

```
POST /toolbox/files/replace
Content-Type: application/json
```

**Body:**
```json
{
  "files": ["/root/project/main.go", "/root/project/handler.go"],
  "pattern": "oldFunction",
  "new_value": "newFunction"
}
```

**Response 200:**
```json
{
  "results": [
    {"file": "/root/project/main.go", "replacements": 3},
    {"file": "/root/project/handler.go", "replacements": 1}
  ]
}
```

### 2.13 Set Permissions

```
POST /toolbox/files/permissions?path=<path>
Content-Type: application/json
```

**Body:**
```json
{
  "mode": "755",
  "owner": "root",
  "group": "root"
}
```

All fields optional — only provided fields are changed.

**Response 200:**
```json
{
  "path": "/root/project/script.sh",
  "mode": "755",
  "owner": "root",
  "group": "root"
}
```

---

## 3. Process/Exec API — Full Specification

All process routes live under `/toolbox/process/` on the daemon.

### 3.1 Execute Command (synchronous)

```
POST /toolbox/process/execute
Content-Type: application/json
```

**Body:**
```json
{
  "command": "ls -la /root",
  "cwd": "/root/project",
  "timeout": 30,
  "env": {
    "NODE_ENV": "production"
  },
  "user": "root"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` | string | required | Shell command to execute |
| `cwd` | string | `"/root"` | Working directory |
| `timeout` | int (seconds) | `60` | Max execution time |
| `env` | map | `{}` | Extra env vars (merged with system env) |
| `user` | string | `"root"` | User to run as |

**Response 200:**
```json
{
  "exit_code": 0,
  "stdout": "total 48\ndrwxr-xr-x 4 root root 4096 ...\n",
  "stderr": "",
  "duration_ms": 12
}
```

**Implementation:** Uses `exec.CommandContext` with the specified timeout. Captures stdout/stderr separately. Runs via `/bin/sh -c "<command>"`.

### 3.2 Execute Command (streaming)

```
POST /toolbox/process/execute/stream
Content-Type: application/json
```

Same body as 3.1, but response is **Server-Sent Events (SSE)**:

```
event: stdout
data: {"data": "Building...\n"}

event: stdout
data: {"data": "Compiling main.go\n"}

event: stderr
data: {"data": "warning: unused variable\n"}

event: exit
data: {"exit_code": 0, "duration_ms": 4521}
```

This is critical for long-running commands (builds, installs) where the caller wants real-time output.

### 3.3 Run Code Snippet

```
POST /toolbox/process/code-run
Content-Type: application/json
```

**Body:**
```json
{
  "code": "print('Hello, World!')",
  "language": "python",
  "timeout": 30,
  "env": {}
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `code` | string | required | Code to execute |
| `language` | string | auto-detect | `python`, `node`, `bash`, `ruby`, `go` |
| `timeout` | int | `30` | Max execution time (seconds) |
| `env` | map | `{}` | Extra env vars |

**Language → Interpreter mapping:**
| Language | Command |
|----------|---------|
| `python` | `python3 -c "<code>"` |
| `node` / `javascript` / `typescript` | `node -e "<code>"` |
| `bash` / `shell` | `/bin/bash -c "<code>"` |
| `ruby` | `ruby -e "<code>"` |
| `go` | Write to temp file, `go run <file>` |

**Response 200:** Same as Execute Command (exit_code, stdout, stderr, duration_ms).

### 3.4 List Running Processes

```
GET /toolbox/process/list
```

**Response 200:**
```json
{
  "processes": [
    {
      "pid": 1234,
      "command": "node server.js",
      "args": ["server.js"],
      "cwd": "/root/project",
      "user": "root",
      "cpu_percent": 2.5,
      "memory_rss_bytes": 52428800,
      "started_at": "2026-03-19T10:00:00Z"
    }
  ]
}
```

**Implementation:** Reads from `/proc/` filesystem (Linux-specific). Filters to user-space processes (skip kernel threads). Parses `/proc/[pid]/stat`, `/proc/[pid]/cmdline`, `/proc/[pid]/status`.

### 3.5 Kill Process

```
POST /toolbox/process/kill
Content-Type: application/json
```

**Body:**
```json
{
  "pid": 1234,
  "signal": "SIGTERM"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pid` | int | required | Process ID to kill |
| `signal` | string | `"SIGTERM"` | Signal: `SIGTERM`, `SIGKILL`, `SIGINT`, `SIGHUP` |

**Response 200:**
```json
{
  "killed": true,
  "pid": 1234,
  "signal": "SIGTERM"
}
```

### 3.6 Send Stdin to Process

```
POST /toolbox/process/stdin
Content-Type: application/json
```

**Body:**
```json
{
  "pid": 1234,
  "data": "yes\n"
}
```

**Note:** This only works for processes started via our `/execute` endpoint where we kept stdin open. For processes started elsewhere, use PTY.

---

## 4. PTY API — Enhanced Specification

We already have `/_pty` WebSocket endpoint. We enhance it with REST management endpoints to match Daytona.

### 4.1 Existing: WebSocket PTY (no changes)

```
WS /_pty
```

Current protocol (JSON messages) stays the same:
```json
// Client → Server
{"type": "input", "data": "ls\n"}
{"type": "resize", "cols": 80, "rows": 24}

// Server → Client
{"type": "output", "data": "..."}
{"type": "exit"}
{"type": "error", "data": "..."}
```

### 4.2 New: Named PTY Sessions (v2, optional)

For v1, the existing single-PTY WebSocket is sufficient. In v2, we add Daytona-style named sessions:

```
POST   /toolbox/pty               → Create named PTY session
GET    /toolbox/pty               → List PTY sessions
GET    /toolbox/pty/:id           → Get PTY session info
WS     /toolbox/pty/:id/connect   → Connect to named session
POST   /toolbox/pty/:id/resize    → Resize session
DELETE /toolbox/pty/:id           → Kill session
```

**Deferred to v2** — the current `/_pty` endpoint covers the dashboard terminal use case. Named sessions matter for multi-terminal scenarios (IDE integration, parallel agent workflows).

---

## 5. Error Responses (consistent across all endpoints)

All errors return JSON:

```json
{
  "error": "descriptive message",
  "code": "FILE_NOT_FOUND",
  "details": "optional additional context"
}
```

**Error codes:**

| HTTP | Code | When |
|------|------|------|
| 400 | `BAD_REQUEST` | Missing/invalid params |
| 404 | `FILE_NOT_FOUND` | Path doesn't exist |
| 403 | `PERMISSION_DENIED` | Can't access path |
| 409 | `ALREADY_EXISTS` | File/dir exists + overwrite=false |
| 413 | `FILE_TOO_LARGE` | Upload exceeds max size |
| 408 | `TIMEOUT` | Command execution timed out |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 502 | `PROCESS_FAILED` | Command exited with non-zero |

---

## 6. Security Considerations

1. **No daemon-level auth** — CF Worker handles all authentication at the edge. The daemon trusts incoming requests on :80 (only reachable from CF IPs via Hetzner Firewall).

2. **Path traversal protection** — All file paths are `filepath.Clean`ed and validated. No symlink following outside `/root` (configurable root boundary).

3. **Command injection** — Commands run via `/bin/sh -c` with proper quoting. Env vars are passed as process env, not interpolated into the command string.

4. **Resource limits:**
   - File upload max: 100MB (configurable)
   - Command timeout: configurable, default 60s, max 3600s
   - Process listing: max 500 results
   - Find text: max 100 matches (configurable)

5. **Rate limiting** — Not at daemon level (CF Worker / Core API handles rate limits). Daemon is internal.

---

## 7. Core API Wrapper (Hono)

The Core API on Vercel wraps every daemon endpoint behind auth. Each machine's toolbox is accessible at:

```
/api/v1/machines/:id/toolbox/files/*
/api/v1/machines/:id/toolbox/process/*
```

### Implementation pattern:

```typescript
// src/server/routes/v1/toolbox.ts

// POST /machines/:id/toolbox/process/execute
machineToolboxApp.openapi(executeCommandRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');
  
  // 1. Verify machine ownership
  const machine = await requireOwnedMachine(c, id, ownerId);
  
  // 2. Proxy to daemon
  const daemonUrl = `http://${machine.ip}/toolbox/process/execute`;
  const resp = await fetch(daemonUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c.req.valid('json')),
  });
  
  return c.json(await resp.json(), resp.status);
});
```

### OpenAPI auto-generation

Every route uses `@hono/zod-openapi` so the full toolbox API appears in:
- `/api/docs/openapi.json` (spec)
- `/api/docs` (Scalar UI)

New tags added to the OpenAPI spec:
```typescript
{ name: 'Filesystem', description: 'Read, write, and manage files on a machine' },
{ name: 'Process', description: 'Execute commands and manage processes on a machine' },
```

### SDK auto-derived

Since we use Hono's typed routes, the TypeScript SDK (`@justavps/sdk` via `hono/client`) gets these methods for free:

```typescript
import { JustAVPS } from '@justavps/sdk';

const client = new JustAVPS({ apiKey: 'sk_live_xxx' });

// Filesystem
const files = await client.machines[':id'].toolbox.files.$get({ param: { id: 'machine-id' }, query: { path: '/root' } });
const content = await client.machines[':id'].toolbox.files.download.$get({ param: { id: 'machine-id' }, query: { path: '/root/main.go' } });
await client.machines[':id'].toolbox.files.upload.$post({ param: { id: 'machine-id' }, query: { path: '/root/new.txt' }, body: 'content' });

// Process
const result = await client.machines[':id'].toolbox.process.execute.$post({
  param: { id: 'machine-id' },
  json: { command: 'ls -la', cwd: '/root', timeout: 30 },
});
```

---

## 8. Implementation Plan

### Phase 1: Daemon — Filesystem API (`daemon/fs.go`) 
~400 lines of Go

New file `daemon/fs.go`:
- `handleListFiles` — `os.ReadDir` + `os.Stat` for each entry
- `handleFileInfo` — `os.Stat` + `os/user` lookup  
- `handleFileExists` — `os.Stat` check
- `handleDownloadFile` — `os.Open` + `io.Copy` to response
- `handleUploadFile` — parse body + `os.WriteFile`
- `handleBulkUpload` — `multipart.Reader` + loop
- `handleBulkDownload` — `archive/zip.Writer` streamed
- `handleCreateFolder` — `os.MkdirAll`
- `handleDeleteFile` — `os.Remove` / `os.RemoveAll`
- `handleMoveFile` — `os.Rename`
- `handleFindText` — `filepath.Walk` + `regexp.Match` line-by-line
- `handleReplaceText` — read + `regexp.ReplaceAll` + write back
- `handleSetPermissions` — `os.Chmod` + `os.Chown`

Register in `proxy.go` routing:
```go
case strings.HasPrefix(path, "/toolbox/"):
    p.toolbox.ServeHTTP(w, r)
```

### Phase 2: Daemon — Process API (`daemon/exec.go`)
~300 lines of Go

New file `daemon/exec.go`:
- `handleExecuteCommand` — `exec.CommandContext` + capture stdout/stderr
- `handleExecuteStream` — Same but flush output as SSE events
- `handleCodeRun` — language detection + temp file + exec
- `handleListProcesses` — read `/proc/` filesystem
- `handleKillProcess` — `syscall.Kill`
- `handleSendStdin` — pipe to tracked process (requires process registry)

### Phase 3: Core API Wrapper (`src/server/routes/v1/toolbox.ts`)
~200 lines of TypeScript

- Authenticated proxy for every daemon `/toolbox/*` endpoint
- Full Zod schemas for request/response
- `@hono/zod-openapi` route definitions → auto OpenAPI spec
- Mount at `v1.route('/machines', toolboxApp)`

### Phase 4: Register in proxy router + update SPEC.md
- Wire `/toolbox/*` into `ProxyRouter.ServeHTTP`
- Update SPEC.md §8 (Agent section) to reflect native toolbox
- Update SPEC.md §17 to REMOVE "No agent toolbox API built-in" (we now have it!)

---

## 9. File Structure (what gets created/modified)

```
daemon/
├── fs.go          ← NEW: Filesystem API handlers (~400 lines)
├── exec.go        ← NEW: Process/Exec API handlers (~300 lines)
├── proxy.go       ← MODIFY: Add /toolbox/* routing
├── api.go         ← No changes (internal :7777 API stays separate)
├── main.go        ← No changes
└── ...

src/server/
├── routes/v1/
│   ├── toolbox.ts ← NEW: Hono routes wrapping daemon toolbox (~200 lines)
│   └── index.ts   ← MODIFY: mount toolboxApp
├── app.ts         ← MODIFY: add Filesystem + Process tags to OpenAPI
└── ...

SPEC.md            ← MODIFY: update §8, §17
```

---

## 10. What We're NOT Building (Scope Control)

- ❌ **Named PTY sessions** — v2. Current `/_pty` WebSocket is sufficient.
- ❌ **File watching (WebSocket)** — v2. `watchDir` is nice but not essential.
- ❌ **Git operations** — Daytona has this; for us it's just `exec("git ...")`.
- ❌ **Language Server Protocol** — Too complex, agents bring their own.
- ❌ **Computer Use (VNC/screenshots)** — Separate concern, sandbox-agent territory.
- ❌ **Code interpreter (stateful REPL)** — Daytona feature, not essential for v1.
- ❌ **Process sessions (Daytona-style)** — Too complex for v1. Our exec endpoint covers 95% of use cases.

---

## 11. Success Criteria

- [ ] All 13 filesystem endpoints work on the daemon
- [ ] All 6 process endpoints work on the daemon
- [ ] Core API wrapper proxies all endpoints with auth
- [ ] OpenAPI spec includes all toolbox endpoints at `/api/docs`
- [ ] Scalar API docs render the toolbox section beautifully
- [ ] `curl` examples work end-to-end through the proxy
- [ ] Existing daemon functionality (PTY, health, heartbeat, port proxy) unaffected
- [ ] `go test` passes for the daemon
