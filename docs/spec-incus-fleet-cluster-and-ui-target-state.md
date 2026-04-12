# JustAVPS Incus fleet, cluster, UI, and scale target state

Date: 2026-04-11

## TL;DR

- **Current shape:** one centralized JustAVPS control plane, plus **one local Incus daemon per bare-metal host** behind **one `runnerd` per host**.
- **Current scaling model:** add more bare-metal hosts, register them in JustAVPS, and let the control plane schedule onto them.
- **Current UI:** the real fleet-management UI today is **JustAVPS V2 Fleet Admin**, not a single global Incus UI.
- **Current Incus UI status:** there is **no exposed Incus web UI endpoint** on the live HEL1 hosts right now.
- **Recommended future shape:** **cells** first (`region × host class × generation`), then optionally **small Incus clusters per cell** where that gives clear operational value. **Do not build one giant heterogeneous global Incus cluster.**

## Direct answers

### 1. Do we have one central Incus or one Incus per node?

**Today: one Incus per node.**

Each bare-metal host is its own local compute unit:

- local **Incus daemon**
- local **storage**
- local **runnerd**
- local **warm pools**
- local host reverse-proxy / port-forward plumbing

The **central thing is JustAVPS**, not Incus:

- Next/API/UI control plane
- Postgres
- Cloudflare Worker/KV/DNS/broker routing
- fleet scheduler / control-plane services / procurement / reservations

So the current architecture is **central control plane + distributed host-local Incus daemons**.

### 2. Are all nodes already connected in one big cluster?

**No. Not today, and that is intentional.**

Right now the nodes are connected through the **JustAVPS control plane**, not through a shared Incus cluster database.

That means:

- JustAVPS knows all hosts in Postgres
- each host exposes `runnerd`
- JustAVPS schedules work to the host-local runner
- runnerd talks only to the host-local Incus

This keeps failure domains small and makes early operations simpler.

### 3. Is `zabbly/incus-ui-canonical` the “native” UI?

**It is the practical Incus web UI people use, yes — but it is not “our fleet UI.”**

It is effectively the Canonical/LXD UI fork rebased for Incus. It is useful for:

- one Incus server
- or one Incus cluster
- instance/storage/network/profile/project operations

But it is **not** the full JustAVPS operator plane for:

- billing
- product plans
- warm-pool economics
- fleet procurement
- host-class policy
- reserve budgets
- Cloudflare routing authority
- account/customer workflows

So it is a **substrate admin UI**, not the commercial cloud control plane.

### 4. Can we run the Incus admin UI right now?

**Not on the currently live JustAVPS hosts as-is.**

I checked both current HEL1 hosts on the usual Incus HTTPS/UI port `8443`:

- `https://135.181.129.188:8443` → no reachable response (`curl` returned `000`)
- `https://65.109.65.169:8443` → no reachable response (`curl` returned `000`)

So:

- there is **no exposed Incus UI endpoint** on the live hosts right now
- and because we do **not** currently run one global Incus cluster, there is also **no single central Incus UI** to show for the whole fleet

If we want an Incus UI, we can add it later **per host** or **per future cell-cluster**, but it would be an **operator substrate UI**, not the main customer/admin product UI.

## What we already have today

### Fleet / host management

Already real in JustAVPS V2 Fleet Admin:

- host inventory
- host maintenance / drain state
- cell model
- reserve budgets
- sellable vs reserve-only capacity
- procurement recommendations
- procurement workflow
- orphan cleanup
- control-plane service state
- config audit

### Compute lifecycle

Already real:

- create VMs on bare-metal-host-local Incus
- start / stop / reboot / delete
- snapshots
- image publish/delete
- golden image
- warm pool fast path
- proxy + terminal routing
- account/API-key/proxy-token auth plane

### Scale shape

Already directionally correct:

- add more hosts
- group them into **cells**
- schedule onto them from JustAVPS
- keep host-local failure domains small

## What is still missing for the “full cloud” target state

### A. Fleet topology / cluster strategy

We need to decide and document the target explicitly:

1. **Default recommendation:**
   - JustAVPS global control plane
   - many hosts
   - cells as the main fleet abstraction
   - **optionally** small Incus clusters inside a cell later

2. **Avoid:**
   - one giant global heterogeneous Incus cluster
   - one giant shared storage fabric too early

### B. Storage model

Need explicit answer per product tier:

- local ZFS/default host-local storage for standard VPS
- snapshot/export/backup pipeline for DR
- off-host backup retention and restore drills
- if customer-attached persistent block/shared volumes are desired later, define that separately

### C. Migration / relocation policy

Need explicit policy for:

- no live migration for mixed hardware cells
- cold relocation / recreate-on-target support
- backup-restore-to-new-host workflow
- optional live migration only within compatible homogeneous cell clusters

### D. Warm pools as a product/infrastructure service

Need explicit split between:

- **platform-managed** warm pool for the standard golden image
- **optional billable user warm pools** keyed by `(image, cpu_bucket, region/cell)`

This needs:

- reserve accounting
- per-cell budgets
- lifecycle/cleanliness guarantees
- cost controls

### E. Proper node lifecycle

Need strong operational primitives for:

- add host
- bootstrap host
- join cell
- warm image/image-locality seeding
- drain host
- evacuate / relocate / restore workloads
- remove host safely

### F. Unified operator UX

Need to keep two layers separate:

1. **JustAVPS Fleet UI**
   - business + fleet + control-plane truth

2. **Incus UI**
   - substrate inspection for operators only

Incus UI should be treated as a **debug/infra console**, not the primary operations source of truth.

## Recommended target architecture

### Near-term

- Keep the current architecture:
  - central JustAVPS control plane
  - host-local runnerd
  - host-local Incus
  - host-local storage
  - cell-aware scheduling

- Finish production hardening around:
  - durable control-plane jobs
  - host/node lifecycle
  - DR / restore / relocation
  - warm-pool economics
  - operator tooling

### Mid-term

- Standardize hosts into **homogeneous cells**
- Introduce **small Incus clusters per cell only if needed** for:
  - image replication
  - compatible in-cell migration
  - unified substrate operations inside that cell

- Keep JustAVPS as the true control plane above those cells

### Long-term

- Global JustAVPS cloud made of:
  - many cells
  - many hosts per cell
  - explicit reserve policy
  - image locality / replication policy
  - restore / relocation playbooks
  - optional user-paid warm pools
  - explicit host-class economics

## Concrete checklist for the “100% scalable cloud” target

- [ ] Global control plane remains independent from substrate details
- [ ] Cells become the first-class scale unit
- [ ] Host add/bootstrap/join/drain/remove is fully automated
- [ ] Snapshot + backup + restore + relocation workflows are operator-safe
- [ ] Warm pools are managed with explicit reserve economics
- [ ] Image locality / replication policy is explicit per cell
- [ ] Storage model is explicitly defined by product tier
- [ ] Resizing rules are defined end-to-end (CPU/RAM/disk, in-place vs recreate)
- [ ] Cross-host relocation path exists where needed
- [ ] Capacity and sellability policy is enforced at the cell level
- [ ] Per-node metrics and operator drill-down exist
- [ ] JustAVPS Fleet Admin remains the main operator UI
- [ ] Optional Incus UI is exposed only for operator substrate inspection

## Bottom line

The right answer is **not** “one global Incus cluster and call it done.”

The right answer is:

- **JustAVPS as the global cloud control plane**
- **cells as the scaling and economics unit**
- **Incus as the per-cell/per-host compute substrate**
- **runnerd as the node agent / host-local orchestrator**
- **optional Incus UI for substrate operators**, not as the main product control plane

That gives you something you can keep adding nodes to without turning the whole cloud into one brittle shared Incus control domain.
