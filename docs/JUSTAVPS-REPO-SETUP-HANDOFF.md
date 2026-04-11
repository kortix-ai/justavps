# JustAVPS repository setup handoff

This is the **single setup document** for bringing `justavps.com` up somewhere else with enough context to:

- clone the repo
- configure env
- run local dev
- bootstrap bare-metal hosts
- deploy the Cloudflare proxy worker
- run real V2 E2E
- understand the current architecture and operational assumptions

This document is intentionally practical, not pretty.

---

## 1. What this repo is

JustAVPS is a control plane for persistent VPS/sandbox machines.

Today it is built around:

- **Next.js app** on port `4100`
- **Postgres** for control-plane state
- **Incus VMs** on dedicated bare-metal hosts
- **runnerd** on each host for machine lifecycle and warm pools
- **Cloudflare Worker + KV** for public proxy routing
- **broker** for Worker → host HTTP forwarding
- **machine daemon** inside guest VMs for heartbeat / readiness / telemetry

The current shape is:

- customer/API/control-plane logic lives in this repo
- actual VM execution happens on external bare-metal hosts
- hosts are grouped into **cells** (`region × host_class × generation`)
- scheduler is now **cell-aware**, reserve-aware, and maintenance-aware
- provisioning is durable via control-plane jobs, not just in-process `after(...)`

---

## 2. What you need before setup

### Accounts / external systems

You need access to all of these before the repo can be fully useful:

1. **Database**
   - Postgres (Neon or self-managed)

2. **Hetzner**
   - Cloud API token (`HETZNER_API_KEY`) for regular VM/image operations
   - Robot credentials (`HETZNER_ROBOT_USER`, `HETZNER_ROBOT_PASSWORD`) for dedicated server procurement

3. **Cloudflare**
   - global API key
   - account id
   - zone id
   - KV namespace for proxy worker
   - worker route on the proxy domain

4. **Stripe**
   - secret key
   - webhook secret

5. **Email provider**
   - currently Mailtrap

6. **GitHub OAuth** (optional but recommended)
   - for GitHub sign-in

7. **Kortix OAuth** (optional)
   - only if Kortix OAuth integration is desired

8. **ngrok** (local real-host E2E)
   - used so remote VMs can call back into your local app via `MACHINE_CALLBACK_URL`

---

## 3. Repository prerequisites

### Required local software

- Node.js 20+
- pnpm
- Docker / Docker Compose
- Python 3
- git
- ngrok (for local real-host E2E)
- Stripe CLI (if testing Stripe locally)
- Wrangler (for Cloudflare Worker deploys)

### Install

```bash
pnpm install
```

---

## 4. Canonical app `.env`

This is the **full canonical app env template** for the main Next/control-plane app.

**Important:** values below are placeholders on purpose. Replace with real values from your secret manager. Do **not** hand this doc to third parties with live secrets filled in.

Create:

```bash
cp .env.example .env
```

Then replace `.env` with something like this:

```dotenv
# -----------------------------------------------------------------------------
# JUSTAVPS APP ENV
# -----------------------------------------------------------------------------

# UI / public URLs
NEXT_PUBLIC_DEV_MODE=true
PLATFORM_URL=https://justavps.com
NEXT_PUBLIC_APP_URL=https://justavps.com
NEXT_PUBLIC_API_URL=https://justavps.com/api
NEXT_PUBLIC_PROXY_DOMAIN=kortix.cloud
PROXY_DOMAIN=kortix.cloud
LEGACY_PLATFORM_PROXY_ENABLED=false
NEXTAUTH_URL=https://justavps.com

# Database
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/justavps?sslmode=require
TEST_DATABASE_URL=postgresql://postgres:bench@127.0.0.1:18150/justavps?sslmode=disable
DB_SSL=true
DB_MAX_CONNECTIONS=5
DB_IDLE_TIMEOUT_SECONDS=20
DB_MAX_LIFETIME_SECONDS=1800
DB_APPLICATION_NAME=justavps-api

# Auth / session / proxy signing
AUTH_SECRET=REPLACE_WITH_32B_BASE64_OR_LONG_RANDOM_SECRET
PROXY_AUTH_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET_MATCHING_WORKER
DATA_ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARS_AES_256_GCM_KEY

# GitHub OAuth (optional but recommended)
GITHUB_CLIENT_ID=REPLACE_ME
GITHUB_CLIENT_SECRET=REPLACE_ME

# Hetzner cloud + dedicated
HETZNER_API_KEY=REPLACE_ME
HETZNER_DEFAULT_LOCATION=hel1
HETZNER_DEFAULT_SERVER_TYPE=cx22
HETZNER_BASE_SNAPSHOT_ID=
HETZNER_ROBOT_USER=REPLACE_ME
HETZNER_ROBOT_PASSWORD=REPLACE_ME

# Bare-metal bootstrap for provisioning new hosts
BAREMETAL_ENABLED=true
BAREMETAL_PURCHASE_APPROVAL_REQUIRED=true
BAREMETAL_BOOTSTRAP_PUBLIC_KEY=ssh-ed25519 AAAA... replace_me
BAREMETAL_BOOTSTRAP_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
REPLACE_ME
-----END OPENSSH PRIVATE KEY-----"

# Machine callback / daemon
MACHINE_CALLBACK_URL=https://justavps.com
DAEMON_CHANNEL=latest
DAEMON_DESIRED_VERSION=
DAEMON_DOWNLOAD_URL=
CONTROL_PLANE_RUNTIME_DISABLED=false

# Cloudflare
CLOUDFLARE_GLOBAL_API_KEY=REPLACE_ME
CLOUDFLARE_EMAIL=you@example.com
CLOUDFLARE_ZONE_ID=REPLACE_ME
CLOUDFLARE_ACCOUNT_ID=REPLACE_ME
CF_KV_NAMESPACE_ID=REPLACE_ME

# Broker / proxy plane
BROKER_HOST=broker.kortix-dev.cloud
BROKER_IPV4=
BROKER_IPV6=
BROKER_SHARED_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET

# Stripe
STRIPE_SECRET_KEY=sk_live_or_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me

# Mailtrap
MAILTRAP_API_TOKEN=REPLACE_ME
MAILTRAP_USE_SANDBOX=false
MAILTRAP_INBOX_ID=
MAILTRAP_SENDER_EMAIL=justavps@your-domain.com
MAILTRAP_SENDER_NAME=JustAVPS

# Optional docs/demo key exposure
JUSTAVPS_API_KEY=

# Kortix OAuth (optional)
KORTIX_OAUTH_CLIENT_ID=
KORTIX_OAUTH_CLIENT_SECRET=
KORTIX_OAUTH_BASE_URL=https://api.computer.kortix.com/v1/oauth
KORTIX_FRONTEND_URL=https://computer.kortix.com

# Local ngrok support (optional; usually written to .env.local instead)
NGROK_RESERVED_URL=
NGROK_URL=
NGROK_LOG_FILE=/tmp/justavps-ngrok-callback.log
NGROK_CONFIG_PATH=
NGROK_KILL_OTHER_LOCAL_AGENTS=1
```

### Notes on the app env

- `PROXY_AUTH_SECRET` must match the **Cloudflare Worker secret**.
- `BROKER_SHARED_SECRET` must match the **Worker secret** and the **broker**.
- `MACHINE_CALLBACK_URL` must be publicly reachable by remote VMs.
- for local real-host E2E, this is normally managed through `.env.local` by the ngrok helper script.

---

## 5. `.env.local` for local real-host E2E

Local development often needs a different callback URL than prod.

The repo already supports this via:

```bash
pnpm callback:ngrok
```

That writes a managed block into `.env.local` like:

```dotenv
# BEGIN JUSTAVPS_NGROK_CALLBACK
MACHINE_CALLBACK_URL=https://your-current-ngrok-subdomain.ngrok.app
NGROK_CALLBACK_URL=https://your-current-ngrok-subdomain.ngrok.app
NGROK_CALLBACK_MODE=ephemeral
# END JUSTAVPS_NGROK_CALLBACK
```

If you have a reserved ngrok domain:

```dotenv
NGROK_RESERVED_URL=https://justavps-callback.ngrok.app
```

---

## 6. Cloudflare Worker env / secrets

The Cloudflare proxy worker is **not** driven by the app `.env` alone. It also needs Wrangler config + secrets.

Current dev worker config lives at:

- `workers/proxy/wrangler.dev.toml`

You need:

### Wrangler vars

```toml
[vars]
ENVIRONMENT = "development"
PLATFORM_URL = "https://dev.justavps.com"
BROKER_ORIGIN = "https://your-broker-origin.example.com"
```

### Wrangler secrets

Set these with `wrangler secret put`:

```bash
pnpm exec wrangler secret put PROXY_AUTH_SECRET -c workers/proxy/wrangler.dev.toml
pnpm exec wrangler secret put BROKER_SHARED_SECRET -c workers/proxy/wrangler.dev.toml
```

These must match:

- app `PROXY_AUTH_SECRET`
- app `BROKER_SHARED_SECRET`
- broker secret validation

### Worker route

You also need a Worker route in the Cloudflare dashboard, e.g.:

- `*.kortix-dev.cloud/*` → dev worker
- `*.kortix.cloud/*` → prod worker

---

## 7. Host-side `/etc/justavps-runnerd.env`

Each bare-metal host runs `runnerd` and needs its own host env file.

Current bootstrap script writes at least:

```dotenv
RUNNERD_TOKEN=REPLACE_ME
RUNNERD_PORT=7779
RUNNERD_PUBLIC_IPV4=YOUR_HOST_PUBLIC_IPV4
```

In practice, you will usually also want:

```dotenv
RUNNERD_TOKEN=REPLACE_ME
RUNNERD_PORT=7779
RUNNERD_PUBLIC_IPV4=YOUR_HOST_PUBLIC_IPV4
RUNNERD_PUBLIC_IPV6=
INCUS_REMOTE=

# Warm pool
POOL_CPU_BUCKETS=1,2
WARM_POOL_PER_CPU=1
```

Notes:

- `POOL_CPU_BUCKETS` controls which exact CPU reserve buckets exist.
- `WARM_POOL_PER_CPU=1` means one reserve VM per bucket.
- current live tested setup uses `1,2` on both HEL1 hosts.

---

## 8. Recommended secret ownership map

Use one secret manager and store secrets by plane:

### App / control plane
- `DATABASE_URL`
- `AUTH_SECRET`
- `PROXY_AUTH_SECRET`
- `DATA_ENCRYPTION_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MAILTRAP_API_TOKEN`
- `HETZNER_API_KEY`
- `HETZNER_ROBOT_USER`
- `HETZNER_ROBOT_PASSWORD`
- `BAREMETAL_BOOTSTRAP_PRIVATE_KEY`
- `BAREMETAL_BOOTSTRAP_PUBLIC_KEY`
- `BROKER_SHARED_SECRET`
- `CLOUDFLARE_*`

### Worker
- `PROXY_AUTH_SECRET`
- `BROKER_SHARED_SECRET`

### Host / runnerd
- `RUNNERD_TOKEN`
- `RUNNERD_PUBLIC_IPV4`
- warm-pool settings

---

## 9. Fresh setup order

If you are standing this repo up somewhere else, do it in this order.

### Step 1 — clone and install

```bash
git clone <your-fork-or-repo-url>
cd justavps.com
pnpm install
```

### Step 2 — create env files

```bash
cp .env.example .env
```

Fill in `.env` using the template above.

### Step 3 — start Postgres and apply schema

For local dev:

```bash
docker compose up -d postgres
pnpm run db:push
pnpm run db:seed:templates
```

If you want the DB-backed Vitest integration suites to run automatically without manually overriding `DATABASE_URL`, set `TEST_DATABASE_URL` to a safe local test database. `src/__tests__/setup.ts` now uses `TEST_DATABASE_URL` when `DATABASE_URL` is otherwise unset in the test process.

### Step 4 — start the app

```bash
pnpm dev
```

App should come up at:

- `http://localhost:4100`

Health check:

```bash
curl http://localhost:4100/api/health
```

Readiness check:

```bash
curl http://localhost:4100/api/readyz
```

`/api/health` now returns shallow process + DB + control-plane summary.

`/api/readyz` now returns `200` only when:

- database is reachable
- critical control-plane services are not stale beyond the readiness freshness threshold

### Step 4b — optional dedicated control-plane worker

If you want the control-plane runtime separated from the web process, run:

```bash
CONTROL_PLANE_RUNTIME_DISABLED=true pnpm dev
```

in the web process, and separately:

```bash
pnpm control-plane:worker
```

This worker starts the background:

- provisioner loop
- routing repair loop
- watchdog loop
- fleet auditor loop

The web app can still run with the runtime embedded by leaving `CONTROL_PLANE_RUNTIME_DISABLED=false`, but a dedicated worker is the cleaner production shape.

### Step 5 — if using local real-host E2E, start callback tunnel

```bash
pnpm callback:ngrok
```

Or:

```bash
pnpm dev:ngrok
```

### Step 6 — deploy Cloudflare Worker

```bash
cd workers/proxy
pnpm exec wrangler deploy -c wrangler.dev.toml
```

Then set the Worker route in Cloudflare.

### Step 7 — bootstrap a new bare-metal host

After procuring a host through the admin API, bootstrap it:

```bash
BOOTSTRAP_KEY_PATH=/tmp/justavps-bm-bootstrap \
bash scripts/bootstrap-baremetal-host.sh <HOST_ID> <HOST_IPV4> <ADMIN_API_KEY>
```

This installs:

- Incus
- runnerd
- backup timer/service
- systemd units

---

## 10. Local dev flows

### Core dev

```bash
pnpm dev
```

### Dev with Postgres + Stripe helper

```bash
pnpm dev:all
```

### Runnerd build

```bash
pnpm runnerd:build
```

### Dedicated control-plane worker

```bash
pnpm control-plane:worker
```

### DB push

```bash
pnpm run db:push
```

### Seed template images

```bash
pnpm run db:seed:templates
```

---

## 11. Real E2E commands

These are the important current E2E entry points:

### Bare-metal lifecycle E2E

```bash
pnpm e2e:v2:baremetal
```

### Runtime E2E

```bash
pnpm e2e:v2:runtime
```

### Cold benchmark

```bash
pnpm e2e:v2:cold
```

### Pin to a specific host

```bash
E2E_BAREMETAL_HOST_ID=<host-uuid> \
E2E_BAREMETAL_HOST_IP=<host-ip> \
E2E_MACHINE_VCPU=2 \
E2E_MACHINE_RAM_GB=4 \
E2E_MACHINE_DISK_GB=80 \
pnpm e2e:v2:runtime
```

Optional overrides supported in runtime/baremetal/cold flows:

```dotenv
BASE_URL=http://localhost:4100
E2E_BAREMETAL_HOST_ID=
E2E_BAREMETAL_HOST_IP=
E2E_IMAGE_ID=
E2E_MACHINE_VCPU=2
E2E_MACHINE_RAM_GB=4
E2E_MACHINE_DISK_GB=80
E2E_BAREMETAL_SSH_KEY=/path/to/host/key
```

---

## 12. V2 admin/fleet surface

Important URLs:

- app: `http://localhost:4100`
- V2 machines UI: `http://localhost:4100/v2/machines`
- V2 docs: `http://localhost:4100/api/docs/v2`
- V2 admin machines: `http://localhost:4100/v2/admin/machines`
- V2 admin fleet: `http://localhost:4100/v2/admin/fleet`

Important admin API routes now live under **V2**:

- `GET /api/v2/admin/fleet/hosts`
- `POST /api/v2/admin/fleet/hosts/reconcile`
- `POST /api/v2/admin/fleet/hosts/:id/cleanup-orphans`
- `GET /api/v2/admin/fleet/control-plane/services`
- `POST /api/v2/admin/fleet/control-plane/run`
- `GET /api/v2/admin/fleet/cell-capacity-snapshots`
- `POST /api/v2/admin/fleet/hosts/:id/maintenance-state`
- `GET /api/v2/admin/fleet/hosts/:id/bootstrap-config`
- `POST /api/v2/admin/fleet/hosts/:id/register`
- `GET /api/v2/admin/fleet/procurements`
- `POST /api/v2/admin/fleet/procurements`
- `POST /api/v2/admin/fleet/procurements/:id/approve`
- `POST /api/v2/admin/fleet/procurements/:id/sync`
- `GET /api/v2/admin/fleet/procurement-recommendations`
- `POST /api/v2/admin/fleet/cells/:id/admission-state`
- `POST /api/v2/admin/fleet/cells/:id/reserve-policy`

---

## 13. Current production-shape assumptions

These are important because if you stand this up elsewhere and violate them, weird things happen.

### 1. Hosts are pinned failure domains

- machines are pinned to one host
- there is no default live migration promise
- cleanup/reconcile/drain flows assume host-local execution

### 2. Warm pools are host-local

- warm reserves are not global
- each host owns its own reserve VMs
- current real tested setup: `POOL_CPU_BUCKETS=1,2`, `WARM_POOL_PER_CPU=1`

### 3. Proxy routing depends on multiple aligned secrets/configs

These must agree:

- app `PROXY_AUTH_SECRET`
- Worker `PROXY_AUTH_SECRET`
- app `BROKER_SHARED_SECRET`
- Worker `BROKER_SHARED_SECRET`
- broker `BROKER_SHARED_SECRET`

If they drift, tokenized/public proxy URLs break.

### 4. `MACHINE_CALLBACK_URL` must be internet-reachable

For remote host/VPS create flows, `localhost` will not work.

### 5. DB connection count matters in local dev

This repo now uses a process-global singleton plus explicit pool sizing because repeated `next dev` hot reloads were exhausting low-connection Postgres targets.

If local DB still complains about `too many clients already`, restart the app and/or DB and verify `DB_MAX_CONNECTIONS` is set conservatively.

---

## 14. Known operator commands

### Clean non-warm orphan instances off a host

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:4100/api/v2/admin/fleet/hosts/<HOST_ID>/cleanup-orphans
```

### Run one operator control-plane maintenance pass

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:4100/api/v2/admin/fleet/control-plane/run
```

Run only selected services:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"services":["auth_cache"]}' \
  http://localhost:4100/api/v2/admin/fleet/control-plane/run
```

Clear a wedged service lease:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service":"auth_cache","scope":"api_keys"}' \
  http://localhost:4100/api/v2/admin/fleet/control-plane/reset-lease
```

### Inspect control-plane service state

```bash
curl \
  -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:4100/api/v2/admin/fleet/control-plane/services
```

Each service row now includes:

- `critical` — whether readiness should care about it
- `mode` — `periodic` vs `event_driven`
- `stale` — operator-facing freshness judgment

Current critical periodic services include:

- `provisioner`
- `webhook_dispatcher`
- `routing`
- `watchdog`
- `fleet_auditor`
- `telemetry`
- `auth_cache`

### Inspect recent cell capacity history

```bash
curl \
  -H "Authorization: Bearer $ADMIN_KEY" \
  "http://localhost:4100/api/v2/admin/fleet/cell-capacity-snapshots?limit=20"
```

### Important versioning note

The old operator trigger endpoint `GET /api/v1/internal/watchdog` is no longer part of the control-plane surface.

Current rule:

- `v1/internal` = machine/daemon callbacks only (`heartbeat`, `stage`, etc.)
- `v2/admin/fleet/*` = operator control-plane actions and inspection

### Reconcile fleet state

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:4100/api/v2/admin/fleet/hosts/reconcile
```

### Mark host maintenance state

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state":"drain_requested"}' \
  http://localhost:4100/api/v2/admin/fleet/hosts/<HOST_ID>/maintenance-state
```

### Update cell admission state

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"admission_state":"restricted","sellability_state":"reserve_only","reason":"Holding reserve"}' \
  http://localhost:4100/api/v2/admin/fleet/cells/<CELL_ID>/admission-state
```

### Update cell reserve policy

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "warm_reserve":{"vcpu":1,"memory_gb":2,"disk_gb":20},
    "failure_reserve":{"vcpu":2,"memory_gb":4,"disk_gb":40},
    "procurement_reserve":{"vcpu":0,"memory_gb":0,"disk_gb":0}
  }' \
  http://localhost:4100/api/v2/admin/fleet/cells/<CELL_ID>/reserve-policy
```

---

## 15. Recommended setup checklist for “new environment”

Use this exact sequence.

### Base control plane
- [ ] clone repo
- [ ] install pnpm deps
- [ ] create `.env`
- [ ] confirm `DATABASE_URL`
- [ ] run Postgres
- [ ] `pnpm run db:push`
- [ ] `pnpm run db:seed:templates`
- [ ] `pnpm dev`
- [ ] health check passes

### Access plane
- [ ] deploy proxy worker
- [ ] set Worker secrets
- [ ] set Worker route
- [ ] confirm KV namespace exists
- [ ] confirm broker reachable

### Bare-metal plane
- [ ] Hetzner cloud + Robot credentials valid
- [ ] bootstrap SSH key generated
- [ ] buy/provision host
- [ ] bootstrap host with `bootstrap-baremetal-host.sh`
- [ ] host registers in `/api/v2/admin/fleet/hosts`
- [ ] runner health reachable on `:7779`

### Warm pool
- [ ] set host `/etc/justavps-runnerd.env`
- [ ] choose `POOL_CPU_BUCKETS`
- [ ] choose `WARM_POOL_PER_CPU`
- [ ] confirm `ready/target` in `/healthz`

### Real runtime E2E
- [ ] `pnpm callback:ngrok` if local
- [ ] run `pnpm e2e:v2:runtime`
- [ ] verify create → ready → SSH → proxy → terminal

---

## 16. Current operational gotchas you should know before handoff

These are all things discovered in real implementation and E2E:

1. **Warm-pool instances are not customer machines**
   - fleet reporting must separate warm reserves from real orphans
   - reserve VMs are now marked with `user.justavps.role=warm_pool_reserve`
   - claimed machines flip to `user.justavps.role=machine`
   - do not assume the `justavps-warm-*` prefix alone is the source of truth anymore

2. **Legacy port metadata vs explicit port allocations**
   - the system is now moving toward `machine_port_allocations` as source of truth
   - during transition, allocator must account for legacy `providerMeta.ssh_port/http_port`

3. **Reconcile is safety net, not normal placement truth**
   - placement now has reservations
   - reconcile should clean / audit, not paper over normal correctness gaps

4. **Golden image quality matters enormously**
   - broken daemon binary or bootloader tweaks can make the whole fast path flaky

5. **DB connection caps matter in local dev**
   - especially under `next dev`

6. **Cloudflare Worker / broker / app secret drift is fatal**
   - keep those in one secret inventory

7. **Capacity blocks now return structured 409s**
   - if reserve policy or admission state makes a request unschedulable, the API returns `409`
   - response includes `details.placement_decision.explanation[]`
   - use that instead of treating it like a generic server error

8. **API key deletion now removes the Worker KV entry too**
   - deleting an API key from `/api/v1/api-keys/:id` now removes `apikey:<sha256>` from Cloudflare KV
   - previously the DB row disappeared but the Worker-side KV entry could linger

9. **The old direct platform proxy is feature-flagged now**
   - `/api/v1/machines/:machineId/proxy/:port/*` is deprecated and should be phased out
   - `LEGACY_PLATFORM_PROXY_ENABLED` now defaults to `false`
   - only set it to `true` as a temporary rollback if you explicitly need the legacy path

---

## 17. Final recommendation for handoff

If you are giving this to another engineer/team, give them:

1. this document
2. the repo
3. the real secret values in a secret manager, **not embedded into this markdown**
4. access to:
   - Postgres
   - Hetzner
   - Cloudflare
   - Stripe
   - Mailtrap
   - ngrok (if doing local real-host E2E)

If they follow this document in order, they should be able to bring the repo up and understand the current production-shape system.

---

## 18. Short version

If you only remember one flow, it is this:

```bash
cp .env.example .env
# fill secrets

docker compose up -d postgres
pnpm install
pnpm run db:push
pnpm run db:seed:templates
pnpm callback:ngrok   # if local real-host E2E
pnpm dev

# deploy worker separately
# bootstrap hosts separately

pnpm e2e:v2:runtime
pnpm e2e:v2:baremetal
pnpm e2e:v2:cold
```

And for hosts:

```bash
BOOTSTRAP_KEY_PATH=/tmp/justavps-bm-bootstrap \
bash scripts/bootstrap-baremetal-host.sh <HOST_ID> <HOST_IPV4> <ADMIN_API_KEY>
```

That is the shortest route from zero to a real JustAVPS environment.
