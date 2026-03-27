# JustAVPS — Current Product Specification

> Last updated: March 22, 2026
> Status: Live codebase; this spec describes the system as currently implemented.

---

## 0. Purpose of This Document

This file replaces the old pre-build product vision doc.

It is intentionally grounded in the current repository and running architecture, not the earlier idealized plan. If a capability is only partially implemented, environment-dependent, deprecated, or still aspirational, this spec says so explicitly.

---

## 1. What JustAVPS Is Today

JustAVPS is a hosted persistent-compute product built on Hetzner that gives users a real Linux machine with:

- authenticated browser access through a Cloudflare proxy domain
- SSH access with generated or user-supplied keys
- an in-browser terminal
- API-managed machine lifecycle
- API-managed file and process operations through a machine toolbox
- images/snapshots, billing, webhooks, proxy tokens, and account controls

The product is built for two overlapping use cases:

1. personal cloud dev machines / agent boxes
2. programmatic sandboxes and persistent infrastructure for agent platforms, including Kortix-linked workflows

The core positioning is still accurate: **persistent agent compute with better DX than a raw VPS**.

---

## 2. Current Product Surface

### User-facing web app

The Next.js app currently includes:

- marketing homepage at `/`
- login and registration flows
- dashboard pages for machines, machine detail, images, keys, webhooks, billing, settings, docs, brand, and admin routing
- checkout success / guest checkout flows
- API docs UI served from the same app

### Public API

The primary API lives at:

```text
https://justavps.com/api/v1
```

It is implemented with Hono and `@hono/zod-openapi`, and the OpenAPI docs are served from:

```text
/api/docs
/api/docs/openapi.json
```

### Machine proxy

Machine traffic is exposed through Cloudflare-managed proxy domains, currently configured from `PROXY_DOMAIN` and defaulting to:

```text
kortix.cloud
```

Production and dev proxy hostnames supported in code:

```text
{slug}.kortix.cloud
{port}--{slug}.kortix.cloud

{slug}.kortix-dev.cloud
{port}--{slug}.kortix-dev.cloud
```

---

## 3. High-Level Architecture

## 3.1 Control plane

The control plane is the Next.js + Hono application. It handles:

- auth and sessions
- machine CRUD
- image CRUD
- SSH keys
- API keys
- proxy tokens
- billing and Stripe webhooks
- webhook subscriptions
- SSE status streaming
- Kortix OAuth link/import endpoints
- internal machine callbacks

### 3.2 Data plane

The data plane has three major parts:

1. **Hetzner** for VM provisioning
2. **Cloudflare Worker + KV** for authenticated machine access
3. **Machine-side daemon** for local proxying, PTY, health, files, and process execution

### 3.3 Important implementation shift

The original spec described a multi-service machine architecture centered around Caddy, code-server, and a separate `justavps-agent`.

That is no longer the primary implementation.

**Current reality:** the machine-side runtime is built around a single Go binary, `justavps-daemon`, which acts as the main HTTP front door and internal control surface.

There are still legacy references to code-server / caddy / justavps-agent in older comments, env names, and docs, but the actual machine runtime has moved to the daemon-centric model.

---

## 4. Machine Runtime (Current)

Every standard machine is expected to run `justavps-daemon`.

### 4.1 Public daemon port

`justavps-daemon` listens publicly on `:80` and routes traffic as follows:

- `/_terminal` → standalone browser terminal page
- `/_pty` → in-process PTY WebSocket
- `/toolbox/files/*` → in-process filesystem API
- `/toolbox/process/*` → in-process process/exec API
- `/_port/{port}/...` → dynamic localhost port forwarding
- `/agent/*` → reverse proxy to local sandbox agent on `127.0.0.1:2468`
- `/daemon/*` → reverse proxy to internal daemon API on `127.0.0.1:7777`
- all other paths → reverse proxy to local OpenCode on `127.0.0.1:3456`

Additionally, if the first path segment is a bare port number, the daemon treats it as forwarded port traffic.

### 4.2 Internal daemon API

The daemon also exposes an internal API bound to `127.0.0.1:7777` with at least:

- `GET /health`
- `GET /services`
- `POST /services/{name}/restart`
- `GET /info`

This API is also reachable externally through the public daemon path prefix `/daemon/*` when proxied.

### 4.3 Toolbox on the machine

The daemon includes toolbox handlers for:

- file listing, info, existence checks, downloads, uploads
- bulk upload / bulk download
- create folder, delete, move, replace text, chmod/chown
- command execution
- streaming command execution over SSE
- code snippet execution
- process listing and killing

This means JustAVPS currently supports both machine access and a machine-resident automation/toolbox API.

### 4.4 PTY / terminal

The daemon implements the PTY server directly and also serves a terminal UI page.

Current public PTY path:

```text
/_pty
```

### 4.5 OpenCode assumption

The current runtime assumes OpenCode is available locally on port `3456` for the default machine root experience. The daemon forwards unmatched traffic there.

This is the current default UX, replacing the older code-server-first plan.

---

## 5. Provisioning Model

Machines are created through the API and backed by the Hetzner provider implementation currently named `cloud`.

### 5.1 Provider reality

There is currently one real compute provider in code:

- `cloud` → Hetzner-backed provider

The product is architected provider-agnostically at the API and DB level, but multi-provider support is not implemented.

### 5.2 Snapshot / image model

The product still relies heavily on prebuilt images.

Key current facts:

- `HETZNER_BASE_SNAPSHOT_ID` is supported and intended for fast provisioning
- default machine creation tries to boot from a ready public template image in the DB
- the canonical default template name is `justavps standard`
- a special `Kortix` template name also exists in the image catalog
- if no configured default template exists, machine creation can fail with `No default template image is configured`

So the current system is **not** a pure from-scratch Ubuntu install flow. It expects template images to be seeded and available.

### 5.3 Cloud-init behavior

Cloud-init currently does machine-specific bootstrapping. It:

- creates the `user` account
- installs SSH authorized keys for `root` and `user`
- disables password auth for SSH
- writes `/etc/justavps/config.json`
- writes `/etc/justavps/env`
- downloads or updates `justavps-daemon`
- disables Caddy if present
- configures UFW rules
- installs / configures fail2ban
- reports provisioning stages back to the platform

This is more accurate than the old spec's rigid snapshot-only / code-server / caddy orchestration story.

### 5.4 Reserved

_(Docker workload mode was removed. Container orchestration is no longer part of machine creation.)_

### 5.5 Provisioning stages

The database tracks provisioning progress with stages such as:

- `server_creating`
- `server_created`
- `cloud_init_running`
- `cloud_init_done`
- `docker_pulling`
- `docker_running`
- `services_starting`
- `services_ready`

Machines become `ready` through callbacks / heartbeat flow, not just blind provider polling.

---

## 6. Network and Access Model

## 6.1 Public access pattern

The intended public access model is:

- users access machines through Cloudflare proxy hostnames
- Cloudflare Worker authenticates the request
- Worker forwards to a shared broker origin
- broker dials the target machine IP and port

This is an important change from older direct-IP proxy designs.

### 6.2 Worker routing format

The worker currently supports:

- `{slug}.kortix.cloud`
- `{port}--{slug}.kortix.cloud`
- legacy dotted two-level `port.slug.domain` parsing in code
- path-based `/_port/{port}/...` fallback

### 6.3 Worker auth methods

The Worker authenticates requests using, in order:

1. `X-Proxy-Token: pt_xxx`
2. `?__proxy_token=pt_xxx`
3. `__justavps_pt` cookie
4. `Authorization: Bearer sk_live_xxx`
5. `?token=<jwt>`
6. `__justavps_proxy` cookie

Auth is machine-scoped and ownership-aware.

### 6.4 Proxy tokens

Proxy tokens are a real, implemented feature.

They are:

- short-lived
- machine-scoped
- optionally port-scoped
- stored in DB and synced to Cloudflare KV
- usable as share links or headers

### 6.5 API keys

API keys are real, implemented, and support:

- account scope or machine scope
- permissions arrays, including `proxy`
- expiration
- KV sync for edge validation

### 6.6 Origin hostnames

The platform-side toolbox proxy uses DNS-only origin hostnames of the form:

```text
origin-{slug}.{PROXY_DOMAIN}
```

This is how the control plane reaches the machine daemon directly for toolbox requests.

---

## 7. Security Model (Current)

### 7.1 Hetzner firewall

The Hetzner provider creates / manages an external firewall.

Current managed firewall rules are narrower than the old spec and currently include:

- SSH on `22` from anywhere
- HTTP on `80` from Cloudflare IP ranges plus optional broker ingress IPs

This is what the code currently guarantees. The old spec's more extensive firewall claims around 443 / 7777 should not be treated as current truth unless re-verified in implementation.

### 7.2 UFW on the machine

Cloud-init also configures UFW on the box, default deny incoming, allow outgoing, allow SSH, and allow public HTTP ingress according to configured proxy/broker rules.

### 7.3 SSH security

Cloud-init explicitly:

- removes / locks root password
- disables SSH password auth
- sets `PermitRootLogin prohibit-password`
- relies on authorized SSH keys

### 7.4 fail2ban

Machines attempt to install and enable fail2ban for SSH brute-force protection.

### 7.5 Heartbeat tamper detection

The platform records machine-reported security status in heartbeat payloads, including:

- whether UFW is active
- whether fail2ban is active
- whether SSH is key-only

The internal heartbeat handler emits alerts if these protections appear to be disabled.

### 7.6 Network anomaly detection

The platform watchdog and heartbeat pipeline also watch for:

- unusually high inbound/outbound traffic
- excessive connection counts
- stale heartbeats

This is a real implementation detail, not just a future idea.

---

## 8. Auth and User Accounts

Current auth is implemented with NextAuth.

### Supported auth methods

- credentials (email + password)
- optional GitHub OAuth, enabled only when GitHub credentials are configured

### User model

Users currently have:

- email
- optional password hash
- optional GitHub ID
- optional display name
- Stripe customer ID
- admin flag

There is also logic for auto-admin assignment based on email rules.

### Guest checkout / account creation

The product supports guest-style checkout flows where billing may happen before a standard account is fully completed. There is explicit support for later password setup on checkout-created accounts.

---

## 9. Billing and Commerce

Stripe billing is fully implemented in the current architecture.

### 9.1 Current billing model

- one machine maps to one Stripe subscription
- machine creation may either:
  - create the subscription immediately if a saved payment method exists, or
  - redirect to Stripe Checkout first if payment setup is required
- Stripe webhook completion provisions the machine for checkout-based flows

### 9.2 Billing intervals

The current code supports:

- `monthly`
- `yearly`
- `2year`

Current pricing logic:

- yearly = 20% off relative to monthly
- 2year = 30% off, billed annually in current Stripe implementation

### 9.3 Backups pricing

Automatic backups are supported and currently modeled as a 20% surcharge on top of monthly machine price.

### 9.4 Guest checkout

There is a guest checkout API path that lets a user start checkout with machine config before having a stored payment method.

### 9.5 Subscription lifecycle hooks

Stripe webhook handling currently covers at least:

- `checkout.session.completed`
- `invoice.payment_failed`
- `customer.subscription.deleted`
- `customer.subscription.updated`

The system also tracks processed Stripe events for idempotency.

---

## 10. Machines API Capabilities

The current machines API supports:

- create machine
- list machines
- get machine
- delete machine
- cancel machine subscription
- reactivate cancelled subscription
- reboot machine
- stop machine
- start machine
- resize machine
- create image from machine
- list backups
- create manual backup
- enable automatic backups
- disable automatic backups

Important current behavior:

- machine creation returns `202` when provisioning starts
- machine creation can return `402` with a checkout URL if payment is required
- machine serialization includes connect info, health data, daemon version, subscription state, SSH material, and proxy URLs

### Legacy field note

`code_server_password` still exists in the database schema, but it is explicitly marked legacy and no longer represents the primary access model.

---

## 11. Images / Snapshots

The product currently uses the term **images** rather than the older spec's heavy emphasis on snapshots.

Current image model supports:

- public template images
- user-owned snapshots captured from running machines
- booting new machines from those images
- provider image IDs stored per image row

Image statuses currently include:

- `creating`
- `ready`
- `failed`
- `deleted`

The API exposes list / get / delete for images, and machine routes expose image creation from a machine.

---

## 12. Toolbox API

Unlike the old spec, the platform now includes a substantial built-in toolbox surface.

### Filesystem capabilities

Implemented API operations include:

- list files
- get file info
- check existence
- download file
- upload file
- create folder
- delete path
- move/rename
- search text
- replace text
- set permissions
- bulk download

The daemon also implements bulk upload, though not every daemon capability is necessarily exposed 1:1 through the public control-plane API.

### Process capabilities

Implemented API operations include:

- synchronous command execution
- streaming command execution over SSE
- code-run helpers
- process list
- kill process

This makes the current product more than a plain VPS host; it is also a remote machine automation platform.

---

## 13. Webhooks and Realtime

### SSE

The API exposes machine status streaming over SSE at:

```text
/machines/:id/status/stream
```

### Webhooks

Webhook subscriptions are implemented.

Supported event families currently documented in code:

- `*`
- `machine.stage_changed`
- `machine.status_changed`
- `machine.heartbeat`

Webhook payloads are signed with HMAC-SHA256.

Webhook management includes:

- create
- list
- delete
- patch/update
- inspect deliveries

Delivery metadata and failure counts are persisted.

---

## 14. Regions, Plans, and Pricing Model

Current pricing is driven by `src/lib/hetzner-pricing.ts`.

### 14.1 Current region abstraction

The public pricing / plan abstraction is currently simplified to two markets:

- `eu`
- `us`

Underlying Hetzner region IDs mapped in code include:

- `hel1`
- `fsn1`
- `nbg1`
- `hil`
- `ash`

### 14.2 Current plan tiers

Current curated plan tiers are:

- `starter`
- `basic`
- `pro`
- `power`
- `ultra`

These map to specific Hetzner SKUs by market.

### 14.3 Current markup

The current multiplier in code is:

```text
Hetzner price x 2
```

This is materially different from the older spec's `2.5x` pricing story.

### 14.4 Backups surcharge

Backups currently add:

```text
20%
```

### 14.5 Caveat

The system still supports provider-level server type listing dynamically, but the first-class commercial story in the codebase is now centered around curated plan tiers and region markets, not the earlier "entire Hetzner catalog exposed equally" narrative.

---

## 15. Kortix Integration

Kortix integration is real in the current codebase, though it is now represented differently than in the old spec.

### Implemented pieces

- Kortix OAuth linking via `/api/v1/import/kortix/start` and callback flow
- persisted Kortix link records in the database
- machine source tracking (`source = user | kortix`)
- `kortix_sandbox_id` on machines
- public template naming that includes a `Kortix` image/template concept

This means the repo already contains real Kortix account-linking and import-oriented primitives, not just aspirational mentions.

---

## 16. Current Database Model

The database currently persists:

- users
- ssh_keys
- images
- machines
- api_keys
- proxy_tokens
- subscriptions
- machine_events
- webhooks
- webhook_deliveries
- stripe_events
- account_limits
- kortix_links

Notable machine fields include:

- provider and provider metadata
- image ID
- docker workload config
- machine token
- generated SSH keypair material
- backups enabled
- source and Kortix sandbox ID
- monthly price
- domains array
- provisioning stage and timestamps
- daemon version
- heartbeat payload and timestamp

This schema is materially more advanced than the original spec's early-stage table plan.

---

## 17. Current Docs and SDK Status

### Docs UI

There is a substantial docs page built directly into the app at `/docs`.

It covers:

- getting started
- personal use
- infrastructure use
- images
- security
- access control
- billing
- support
- deep links into API docs

### SDK

The repo contains generated SDK artifacts and packaging for:

- TypeScript
- Python

The API docs themselves advertise:

- `@kortix/justavps` for TypeScript / Node
- `kortix-justavps` / Python package naming in docs examples

This should be treated as **SDK generation exists in repo**, while package publishing/distribution should only be claimed externally if verified separately.

---

## 18. Truthful Summary of What Is Not Yet Fully Settled

To keep this spec honest, these points need to be called out explicitly:

- older comments, READMEs, and parts of the old spec still reference code-server, Caddy, and `justavps-agent`; the actual system has largely moved to `justavps-daemon`
- some Worker docs still describe direct-IP proxying; the current Worker implementation proxies through a shared broker origin
- some legacy/deprecated platform proxy routes still exist in the API, but the Cloudflare Worker is the intended access path
- custom domains are not implemented as a first-class current product flow, even though the schema leaves room for `domains[]`
- multi-provider support is not implemented despite provider-agnostic abstractions
- several capabilities are environment-dependent, especially Stripe, Cloudflare, GitHub OAuth, Mailtrap, and Kortix OAuth
- the app and docs market the product as OpenCode-first today; the old code-server-first framing is outdated

---

## 19. Canonical Current Product Statement

If someone asks "what is JustAVPS right now?", the most accurate short answer is:

> JustAVPS is a Hetzner-backed persistent compute platform for developers and AI agents. Users can buy a machine through a Next.js app, access it through an authenticated Cloudflare proxy on `kortix.cloud`, SSH into it, open a browser terminal, manage files and processes through a toolbox API, create images, use expiring share tokens, receive webhooks, and pay through Stripe. The machine runtime is centered on a single Go daemon that fronts OpenCode, PTY, local port forwarding, and the machine toolbox.

---

## 20. Spec Discipline Going Forward

This file should now be treated as a current-state spec, not a future-state manifesto.

When the product changes, update this file using these rules:

- describe implemented behavior first
- mark deprecated paths as deprecated
- separate environment-dependent capabilities from always-on capabilities
- do not promote planned features to current truth until code and runtime verify them
