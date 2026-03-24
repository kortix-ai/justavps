# Spec: Cloudflare DNS Limit Migration to Worker + KV Routing

**Status:** Draft  
**Date:** 2026-03-22  
**Authors:** Marko, Agent

---

## Problem

`kortix-dev.cloud` hit Cloudflare's DNS record cap during machine provisioning.

The current routing flow creates multiple DNS records per machine in `src/server/lib/cloudflare.ts`:

- `slug.<domain>` proxied A/AAAA
- `*.slug.<domain>` proxied A/AAAA
- `origin-slug.<domain>` DNS-only A/AAAA

For a dual-stack machine this is **up to 6 records per machine**. On a zone capped at 200 records, that fails around **33 machines**. Even Cloudflare's 3,500-record ceiling only gets us to roughly **583 dual-stack machines** before routing fails again.

We have not launched yet, so we can do a dirty cleanup of legacy records. We should treat this as a pre-launch architecture correction, not a live migration with backward-compat guarantees.

---

## Current State

### Already in place

- A Cloudflare Worker already handles auth + proxying for `*.kortix.cloud` and `*.kortix-dev.cloud` in `workers/proxy/src/index.ts`.
- Hostname parsing already supports the canonical public format:
  - `slug.kortix.cloud`
  - `port--slug.kortix.cloud`
- Machine metadata is already written to KV as `machine:{slug}` in `src/server/lib/machine-lifecycle.ts`.
- API keys and proxy tokens already sync into KV in `src/server/lib/proxy-kv.ts`.

### What is still wrong

- We still create per-machine public DNS records even though the Worker is already the public entrypoint.
- Worker routing still depends on per-machine `origin-slug.<domain>` DNS-only records because Cloudflare Workers cannot fetch raw IPs directly; Cloudflare docs require fetching a hostname, not `http://1.2.3.4`.
- Machine-scoped API key enforcement at the edge is incomplete because `machine:{slug}` does not currently include `machine_id`, so the Worker falls back to owner checks instead of exact scope checks.
- We still have old architecture cleanup paths (`origin.<slug>.<domain>`, legacy two-level hostnames) mixed into the code.

---

## Goals

1. Reduce public DNS usage from **O(number of machines)** to **O(1) per environment**.
2. Make the Worker + KV lookup the canonical public routing path for all machine traffic.
3. Keep machine provisioning and deletion idempotent even when DNS or KV writes partially fail.
4. Add an admin cleanup surface that can remove stale routing artifacts without direct Cloudflare dashboard work.
5. Preserve the existing auth model: API keys, proxy tokens, session/JWT flow, WebSockets, and `/_port/{port}` routing.

---

## Non-Goals

1. Eliminate every per-machine DNS record in v1. We will still keep per-machine `origin-slug.<domain>` DNS-only hostnames unless we adopt tunnels or another origin broker.
2. Rebuild proxy auth from scratch. The existing Worker auth stack stays.
3. Preserve undocumented legacy hostname formats forever. We can keep temporary compatibility, but new docs and code paths should standardize on `port--slug`.
4. Build a full end-user domain product in this migration. This is only for platform-managed proxy routing.

---

## Decision Summary

### Recommended architecture

#### Public ingress

Use one wildcard proxied DNS record per environment as the public entrypoint:

- `*.kortix-dev.cloud` -> Cloudflare proxied
- `*.kortix.cloud` -> Cloudflare proxied

All public requests go:

`client -> wildcard DNS -> Worker route -> KV lookup -> origin hostname -> machine daemon`

We stop creating these per-machine public DNS records entirely:

- `slug.<domain>`
- `*.slug.<domain>`

#### Edge lookup

Worker parses hostname, extracts `slug` and `port`, then loads:

- `machine:{slug}` for routing + ownership metadata
- `apikey:{sha256}` for API key auth
- `pt:{sha256}` for proxy token auth

#### Origin fetch (v1)

Keep per-machine DNS-only `origin-slug.<domain>` A/AAAA records for Worker egress.

Reason: Cloudflare Workers cannot subrequest raw IP origins directly. This is the only part that remains machine-specific in DNS for now.

Resulting DNS cost in v1:

- Public ingress: fixed wildcard records only
- Per machine: only `origin-slug.<domain>` A/AAAA

That reduces dual-stack machine cost from **6 records** to **2 records**.

#### Longer-term v2 option

If we need to scale beyond what `origin-slug` records allow, we should evaluate one of:

1. Shared Cloudflare Tunnel ingress
2. Central origin router/broker under a single hostname
3. Another Worker-compatible hostname indirection layer

This spec does **not** include v2 implementation, only a clean v1 that removes the biggest source of DNS explosion immediately.

---

## Target Routing Model

### Public hostnames

- `https://{slug}.kortix-dev.cloud`
- `https://{port}--{slug}.kortix-dev.cloud`
- `https://{slug}.kortix.cloud`
- `https://{port}--{slug}.kortix.cloud`

### Internal routing lookup

Worker flow:

1. Parse hostname into `slug` and `port`
2. Load `machine:{slug}` from KV
3. Validate auth from KV/JWT
4. Build origin URL from `origin_hostname`
5. Proxy to `http://origin_hostname:80/...` or `/_port/{port}`

### KV schema

`machine:{slug}` should become:

```json
{
  "machine_id": "uuid",
  "owner_id": "uuid",
  "ip": "203.0.113.10",
  "origin_hostname": "origin-demo.kortix-dev.cloud",
  "status": "ready",
  "server_type": "starter",
  "routing_version": 2,
  "updated_at": "2026-03-22T00:00:00.000Z"
}
```

Notes:

- `machine_id` is required for proper machine-scoped API key enforcement at the edge.
- `routing_version` gives us a clean cutover marker for admin tooling and backfills.
- `updated_at` makes drift debugging easier.

---

## User Stories

- As a platform operator, I want new machines to provision without creating public per-machine DNS records so the zone stops hitting Cloudflare caps.
- As an admin, I want to see stale DNS and KV routing artifacts and remove them safely from the dashboard.
- As an API client, I want existing proxy URLs and auth flows to continue working while the backend routing implementation changes.
- As an engineer, I want machine routing metadata to be reconstructable from the database so Cloudflare state can be repaired after partial failures.

---

## Requirements

### Must Have (P0)

#### 1. Wildcard public DNS becomes the only public ingress

- Stop creating `slug.<domain>` and `*.slug.<domain>` records in provisioning code.
- Ensure the zone has the wildcard public record and Worker route before rollout.
- Keep public URL format on `slug` and `port--slug` only.

Acceptance criteria:

- Given a newly provisioned machine, when routing setup runs, then no per-machine public proxied record is created.
- Given a request to `https://3000--demo.kortix-dev.cloud`, when the Worker runs, then the request is routed without any `3000--demo` DNS record existing.

#### 2. Keep per-machine origin hostname only

- Provisioning creates only `origin-slug.<domain>` A/AAAA records.
- Deletion removes only `origin-slug.<domain>` plus any known legacy artifacts.
- Sync jobs repair missing origin records idempotently.

Acceptance criteria:

- Given a machine with public IPv4 and IPv6, when routing setup runs, then only DNS-only origin records are created for that machine.
- Given a deleted machine, when cleanup runs, then origin records and KV entries are removed.

#### 3. Worker KV routing becomes authoritative

- `setupProxyDNS()` should be renamed conceptually to `syncMachineEdgeRouting()` or equivalent behavior.
- Every machine create/update/delete path must sync KV.
- `machine:{slug}` must include `machine_id` and routing metadata required by the Worker.

Acceptance criteria:

- Given a machine create, when provisioning completes, then KV contains a fresh `machine:{slug}` entry.
- Given a machine IP change, when sync runs, then KV and origin DNS are updated.

#### 4. Admin routing cleanup panel

- Add an admin-only surface for Cloudflare routing operations.
- It must support dry-run preview before destructive cleanup.
- It must support bulk cleanup of legacy public records.
- It must support per-machine repair: recreate KV, recreate origin DNS, remove legacy public DNS.

Minimum actions:

- `Scan routing state`
- `Remove legacy public DNS`
- `Repair machine KV`
- `Repair machine origin DNS`
- `Delete stale KV for deleted machines`
- `Backfill all active machines`

Acceptance criteria:

- Given legacy `slug.<domain>` or `*.slug.<domain>` records, when an admin runs cleanup, then those records are removed while `origin-slug.<domain>` remains intact.
- Given a machine missing KV, when an admin runs repair, then the KV entry is recreated from DB state.

#### 5. Exact machine-scoped API key checks at the edge

- Add `machine_id` to machine KV.
- Update Worker auth to reject machine-scoped keys when the slug resolves to a machine not listed in `machine_ids`.

Acceptance criteria:

- Given a machine-scoped API key for machine A, when it hits machine B's hostname, then the Worker returns 403.

### Nice to Have (P1)

#### 6. Reconciliation job

- Add an internal/admin job that compares DB machines to Cloudflare DNS and KV.
- It should produce a diff view: missing, extra, mismatched.

#### 7. Routing state columns or metadata

- Add lightweight DB metadata such as `routing_version`, `routing_synced_at`, or store this in `providerMeta` if we want operator visibility.

#### 8. Hard-delete deprecated proxy path

- Remove `src/server/routes/v1/proxy.ts` after Kortix Computer migrates.

### Future Considerations (P2)

#### 9. Eliminate per-machine origin DNS entirely

- Requires a Worker-compatible origin indirection strategy, likely tunnels or a shared origin broker.

#### 10. Self-healing routing automation

- Watch for missing KV/DNS during heartbeat or status sync and repair automatically with bounded retries.

---

## Admin Panel Spec

### Location

Admin-only page under a clear operations namespace, for example:

- `/admin/routing`

### Table columns

- Machine slug
- Machine status
- Owner
- IP
- Origin hostname expected
- KV state: present / missing / stale
- Legacy public DNS state: present / absent
- Origin DNS state: present / missing / stale
- Last routing sync time

### Filters

- Active only
- Deleted only
- Missing KV
- Has legacy public DNS
- Missing origin DNS
- Drift only

### Actions

- Per machine: `Repair`, `Remove legacy DNS`, `Delete stale KV`
- Bulk: `Backfill active machines`, `Clean legacy public DNS`, `Prune deleted-machine artifacts`
- All destructive actions require a typed confirmation or explicit dry-run review first.

### API surface

Suggested admin/internal routes:

- `GET /api/v1/admin/routing/scan`
- `POST /api/v1/admin/routing/backfill`
- `POST /api/v1/admin/routing/cleanup-legacy-dns`
- `POST /api/v1/admin/routing/repair-machine`
- `POST /api/v1/admin/routing/prune-stale-kv`

Response should always include:

- planned actions
- executed actions
- per-record success/failure
- machine slug / record name / Cloudflare record id when available

---

## Implementation Plan

### Phase 0 - Preconditions

1. Confirm wildcard public DNS exists for each environment.
2. Confirm Worker routes are active for `*.kortix-dev.cloud/*` and `*.kortix.cloud/*`.
3. Inventory current DNS usage and count how many records are legacy public vs required origin.

### Phase 1 - Cloudflare service refactor

Refactor `src/server/lib/cloudflare.ts` into clearer operations:

- `ensureWildcardIngress()` - validate or create wildcard public DNS once
- `ensureMachineOriginDNS(slug, addresses)`
- `removeMachineOriginDNS(slug)`
- `removeLegacyMachinePublicDNS(slug)`
- `writeMachineRoutingKV(machine)`
- `deleteMachineRoutingKV(slug)`
- `scanMachineRouting(slug)`

Key change:

- `addMachineDNS()` should stop creating public machine records.

### Phase 2 - Machine lifecycle refactor

Update `src/server/lib/machine-lifecycle.ts`:

- rename `setupProxyDNS()` behavior to reflect routing sync, not public DNS creation
- write `machine_id` into KV
- ensure delete flow removes origin DNS + KV + legacy public records best-effort
- ensure sync flow repairs origin DNS when IPs change

### Phase 3 - Worker auth tightening

Update `workers/proxy/src/auth.ts`:

- read `machine_id` from `machine:{slug}`
- enforce `machine_ids` exactly for scoped keys
- keep `proxy` permission checks unchanged

### Phase 4 - Admin cleanup tooling

Add admin scan + cleanup endpoints and UI.

Primary first-run action:

- remove all legacy public `slug.<domain>` and `*.slug.<domain>` records for active machines after wildcard routing is verified

### Phase 5 - Backfill + cleanup

Run one-time migration:

1. Backfill KV for all active machines
2. Ensure `origin-slug` exists for all active machines
3. Remove legacy public per-machine records
4. Delete Cloudflare/KV artifacts for already deleted machines

---

## Migration Runbook

### Step 1 - Deploy code first

Deploy platform + Worker changes so new machines use the new routing model before cleanup starts.

### Step 2 - Verify on a fresh dev machine

Verify:

- machine is reachable on `slug.kortix-dev.cloud`
- port routing works on `port--slug.kortix-dev.cloud`
- no public per-machine DNS exists
- `origin-slug.kortix-dev.cloud` exists
- `machine:{slug}` KV entry contains `machine_id`

### Step 3 - Backfill existing active machines

Run admin backfill for all active machines.

Expected outcome:

- every active machine has KV
- every active machine has origin DNS
- no active machine depends on public per-machine DNS

### Step 4 - Bulk-remove legacy public DNS

Remove these patterns for all active machines:

- `slug.<domain>`
- `*.slug.<domain>`
- `origin.<slug>.<domain>` legacy artifact

Keep:

- `origin-slug.<domain>`

### Step 5 - Prune deleted-machine artifacts

Delete:

- `origin-slug.<domain>` for deleted machines
- stale `machine:{slug}` KV entries for deleted machines
- any remaining legacy public DNS for deleted machines

---

## Data / API Changes

### Cloudflare KV

Update machine payload written by platform code to include:

- `machine_id`
- `updated_at`
- `routing_version`

### Internal/admin responses

Return structured scan objects like:

```json
{
  "slug": "demo",
  "machine_status": "ready",
  "expected": {
    "origin_hostname": "origin-demo.kortix-dev.cloud",
    "kv_key": "machine:demo"
  },
  "actual": {
    "kv_present": true,
    "origin_dns_present": true,
    "legacy_public_dns": [
      "demo.kortix-dev.cloud",
      "*.demo.kortix-dev.cloud"
    ]
  },
  "drift": ["legacy_public_dns_present"]
}
```

---

## Verification Plan

### Automated

- Update `src/__tests__/lib/cloudflare.test.ts` for the new DNS behavior.
- Add Worker tests for exact machine-scoped key enforcement.
- Add tests for admin scan diff generation if implemented in server code.

### Manual / E2E

On dev:

1. Create machine
2. Confirm only origin DNS gets created for that machine
3. Access root proxy URL
4. Access `port--slug` proxy URL
5. Use API key with `proxy` permission
6. Use proxy token URL
7. Delete machine
8. Confirm origin DNS and KV are removed

### Success criteria

- Creating a machine no longer consumes public per-machine DNS records.
- Bulk cleanup removes legacy public DNS without breaking routing.
- Admins can repair routing drift without direct Cloudflare UI work.

---

## Risks

1. **Cloudflare wildcard misconfiguration** - cleanup before wildcard ingress is verified will break all public machine traffic.
2. **KV drift** - stale machine KV could route auth correctly but fail proxying due to old origin hostname or status.
3. **Deleted machine leftovers** - because old cleanup was best-effort, scan tooling must assume stale records already exist.
4. **Legacy client paths** - anything still depending on `/api/v1/machines/:id/proxy/:port/*` must migrate before that route is removed.

---

## Open Questions

### Blocking

1. Do we want the admin cleanup panel to live in the product UI now, or start as internal/admin API endpoints plus a lightweight table page?
2. Should `routing_version` live in the database, in KV only, or both?

### Non-blocking

3. Do we want to keep legacy `PORT.SLUG` parsing temporarily, or remove it once wildcard routing is stable?
4. After v1 lands, do we want v2 to be shared tunnels or a central origin broker?

---

## Recommended First Slice

If we want the smallest useful implementation first:

1. Stop creating public per-machine DNS in `cloudflare.ts`
2. Add `machine_id` to `machine:{slug}` KV
3. Keep only `origin-slug` per machine
4. Add a one-off admin cleanup endpoint to remove legacy public DNS
5. Verify on dev, then backfill and clean the zone

That solves the immediate record explosion without waiting on a larger origin architecture rewrite.
