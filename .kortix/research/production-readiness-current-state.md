# JustAVPS production readiness audit — current state

Date: 2026-04-10

## Scope

This audit describes the **current implemented architecture** of the JustAVPS bare-metal/Incus path, and distinguishes it from things that are still only described in specs or runbooks.

## Executive summary

- **Implemented today:** a centralized control plane (Next/DB/Cloudflare) that provisions onto host-local `runnerd` agents, which in turn orchestrate local Incus VMs and warm pools on each bare-metal host. Core pieces are real: host registration/procurement admin APIs, runnerd instance lifecycle, snapshots, reconciliation, Cloudflare KV routing, and a fleet admin UI (`src/server/routes/v1/admin-baremetal.ts`, `runnerd/src/index.ts`, `src/server/lib/baremetal/reconcile.ts`, `src/server/lib/cloudflare.ts`, `src/app/v2/admin/fleet/page.tsx`).
- **Operationally strong now:** host-local isolation keeps failure domains small; warm-pool golden-image claims are implemented; reconciliation can repair stale DB state from runner truth; routing no longer assumes port 80 only and now carries `http_port` in KV (`runnerd/src/index.ts:631-737`, `src/server/routes/v1/internal.ts:134-144`, `.kortix/context.md:17`).
- **Not production-ready yet for large scale:** capacity accounting is not transactional, provisioning is still in-process `after(...)` work instead of durable jobs, scheduler logic is simple first-fit on DB snapshots, reconciliation is fleet-wide and DB-heavy, host migration/failover is intentionally absent, backups are mostly snapshot semantics rather than durable off-host recovery, and some monitoring logic is still Hetzner-cloud-oriented rather than bare-metal-specific (`src/server/lib/v2/machines.ts:404-598`, `src/server/lib/baremetal/scheduler.ts:37-55`, `src/server/lib/baremetal/reconcile.ts:151-316`, `src/server/lib/machine-watchdog.ts:1-220`, `.kortix/docs/specs/operator-runbook-scaling-and-backups.md:70-144`).

## Current control plane

### Implemented

- The control plane is the existing JustAVPS app/API/frontend plus Postgres and Cloudflare routing state; the runbook explicitly calls this architecture centralized (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:10-21`).
- Machine creation in V2 is initiated in `createMachineV2()`: it checks quota, picks a host from `baremetal_hosts`, creates the machine row, then schedules background provisioning work with `after(...)` (`src/server/lib/v2/machines.ts:307-406`).
- The background path performs image resolution, SSH key generation, provider/runner creation, Stripe linking, and best-effort Cloudflare DNS/KV setup (`src/server/lib/v2/machines.ts:413-583`).
- Host procurement and registration are exposed in admin routes: request procurement, approve/order via Hetzner Robot, sync the procurement transaction, and register a bootstrapped host runner/capacity (`src/server/routes/v1/admin-baremetal.ts:157-217`, `422-558`, `348-406`).

### Current strengths

- Clear separation between customer-facing machine APIs and internal fleet APIs matches the v2 spec direction (`docs/spec-incus-v2-provider.md:353-399`).
- Each host has explicit DB registration, runner token, capacity fields, and status (`src/server/routes/v1/admin-baremetal.ts:82-92`, `108-132`, `387-400`).
- The control plane does not directly talk to Incus; it talks to `runnerd`, which is the right abstraction boundary (`docs/spec-incus-v2-provider.md:462-487`, `runnerd/README.md:3-10`).

### Current production-readiness gaps / failure modes

- **Provisioning is not queue-backed.** The critical provisioning flow after API return runs inside `after(...)` in the web process, not in a durable job system (`src/server/lib/v2/machines.ts:404-598`). A process crash/redeploy mid-flight can strand work.
- **Host picking is based on a raw DB snapshot.** `createMachineV2()` loads all hosts and chooses the first eligible one in memory (`src/server/lib/v2/machines.ts:325-346`). There is no transactional host reservation or row-level locking.
- **Capacity accounting lags reality.** Host `used_*` fields are refreshed by reconcile, not atomically updated on placement (`src/server/lib/baremetal/reconcile.ts:215-227`). Concurrent creates can oversubscribe a host before reconcile catches up.
- **Best-effort side effects.** Stripe and Cloudflare setup are intentionally non-blocking / best-effort, which is good for UX but means partial completion states are possible (`src/server/lib/v2/machines.ts:466-583`).

## Current data plane / compute-plane architecture

### Implemented

- Each compute node is independent and runs Incus, local ZFS, `runnerd`, nginx, and warm reserve VMs per the operator runbook (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:16-22`).
- `runnerd` is the host-local control plane. It creates/starts/stops/reboots/deletes VMs, manages snapshots/images, exposes health/state, and maintains warm pools (`runnerd/src/index.ts:578-612`, `614-935`; `runnerd/README.md:3-10`).
- Storage is intentionally host-local, and machines are pinned to one host; the admin fleet page states this directly (`src/app/v2/admin/fleet/page.tsx:191-200`).

### Planned but not implemented as seamless production features

- No shared storage.
- No live migration.
- No automatic cross-host failover.
- No image-replicate-everywhere fabric.

Those are explicit design choices in the runbook/spec, not missing accidental features (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:42-68`, `docs/spec-incus-v2-provider.md:500-512`, `694-708`).

## Scheduling / placement model

### Implemented

- V1 scheduler logic exists in `pickBaremetalHostForPlan()`: filter to active hosts in-region with a runner and enough free CPU/RAM/disk, then sort by utilization score and pick the first (`src/server/lib/baremetal/scheduler.ts:23-55`).
- V2 custom-resource placement is even simpler: fetch all hosts and pick the first host in the region with enough free capacity, or use an explicit `host_id` (`src/server/lib/v2/machines.ts:325-346`).
- Host selection in the provider path can force a specific host or select any eligible active host with free capacity (`src/server/lib/providers/baremetal.ts:171-208`).

### Strengths

- Simple placement logic is easy to reason about.
- Region and host status are real inputs.
- Explicit host pinning for debugging/admin is supported.

### Gaps / failure modes

- **No transactional reservations** before provisioning starts.
- **No warm-pool-aware host selection** in the control plane, despite the spec wanting that (`docs/spec-incus-v2-provider.md:437-458`). Today the host is picked first; only then does that host’s runner decide warm-claim vs cold boot.
- **No image-locality-aware scheduling** even though the runbook recommends it (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:62-68`, `138-143`).
- **No real host-class policy enforcement** in the scheduler beyond free capacity. Host classes exist in procurement/admin data, but the active placement code does not encode class-to-plan rules (`src/server/routes/v1/admin-baremetal.ts:22`, `src/server/lib/baremetal/scheduler.ts:37-55`).

## runnerd

### Implemented

- Authenticated host-local HTTP API with bearer token (`runnerd/src/index.ts:366-371`).
- Health endpoint with Incus and warm-pool status (`runnerd/src/index.ts:578-612`).
- State endpoint returning detailed instances and images for reconciliation (`runnerd/src/index.ts:781-803`).
- Instance lifecycle endpoints, snapshot create/list/restore/delete, and image publish/delete (`runnerd/src/index.ts:805-917`).
- Startup logic prunes old warm artifacts and refills pools on a 30s interval (`runnerd/src/index.ts:926-935`).

### Operational strengths

- The app only needs host base URL + token, which keeps compute orchestration local.
- Retry wrappers for Incus busy/transient errors are already present (`runnerd/src/index.ts:225-261`).
- Health and state APIs give the control plane a better truth source than DB rows alone.

### Gaps / failure modes

- **In-memory pool state only.** `warmPools` and replenish state live in process memory (`runnerd/src/index.ts:74-76`). Restarting `runnerd` forces pool rebuild; there is no persisted inventory model.
- **Single-process bottleneck per host.** All orchestration goes through one Node process; there is no concurrency shaping or internal queue.
- **Port allocation is not scalable per host.** SSH port uses `22000 + sha1(instanceId) % 1000`, HTTP uses `8000 + sha1(instanceId) % 1000` (`runnerd/src/index.ts:378-388`). That gives only ~1000 distinct SSH and ~1000 distinct HTTP ports per host, with collision risk well before that. This is a hard blocker for dense hosts and a major blocker for 100k+ fleet ambitions if per-machine NAT ports remain the model.
- **Nginx map regeneration is best-effort** after lifecycle changes (`runnerd/src/index.ts:664`, `727`, `849`, `923-924`), so a failed regeneration can leave routing drift until repaired.

## Warm pools

### Implemented

- Warm pools are real and keyed by exact CPU bucket (`runnerd/src/index.ts:49-82`).
- Default bucket set comes from `POOL_CPU_BUCKETS`; target per bucket comes from `WARM_POOL_PER_CPU` (`runnerd/src/index.ts:55-61`).
- Golden-image creates attempt a warm claim first; otherwise they cold-boot from image (`runnerd/src/index.ts:627-737`).
- Warm-pool claims inject identity, hotplug memory/disk, configure SSH/HTTP proxy devices, and can mark the machine ready immediately in the control plane (`runnerd/src/index.ts:637-673`, `src/server/lib/v2/machines.ts:542-555`).
- Current context notes confirm live verification of the warm-path and cold fallback on real hosts (`.kortix/context.md:7-9`, `21-23`).

### Strengths

- This is the main user-facing latency win in the current system.
- Exact-CPU buckets avoid lying about CPU capacity.
- Warm pools are operationally simple compared with stateful resume or shared-image tricks.

### Gaps / failure modes

- **Warm pools are host-local only.** There is no fleet-level reserve awareness.
- **Only golden images really benefit.** Non-golden images go through the full cloud-init path (`src/server/lib/v2/machines.ts:441-465`, `runnerd/src/index.ts:739-775`).
- **Immediate ready on warm claim is optimistic.** The control plane marks a warm-claimed machine `ready` without waiting for the daemon heartbeat (`src/server/lib/v2/machines.ts:542-552`). Fast, but it weakens “ready means application verified.”
- **No cleanliness attestation beyond rebuild discipline.** The spec says warm VMs must be clean; current implementation relies on how the pool image is prepared and recycled, not on a separate scrub validator (`docs/spec-incus-v2-provider.md:673-699`).

## Reconciliation

### Implemented

- `reconcileBaremetalFleet()` fetches all hosts, all machines, and all images, then asks each active host runner for `/v1/state` and updates host usage and reconciliation metadata (`src/server/lib/baremetal/reconcile.ts:151-227`).
- It marks stale/missing machines deleted, records orphan runner instances, and can reconcile stale images when all hosts are healthy (`src/server/lib/baremetal/reconcile.ts:190-315`).
- Host listing in admin tries to run reconcile before returning results (`src/server/routes/v1/admin-baremetal.ts:305-313`).
- Internal `/watchdog` also runs both the machine watchdog and baremetal reconcile (`src/server/routes/v1/internal.ts:206-218`).

### Strengths

- There is a real second source of truth besides the DB.
- Host usage numbers are derived from actual Incus state, not just desired state.
- Orphans/stale rows are surfaced explicitly.

### Gaps / failure modes

- **Fleet-wide full scan behavior.** Reconcile loads all hosts, machines, and images every run (`src/server/lib/baremetal/reconcile.ts:154-158`). That is acceptable for a few hosts, but expensive at scale.
- **Sequential per-host RPC behavior.** The host loop is per-host and updates rows inline, which becomes slow as fleet size grows (`src/server/lib/baremetal/reconcile.ts:171-262`).
- **Reconcile is compensating for missing placement reservations.** It is acting as eventual correction for state drift rather than auditing a strongly consistent placement system.
- **Admin page coupling.** Listing hosts tries to reconcile live first (`src/server/routes/v1/admin-baremetal.ts:305-310`), which is convenient now but the wrong shape for large fleets or degraded control-plane latency.

## Routing / proxy

### Implemented

- Cloudflare KV stores per-machine routing/auth metadata under `machine:{slug}` (`src/server/lib/cloudflare.ts:303-322`).
- `setupProxyDNS()` writes KV and creates an unproxied `origin-{slug}` DNS record for SSH (`src/server/lib/machine-lifecycle.ts:193-230`).
- Machine heartbeat upgrades KV status to `ready` and now includes `origin_port` from `providerMeta.http_port` (`src/server/routes/v1/internal.ts:134-144`).
- The Cloudflare Worker/broker path reads `origin_port` and signs broker headers toward the shared broker origin (`workers/proxy/src/proxy.ts:91-130`, `147-198`).
- Repository context explicitly notes the recent fix: baremetal `http_port` is now written to KV so the Worker/Broker can dial the correct host-side origin port (`.kortix/context.md:17`).

### Strengths

- Public HTTP ingress is now decoupled from assuming direct VM IP or port 80.
- SSH uses host NAT + unproxied origin DNS rather than raw Incus network exposure.
- Worker auth path is reasonably mature and supports JWT, API key, and proxy token modes (`workers/proxy/src/auth.ts:1-120`).

### Gaps / failure modes

- **Broker is a central dependency.** Context already notes runtime proxy E2E can fail if broker origin availability fails even when provisioning succeeds (`.kortix/context.md:17`).
- **KV correctness is critical.** Routing depends on the Cloudflare KV record matching machine IP + port. Best-effort writes and delayed heartbeats can create stale routing windows (`src/server/lib/machine-lifecycle.ts:213-229`, `src/server/routes/v1/internal.ts:134-144`).
- **Current security/firewall posture is still documented partly in Hetzner-cloud terms.** `SPEC.md` explicitly warns that only the narrower currently verified firewall rules should be treated as truth (`SPEC.md:308-339`).

## Backups

### Implemented

- Bare-metal provider advertises `backups: false, images: true` (`src/server/lib/providers/baremetal.ts:95-102`).
- In practice, V2 exposes snapshots for bare-metal by talking directly to runnerd snapshot endpoints (`src/server/lib/v2/snapshots.ts:39-111`, `runnerd/src/index.ts:853-895`).
- Image publication from a machine is implemented through runnerd publish (`src/server/lib/providers/baremetal.ts:115-123`, `runnerd/src/index.ts:897-905`).

### Planned / not yet production-complete

- The runbook is explicit that real VPS-grade recovery requires off-host backup of Postgres plus selected machine images/snapshots (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:70-98`).
- The same runbook lists off-host machine snapshot export/import as a future improvement (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:138-143`).

### Audit conclusion

- **Implemented today:** host-local snapshots and image publication.
- **Not implemented today:** durable off-host machine backups, automatic export pipeline, and a true cross-host restore product story.
- **Net:** backup UX exists, but disaster recovery is not yet at production-grade VPS-service level.

## Migration posture

### Implemented / explicit stance

- The system is intentionally **pinned-to-node**, with **no live migration** and **no distributed storage** (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:42-68`, `src/app/v2/admin/fleet/page.tsx:194-199`, `docs/spec-incus-v2-provider.md:694-708`).
- If a host fails, the intended operator action is: mark unschedulable/draining, then restore from image/snapshot/backup to another host (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:99-115`).

### Production-readiness implication

- This posture is acceptable for an early provider if customers understand the semantics.
- It is **not** equivalent to seamless infrastructure HA. Host death is still machine downtime plus restore work.
- The design is sane for simplicity, but it means maintenance/drain/runbook quality matters a lot.

## Current operational strengths

- Strong architectural boundary between app control plane and host-local runner.
- Real warm-pool implementation with field verification on live hosts.
- Real reconciliation loop against host truth.
- Host procurement/admin surfaces exist rather than being only speculative.
- Host-local storage and failure domains are simple and understandable.
- Worker/KV/broker routing model is real and recently corrected for non-default origin ports.

## Current production-readiness gaps and likely failure modes

1. **Durability gap in control-plane jobs** — provisioning is still web-process background work.
2. **Capacity race / oversubscription risk** — no atomic placement reservation.
3. **Reconcile-driven truth** — DB capacity is eventually corrected, not strongly maintained.
4. **Single-host dependency per machine** — no migration/failover beyond restore semantics.
5. **Central broker/KV dependency** — routing can fail independently of VM health.
6. **Backups not DR-complete** — snapshots exist, off-host recovery does not.
7. **Monitoring mismatch** — the watchdog still contains Hetzner hypervisor polling / reboot assumptions from the cloud-VPS world (`src/server/lib/machine-watchdog.ts:6-19`, `71-162`), which are not the same as host-local Incus bare-metal operations.

## 100k+ scaling blockers

These are the most concrete blockers visible in current code/design.

### 1. No transactional capacity reservation

- Host selection is a memory-side scan of `baremetal_hosts` (`src/server/lib/v2/machines.ts:325-346`).
- Host `used_*` numbers are only updated during reconciliation (`src/server/lib/baremetal/reconcile.ts:215-227`).
- At 100k machines / high concurrency, this will oversubscribe hosts and create hot-spot placement races.

### 2. Provisioning is not a durable job pipeline

- `after(...)` is not a durable orchestrator (`src/server/lib/v2/machines.ts:404-598`).
- Large-scale fleet operations need queueing, retry policy, idempotency keys, and resumable state transitions.

### 3. Reconciliation is O(fleet) and DB-heavy

- Reconcile loads all hosts, all machines, all images every pass (`src/server/lib/baremetal/reconcile.ts:154-158`).
- It also RPCs every host and writes rows inline. That is not the right architecture for 100k machines.

### 4. Heartbeat write volume will be huge

- Internal heartbeat updates machine rows and emits events on each callback (`src/server/routes/v1/internal.ts:53-157`).
- At 100k machines, even a 60s cadence is ~1.7k writes/sec before secondary effects, and the current path is direct DB mutation per heartbeat.

### 5. Per-host NAT port model does not scale

- `sshPortForInstance()` and `httpPortForInstance()` each only allocate from a 1000-port window (`runnerd/src/index.ts:378-388`).
- Collision risk and host density ceilings make this unsuitable for large host counts or dense consolidation.

### 6. Scheduler is too simple

- No warm-pool-aware placement.
- No image-locality awareness.
- No host-class policy engine.
- No drain-aware placement despite statuses existing.

This is okay now, but not for a 100k-machine provider (`docs/spec-incus-v2-provider.md:437-458`, `.kortix/docs/specs/operator-runbook-scaling-and-backups.md:31-40`).

### 7. Cloudflare KV + broker centralization becomes a control bottleneck

- One KV record per machine plus shared broker routing is operationally elegant now.
- At 100k+, KV update rate, stale-entry handling, and broker fan-in/fan-out need a more explicit scalability plan (`src/server/lib/cloudflare.ts:303-322`, `workers/proxy/src/proxy.ts:147-245`).

### 8. Host-local only recovery semantics limit fleet operations

- No live migration and no distributed storage are deliberate choices, but they mean maintenance, balancing, and hardware failure handling stay manual/restore-driven (`.kortix/docs/specs/operator-runbook-scaling-and-backups.md:42-59`).

### 9. runnerd is still a minimal first implementation

- The README explicitly calls it “intentionally minimal for the first implementation” (`runnerd/README.md:26-36`).
- That is a correct MVP choice, but not yet the shape of a large-scale production node agent.

## Implemented vs planned — concise verdict

### Implemented and real

- Centralized app/DB/Cloudflare control plane
- Bare-metal host inventory + procurement/admin flows
- Host-local runnerd per node
- Incus VM create/delete/start/stop/reboot
- Warm-pool golden-image fast path
- Host-local snapshots and image publication
- Reconciliation against runner state
- Cloudflare KV + broker routing with host-side `http_port`
- Admin fleet UI

### Still planned / incomplete / not production-hard yet

- Durable off-host backup pipeline
- Transactional scheduler / placement reservations
- Image-locality-aware and warm-pool-aware scheduling
- Host draining workflows with full operator ergonomics
- Seamless migration/failover (explicitly out of scope today)
- Scalable queue-based provisioning orchestration
- 100k-grade heartbeat, reconcile, and routing control-plane scaling

## Bottom line

JustAVPS has moved beyond a concept: the bare-metal + Incus + runnerd architecture is **real and functioning**. For a small early fleet, the design is coherent and operable. But it is still best described as **production-shaped MVP infrastructure**, not a fully production-hardened provider platform. The biggest near-term readiness issues are not Incus itself; they are **control-plane durability, placement correctness under concurrency, DR/backups, and scaling limits in the current scheduler/reconcile/routing model**.
