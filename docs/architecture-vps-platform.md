# JustAVPS Platform Architecture — Images, Cloud-Init & Daemon

## One-Liner

Every VPS boots from an **image** (default: Ubuntu), cloud-init makes it managed, and users can capture their running machine as a new image.

---

## Concepts

| Term | What it is |
|---|---|
| **Image** | A bootable disk. Either Hetzner's `ubuntu-24.04` or a user-created capture of a running machine. Hetzner calls these "snapshots" internally — we call them **images**. |
| **Default image** | `ubuntu-24.04`. Every user gets this. No pre-building needed. |
| **Cloud-init** | Script that runs on every boot. Installs platform software (if missing), configures identity, starts services. This is invisible to users. |
| **justavps-daemon** | Go binary. The on-machine agent. Heartbeats, health, local API. What makes a VPS "managed." |
| **Sandbox Agent** | Rust binary by Rivet. Universal coding agent API — controls Claude Code, Codex, OpenCode, Amp over HTTP/SSE. Runs on port 2468. Includes session management, process control, file system API, terminal WebSocket, and built-in Inspector UI at `/agent/ui/`. |

---

## Boot Flow

```
User creates machine
  │
  ├── image_id: null  → Hetzner boots from ubuntu-24.04
  │                      Cloud-init installs everything (~5 min)
  │
  └── image_id: "uuid" → Hetzner boots from user's captured image
                          Cloud-init skips installs, just configures (~30 sec)
```

### Cloud-Init (runs on EVERY boot)

```bash
#!/bin/bash
set -e

# ── Phase 1: Install (skip if already on disk) ────────────────────
if ! command -v code-server >/dev/null 2>&1; then
  # Docker, Node.js, code-server, Caddy, dev tools
  # Sandbox Agent (+ pre-install all coding agents)
  # justavps-daemon (download Go binary)
  # Create 'user' account
  # Write systemd service files
fi

# ── Phase 2: Configure (ALWAYS) ──────────────────────────────────
# SSH keys
# Machine config → /etc/justavps/config.json
# Env vars → /etc/justavps/env
# Caddy config (slug.proxy-domain with sub-routes)
# code-server password

# ── Phase 3: Start services ──────────────────────────────────────
systemctl enable --now justavps-daemon
systemctl enable --now code-server
systemctl enable --now sandbox-agent
systemctl enable --now caddy

# ── Phase 4: Docker workload (optional) ──────────────────────────
if [ -n "$DOCKER_IMAGE" ]; then
  docker pull $DOCKER_IMAGE  # skips if cached
  docker run ... $DOCKER_IMAGE $ENTRYPOINT
fi
```

---

## Images

### What they are

A point-in-time capture of a running machine's disk. Contains everything — installed packages, configs, Docker images, user data.

### How they work

1. User has a running machine with stuff installed
2. User clicks **"Create Image"** → platform calls Hetzner `POST /servers/{id}/actions/create_image`
3. Hetzner snapshots the disk (~2-3 min)
4. Image appears in user's image list as `ready`
5. User can boot new machines from this image
6. Cloud-init runs on boot → writes new identity (slug, token, SSH keys) on the existing disk

### API

```
POST   /machines/:id/image    Create image from running machine
  Body: { "name": "my-dev-env" }
  Returns: { "id": "uuid", "name": "...", "status": "creating", ... }

GET    /images                 List user's images
GET    /images/:id             Get image details
DELETE /images/:id             Delete image (removes from Hetzner too)
```

### Database Schema

```sql
CREATE TABLE images (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID REFERENCES users(id) NOT NULL,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'creating',
                        -- creating | ready | failed | deleted
  source_machine_id     UUID REFERENCES machines(id),
  provider              TEXT NOT NULL DEFAULT 'hetzner',
  provider_image_id     TEXT,          -- Hetzner snapshot/image ID
  disk_size_gb          INTEGER,
  architecture          TEXT DEFAULT 'x86',
  created_at            TIMESTAMP DEFAULT now() NOT NULL,
  updated_at            TIMESTAMP DEFAULT now() NOT NULL
);
```

---

## Machine Creation

```
POST /api/v1/machines
{
  "provider": "hetzner",
  "server_type": "cpx22",
  "region": "nbg1",
  "name": "my-machine",           // optional
  "image_id": null,                // null = Ubuntu (default). UUID = user image.
  "env_vars": { "MY_KEY": "val" }      // optional
}
```

- `image_id: null` → boot from `ubuntu-24.04`
- `image_id: "uuid"` → boot from user's image
### Machines Table Changes

```sql
-- RENAME:
  snapshot_id  →  image_id    -- references images(id), NULLABLE
```

---

## justavps-daemon (Go Binary)

### What it does

| Feature | Detail |
|---|---|
| **Heartbeat** | POST to platform every 30s: CPU, memory, disk, services |
| **Stage reporting** | Cloud-init calls daemon to report provisioning progress |
| **Health** | Monitors Docker, code-server, Caddy, Sandbox Agent, OpenCode. |
| **Local API** | `:7777` — platform queries status, triggers restarts |
| **Identity** | Reads `/etc/justavps/config.json`, authenticates with `machine_token` |

### API (port 7777)

```
GET  /health                → { "status": "ok", "uptime": 86400 }
GET  /services              → { "code-server": "running", ... }
POST /services/:name/restart
GET  /info                  → { "slug": "...", "ip": "...", "server_type": "..." }
```

### Install

Cloud-init downloads the binary on first boot:

```bash
curl -fsSL -o /usr/local/bin/justavps-daemon \
  https://github.com/heyagi/justavps-daemon/releases/latest/download/justavps-daemon-linux-amd64
chmod +x /usr/local/bin/justavps-daemon
```

---

## What Changes from Current Code

### Remove entirely

- `scripts/build-default-snapshot.ts` — no pre-built snapshots
- Snapshot builder system (`buildSnapshot`, `buildBuilderUserData`, builder server polling)
- `DEFAULT_HETZNER_SNAPSHOT_ID` config
- `isDefault`, `buildLogs`, `providerData` columns on snapshots
- Old `src/server/lib/hetzner.ts` — already deleted

### Rename

- `snapshots` table → `images` table
- `snapshot_id` on machines → `image_id`
- All route paths: `/snapshots` → `/images`
- All frontend references
- All types: `Snapshot` → `Image`, `SnapshotStatus` → `ImageStatus`
- All hooks: `useSnapshots` → `useImages`

### Add

- `POST /machines/:id/image` endpoint
- `provider_image_id`, `source_machine_id`, `disk_size_gb` columns on images table
- `daemon/` Go project (later — placeholder binary for now)
- Smart cloud-init with install detection

### Simplify

- Cloud-init: single script, smart install detection
- Image routes: just list/get/delete (no builder)
- Machine creation: `image_id` optional (null = Ubuntu)

---

## Sandbox Agent (Rivet)

### What it is

A Rust binary by [Rivet](https://rivet.dev) that provides a universal HTTP API for controlling coding agents (Claude Code, Codex, OpenCode, Amp, Pi) inside sandboxes. We ship it as part of every JustAVPS machine.

### What it provides

| Feature | Detail |
|---|---|
| **Coding Agent Sessions** | Create sessions, send prompts, stream events via SSE. One API for all agents. |
| **Process Management** | Run commands, spawn long-lived processes, stream logs, PTY terminals via WebSocket |
| **File System** | Read/write/list/move/delete files over HTTP |
| **Desktop** | Virtual Xvfb desktop with screenshots, mouse/keyboard, recordings, WebRTC streaming |
| **Inspector UI** | Built-in debug UI at `/agent/ui/` for inspecting sessions and events |
| **Session Persistence** | Event history, session resume, audit trail |

### Port & Routing

- Sandbox Agent listens on `:2468` internally
- Caddy proxies it at `https://{slug}.{domain}/agent/*`
- Inspector UI at `https://{slug}.{domain}/agent/ui/`

### Supported Agents

| Agent | ID | Requires |
|---|---|---|
| Claude Code | `claude` | `ANTHROPIC_API_KEY` |
| Codex | `codex` | `OPENAI_API_KEY` |
| OpenCode | `opencode` | Provider API key |
| Amp | `amp` | Provider API key |
| Pi | `pi` | Provider API key |

API keys are passed via the machine's env vars (`/etc/justavps/env`).

---

## Service Port Map

| Service | Port | Caddy Route | Description |
|---|---|---|---|
| code-server | 8080 | `/` (default) | VS Code web IDE |
| Sandbox Agent | 2468 | `/agent/*` | Coding agent API + Inspector |
| OpenCode Web | 3456 | `/opencode/*` | OpenCode web UI |
| justavps-daemon | 7777 | `/daemon/*` | Platform agent (heartbeat, health) |
| Docker workload | 8000+ | — | User's container (if configured) |

---

## Implementation Order

1. ~~**Rename snapshots → images**~~ ✅
2. ~~**Rewrite cloud-init**~~ ✅
3. ~~**Add `POST /machines/:id/image`**~~ ✅
4. ~~**Update machine creation**~~ ✅
5. ~~**Update frontend**~~ ✅
6. ~~**Build justavps-daemon**~~ ✅
7. ~~**Integrate Sandbox Agent**~~ ✅
