# E2E Test Plan — JustAVPS Platform

## What Changed (This Session)

The entire snapshot system was refactored. "Snapshots" are now "Images." The architecture is fundamentally different. Here's what needs e2e coverage.

---

## Architecture Summary

- **Default boot = Ubuntu 24.04** — `image_id` is optional/nullable. When null, Hetzner boots from `ubuntu-24.04`.
- **Images = point-in-time captures** of running machines (not built from Docker images). Created via `POST /machines/:id/image`.
- **Docker images** are a machine-level concern — `docker_image` + optional `entrypoint` + optional `command` fields on machine creation. Pulled at boot via cloud-init.
- **Cloud-init** has smart install detection — installs everything on fresh Ubuntu, skips on image boots.
- **5 services per VPS**: code-server (:8080), Sandbox Agent (:2468), OpenCode (:3456), justavps-daemon (:7777), Caddy (:80/443 reverse proxy).
- **justavps-daemon** = Go binary. Heartbeats, health monitoring, local API on :7777.
- **Sandbox Agent** = Rust binary by Rivet. Universal coding agent API (Claude, Codex, OpenCode, Amp). Port 2468.

---

## API Endpoints to Test

### Auth
- `POST /api/auth/register` — creates user, NO default snapshot/image seeded anymore
- API keys use `sk_live_` prefix, bcrypt-hashed via `generateApiKey()` in `src/server/lib/crypto.ts`

### Images (`/api/v1/images`)

| Method | Path | Auth | Expected |
|---|---|---|---|
| `GET /images` | List user's images | Bearer API key | `200` with `{ images: [] }` for new users |
| `GET /images/:id` | Get image detail | Bearer API key | `200` with image object, or `404` |
| `DELETE /images/:id` | Delete image | Bearer API key | `204`, also deletes Hetzner snapshot |
| `DELETE /images/:nonexistent` | — | Bearer API key | `404` |

### Machines (`/api/v1/machines`)

| Method | Path | Auth | Expected |
|---|---|---|---|
| `POST /machines` | Create machine | Bearer API key | `202` with machine object |
| `POST /machines` (no `image_id`) | Ubuntu default boot | Bearer API key | `202`, `image_id: null` in response |
| `POST /machines` (with `docker_image` + `entrypoint` + `command`) | Docker workload | Bearer API key | `202`, fields stored in DB |
| `POST /machines` (with `image_id`) | Boot from user image | Bearer API key | `202`, uses image's `provider_image_id` |
| `GET /machines` | List machines | Bearer API key | `200` with `{ machines: [...] }` |
| `GET /machines/:id` | Get machine | Bearer API key | `200` with full machine object |
| `DELETE /machines/:id` | Delete machine | Bearer API key | Deletes Hetzner server + SSH keys |
| `POST /machines/:id/image` | Create image from machine | Bearer API key | `202` if machine is `ready`, `400` if not |

### Machine Creation Schema

```json
{
  "provider": "hetzner",        // required
  "server_type": "cpx22",      // required
  "region": "nbg1",            // required
  "name": "my-machine",        // optional
  "image_id": null,             // optional — null = Ubuntu 24.04
  "docker_image": "python:3.12-alpine", // optional
  "entrypoint": "python",               // optional
  "command": "-m http.server 8000",     // optional
  "env_vars": { "KEY": "val" }        // optional
}
```

### Image Response Schema

```json
{
  "id": "uuid",
  "name": "my-image",
  "status": "creating | ready | failed | deleted",
  "source_machine_id": "uuid | null",
  "provider": "hetzner",
  "provider_image_id": "12345678 | null",
  "disk_size_gb": 40,
  "architecture": "x86",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

### Unauthed Access
- All `/api/v1/*` endpoints without `Authorization` header → `401`

---

## DB Schema (Key Tables)

### `images` (renamed from `snapshots`)
- `id`, `owner_id`, `name`, `status`, `source_machine_id`, `provider`, `provider_image_id`, `disk_size_gb`, `architecture`, `created_at`, `updated_at`
- No more: `docker_image`, `entrypoint`, `is_default`, `provider_data`, `build_logs`

### `machines`
- `image_id` (renamed from `snapshot_id`) — nullable, no FK
- `docker_image` — new column, nullable
- `entrypoint` — new column, nullable
- `docker_command` — new column, nullable

---

## Cloud-Init Tests

File: `src/__tests__/lib/cloud-init.test.ts`

The cloud-init output should be verified for:

1. **Smart install detection** — contains `if ! command -v code-server` guard
2. **Platform installs inside guard** — Docker, Node.js, code-server, Caddy, Claude Code, OpenCode, Sandbox Agent
3. **Sandbox Agent install** — `curl -fsSL https://releases.rivet.dev/sandbox-agent/0.3.x/install.sh | sh` + `sandbox-agent install-agent --all`
4. **Sandbox Agent systemd service** — `sandbox-agent.service` on port 2468
5. **justavps-daemon download** — OUTSIDE install guard (always updates to latest)
6. **justavps-daemon systemd service** — port 7777
7. **SSH keys** — root + user accounts
8. **Platform config** — `/etc/justavps/config.json` with slug, callback_url, machine_token, proxy_domain
9. **Env vars** — base64-encoded to `/etc/justavps/env`
10. **Caddy config** — reverse proxy with sub-routes:
    - `/` → localhost:8080 (code-server)
    - `/agent/*` → localhost:2468 (Sandbox Agent)
    - `/opencode/*` → localhost:3456 (OpenCode)
    - `/daemon/*` → localhost:7777 (justavps-daemon)
11. **code-server config** — password, bind addr
12. **Docker workload** (when `dockerImage` specified) — docker run command, env-file, volume mount, entrypoint, command args
13. **No Docker block** when `dockerImage` not specified
14. **Service startup order** — justavps-daemon, code-server, sandbox-agent, caddy, opencode-web
15. **Stage callbacks** — `cloud_init_running`, `cloud_init_done`, `docker_pulling`, `docker_running`, `services_ready`

---

## Go Daemon Tests

Directory: `daemon/`
Run: `cd daemon && go test -v ./...`

Current tests (8 passing):
- `TestLoadConfig` — reads JSON config
- `TestLoadConfigMissingSlug` — rejects missing slug
- `TestLoadConfigMissingFile` — rejects missing file
- `TestAPIHealth` — GET /health → 200 with status, uptime, load
- `TestAPIInfo` — GET /info → 200 with slug, proxy_domain, daemon_version
- `TestAPIServices` — GET /services → 200 with service list (now includes `sandbox-agent`)
- `TestAPIServiceRestartForbidden` — POST /services/sshd/restart → 403
- `TestHeartbeatPayload` — heartbeat sends correct slug, token, load, services

---

## Caddy Routing Tests (if doing browser e2e)

Given a running machine at `{slug}.{domain}`:
- `GET /` → code-server login page (200)
- `GET /agent/v1/health` → Sandbox Agent health (200)
- `GET /agent/ui/` → Sandbox Agent Inspector UI (200)
- `GET /opencode/` → OpenCode Web UI (200 or redirect)
- `GET /daemon/health` → justavps-daemon health JSON (200)

---

## Files That Changed

### Deleted
- `src/server/lib/hetzner.ts` — old dead client
- `src/server/routes/v1/snapshots.ts` — replaced by `images.ts`
- `src/__tests__/lib/hetzner.test.ts` — tests for deleted client
- `scripts/build-default-snapshot.ts` — no more pre-built snapshots

### Created
- `src/server/routes/v1/images.ts` — image list/get/delete routes
- `src/hooks/use-images.ts` — frontend hook for images
- `daemon/` — entire Go daemon project (main.go, config.go, health.go, heartbeat.go, api.go, daemon_test.go, Makefile)
- `docs/architecture-vps-platform.md` — architecture spec

### Heavily Modified
- `src/server/db/schema.ts` — `snapshots` → `images` table, new columns
- `src/server/routes/v1/machines.ts` — `snapshot_id` → `image_id`, `POST /:id/image` endpoint, docker_image + entrypoint + command
- `src/server/lib/cloud-init.ts` — full rewrite (smart install, sandbox-agent, caddy routes)
- `src/server/lib/machine-lifecycle.ts` — added dockerImage + entrypoint + command to CreateMachineInput
- `src/server/lib/providers/hetzner.ts` — removed builder system, added `createImage()`
- `src/server/lib/providers/types.ts` — removed `buildSnapshot`, added `createImage`/`deleteImage`
- `src/lib/types.ts` — `Snapshot` → `Image`, new fields
- `src/lib/schemas.ts` — `snapshot_id` → `image_id`, added docker_image + entrypoint + command
- `src/app/(dashboard)/snapshots/page.tsx` — renamed/simplified
- `src/components/dashboard/create-machine-dialog.tsx` — image_id optional, docker fields
- `src/hooks/use-snapshots.ts` — kept for backward compat, delegates to use-images

### Test Files
- `src/__tests__/lib/cloud-init.test.ts` — needs updating for new cloud-init output
- `src/__tests__/routes/server-types.test.ts` — rewritten for provider system
- `src/__tests__/schemas.test.ts` — needs `image_id` instead of `snapshot_id`
