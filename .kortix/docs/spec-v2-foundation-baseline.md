# JustAVPS V2 foundation baseline — regions, cells, projects, IncusOS, limits, and isolation

Status: proposed  
Date: 2026-04-18  
Owner: platform / infra / product

---

## 0. Why this spec exists

Before polishing Daytona/E2B-style instance DX, we need the **substrate basics** to be boring and reliable.

This spec defines the minimum robust foundation V2 should have for:

- regions
- cells
- hosts
- IncusOS / host bootstrap baseline
- Incus projects
- Incus profiles
- limits and quota materialization
- container isolation defaults
- operator-only substrate exposure

This is not the full V3 “generalized Incus cloud” vision.

It is the **minimum strong base** that keeps V2 from being fragile.

---

## 1. Current reality and the biggest gaps

The good news:

- cells already exist in the DB and scheduler model
- host lifecycle, reserve policy, capacity snapshots, and procurements already exist
- control-plane jobs/reservations already exist
- container and VM runtime split already exists in runnerd

The biggest foundational gaps are:

1. **Host bootstrap is still MVP-shaped**
   - current `20-configure-incus.sh` seeds a minimal Incus config
   - default storage driver is still `dir`
   - no first-class Incus project/profile bootstrap exists

2. **Incus project strategy is not yet materialized in the runtime**
   - we have docs and intent, but not a fully enforced project baseline

3. **Profile strategy is not yet explicit enough**
   - container hardening is partially encoded in runtime args
   - that needs to become a clearer platform policy

4. **Quota/limits are not yet clearly materialized into Incus primitives**
   - account/cell limits exist conceptually
   - project-level Incus limits/restrictions need a clean baseline

5. **IncusOS is a strategy, not yet the clear default operational baseline**
   - we need an explicit rule for new hosts

---

## 2. The baseline architecture we should lock

## 2.1 Region

Region is:

- customer-selectable
- placement boundary
- quota/accounting boundary at the product layer
- composed of one or more cells

## 2.2 Cell

Cell is the primary operating unit.

Canonical identity:

`region × host_class × generation × runtime_policy_slice`

Each cell must own:

- admission state
- sellability state
- reserve policy
- image locality policy
- procurement targeting
- preferred runtime mix (`container-first`, `vm-capable`, etc.)

## 2.3 Host

Every host must have:

- exactly one cell membership
- one bootstrap profile
- one validation artifact history
- one maintenance state
- one drift state

No host should be treated as an unlabeled snowflake.

---

## 3. IncusOS baseline

## 3.1 Target rule

For **new production hosts**, the target baseline should be:

- **IncusOS first**

Use Debian/Ubuntu bootstrap only as:

- existing-fleet compatibility
- lab/dev fallback
- temporary migration bridge

## 3.2 Why

IncusOS gives us the right operating posture for this product:

- immutable host image
- API-only management
- TPM-backed encryption
- Secure Boot
- A/B atomic updates
- lower drift risk

That is exactly the kind of boring substrate we want under an agent-instance platform.

## 3.3 Minimum production checks for IncusOS hosts

For every IncusOS-backed production host, store in the validation artifact:

- secure boot enabled
- TPM status healthy
- recovery keys retrieved and escrowed operationally
- Incus version
- storage pool info
- network baseline status
- runnerd version

---

## 4. Host bootstrap baseline

## 4.1 Current problem

Current bootstrap is too thin:

- minimal `incus admin init --preseed`
- default bridge only
- no Incus project/profile materialization
- default storage driver can still be `dir`

That is fine for bootstrap MVP work, but not good enough as the long-term base.

## 4.2 Required bootstrap phases

Every host bootstrap should execute and record:

1. procure / identify host
2. install base OS (IncusOS preferred)
3. install substrate runtime (Incus, runnerd, required helpers)
4. configure storage baseline
5. configure network baseline
6. configure operator-only Incus API exposure
7. seed required profiles/projects/images
8. run validation suite
9. mark host active only if validation passes

## 4.3 Minimum validation suite

Before a host can become `active`, it must prove:

- runnerd reachable and authenticated
- Incus ready
- storage pool correct
- create/start/delete smoke test works
- container create path works
- routing/preview plumbing works
- image import/locality path works
- warm pool fill works for required buckets
- baseline project/profile creation works

---

## 5. Storage baseline

## 5.1 Immediate rule

The default production storage baseline for new mainstream hosts should be:

- **ZFS**, not `dir`

## 5.2 Why

We care about:

- fast clone/launch behavior
- better snapshot ergonomics
- stronger operational predictability

`dir` is acceptable for dev/test, but it should not be the default production baseline we build around.

## 5.3 Product impact

This directly improves:

- container cold launch
- snapshot/restore ergonomics
- warm-pool refill behavior

---

## 6. Incus project baseline

This is one of the most important missing foundational pieces.

## 6.1 Role of Incus projects in V2

Incus projects should be treated as:

- **cell-local substrate isolation and policy boundaries**

The global tenant/account truth still lives in the JustAVPS control plane.

## 6.2 Minimum project types we should support

At minimum, V2 should have explicit project classes like:

### A. Platform reserve / warm pool project

For:

- platform-owned warm reserve instances
- internal staging/claim flows

### B. Customer workload project(s)

For:

- customer-owned instances in a given cell

### C. Operator / break-glass debug project

For:

- restricted internal use only

## 6.3 Required project config baseline for customer workload projects

The customer workload project baseline should include:

- `restricted=true`
- `limits.instances`
- `limits.cpu`
- `limits.disk`
- `features.images` explicit by policy
- `features.profiles` explicit by policy
- `features.networks` explicit by policy
- `features.storage.volumes` explicit by policy

And the key restrictions should default to:

- `restricted.containers.privilege=unprivileged`
- `restricted.containers.nesting=block`
- `restricted.containers.interception=block`
- `restricted.containers.lowlevel=block`
- `restricted.virtual-machines.lowlevel=block`
- `restricted.devices.disk=managed`
- `restricted.devices.nic=managed`
- `restricted.devices.gpu=block` unless the cell/product explicitly supports GPU
- `restricted.cluster.target=block`
- `restricted.snapshots=allow` or `block` by product policy, but explicit
- `restricted.backups=allow` or `block` by product policy, but explicit
- `restricted.networks.access=<approved managed networks only>`

## 6.4 Important rule

Customer workloads must not rely on:

- privileged containers
- raw low-level Incus config
- arbitrary host path mounts
- arbitrary network names
- arbitrary device passthrough

If a product path needs an exception, it must be explicit and cell/preset-based.

---

## 7. Profile baseline

Profiles should become the main reusable substrate policy units.

## 7.1 Required profile set

At minimum we should standardize:

### `platform-container-default`

Baseline container behavior.

### `platform-container-hardened`

Security-first container additions.

### `platform-vm-default`

Default VM behavior.

### `platform-warm-pool`

Reserve/warm-pool behavior.

### `platform-operator-debug`

Internal operator-only path, tightly restricted.

## 7.2 Container hardening defaults

For mainstream customer containers, defaults should be explicit:

- `security.privileged=false`
- `security.idmap.isolated=true`
- `security.nesting=false`
- syscall interception disabled unless explicitly needed
- no low-level/raw overrides
- explicit CPU/memory/disk limits on every instance

If we need a “nested/container-builder” preset later, it should be separate and explicitly risky.

## 7.3 Why profiles matter

Right now some of this logic lives in runner launch args.

That is fine short-term, but the **platform policy** needs a clearer home.

Profiles make the system more:

- inspectable
- repeatable
- testable
- auditable

---

## 8. Limits and quota materialization

## 8.1 Required layers of limits

We need three different layers to be explicit.

### A. Product/account limits

Owned by JustAVPS:

- org/account quota
- plan quota
- regional quota

### B. Cell sellability and reserve limits

Owned by the fleet/capacity system:

- reserve budget
- sellable capacity
- admission state

### C. Incus project limits

Materialized into Incus:

- `limits.instances`
- `limits.cpu`
- `limits.disk`
- any other project-scoped limits we choose to use

## 8.2 Important rule

The control plane should remain the canonical quota authority.

But Incus project limits should still exist as a **substrate guardrail**, not just a documentation idea.

## 8.3 Per-instance limits

Every created instance should always have explicit:

- CPU limit
- memory limit
- disk size

And for containers, we should strongly consider explicit:

- process count limit where product-safe

No “best effort unlimited container” defaults.

---

## 9. Networking baseline

## 9.1 Customer networking stance for V2

V2 should keep networking simple and robust.

The baseline is:

- managed host/cell networking internally
- preview/proxy/SSH through the JustAVPS access plane
- no public Incus endpoint for customers

## 9.2 Incus exposure rule

Incus HTTPS / UI should be:

- operator-only
- private/VPN-only where possible
- never a customer-facing control plane

## 9.3 Project network restrictions

Customer projects should only be allowed to use:

- approved managed networks
- approved uplinks
- approved access patterns

No arbitrary NIC/network combinations.

---

## 10. Concrete implementation priorities

This is the actual implementation list I would do now.

## P0 — must do next

### 1. Replace the current production bootstrap baseline

- stop treating `dir` as the production default
- make ZFS the mainstream production baseline
- add explicit host bootstrap profile/versioning
- record structured validation artifacts

### 2. Define and materialize project classes

- create platform reserve project baseline
- create customer workload project baseline
- define internal operator/debug project baseline

### 3. Materialize restricted project config

- `restricted=true`
- explicit restriction keys
- explicit network access restrictions
- explicit limits

### 4. Define and seed the required profiles

- container default
- container hardened
- vm default
- warm pool
- operator debug

### 5. Make IncusOS the preferred new-host baseline

- document transitional fallback for old hosts
- add validation fields for secure boot / TPM / recovery-key handling

## P1 — should do right after

### 6. Move more runtime policy from ad hoc launch args into inspectable profile/project policy

### 7. Add project/profile smoke tests into bootstrap validation

### 8. Expose project/profile/baseline posture in Fleet Admin

### 9. Add cell-level runtime policy slice field if needed (`container-first`, `vm-mixed`, etc.)

### 10. Add a policy conformance audit

For every host/cell/project, show:

- in policy
- warning drift
- blocking drift

---

## 11. Definition of done for the foundation baseline

The basics are “down” only when all of these are true:

- [ ] Every host belongs to one declared cell.
- [ ] Every active host has a structured validation artifact.
- [ ] New mainstream hosts use the intended production storage baseline.
- [ ] New mainstream hosts have a declared IncusOS-vs-legacy bootstrap class.
- [ ] Customer workloads land in explicitly configured restricted Incus project(s).
- [ ] Required project limits and restrictions are materialized, not just planned.
- [ ] Required platform profiles exist and are used consistently.
- [ ] Container default isolation is explicit and verifiable.
- [ ] Fleet Admin exposes region/cell/host/procurement/reserve state coherently.
- [ ] Operator-only Incus exposure is controlled and never treated as the product plane.

---

## 12. Bottom line

If we want V2 to be robust, the next job is **not** generalized cloud sprawl.

The next job is to lock the foundation:

- cells
- bootstrap
- IncusOS posture
- ZFS baseline
- restricted projects
- reusable profiles
- explicit quota/limit materialization
- boring operator visibility

That gives us the strong substrate we need before we finish the high-level instance UX.
