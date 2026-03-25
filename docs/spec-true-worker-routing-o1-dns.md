# Spec: True Worker-Based Routing With O(1) DNS

**Status:** Draft  
**Date:** 2026-03-22  
**Scope:** `kortix-dev.cloud` first, then `kortix.cloud`

---

## The actual requirement

The real requirement is **not** just “use a Cloudflare Worker for public ingress.”

The real requirement is:

1. Public traffic must enter through the Cloudflare Worker.
2. DNS records must **not** grow linearly with machine count.
3. Routing must be determined by Worker lookup logic, not by creating per-machine DNS.

That means the current dev state is **not the final architecture**.

Even though public per-machine DNS is gone, keeping `origin-{slug}.kortix-dev.cloud` still makes DNS scale with machine count, which fails the core goal.

---

## Hard constraint from Cloudflare Workers

Cloudflare Workers cannot make subrequests directly to raw IPs like:

```ts
fetch("http://203.0.113.10")
```

Cloudflare's own docs require a hostname target instead of a raw IP. That is why the current implementation still uses `origin-{slug}` hostnames.

So there are only two honest choices:

1. **Keep per-machine hostnames** for origin fetches, which still scales linearly.
2. **Introduce a fixed shared origin layer** that the Worker can fetch, and let that shared layer dial machine IPs.

If the requirement is truly O(1) DNS, then option 2 is the only viable path with today's Worker constraints.

---

## Decision

Adopt a **two-hop architecture**:

1. **Cloudflare Worker** remains the public auth + routing brain.
2. **Shared Origin Broker** becomes the network dialer to machine IPs.

The Worker does the lookup and chooses where traffic should go.
The broker does the thing the Worker cannot do: connect to arbitrary machine IPs and ports.

This preserves the user's intent:

- Worker is still the proxy decision point.
- DNS becomes effectively constant-sized.
- Per-machine DNS goes to zero.

---

## Final target architecture

### Public DNS

Per environment, we keep only a fixed small set of public DNS records:

- `*.kortix-dev.cloud` -> proxied -> Worker
- optional apex/supporting records
- one broker hostname outside the Worker route, for example:
  - `broker-dev.kortix-origin.net`

Important: the broker hostname **must not** live under `*.kortix-dev.cloud/*` unless explicitly excluded from the Worker route, or the Worker will fetch itself and loop.

### Request flow

```text
Browser / API client
  -> *.kortix-dev.cloud
  -> Cloudflare Worker
  -> KV lookup (slug -> machine metadata)
  -> fetch(shared broker hostname, signed internal headers)
  -> broker dials machine IP:80
  -> machine daemon /_port/{port}
  -> response streams back through broker -> Worker -> client
```

### Why this solves the scaling problem

DNS count no longer depends on machine count.

Instead of:

- `slug.kortix-dev.cloud`
- `*.slug.kortix-dev.cloud`
- `origin-slug.kortix-dev.cloud`

for every machine, we keep:

- one wildcard Worker ingress record
- one broker hostname (or a tiny fixed broker pool)

That is **O(1)** DNS.

---

## Why the previous ideas are not sufficient

### 1. Current `origin-{slug}` approach

This fixes the public DNS explosion, but it still creates one or two DNS records per machine.

Result:

- better than before
- not the final solution
- still fails “DNS should not scale with machines”

### 2. Shared Cloudflare Tunnel with many connectors

This does **not** solve the problem by itself.

Cloudflare tunnel replicas are replicas of the same tunnel config; they are not a routing fabric that can magically steer requests to a particular machine connector based on Worker KV.

If we still need hostname-level ingress rules per machine, then we have simply moved the linear scaling problem from DNS into tunnel config.

That is not the right core architecture.

### 3. Worker-only direct-to-IP proxy

Cloudflare blocks direct Worker subrequests to raw IPs.

So pure Worker-only transport without another dialer is not available to us here.

---

## Recommended architecture: Shared Origin Broker

## Components

### 1. Public Edge Worker

Responsibilities:

- parse hostname (`slug`, `port--slug`)
- authenticate user / API key / proxy token
- load `machine:{slug}` from KV
- enforce machine status and ownership
- construct signed internal broker request
- stream HTTP / SSE / WebSocket traffic to broker

The Worker should no longer use:

- `machineInfo.origin_hostname`

Instead it should always fetch a fixed broker origin, for example:

```ts
const brokerUrl = `http://broker-dev.kortix-origin.net${rewrittenPath}`;
```

with routing context in headers.

### 2. Shared Origin Broker

This is a new long-lived service, preferably **Go**, running on one or more dedicated origin nodes.

Why Go:

- easy long-lived HTTP streaming
- solid WebSocket support
- better fit than Vercel/serverless for reverse proxy behavior
- easy IP allowlisting and low overhead

Responsibilities:

- verify internal Worker signature / timestamp
- read target machine IP + port from headers
- proxy to machine daemon over raw IP
- support HTTP, SSE, and WebSocket upgrade traffic
- strip unsafe hop-by-hop headers
- emit structured logs and latency/error metrics

The broker should be intentionally dumb:

- **no user auth logic**
- **no DB lookups in hot path**
- **no ownership checks**

That logic belongs in the Worker.

The broker is only the network transport shim.

### 3. Machine daemon

No architectural change needed on-machine.

We keep the current daemon behavior:

- `/` -> main service on local port 80 equivalent
- `/_port/{port}` -> dynamic port proxy to localhost port
- WebSocket support for PTY/OpenCode flows

This is good because it lets the broker always dial machine port `80`, and the daemon handles internal port fanout.

### 4. KV / routing metadata

`machine:{slug}` should contain only broker-relevant routing state:

```json
{
  "machine_id": "uuid",
  "owner_id": "uuid",
  "ip": "203.0.113.10",
  "status": "ready",
  "server_type": "cpx22",
  "routing_version": 3,
  "updated_at": "2026-03-22T00:00:00.000Z"
}
```

Notably, `origin_hostname` becomes unnecessary in the final architecture.

---

## Broker request contract

The Worker should send a request like this to the broker:

### Request URL

```text
http://broker-dev.kortix-origin.net/_broker_proxy
```

### Required headers

```text
X-Kortix-Target-IP: 203.0.113.10
X-Kortix-Target-Port: 3000
X-Kortix-Machine-Id: <uuid>
X-Kortix-Machine-Slug: abc123
X-Kortix-User-Id: <uuid>
X-Kortix-Request-Ts: 1711111111
X-Kortix-Request-Nonce: <random>
X-Kortix-Signature: <hmac_sha256(secret, canonical_string)>
X-Kortix-Original-Host: 3000--abc123.kortix-dev.cloud
X-Kortix-Original-Path: /foo/bar?x=1
```

### Canonical string to sign

```text
<timestamp>\n<nonce>\n<machine_id>\n<slug>\n<target_ip>\n<target_port>\n<original_host>\n<original_path>
```

### Broker verification rules

- reject missing signature
- reject timestamp older than 30s
- reject nonce replay within short TTL cache
- reject if target IP is missing or malformed
- reject if target port is outside allowed range

The broker should not trust any unsigned target header.

---

## HTTP and WebSocket behavior

### HTTP / SSE

Broker target construction:

- port `80` public request -> `http://<machine-ip>:80/<path>`
- non-default port -> `http://<machine-ip>:80/_port/<port>/<path>`

This matches the current daemon routing model and preserves localhost-only services.

### WebSockets

Same idea:

- default port -> `ws://<machine-ip>:80/<path>`
- non-default port -> `ws://<machine-ip>:80/_port/<port>/<path>`

Broker must explicitly support upgrade handling and bidirectional stream forwarding.

### Timeouts

Suggested defaults:

- dial timeout: 3s
- first byte timeout: 10s
- idle timeout for standard HTTP: 60s
- long-running WS/SSE: much higher / keepalive-based

---

## Security model

## Public security boundary

The Worker remains the only public auth boundary.

Users never talk to the broker directly.

## Broker hardening

The broker is still internet-addressable at the network level, so it must be locked down.

### Required protections

1. HMAC-signed Worker requests
2. timestamp + nonce replay protection
3. reject all unsigned traffic
4. restrict allowed target ports if needed
5. optional firewall allowlist for Cloudflare egress IPs
6. structured logs for every denied request

### Machine firewall hardening

Once the broker is live, machine UFW rules should stop allowing generic public `80/tcp`.

Instead:

- allow `22/tcp` as today
- allow `80/tcp` only from broker node IPs (or broker private network)

This removes direct public machine exposure while keeping broker-to-machine transport working.

---

## Reliability / scale model

## Dev

Dev can start with **one broker node**.

That is acceptable because dev is validation infrastructure.

## Production

Production should use **at least two broker nodes** behind a fixed hostname/load balancer.

Options:

1. DNS/load balancer in front of two brokers
2. Cloudflare Load Balancer in front of broker origins
3. one hostname -> small broker pool with health checks

DNS remains O(1) in all cases.

### Broker pool selection

Worker does **not** need to pick a broker per machine at first.

Simplest v1:

- Worker always sends to `broker-dev.kortix-origin.net`
- the LB chooses a healthy broker

Future v2:

- include `broker_pool` or region affinity in KV if needed

---

## Data model changes

### KV

Change `machine:{slug}` to remove `origin_hostname` from the required contract.

Final shape:

```json
{
  "machine_id": "uuid",
  "owner_id": "uuid",
  "ip": "203.0.113.10",
  "status": "ready",
  "server_type": "cpx22",
  "routing_version": 3,
  "updated_at": "2026-03-22T00:00:00.000Z"
}
```

Optional future fields:

- `broker_pool`
- `region`
- `private_ip`
- `last_verified_at`

### DB / metadata

Recommended additions:

- `routing_version`
- `routing_synced_at`
- `broker_locked_down_at`

These can live in `providerMeta` initially if we want to avoid a migration.

---

## Required code changes

## Worker

### `workers/proxy/src/proxy.ts`

Replace current target construction:

```ts
const originHost = machineInfo.origin_hostname || machineInfo.ip;
const targetUrl = `http://${originHost}:80${targetPath}`;
```

with broker target construction:

```ts
const brokerUrl = `http://${env.BROKER_HOST}/_broker_proxy`;
```

and move machine target data into signed headers.

### `workers/proxy/src/index.ts`

- pass `env.BROKER_HOST`
- remove assumptions about `origin_hostname`

### `workers/proxy/src/auth.ts`

- keep current auth model
- keep machine-scoped `machine_id` checks

## Platform server

### `src/server/lib/cloudflare.ts`

Final end state:

- keep wildcard ingress helpers
- remove all per-machine DNS creation
- remove `origin-{slug}` management entirely
- keep KV sync only

### `src/server/lib/machine-lifecycle.ts`

- stop calling per-machine DNS sync
- keep KV sync on create/update/delete

### Admin routing panel

Update `src/server/routes/v1/admin-routing.ts` and `src/app/(dashboard)/admin/routing/page.tsx` to scan:

- missing KV
- stale KV
- any remaining per-machine DNS (these become legacy-only)
- machine firewall lock status if we add reporting later

## New broker service

Add a new service, suggested path:

- `broker/`

Recommended initial layout:

```text
broker/
  cmd/broker/main.go
  internal/auth/signature.go
  internal/proxy/http.go
  internal/proxy/websocket.go
  internal/config/config.go
  internal/logging/logging.go
```

---

## Migration plan

## Phase 0 - Spec correction

Mark the current `origin-{slug}` model as an intermediate dev mitigation, not the final solution.

## Phase 1 - Build broker

1. Implement broker service in Go.
2. Deploy one dev broker node.
3. Give it a fixed hostname outside the Worker route.
4. Add Worker-to-broker shared secret.

## Phase 2 - Worker cutover on dev

1. Update Worker to send traffic to broker instead of `origin_hostname`.
2. Verify HTTP, SSE, and WebSockets through broker.
3. Keep old `origin-{slug}` records temporarily only as rollback material.

## Phase 3 - Remove per-machine origin DNS on dev

1. Stop creating `origin-{slug}` for new machines.
2. Bulk-delete all existing `origin-{slug}` records.
3. Confirm admin scan reports:
   - zero per-machine public DNS
   - zero per-machine origin DNS
   - zero stale KV

## Phase 4 - Firewall tightening

Update cloud-init / remediation so machines only allow broker nodes on `80/tcp`.

## Phase 5 - Production rollout

1. Deploy broker pool.
2. Cut Worker over in prod.
3. Delete prod per-machine DNS.
4. Verify scale no longer touches DNS count.

---

## Rollback plan

If broker rollout fails on dev:

1. revert Worker to `origin_hostname`
2. restore `origin-{slug}` DNS creation if needed
3. leave wildcard public routing in place

If broker rollout fails in prod:

1. revert Worker fetch target to old origin hostnames
2. restore origin DNS from DB/KV reconciliation

Because we have not launched, we can accept a dirtier rollback on dev than we would in prod.

---

## Success criteria

The migration is only truly complete when all of the following are true:

1. `slug.kortix-dev.cloud` works without any per-machine DNS record.
2. There is **no** `origin-{slug}` record for any machine.
3. Cloudflare DNS count stays flat as machines are added.
4. Worker still performs auth + routing lookup.
5. WebSockets and `/_port/{port}` flows still work.
6. Machines are not directly exposed on public `80/tcp` except via broker allowlist.

If any per-machine DNS remains, then the core scaling problem is not fully solved.

---

## Open questions

### Blocking

1. Which hostname/zone should host the broker so it does not collide with the Worker route?
2. Should dev broker be a standalone VPS, or run on existing infra?
3. Do we want broker HMAC only, or HMAC + Cloudflare IP allowlist?

### Non-blocking

4. Do we want a broker pool from day one in prod or start with one broker and add HA next?
5. Do we want to keep `origin_hostname` in KV temporarily for rollback only?

---

## Recommended first implementation slice

If we want the smallest path to the true target architecture:

1. Build single dev broker in Go.
2. Add `BROKER_HOST` + `BROKER_SHARED_SECRET` to Worker env.
3. Change Worker fetches from `origin_hostname` to broker.
4. Verify one real machine over HTTP + WebSocket.
5. Delete all `origin-{slug}` DNS on dev.

That is the first moment the system actually satisfies the real requirement: **routing scales without DNS scaling with machine count**.
