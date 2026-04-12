# JustAVPS spec — warm-pool productization and storage economics

Date: 2026-04-11

## Purpose

This spec defines the production-grade target state for:

- platform-managed warm pools
- optional user-managed warm pools
- storage pool/product semantics
- capacity and utilization economics
- the pricing/control model needed to scale the fleet without hidden reserve leakage

This answers the practical question: **how do we keep adding nodes and still keep warm starts, storage, snapshots, and economics sane?**

---

## 1. Core principles

1. **Warm capacity is not free.** Any pre-warmed VM or pre-allocated reserve consumes real CPU/RAM/disk budget.
2. **Host-local storage is the default.** We do not assume globally shared storage semantics.
3. **Cells are the budgeting unit.** Reserve and sellability policy should be managed per cell, not per host in isolation.
4. **Golden-image warm pools are platform infrastructure.** They can be subsidized by the platform.
5. **Custom image warm pools are premium product behavior.** They should be explicit, budgeted, and billable.

---

## 2. Warm-pool classes

## A. Platform warm pool

This is the default JustAVPS fast-start pool.

### Scope

- image: official JustAVPS golden image only
- buckets: only the most common CPU buckets
- placement: distributed per cell according to reserve policy

### Product behavior

- invisible to the customer as a separate SKU
- included in the default platform experience
- used only where reserve budget allows it

### Operational rule

- warm pool targets are declared at the **cell** level
- actual per-host reserve inventory is derived from the cell target, not hand-managed ad hoc on each host

---

## B. User warm pool

This is an optional premium feature for faster starts on custom images or special templates.

### Keying model

Warm pools should be keyed by at least:

- `account_id`
- `image_id`
- `cpu_bucket`
- `region`
- optionally `cell_id`

### Product semantics

- explicit opt-in
- explicit per-bucket quantity target
- explicit billing
- explicit reserve visibility to the customer/operator

### Non-goals

- no hidden platform-wide warm reserve for arbitrary user images
- no broad “every image is warm everywhere” behavior

---

## 3. Warm-pool policy model

## A. Policy layers

There should be three layers of reserve policy:

1. **Burst reserve**
   - fast starts
   - warm pool inventory

2. **Procurement reserve**
   - headroom while waiting for new hosts

3. **Failure reserve**
   - enough spare to drain or lose hosts without immediate regional sellout

### Rule

All three must be tracked separately in capacity accounting.

---

## B. Target sizing model

For each cell, track:

- current active machine demand by CPU/RAM/disk bucket
- warm-claim rate by image and CPU bucket
- cold-start rate and latency percentile
- image locality hits/misses
- procurement lead time
- restore/relocation spare requirement

### Output decisions

Per cell, compute:

- platform warm reserve target
- user warm reserve target
- procurement reserve target
- failure reserve target
- sellable capacity after reserves

---

## C. Warm-pool cleanliness guarantees

Warm inventory must not rely on “we think it is clean.”

### Required guarantees

- role tagging: reserve vs customer machine is explicit
- identity reset proven before reserve is returned to pool
- SSH host identity/customer auth artifacts reset
- customer data/state scrubbed or rebuilt from immutable image discipline
- verification result recorded before a reserve becomes sellable again

### Target artifact

Each reserve candidate should have an attestation record including:

- image version
- scrub/reset timestamp
- validation status
- last claim time
- cell/host location

---

## 4. Storage product model

## A. Default root disk

### Recommended target

- local NVMe-backed ZFS-style storage per host/cell
- standard root disk for normal VPS products

### Product semantics

- root disk is attached to the machine and moves only through explicit relocation/restore workflows
- snapshots are local convenience features, not the sole backup guarantee

---

## B. Snapshots

### Product semantics

- user-controlled restore points
- fast revert/clone convenience
- billed separately if retention/usage exceeds included limits

### Explicit limitation

- snapshots are **not** durable off-host backups by default

---

## C. Backups

### Product semantics

- off-host export/copy based backups
- restoreable to the same host or another compatible host
- should expose retention class and restore objective clearly

### Billing dimensions

- protected machine count
- backup storage consumed
- backup frequency / retention class
- restore operations if applicable

---

## D. Future attached storage products

If attached data-disk products are added later, treat them separately from root disk.

### Product decisions required

- local-only attached disk vs portable data disk
- snapshot/backup semantics for attached volumes
- resize semantics for attached volumes
- relocation support requirements

This should **not** be hand-waved into the root-disk model.

---

## 5. Resize economics

## A. CPU/RAM resize

### Economic rule

- CPU/RAM resize consumes sellable capacity immediately
- acceptance must be based on projected post-resize reserve policy, not just current usage

### Customer semantics

- live / reboot / recreate class must be declared before applying the change

---

## B. Disk resize

### Economic rule

- disk growth affects not just root storage usage
- it also affects:
  - snapshot reserve needs
  - backup footprint
  - relocation/restore headroom

### Required control-plane accounting

Disk growth must be evaluated against:

- host disk target utilization
- cell disk sellability budget
- expected snapshot reserve
- expected image cache reserve

---

## 6. Utilization policy

## A. Cell-level hard caps

Target caps should be enforced on **projected post-placement/post-resize state**.

### Recommended starting policy

- CPU: 75–80%
- RAM: 70–75%
- Disk: 65–75%

These should be tunable by host class and cell role.

---

## B. Sellability model

Each cell should expose:

- total capacity
- used capacity
- reserved capacity
- sellable capacity
- utilization score
- reserve-breach risk

### Meaning

“Available” is not enough.

We need to distinguish:

- physically free
- policy-reserved
- actually sellable

---

## 7. Billing / SKU model for premium warm pools

## A. Proposed SKU dimensions

User warm pools should be billed by some combination of:

- image
- CPU bucket
- quantity target
- region/cell
- whether the reserve is always-on or burst-only

### Examples

- 1 warm slot for custom image X in HEL1, 1 vCPU
- 2 warm slots for custom image Y in HEL1, 2 vCPU
- regional warm reserve pack for a standard image family

---

## B. Required guardrails

- no user warm reserve creation without explicit capacity validation
- no hidden oversubscription of paid warm reserve
- no cross-cell promise unless the reserve is actually provisioned across cells

---

## 8. Required Fleet Admin views

Fleet Admin should eventually expose:

## Warm-pool views

- platform warm reserve targets by cell
- actual warm reserve inventory by host
- reserve shortfall / overfill
- warm-claim rate by CPU bucket
- custom image warm-pool allocations

## Storage/economics views

- per-cell storage utilization
- image cache reserve consumption
- snapshot reserve consumption
- backup reserve consumption
- projected sellable capacity after reserve budgets

## Operator actions

- adjust platform warm-pool targets
- suspend/refill reserve for a draining host
- seed image locality into a target cell
- approve/reject premium warm-pool requests if policy requires it

---

## 9. Capability checklist

- [ ] Platform warm pools are budgeted at the cell level
- [ ] User warm pools are explicit, billable, and keyed by image/cpu/region
- [ ] Warm-pool cleanliness is attested, not assumed
- [ ] Storage products distinguish snapshots from real backups clearly
- [ ] Resize paths account for reserve impact before approval
- [ ] Fleet Admin shows sellable vs reserved vs used capacity clearly
- [ ] Image locality and warm reserve policy are coordinated per cell

---

## 10. Implementation order

### Phase 1

1. formalize platform warm-pool target policy by cell
2. add reserve attestation/cleanliness model
3. expose richer storage reserve accounting in Fleet Admin

### Phase 2

1. define premium custom-image warm-pool SKU/API
2. connect pricing and capacity validation
3. expose cell-level warm-pool operations in Fleet Admin

### Phase 3

1. add attached-storage product decisions if needed
2. tune reserve policy using observed claim/restore data
3. evolve image locality replication policy per cell

---

## Bottom line

For JustAVPS to scale cleanly, warm pools and storage cannot remain “best effort infrastructure details.”

They must become explicit parts of the cloud operating model:

- budgeted
- visible
- policy-controlled
- productized where needed

That is how we keep fast starts, maintain storage sanity, and preserve utilization economics while continuously adding more nodes.
