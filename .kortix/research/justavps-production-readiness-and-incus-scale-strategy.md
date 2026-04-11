# JustAVPS production readiness and Incus scale strategy

Date: 2026-04-10

## Executive summary

JustAVPS is now past the "idea" stage. The bare-metal + Incus + `runnerd` architecture is real, live, and verified on multiple Hetzner hosts with real V2 E2E coverage, including warm-pool fast paths, cold paths, snapshots, images, terminal/proxy routing, and real host procurement/registration ([current-state audit](./production-readiness-current-state.md), [V2 provider spec](../../docs/spec-incus-v2-provider.md)).

However, it is **not yet production-ready for a 100k-machine cloud business**.

The biggest issues are not "can Incus do it?" The biggest issues are:

1. **Control-plane durability** — provisioning still runs as in-process background work instead of a durable job system ([`createMachineV2`](../../src/server/lib/v2/machines.ts)).
2. **Capacity correctness under concurrency** — placement is based on DB snapshots without transactional host reservations ([`createMachineV2`](../../src/server/lib/v2/machines.ts), [`baremetal scheduler`](../../src/server/lib/baremetal/scheduler.ts)).
3. **Write amplification / scaling shape** — heartbeats, SSE polling, reconcile loops, and webhook retries all lean too directly on the primary Postgres/control-plane path ([`internal.ts`](../../src/server/routes/v1/internal.ts), [`sse.ts`](../../src/server/routes/v1/sse.ts), [`webhook-delivery.ts`](../../src/server/lib/webhook-delivery.ts)).
4. **Disaster recovery maturity** — snapshots/images exist, but off-host durable backup/restore is not yet product-grade ([operator runbook](../docs/specs/operator-runbook-scaling-and-backups.md)).
5. **Host-class economics** — the current `general-small` AX41-style node is good for proving the model, but it is a poor long-term base unit for broad warm-pool coverage across many plan sizes.

My conclusion:

- **Incus is a viable substrate** for a multi-million-dollar VPS/cloud business.
- **The current JustAVPS architecture is viable as a production-shaped MVP.**
- **It is not yet viable as-is for 100k+ machines.**
- The path to 100k is not “rewrite everything”; it is a focused evolution in five areas:
  - queueing/durability
  - scheduling/reservations
  - observability/event ingestion
  - backups/DR
  - host-class/cell architecture

## Current-state verdict by domain

| Domain | Current state | Verdict for early production | Verdict for 100k scale |
| --- | --- | --- | --- |
| Compute substrate | Real Incus VM orchestration on bare metal via `runnerd` | Good | Viable substrate |
| Warm pools | Real and E2E-verified on both hosts for 1- and 2-vCPU buckets | Good | Needs fleet-aware economics and scheduling |
| Scheduling | Simple DB-snapshot-based host pick | Barely acceptable | Not acceptable |
| Provisioning orchestration | In-process async background work | Risky | Not acceptable |
| Reconciliation | Real host truth loop exists | Good safety net | Too DB-heavy / O(fleet) |
| Routing/proxy | Real Cloudflare KV + broker path | Good | Needs explicit scale/reliability plan |
| Backups/DR | Host-local snapshots/images only | Partial | Not acceptable |
| Security | Reasonable VM-first posture, SSH-first, daemon/watchdog hardening | Good baseline | Needs stronger host/IAM/audit/compliance program |
| Migration/failover | Explicitly pinned-to-node; restore-driven recovery | Acceptable early | Needs cold-migration tooling at minimum |
| Database/data model | Functional | Fine for small fleet | Needs indexing, partitioning strategy, write-path redesign |

## What you have today

### Architecture

Today’s platform is a centralized control plane with a host-local data plane:

- **Control plane**: Next/Node API, Postgres, Stripe, Cloudflare, admin APIs, machine lifecycle logic ([current-state audit](./production-readiness-current-state.md)).
- **Data plane**: one `runnerd` per host, one local Incus daemon per host, host-local storage, host-local warm reserves ([`runnerd/README.md`](../../runnerd/README.md), [`runnerd/src/index.ts`](../../runnerd/src/index.ts)).
- **Routing plane**: Cloudflare Worker + KV + broker + host HTTP/SSH NAT/proxy wiring ([`cloudflare.ts`](../../src/server/lib/cloudflare.ts), [`workers/proxy/src/proxy.ts`](../../workers/proxy/src/proxy.ts), [`daemon/internal/broker/broker.go`](../../daemon/internal/broker/broker.go)).

This is the right basic shape for an own-substrate VPS product: clear host-local orchestration, simple failure domains, and no direct Incus exposure to customers.

### What has been validated E2E

You now have real verification of:

- procurement of a second Hetzner host
- host bootstrap and registration
- warm-pool golden fast path
- cold path
- explicit template path
- snapshots/image publish/restore/delete
- SSH
- terminal
- tokenized/public proxy routing

That matters a lot. It means the core product loop is not speculative anymore.

## The most important production-readiness concerns

## 1. Provisioning durability is the #1 blocker

The current V2 create path returns `202`, creates the machine row, and then runs the actual provisioning flow in `after(...)` in the app process ([`v2/machines.ts`](../../src/server/lib/v2/machines.ts)).

That is okay for MVP throughput, but for a real cloud business it creates ugly failure modes:

- deploy/restart mid-provision can strand work
- partial side effects are possible (DB row created, Stripe linked, host not provisioned)
- retry semantics are implicit and uneven
- concurrency is bounded by web workers rather than an explicit job system

### Required target state

Provisioning must become a **durable, idempotent job pipeline**.

Minimum acceptable design:

- API request writes a machine row + job row + idempotency key
- job worker claims the provisioning job
- every side effect is resumable / replay-safe
- host reservation lease exists before runner call
- retries have bounded semantics and dead-letter handling
- webhooks / notifications run from separate durable delivery queues

This change alone is one of the biggest jumps from MVP to real platform.

## 2. Capacity accounting is eventually correct, not transactionally correct

The current placement model reads host capacity from DB and chooses an eligible host by scanning rows in memory ([`v2/machines.ts`](../../src/server/lib/v2/machines.ts), [`baremetal scheduler`](../../src/server/lib/baremetal/scheduler.ts)). Host `used_*` values are refreshed by reconciliation rather than atomically reserved at create time ([`reconcile.ts`](../../src/server/lib/baremetal/reconcile.ts)).

That means:

- two concurrent creates can both believe the same host has room
- warm-pool consumption is only reflected as soon as reconcile catches reality
- host oversubscription risk exists under bursty demand

### Required target state

Add a **reservation allocator**:

- `host_capacity_reservations` or equivalent lease table
- row-level lock or compare-and-swap reservation on host buckets
- lease timeout / garbage collection for failed provisions
- separate accounting for:
  - running customer instances
  - stopped-but-billed disk allocations
  - warm reserves
  - migration/transient reservations

At 100k scale, capacity truth cannot be "reconcile later." Reconcile should audit, not correct normal placement races.

## 3. The DB/data model is under-indexed for cloud-scale operations

The schema currently defines almost no explicit indexes beyond one unique membership index plus primary/unique-key defaults ([`schema.ts`](../../src/server/db/schema.ts)).

That is a serious scaling concern because hot queries depend on fields like:

- `machines.account_id`
- `machines.status`
- `machines.deleted_at`
- `machines.provider_server_id`
- `machines.slug`
- `machine_events.machine_id + created_at`
- `webhooks.account_id + active`
- `webhook_deliveries.webhook_id + created_at`
- `baremetal_hosts.region + status`
- `images.account_id + status`

### Required target state

Before calling this production-hardened, add and validate indexes for all hot-path lookups, and define a future partitioning/archive strategy for:

- `machine_events`
- heartbeat history / time-series data
- `webhook_deliveries`
- audit logs

Without this, the platform will degrade under growth long before Incus does.

## 4. Heartbeat, SSE, and event delivery need a real scale architecture

### Heartbeats

Readiness and health currently flow through direct DB mutation on heartbeat ([`internal.ts`](../../src/server/routes/v1/internal.ts)).

At 100k machines:

- at 30s heartbeat cadence: **~3,333 heartbeat updates/sec**
- plus event insertion / webhook fan-out / status transitions

That is not impossible, but it is not something to casually run straight through the primary transactional DB write path forever.

### SSE

The live status stream polls DB every 2 seconds and also reads `machine_events` incrementally ([`sse.ts`](../../src/server/routes/v1/sse.ts)). That is fine for a modest number of active viewers, but not as the long-term real-time architecture for a large customer base.

### Webhooks

Webhook retries are done with in-process `setTimeout(...)` timers ([`webhook-delivery.ts`](../../src/server/lib/webhook-delivery.ts)). That is explicitly non-durable across restarts.

### Required target state

- heartbeat ingestion service or queue
- roll up health/heartbeat state separately from core transactional rows
- event bus backed by durable infrastructure (Postgres queue first, then NATS/Kafka/etc. if needed)
- durable webhook delivery workers
- separate live-status fanout layer (or at least cache/event stream abstraction) instead of raw DB-polling SSE for everything

## 5. Backups are not yet VPS-grade DR

Today you have:

- snapshots
- image publication
- host-local restore semantics

You do **not** yet have:

- automated off-host machine backup export
- tested restore workflows from object storage / secondary cluster
- RPO/RTO commitments backed by systems
- backup inventory, retention, and cost accounting as first-class platform primitives

The operator runbook already says the right thing: snapshots are not enough, and off-host backup is required for real DR ([operator runbook](../docs/specs/operator-runbook-scaling-and-backups.md)). Incus docs say the same thing: snapshots are not secure backups on their own ([How to back up an Incus server](https://linuxcontainers.org/incus/docs/main/backup/)).

### Required target state

- Postgres PITR / streaming backup
- periodic export of selected snapshots/images to object storage
- host bootstrap backup + configuration backup
- restore drills run regularly
- customer-facing backup semantics separated from operator DR backups

## Economics and capacity: what the current host class tells us

## Current V2 pricing envelope

Current V2 pricing is resource-based:

- `$3 / vCPU / month`
- `$1.50 / GB RAM / month`
- `$0.05 / GB disk / month` ([`v2-pricing.ts`](../../src/lib/v2-pricing.ts))

On your current hosts, theoretical max monthly revenue at 100% sold capacity is roughly:

| Host shape | Capacity basis | Theoretical monthly revenue |
| --- | --- | ---: |
| 12 vCPU / 62 GB / 435 GB | host 2 current reported totals | ~$150.75 |
| 12 vCPU / 62 GB / 460 GB | host 1 current reported totals | ~$152.00 |

Important: that is a **gross capacity ceiling**, not margin.

It excludes:

- host cost
- payment fees
- support
- backup storage
- engineering/ops overhead
- fraud/bad debt
- warm reserve opportunity cost

## Warm-pool reserve overhead on the current host class

In `runnerd`, warm reserve VMs are created with exact CPU bucket, but only **1 GiB RAM** and **10 GiB disk** before hotplugging upward on claim ([`runnerd/src/index.ts`](../../runnerd/src/index.ts)).

With your current policy:

- `POOL_CPU_BUCKETS=1,2`
- `WARM_POOL_PER_CPU=1`

Each host permanently reserves:

- **3 vCPU** (1 + 2)
- **2 GiB RAM**
- **20 GiB disk**

On a 12-vCPU host that means:

- **25% of CPU is reserved for warm-start inventory before selling anything**
- RAM/disk overhead is much smaller

That is the key economic lesson:

> Small host classes make warm pools CPU-expensive.

If you wanted warm buckets for `1,2,4,8` on this same 12-vCPU host, the reserve CPU requirement would be **15 vCPU**, which is impossible.

So the current `general-small` host class is fine for proving the model, but it is **not** the right long-term foundation if you want broad warm-start coverage across many sizes.

## Scaling math: current host class vs larger host class

If the average customer machine is roughly **2 vCPU**, and you reserve 3 vCPU per host for warm pools:

| Host class assumption | Sellable vCPU after reserve | Avg 2-vCPU machines/host | Hosts for 1k machines | Hosts for 10k machines | Hosts for 100k machines |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current AX41-style 12-vCPU host | 9 | 4.5 | 223 | 2,223 | 22,223 |
| Current AX41-style with 10% spare headroom | 8.1 | 4.05 | 247 | 2,470 | 24,692 |
| Hypothetical 48-vCPU host with same reserve | 45 | 22.5 | 45 | 445 | 4,445 |
| 48-vCPU host with 10% spare headroom | 40.5 | 20.25 | 50 | 494 | 4,939 |

### Implication

If you truly want **100k machines**, you do **not** want to do that primarily on 12-vCPU hosts. The ops burden becomes absurd.

That does not mean the current host class is wrong. It means:

- use it to validate the business and low-tier fast-start UX
- move the long-term platform toward **larger standardized host classes** for the mainstream pool
- keep smaller hosts only where they make sense operationally or regionally

## Incus features you should actually use

The full feature map is in the dedicated subreport ([Incus feature map](./incus-feature-map.md)). The most important distilled answer is:

## Use heavily now

- **Incus VMs** as the customer compute primitive ([Incus overview](https://linuxcontainers.org/incus/docs/main/))
- **Profiles** for product/default config composition ([How to use profiles](https://linuxcontainers.org/incus/docs/main/profiles/))
- **Projects** for infrastructure isolation boundaries, not as a full customer-account model ([Projects](https://linuxcontainers.org/incus/docs/main/explanation/projects/))
- **Local ZFS-style storage** (or equally simple local backend) for snapshots/clones ([Storage](https://linuxcontainers.org/incus/docs/main/explanation/storage/))
- **Images / snapshots / exports** as operational primitives, with backups built on top of export/copy ([How to back up an Incus server](https://linuxcontainers.org/incus/docs/main/backup/))
- **Metrics and events** behind your own control plane ([How to monitor metrics](https://linuxcontainers.org/incus/docs/main/metrics/))
- **TLS-based internal auth** and restricted certificate usage ([Authorization](https://linuxcontainers.org/incus/docs/main/authorization/))

## Use selectively later

- **Clustering**, but likely as **many small standardized cells**, not one giant heterogeneous cluster ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/))
- **OVN** only if/when you truly need richer tenant networking products ([OVN network](https://github.com/lxc/incus/blob/main/doc/reference/network_ovn.md))
- **Migration/live migration** for compatible host classes and controlled maintenance workflows, not as a blanket product promise ([Migration](https://linuxcontainers.org/incus/docs/main/migration/))
- **OpenFGA** if you eventually want more delegated internal auth patterns ([Authorization](https://linuxcontainers.org/incus/docs/main/authorization/))
- **Placement scriptlets** only as an augmentation to platform scheduling, not a replacement for it ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/))

## Probably avoid initially

- one giant heterogeneous Incus cluster
- customer-facing Incus API / Incus-as-customer-IAM
- Ceph/LINSTOR as the default substrate without a very strong reason
- snapshots-as-backups thinking

## My recommendation on clustering

For your ambition level, I would **not** jump straight from "independent hosts" to "one giant Incus cluster for everything."

Instead, use a **cell architecture**:

- cell = region × host class × generation
- each cell has standardized hardware/profile/storage/network assumptions
- each cell has its own capacity, warm pools, image replication policy, and failure domain

That can be implemented as:

- independent hosts under your current runner abstraction at first
- then, if useful, small Incus clusters per cell

That is a much saner path than a single mega-cluster.

## Security and reliability posture

## What is already good

- VM-first isolation model
- no direct customer Incus API exposure
- SSH-first + proxy-mediated public access
- heartbeat/watchdog/security telemetry model
- host-local failure domains

## What still needs to exist for a real cloud company

- host hardening baseline and drift detection
- secrets management / rotation program
- audit trails for operator actions
- break-glass workflow with logging/approval
- support impersonation controls
- abuse detection and containment program
- compliance evidence (especially if business customers matter)
- restore drills and incident response playbooks

This is the difference between "the infrastructure works" and "the business is trustworthy."

## What I would change next, in order

## Phase 1 — must do before calling it production-hardened

1. **Durable provisioning queue**
2. **Transactional host reservations / leases**
3. **Hot-path DB indexes**
4. **Durable webhook delivery queue**
5. **Off-host backup pipeline for DB + machine exports**
6. **Host drain / maintenance mode workflow**
7. **Standardize host substrate** (today the live fleet already shows mixed storage drivers: `zfs` vs `dir`)

## Phase 2 — must do before serious multi-region scale

1. **Heartbeat ingestion redesign** (separate hot telemetry from transactional DB rows)
2. **Image locality and replication policy**
3. **Scheduler v2** with:
   - warm-pool awareness
   - image locality
   - host class policy
   - reserve policy
   - drain awareness
4. **Fleet control split**: admin/API path should not trigger full reconcile on read
5. **Customer-visible backup / restore product semantics**

## Phase 3 — required for 10k–100k machine ambitions

1. **Cell architecture**
2. **Dedicated control-plane services**:
   - allocator
   - provisioner
   - telemetry ingestor
   - webhook dispatcher
   - routing state manager
3. **Time-series + event storage strategy** separate from primary OLTP tables
4. **Bigger standardized host classes** for mainstream capacity
5. **Formal cost/capacity model** per host class / region / reserve bucket

## Phase 4 — optional advanced platform evolution

1. cold migration between cells
2. controlled live migration within compatible host classes
3. OVN/private-cloud products
4. advanced auth delegation / OpenFGA
5. distributed storage only if product strategy truly demands it

## Bottom line

You are building on a substrate that can absolutely support a serious VPS business.

**Incus is not the weak point.**

The weak points today are the classic ones for an emerging cloud:

- control-plane durability
- scheduling correctness
- telemetry/write-path scaling
- DR maturity
- host-class economics

If you fix those five areas, the architecture can evolve into a very strong business.

If you do **not** fix them, you can still run a small fleet successfully, but scaling toward a true 100k-machine cloud will hurt badly and unpredictably.

My highest-confidence strategic recommendation is:

> Keep Incus. Keep the host-local runner idea. Keep warm pools. But move fast toward durable jobs, transactional reservations, proper backup/DR, and larger standardized capacity cells.

That is the path from "clever infra MVP" to "real cloud company."
