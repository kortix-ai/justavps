# JustAVPS spec — host lifecycle, resize semantics, and relocation model

Date: 2026-04-11

## Purpose

This spec turns the cloud target-state documents into concrete operational behavior for three missing production-grade capabilities:

1. **host lifecycle automation**
2. **instance resize semantics**
3. **instance relocation / migration policy**

These are required before we can honestly say the platform is a scalable cloud operator system rather than a strong provisioning MVP.

---

## 1. Scope

This spec covers:

- adding a new bare-metal node
- validating and activating a node
- draining / maintenance / retirement
- customer-visible resize operations
- operator relocation operations
- when live migration is allowed vs explicitly forbidden

This spec does **not** change the top-level architecture:

- global JustAVPS control plane
- cells as the main scaling unit
- one local runnerd + local Incus per host initially
- optional small Incus clusters inside homogeneous cells later

---

## 2. Terminology

- **Host**: one physical bare-metal server
- **Cell**: `region × host_class × generation`
- **Resize**: change CPU/RAM/disk entitlement for an existing machine
- **Relocation**: move a machine from one host to another host
- **Cold relocation**: stop → export/restore or recreate on target → cut over
- **Live migration**: no-downtime in-memory handoff between compatible hosts

---

## 3. Host lifecycle target state

## A. Host states

Every host should have a lifecycle state machine distinct from maintenance intent.

### Proposed host lifecycle states

- `ordered`
- `bootstrapping`
- `validating`
- `active`
- `drain_requested`
- `draining`
- `drained`
- `maintenance`
- `retiring`
- `retired`
- `failed`

### Rules

- only `active` hosts are schedulable
- `drain_requested` stops new placements immediately
- `draining` means active evacuation/cleanup work is in progress
- `drained` means no customer machines remain and the host can safely undergo maintenance or retirement
- `failed` means unexpected breakage, not planned maintenance

---

## B. Host add/bootstrap flow

### Required operator flow

1. **Procure host**
2. **Bootstrap base OS**
3. **Install substrate**
   - Incus
   - chosen storage pool backend
   - runnerd
   - host reverse-proxy plumbing
   - monitoring / logging / security baseline
4. **Register host in control plane**
5. **Assign host to cell**
6. **Run validation suite**
7. **Seed image policy / warm pool policy**
8. **Mark host active**

### Validation gate before `active`

The control plane should not mark a host active until all of these are proven:

- runnerd authenticated and reachable
- Incus reachable via runnerd
- storage pool matches expected cell standard
- image import/publish path works
- VM create/start/delete smoke test works
- public routing / proxy device test works
- daemon injection / heartbeat test works
- warm-pool fill succeeds for required base buckets

### Deterministic verification for host activation

Each host activation should leave a recorded validation artifact:

- validation timestamp
- runnerd version
- Incus version
- storage driver
- smoke-test machine ID/result
- image seed result
- warm-pool readiness result

That artifact should be visible in Fleet Admin.

---

## C. Host drain / maintenance / retirement

### Drain goals

When a host is drained:

- no new placements land there
- warm reserves are not refilled there
- customer machines are either:
  - stopped and left intentionally
  - relocated
  - restored elsewhere
  - or explicitly acknowledged as blockers

### Required drain report sections

- active running customer machines
- stopped machines still retaining disk
- warm-pool inventory still present
- snapshots/backups pending export
- port/routing allocations still pinned to the host
- relocation blockers
- image cleanup blockers

### Maintenance workflow

1. set `drain_requested`
2. scheduler blocks new placements
3. warm-pool refill suspended for that host
4. operator resolves blockers / triggers relocations
5. host reaches `drained`
6. host enters `maintenance`
7. after validation, host returns to `active`

### Retirement workflow

1. drain host fully
2. remove all workload/routing references
3. archive host metadata and validation history
4. mark `retired`
5. keep retired rows queryable for audits

---

## 4. Resize semantics target state

## A. Resize categories

We must explicitly support three resize classes:

### 1. CPU/RAM metadata-only or hot-capable resize

Allowed only when:

- substrate supports it safely for the machine class
- profile/device model supports it
- guest behavior is acceptable

### 2. Reboot-required resize

Allowed when:

- Incus/guest can apply the new CPU/RAM/disk config after stop/start
- the host still has capacity after reserves

### 3. Recreate-required resize

Used when:

- plan change crosses host-class or placement policy boundaries
- storage/network/profile incompatibility exists
- in-place change is unsafe or unsupported

---

## B. Required resize API semantics

For every requested resize, the control plane must return one of:

- `applied_live`
- `scheduled_reboot`
- `scheduled_recreate`
- `rejected_capacity`
- `rejected_policy`
- `rejected_unsupported`

### Required validation before accepting resize

- target host still has cell-legal sellable capacity
- reserve policy remains intact after resize
- port/routing model still valid
- plan-to-host-class policy is satisfied
- disk growth semantics are supported for the requested filesystem/product tier

---

## C. Disk resize policy

Disk resize must be explicit about two layers:

1. **virtual disk capacity change**
2. **guest filesystem growth**

### Product rule

- increasing disk should be supported
- shrinking disk should **not** be offered as an in-place operation by default
- if disk shrink is ever allowed, it should be implemented as a recreate/migration workflow only

### Required customer/operator visibility

Every disk resize operation should report:

- substrate disk changed: yes/no
- guest filesystem expanded automatically: yes/no
- reboot required: yes/no
- manual in-guest step required: yes/no

---

## 5. Relocation model target state

## A. Default stance

The default supported operator relocation path should be **cold relocation**, not live migration.

### Why

- mixed hardware fleet
- host-local storage by default
- smaller failure domains
- more predictable operational semantics

### Standard relocation reasons

- host drain
- hardware refresh
- capacity rebalance
- noisy-neighbor remediation
- cell policy correction

---

## B. Cold relocation workflow

### Target behavior

1. validate target host/cell
2. reserve target capacity
3. quiesce source machine
4. snapshot/export/copy required state
5. recreate or restore on target host
6. verify daemon heartbeat and public routing on target
7. cut over routing/auth references
8. release source reservations/ports
9. either delete source instance or hold for rollback window

### Required modes

- `recreate_from_image`
- `restore_from_snapshot`
- `restore_from_backup_artifact`

### Required operator output

- source host
- target host
- relocation reason
- estimated downtime class
- rollback availability window
- final cutover proof

---

## C. Live migration policy

Live migration should be **optional and constrained**, not assumed globally.

### Only allow if all are true

- hosts are in the same compatible homogeneous cell or compatible cluster group
- CPU baseline compatibility is proven
- storage/network assumptions are compatible
- the feature is explicitly enabled for that cell/product tier

### Explicitly do not promise

- live migration across mixed generations/vendors
- live migration across arbitrary cells/regions
- zero-downtime mobility as a universal platform guarantee

---

## 6. Fleet UI / operator UI requirements

Fleet Admin should eventually expose:

## Host lifecycle panel

- host lifecycle state
- last validation pass
- substrate profile (Incus/storage/network standard)
- warm-pool readiness
- drain blockers
- relocation candidates

## Resize panel per machine

- current entitlement
- allowed resize targets
- whether change is live / reboot / recreate
- capacity/policy validation result

## Relocation panel per machine

- source host/cell
- eligible target hosts/cells
- relocation mode options
- downtime expectation
- backup/snapshot requirement

Incus UI, if later enabled, remains optional substrate visibility only.

---

## 7. Capability checklist

- [ ] Host bootstrap is fully automated and validation-gated
- [ ] Host activation requires a recorded smoke-test artifact
- [ ] Drain workflow is first-class and blocks new placements immediately
- [ ] Resize API exposes live vs reboot vs recreate semantics explicitly
- [ ] Disk growth behavior is explicit and audited
- [ ] Cold relocation is supported as a first-class operator workflow
- [ ] Live migration is optional and limited to compatible homogeneous cells only
- [ ] Fleet Admin exposes host lifecycle, resize, and relocation state

---

## 8. Recommended implementation order

### Phase 1

1. host validation artifact + activation gate
2. stronger drain workflow + blocker reporting
3. resize semantics spec mapped onto API contracts

### Phase 2

1. cold relocation workflow with restore-backed cutover
2. Fleet Admin relocation actions
3. host retirement workflow

### Phase 3

1. selective live migration inside compatible cells if still justified
2. productized user-facing resize experiences
3. customer-visible maintenance/relocation status UX

---

## Bottom line

To be truly production-ready at cloud scale, JustAVPS needs to make these truths explicit:

- hosts are lifecycle-managed assets, not just rows with capacity
- resize is a product workflow with declared semantics, not an ad hoc infra action
- relocation is primarily a controlled cold operation unless a compatible cell explicitly supports live migration

That is the path to a cloud that can keep adding nodes, keep operating safely, and keep evolving without collapsing into unclear operator behavior.
