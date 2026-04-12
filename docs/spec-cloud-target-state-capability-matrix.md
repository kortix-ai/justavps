# JustAVPS cloud target-state capability matrix

Date: 2026-04-11

## Purpose

This document turns the high-level Incus/cell guidance into a concrete operator checklist for the cloud we actually want to run:

- keep adding nodes without redesigning the platform
- provision customer VMs reliably
- manage images, snapshots, storage, resizing, and relocation sanely
- keep warm pools economically controlled
- separate substrate admin from product/operator control

This is the answer to: **"do we actually have the full scalable cloud shape yet, and what exactly still has to exist?"**

---

## 1. Final architecture stance

### Global shape

- **One global JustAVPS control plane**
  - API/UI
  - Postgres
  - scheduler / reservations / jobs / routing / auth-plane repair
  - procurement / fleet policy / economics

- **Many compute cells**
  - cell = `region × host_class × generation`
  - cells are the scale/economics/failure-domain unit

- **Many hosts inside each cell**
  - one `runnerd` per host
  - one local Incus daemon per host initially
  - optional **small Incus cluster per cell later** if justified

### Explicit non-goals

- no single global heterogeneous Incus cluster
- no direct customer Incus API exposure
- no “live migrate any VM anywhere” promise
- no distributed storage as the default foundation unless product strategy requires it

---

## 2. How the nodes are connected

### Current / recommended control path

1. JustAVPS control plane stores fleet truth in Postgres
2. scheduler chooses a host/cell
3. control plane talks to host-local `runnerd`
4. `runnerd` talks to the host-local Incus daemon
5. Cloudflare Worker/broker route public traffic to the correct host/port
6. the guest daemon heartbeats back into JustAVPS

### Meaning

- hosts are connected today through **JustAVPS**, not through one shared Incus cluster database
- that is acceptable and sane for early serious scale
- if we later introduce Incus clustering, it should be **inside a cell**, not across the whole company fleet

---

## 3. Capability matrix

## A. Fleet topology and host growth

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Add more nodes | Add bare-metal hosts continuously without redesign | **Partially real** | Needs fully automated host add/bootstrap/join runbook + validation |
| Cell model | Cells are first-class for policy, reserves, economics | **Real foundation exists** | Must become the canonical unit for scaling decisions |
| Fleet policy | Admission, sellability, reserve policy per cell | **Partially real** | Needs stronger policy automation and alerting |
| Host lifecycle | Add, drain, evacuate, return, retire | **Partially real** | Drain/maintenance exists; evacuation/relocation still incomplete |

### Required target outcome

- any new host can be added via a reproducible bootstrap flow
- every host lands in a declared cell
- every cell has explicit reserve and sellability policy
- removing a host is a planned operation, not an incident improvisation

---

## B. Compute lifecycle

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Create VM | Durable, reserved, verified provisioning | **Real** | Keep hardening control-plane and runnerd correctness |
| Start/stop/reboot/delete | Safe and operator-visible | **Real** | Needs more relocation-aware lifecycle semantics |
| Readiness | “Ready” means actually reachable to the user | **Improving / now significantly better** | Keep tightening heartbeat + proxy gating |
| Dense packing | Many VMs per host without routing collisions | **Improving** | Explicit port allocation exists; keep validating density model |

### Required target outcome

- machine create is always queue-backed and reservation-backed
- machine readiness means the auth path + proxy path are genuinely alive
- failures are classified into retryable vs operator-required vs dead-lettered

---

## C. Images and golden-image system

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Golden image | Official platform image always usable on every target cell | **Real** | Need stronger image replication/locality policy |
| Custom images | User images supported without breaking warm/cold flows | **Partially real** | Need explicit product semantics + reserve economics |
| Image locality | Cell/host-aware image placement | **Foundation exists** | Needs stronger automatic seeding/replication |
| Image pipeline | Build, validate, publish, deprecate, rotate | **Partially real** | Needs more lifecycle policy and operational tooling |

### Required target outcome

- every cell has declared image availability policy
- golden image is continuously rebuilt and validated
- custom image warm pools are optional, explicit, and billable

---

## D. Warm pools

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Platform warm pool | Standard golden-image warm pool per common CPU buckets | **Real** | Needs fleet-aware reserve economics |
| User warm pools | Customer-visible warm pools by image/cpu/cell | **Not productized** | Needs SKU/billing/lifecycle design |
| Pool cleanliness | Warm instances proven clean before handoff | **Implicit / discipline-based** | Needs attestation/scrub guarantees |
| Pool economics | Warm reserves budgeted per cell | **Partially real** | Needs stronger per-product reserve math |

### Required target outcome

- platform warm pools remain infra-managed by default
- user warm pools are a premium capability, not hidden infra leakage
- reserve burn is visible at the cell level

---

## E. Storage

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Default root storage | Local NVMe-backed ZFS style storage per host/cell | **Mostly the intended direction** | Must standardize substrate more aggressively |
| Snapshot feature | Fast local snapshots | **Real** | Already not enough for DR by themselves |
| Backups | Off-host backup with tested restore | **Partially real** | Needs stronger product + DR enforcement |
| Shared/distributed storage | Only where product strategy requires it | **Not default** | Good — keep it that way unless justified |
| Storage pools | Declarative per-cell substrate standard | **Not fully formalized** | Needs standard host-class + pool definitions |

### Required target outcome

- default storage is simple and local
- backups are off-host and restore-tested
- distributed/shared storage is not introduced casually

---

## F. Resizing

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| CPU/RAM resize | Supported where substrate allows it safely | **Not fully productized** | Need clear in-place vs restart-required behavior |
| Disk resize | Supported with filesystem growth workflow | **Partially implied** | Need explicit UX + operational guarantees |
| Plan migration | Move between product sizes predictably | **Incomplete** | Needs policy by host class and product tier |

### Required target outcome

- each resize path has declared behavior:
  - online
  - reboot-required
  - recreate-required
- customer and operator both understand what will happen

---

## G. Snapshots, backups, restore, relocation

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Snapshots | Customer convenience feature | **Real** | Fine, but not DR |
| Backups | Export/copy to off-host storage or secondary infra | **Partially real** | Needs stronger runbooks and product semantics |
| Restore | Tested restore execution history and drills | **Foundation exists** | Must become routine, not exceptional |
| Relocation | Cold relocate or restore-to-new-host | **Not fully productized** | Major required feature |
| Live migration | Optional only inside compatible homogeneous cells | **Not current default** | Should remain optional and limited |

### Required target outcome

- if a host must leave service, workloads can be restored or relocated systematically
- relocation is a product/ops workflow, not a manual incident-only trick

---

## H. Networking and routing

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Public routing | Worker/broker path authoritative and durable | **Real** | Keep hardening repair and drift detection |
| Internal host plumbing | runnerd/Incus per-host routing fully deterministic | **Real but still maturing** | Need dense-host and relocation confidence |
| Multi-tenant advanced networking | OVN/private-network products later if justified | **Not default** | Good; add only when product requires it |

### Required target outcome

- public auth + routing truth lives in the control plane
- no legacy direct-path dependence remains for customers
- advanced networking is an explicit product line, not accidental complexity

---

## I. UI and operator tooling

| Capability | Target state | Current status | Gap / decision |
| --- | --- | --- | --- |
| Main operator UI | JustAVPS Fleet Admin is the source of truth | **Real** | Continue expanding it |
| Incus substrate UI | Optional operator-only visibility | **Not exposed now** | Could be added per host or per cell-cluster later |
| Node drill-down | Per-host state, reconciliation, warm pools, incidents | **Partially real** | Needs deeper substrate + metrics views |
| Control-plane observability | Service leases/checkpoints/readiness visible | **Real** | Keep improving operator ergonomics |

### Required target outcome

- JustAVPS UI remains the real cloud/fleet console
- Incus UI, if added, is only a substrate-side operator aid

---

## 4. What “fully scalable” should mean here

For JustAVPS, “fully scalable” does **not** mean one infinite magical cluster.

It means:

1. **Add hosts predictably**
2. **Standardize them into cells**
3. **Keep failure domains contained**
4. **Make relocation/restore possible**
5. **Make reserves and economics explicit**
6. **Expose the right controls in the JustAVPS fleet UI**

That is the shape that can get to 100s, then 1000s, then much larger node counts.

---

## 5. The practical roadmap to get there

### Phase A — complete the current control-plane hardening

- durable provisioning / routing / auth / fleet services
- real readiness semantics
- host drain and orphan cleanup
- backup/restore drill enforcement

### Phase B — finish the fleet operating model

- automated host add/bootstrap/validation
- stronger cell policy automation
- image locality and pre-seeding rules
- relocation/restore workflow as a first-class operator action

### Phase C — productize missing customer capabilities

- resize semantics
- clear backup product semantics
- optional user warm pools
- attached data-disk / storage product decisions

### Phase D — only then evaluate substrate evolution

- small homogeneous Incus clusters per cell if clearly useful
- migration inside compatible cells
- selective image replication and richer internal networking

---

## 6. Bottom line

The correct target is:

- **global JustAVPS cloud control plane**
- **many cells**
- **many hosts per cell**
- **local Incus substrate per host to start**
- **optional small Incus clusters inside homogeneous cells later**
- **strong product/operator workflows above Incus**

That is the architecture that actually matches:

- scaling
- economics
- operational sanity
- product flexibility

It is also the architecture that avoids the trap of treating Incus itself as the full commercial cloud control plane.

## Related specs

- `docs/spec-incus-fleet-cluster-and-ui-target-state.md`
- `docs/spec-host-lifecycle-resize-and-relocation.md`
- `docs/spec-warm-pool-and-storage-economics.md`
- `docs/spec-operator-incus-ui-and-host-bootstrap.md`
