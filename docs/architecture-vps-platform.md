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
  # justavps-daemon (download Go binary)
  # Create 'user' account
  # Write systemd service files
fi

# ── Phase 2: Configure (ALWAYS) ──────────────────────────────────
# SSH keys
# Machine config → /etc/justavps/config.json
# Env vars → /etc/justavps/env
# Caddy config (slug.proxy-domain)
# code-server password

# ── Phase 3: Start services ──────────────────────────────────────
systemctl enable --now justavps-daemon
systemctl enable --now code-server
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
  "docker_image": "nginx:latest",  // optional — pulled & run at boot
  "entrypoint": "sleep infinity",  // optional — container CMD override
  "env_vars": { "MY_KEY": "val" }  // optional
}
```

- `image_id: null` → boot from `ubuntu-24.04`
- `image_id: "uuid"` → boot from user's image
- `docker_image` → pulled at boot, run as systemd-managed container
- `entrypoint` → CMD override. Null = image default. `"sleep infinity"` = keep alive.

### Machines Table Changes

```sql
-- ADD these columns to machines:
  docker_image    TEXT,       -- e.g. "nginx:latest"
  entrypoint      TEXT,       -- e.g. "sleep infinity"

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
| **Health** | Monitors Docker, code-server, Caddy. Self-heals if possible. |
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
- `isDefault`, `dockerImage`, `entrypoint`, `buildLogs`, `providerData` columns on snapshots
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
- `docker_image`, `entrypoint` columns on machines table
- `provider_image_id`, `source_machine_id`, `disk_size_gb` columns on images table
- `daemon/` Go project (later — placeholder binary for now)
- Smart cloud-init with install detection

### Simplify

- Cloud-init: single script, smart install detection
- Image routes: just list/get/delete (no builder)
- Machine creation: `image_id` optional (null = Ubuntu)

---

## Implementation Order

1. **Rename snapshots → images** (schema, types, routes, frontend, tests)
2. **Rewrite cloud-init** (smart install, daemon placeholder, docker workload)
3. **Add `POST /machines/:id/image`** (take image from running machine)
4. **Update machine creation** (image_id optional, docker_image + entrypoint)
5. **Update frontend** (images page, create image button on machine, wizard)
6. **Build justavps-daemon** (Go — separate step, can start with bash placeholder)
