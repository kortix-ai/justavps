# JustAVPS capacity economics and scaling model

Date: 2026-04-10

## Executive summary

**Facts from the current codebase and live local DB snapshot:**

- The control plane is centralized around the JustAVPS app/API, Postgres, and Cloudflare KV/DNS/Worker routing, while each compute node is an independent Incus + ZFS + runnerd + nginx unit.
- Warm-start today is an **exact-CPU warm reserve** model with cold boot fallback. Verified timings in repo are roughly **~4-5s warm** and **~27s cold**.
- The current live fleet snapshot shows **2 active `general-small` hosts in `hel1`**, each with about **12 vCPU / 62 GB RAM / 435-460 GB disk**.
- The current scheduler/control path is still small-fleet logic: full-host table reads, simple first-fit for V2 custom machines, reconcile loops that load all hosts/machines/images, and no transactional capacity reservation.

**Main conclusion:** the current architecture is directionally right for a multi-host VPS platform, but the **current host class and control-plane behavior do not economically or operationally scale to 100k machines unchanged**. The biggest blockers are:

1. **Host density/economics:** current `general-small` hosts are too shallow on CPU and especially disk for 100k-machine scale.
2. **Capacity accounting:** no hard reserve model, no transactional placement reservation, and warm-pool cost is implicit.
3. **Control-plane scaling:** reconcile and placement patterns are still O(fleet) style, not queue/shard driven.
4. **Data-plane scaling:** image locality, Cloudflare KV routing, backups, and observability all need dedicated scale designs.

My recommendation is to treat the current model as a **good 1k-machine architecture foundation**, a **10k-machine hardening target**, and **not yet a 100k-machine final architecture** unless JustAVPS introduces denser host classes, explicit reserve economics, and sharded fleet control.

---

## Scope and source basis

### Facts used

- `.kortix/CONTEXT.md`
- `docs/spec-incus-v2-provider.md`
- `.kortix/docs/specs/operator-runbook-scaling-and-backups.md`
- `.kortix/docs/specs/user-image-reserve-spec.md`
- `src/app/v2/admin/fleet/page.tsx`
- `src/server/lib/baremetal/reconcile.ts`
- `src/server/lib/baremetal/scheduler.ts`
- `src/server/lib/providers/baremetal.ts`
- `src/server/lib/v2/machines.ts`
- `src/server/routes/v2/catalog.ts`
- `src/lib/v2-pricing.ts`
- `src/lib/plan-catalog.ts`
- `runnerd/src/index.ts`
- live local Postgres snapshot of `baremetal_hosts` and `machines` on 2026-04-10

### Estimates used

Anything labeled **estimate** below is a planning assumption, not a repo fact.

---

## Current architecture facts that matter economically

### 1. The scalable unit is one host

Per the operator runbook, each compute node is its own:

- Incus daemon
- ZFS pool
- runnerd
- nginx reverse proxy
- warm reserve inventory

There is **no shared block storage, no live migration, and no automatic host failover**. That keeps the system simple, but it means scale comes from **adding many independent hosts**.

### 2. Warm reserve is real capacity consumption

`runnerd` keeps running reserve VMs by exact CPU bucket (`POOL_CPU_BUCKETS`, `WARM_POOL_PER_CPU`). That reserve:

- improves startup latency materially
- consumes host CPU/RAM/disk
- is not yet modeled as a separate regional reserve budget in the control plane

### 3. Placement is still small-fleet logic

Current placement behavior is not yet a large-scale scheduler:

- `src/server/lib/v2/machines.ts` reads all hosts and chooses the first active host in-region with enough free capacity
- `src/server/lib/providers/baremetal.ts` does similar host loading for custom-resource creation
- `src/server/lib/baremetal/scheduler.ts` has only a simple free-capacity filter + utilization score for plan-based placement
- there is **no DB-level reservation/lease** to stop concurrent overcommit races

### 4. Reconcile is O(fleet)

`reconcileBaremetalFleet()`:

- loads **all hosts**
- loads **all machines**
- loads **all images**
- then calls each runner host for state

That is fine at tens of hosts, acceptable at low hundreds with care, and becomes a serious bottleneck at high thousands.

### 5. Backups are economically incomplete today

Important mismatch in current repo state:

- V2 pricing can add a backup surcharge (`backupSurcharge`) in the machine create path
- but the bare-metal provider advertises `backups: false`
- the runbook says off-host backups are required, but the data plane is not the current default implementation

So the platform has **backup pricing hooks**, but not yet a complete **backup cost + recovery implementation**.

---

## Live fleet snapshot (fact)

Snapshot taken from local Postgres on 2026-04-10.

### Active hosts

| Host | Region | Class | vCPU | RAM GB | Disk GB | Used vCPU | Used RAM GB | Used Disk GB |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| `bm-general-small-HEL1-ed822eae` | hel1 | general-small | 12 | 62 | 460 | 9 | 14 | 180 |
| `bm-general-small-HEL1-a1e0cdbc` | hel1 | general-small | 12 | 62 | 435 | 6 | 7 | 70 |

### Fleet totals

| Metric | Value |
|---|---:|
| Active hosts | 2 |
| Total vCPU | 24 |
| Total RAM | 124 GB |
| Total disk | 895 GB |
| Used vCPU | 15 |
| Used RAM | 21 GB |
| Used disk | 250 GB |

### Bare-metal machine snapshot

| Metric | Value |
|---|---:|
| Bare-metal machines (non-deleted) | 6 |
| Ready | 5 |
| Provisioning | 1 |
| Avg requested vCPU | 1.67 |
| Avg requested RAM | 3.00 GB |
| Avg requested disk | 36.67 GB |

### What that implies

- Customer-requested machine load is about **10 vCPU / 18 GB / 220 GB** total.
- Host-used load is **15 vCPU / 21 GB / 250 GB** total.
- The gap is roughly **+5 vCPU / +3 GB / +30 GB** of non-customer overhead, which is consistent with warm-pool and orphan-instance overhead already showing up in reconcile metadata.

So even on the tiny live fleet, **reserve capacity is already a visible economic cost center**.

---

## Current host-level unit economics assumptions

## Fact: current sell pricing in repo

### V2 custom resource pricing

| Resource | Sell price |
|---|---:|
| vCPU | $3.00 / month |
| RAM | $1.50 / GB / month |
| Disk | $0.05 / GB / month |

### Legacy plan pricing

| Plan | Price |
|---|---:|
| Starter | $12 |
| Basic | $21 |
| Pro | $39 |
| Power | $56 |
| Ultra | $77 |

## Fact: current pricing logic assumptions

- Legacy plan catalog assumes **2x provider cost**, rounded up.
- V2 pricing is **resource-rate based**, not derived from actual host lease cost.
- Backup surcharge logic exists (+20%), but the bare-metal provider does not yet offer actual backups.

## Estimate: monetization ceiling of the current live host class

Using the **average live host shape** (~12 vCPU / 62 GB / 448 GB):

### Theoretical max monthly sell-through at 100% full

`12*3 + 62*1.5 + 448*0.05 ≈ $151/month`

### Practical max at safer operating caps

If JustAVPS caps at about **75% CPU / 70% RAM / 70% disk**:

`9*3 + 43*1.5 + 314*0.05 ≈ $108/month`

That is **before** accounting for:

- warm reserve capacity
- host failures / spare capacity
- payment fees
- support / ops labor
- backup storage and transfer
- control-plane infra

### Estimate: current live average machine revenue

For the observed average machine size (**1.67 vCPU / 3 GB / 36.67 GB**), V2 raw price is:

`1.67*3 + 3*1.5 + 36.67*0.05 ≈ $11.34`, which rounds to **about $12/month**.

If the current host class safely carries only about **5 machines/host** at target caps, that implies only about **$60/month host revenue** at this average mix.

**Implication:** the current `general-small` host class is probably fine for MVP validation, but it is unlikely to be the long-run economically efficient class for a 100k-machine fleet.

---

## Missing inputs for real unit economics

These are the biggest missing inputs preventing a true gross-margin model:

| Missing input | Why it matters |
|---|---|
| Actual monthly lease cost per host class | Needed for gross margin and payback |
| Disk layout details (usable vs raw, ZFS overhead, snapshot reserve) | Current hosts look disk-constrained first |
| Warm reserve target by CPU bucket and region | Reserve cost is real and grows nonlinearly with fragmentation |
| Procurement lead time by vendor/region | Determines required spare capacity |
| Failure budget (host failure rate, SSD replacement, reinstall rate) | Needed for true reserve and replacement policy |
| Off-host backup cost per GB-month and restore bandwidth | Required to price backups honestly |
| Support cost per active machine / account | At 10k+ and 100k+, support becomes material |
| Payment fees / bad debt / refund rate | Needed for real net margin |
| Image cache hit rate and transfer cost | Impacts custom image launch cost and latency |
| Network egress and broker routing cost | Becomes visible at scale |

Until these are measured, the right planning mindset is: **treat current economics as approximate and reserve-heavy**.

---

## Utilization / reserve / warm-pool tradeoffs

## Core tradeoff

Warm pools buy latency by pre-paying capacity.

| Policy | Startup UX | Capacity efficiency | Operational risk |
|---|---|---|---|
| Cold only | Slowest | Highest | Lower infra complexity |
| Small warm pool on common buckets | Good | Moderate | Best current default |
| Aggressive per-host warm pools on many buckets | Best | Worst | High fragmentation and hidden cost |

## Why this is tricky on JustAVPS specifically

- Machines are pinned to one host.
- Storage and image caches are host-local.
- Host procurement is slow relative to VM placement.
- CPU buckets matter because CPU cannot be resized as flexibly as RAM/disk in the current VM model.

That means JustAVPS must reserve for **three different reasons**:

1. **Burst reserve**: warm slots for fast starts
2. **Procurement reserve**: headroom while waiting for new hosts
3. **Failure reserve**: enough spare to drain or lose hosts without regional sell-out

---

## Recommended utilization targets and reserve policy

## Recommended per-host hard caps

These should be enforced on **projected post-placement utilization**, not only observed current usage.

| Resource | Recommended target cap | Why |
|---|---:|---|
| CPU | 75-80% | protects noisy-neighbor risk and warm-pool claims |
| RAM | 70-75% | VMs behave badly when memory headroom is thin |
| Disk | 65-75% | leaves room for snapshots, image cache, rebuilds, and local recovery |

For the current `general-small` class, I would bias conservative: **75% CPU / 70% RAM / 70% disk**.

## Recommended regional spare capacity policy

| Stage | Regional spare target | Notes |
|---|---:|---|
| 1k machines | 10-15% + at least one host per active region | procurement is slow and humans are still in loop |
| 10k machines | 8-10% + N+1 per major region | enough to survive one host loss and normal burst |
| 100k machines | 5-8% + N+2 for large regions / host-group reserve | requires forecast-driven procurement |

## Recommended warm-pool policy

### Near term

- Keep warm pools only for the **golden image** and the most common CPU buckets.
- Prefer **1 vCPU and 2 vCPU** buckets first; add 4 vCPU only when data shows it matters.
- Do **not** keep broad per-host warm pools for many image variants.

### Product policy

- Platform golden image reserve can stay a platform cost.
- Custom image reserve should be **explicit and billable** by `(image_id, cpu_bucket)`.

### Reserve budgeting rule

Warm reserve should be budgeted at the **region level**, then distributed to hosts. Otherwise the fleet will fragment badly as host count grows.

---

## Capacity planning model across many hosts and regions

## Recommended planning formula

For each region and host class, track:

- active machines by CPU/RAM/disk bucket
- warm-claim rate by image and CPU bucket
- placement failures / near-misses
- host procurement lead time
- disk growth from snapshots/images

Use this model:

`effective_slots_per_host = min(cpu_cap/avg_cpu, ram_cap/avg_ram, disk_cap/avg_disk)`

Where:

- `cpu_cap = host_cpu * target_cpu_util - warm_cpu_reserve`
- `ram_cap = host_ram * target_ram_util - warm_ram_reserve`
- `disk_cap = host_disk * target_disk_util - image_cache_reserve - backup/snapshot_reserve`

Then:

`hosts_needed = ceil(machine_count / effective_slots_per_host) * (1 + regional_spare)`

## Operationally important point

At scale, the binding resource is unlikely to be the same everywhere:

- low-end plans often become **disk-bound** first
- mid tiers often become **CPU-bound** first
- custom image usage creates **cache-locality constraints** that behave like a fourth capacity dimension

---

## Recommended scaling stages

## Planning assumption for concrete examples

To keep the stage model concrete, I use this **estimate** based on the live bare-metal fleet snapshot:

- average machine = **1.67 vCPU / 3 GB / 36.67 GB disk**
- current safe cap on current host class = **~5 customer machines/host**
- reserve overhead handled by a separate **10% / 8% / 6%** spare multiplier by stage

This is only an estimate, but it is grounded in the current live fleet rather than generic cloud assumptions.

### Stage model using the current live `general-small` host class

| Stage | Effective machines/host (estimate) | Base hosts | Spare policy | Total hosts needed | Read as |
|---|---:|---:|---:|---:|---|
| 1k machines | 5 | 200 | 10% | ~220 | viable but already ops-heavy |
| 10k machines | 5 | 2,000 | 8% | ~2,160 | requires major control-plane hardening |
| 100k machines | 5 | 20,000 | 6% | ~21,200 | not realistic on current host class |

### What this means

- **1k machines:** current architecture can plausibly work if procurement, reconciliation, backups, and observability are tightened.
- **10k machines:** current architecture needs major scheduler/reconcile/routing hardening.
- **100k machines:** current host class count becomes so large that fleet operations, disk footprint, support, and vendor procurement all become dominant problems.

## Recommended production path for 100k+

To make 100k machines plausible, JustAVPS should assume at least one denser production host class and a more centralized reserve allocator.

Examples of what must change:

- larger host classes with materially more CPU and disk per operational unit
- image-locality-aware placement
- queue-based placement with transactional reservations
- sharded reconcile / host-state ingestion
- explicit backup/export pipeline
- routing and broker tiers sized independently from compute nodes

---

## Bottlenecks by stage

## 1k machines

### Primary bottlenecks

- **Procurement latency**: buying hosts is slower than scheduling VMs.
- **No transactional reservations**: concurrent creates can race on the same free capacity.
- **Backups not production-complete**: recovery posture is weaker than a true VPS platform needs.
- **Single-region concentration**: live snapshot is still HEL1-only.

### What must exist by 1k

- host draining API/UI
- off-host Postgres backup and tested restore
- off-host image/snapshot export for important machines
- placement guardrails for CPU/RAM/disk caps
- basic procurement forecasting

## 10k machines

### Primary bottlenecks

- **DB/query pattern**: full host reads and O(fleet) reconcile loops become too expensive.
- **Scheduler sophistication**: current logic ignores image locality, reserve locality, and anti-fragmentation strategy.
- **Fleet control fanout**: one control plane polling many runnerd hosts will strain.
- **Image locality**: cold imports across many hosts and regions will hurt both cost and latency.
- **Cloudflare KV routing**: per-machine routing metadata becomes a real operational data plane.
- **Observability cardinality**: per-machine events, heartbeats, and metrics explode.
- **Support/on-call load**: even low ticket rates become meaningful at this fleet size.

### What must exist by 10k

- queue-based placement service
- reservation leases in DB
- sharded host-state ingestion / reconcile workers
- image-cache index and locality-aware scheduler
- explicit regional capacity planner
- mature host draining and maintenance workflows
- standardized runbooks and alert routing

## 100k machines

### Primary bottlenecks

- **Postgres as the only central source of scheduling truth** if kept in the current access pattern
- **Scheduler throughput** for create/delete/resize/image operations
- **Fleet control topology** across thousands of hosts
- **Image distribution** for many regions and custom-image permutations
- **Network/routing layer**: broker, Cloudflare KV, origin-port mapping, and per-machine auth lookups
- **Backup data plane**: exporting and restoring at fleet scale becomes its own platform
- **Observability cost**: logs, metrics, traces, heartbeats, and audit events become a major budget item
- **Support and abuse operations**: 100k machines is a real service organization, not just software
- **Vendor concentration / stock risk** if procurement stays single-vendor and manual-ish

### What must exist by 100k

- sharded scheduler/control plane
- event-driven host state rather than mostly polling/full scans
- regional image-distribution service
- dedicated backup/restore control plane
- routing/auth data plane sized independently from app DB
- capacity forecasting with procurement automation
- multi-region, probably multi-vendor supply strategy

---

## Specific architectural recommendations

## 1. Make reserve explicit in the scheduler

Today reserve cost is implicit. Add explicit fields or derived views for:

- sellable capacity
- warm reserve capacity
- maintenance/drain reserve
- failure reserve

Placement should never use raw host totals directly.

## 2. Add placement leases

Before 10k machines, machine creation should take a short-lived reservation lease so parallel creates cannot oversell the same host.

## 3. Separate host-state ingestion from synchronous create paths

Avoid full-fleet reconcile in create hot paths. Host state should be continuously ingested and cached for schedulers.

## 4. Make image locality a first-class scheduling dimension

At 10k+, image locality will be as important as CPU/RAM/disk for startup latency and network cost.

## 5. Treat backups as a separate product-cost model

Do not rely on the current backup surcharge hook alone. Backups need:

- storage class choice
- retention policy
- export bandwidth budget
- restore SLOs
- verified recovery drills

## 6. Introduce denser host classes before chasing 100k machines

Based on the current live host sizes, 100k machines on the current `general-small` class would imply an impractically large host fleet. A 100k path likely needs:

- bigger CPU pools per host
- much more disk per host
- fewer operational units per machine sold

---

## Bottom line

### Best short read

- **1k machines:** the current architecture is credible if hardened.
- **10k machines:** the current architecture needs scheduler, reserve, backup, and routing redesigns, but can still stay on the same basic model.
- **100k machines:** the current **architecture pattern** can survive, but the current **host class, reconcile style, and reserve model cannot**.

### Recommended policy

- target **75-80% CPU**, **70-75% RAM**, **65-75% disk** caps
- maintain **10-15% spare at 1k**, **8-10% at 10k**, **5-8% at 100k** plus regional host-failure reserve
- keep warm reserve **small, regional, and focused on common buckets/images**
- make custom-image reserve **explicit and billable**

### Strategic conclusion

JustAVPS should treat the current setup as a **solid multi-host MVP substrate**, then evolve it into:

1. **1k-machine reliable platform**
2. **10k-machine capacity-aware fleet**
3. **100k-machine sharded service**, likely with denser hosts and a more industrial control plane
