# JustAVPS spec — operator Incus UI exposure and automated host bootstrap

Date: 2026-04-11

## Purpose

This spec closes two practical operator gaps in the current target-state docs:

1. **when and how an Incus web UI should exist**
2. **how host bootstrap/validation should become fully automated and repeatable**

This is specifically about operator workflow, not customer-facing product UX.

---

## 1. Incus UI stance

## A. What the Incus UI is for

The Incus web UI is a **substrate operator console**.

It is useful for:

- inspecting Incus members
- checking instances/images/profiles/storage pools/networks
- debugging substrate-side problems
- confirming cluster-group or project state if Incus clustering is later used inside a cell

It is **not** the primary source of truth for:

- billing
- customer accounts
- sellability / reserve budget
- procurement
- host lifecycle policy
- warm-pool product semantics
- Cloudflare routing truth
- control-plane jobs / service health

Those remain in JustAVPS Fleet Admin.

---

## B. Exposure model

### Current state

- live HEL1 hosts do **not** expose Incus HTTPS/UI on `8443`
- there is no single global Incus endpoint for the whole fleet

### Target state

Incus UI should be exposed only in one of these ways:

1. **per-host** for debugging early fleets
2. **per-cell-cluster** later if a homogeneous cell is upgraded into a small Incus cluster

### Explicit non-goal

- no one global public Incus UI spanning the whole fleet

---

## C. Security model for Incus UI exposure

If enabled, Incus UI must be:

- operator-only
- private-network or VPN-only where possible
- protected by Incus TLS auth / restricted certificates
- logged as an operator access surface
- documented as substrate visibility only

### Required controls

- never expose it as a normal customer endpoint
- never treat it as the commercial cloud control plane
- never rely on it as the only operations surface

---

## D. Recommended rollout model

### Stage 1 — no UI exposure by default

- default production stance remains: disabled/not exposed
- JustAVPS Fleet Admin is the operator entry point

### Stage 2 — break-glass/operator debugging exposure

- optional operator-only enablement per host
- only after access control, certificate handling, and logging are defined

### Stage 3 — cell-cluster substrate console

- if a cell later becomes a small Incus cluster, expose one operator-only UI entry point for that cell cluster
- still keep JustAVPS Fleet Admin as the real cloud/fleet UI

---

## 2. Automated host bootstrap target state

## A. Current shape

There is already a bootstrap script (`scripts/bootstrap-baremetal-host.sh`) that:

- installs Incus and runnerd
- pre-seeds a simple Incus config
- creates recovery helpers
- registers the host in the control plane

This is useful, but it is not yet the final production-grade bootstrap lifecycle.

---

## B. Required end-to-end bootstrap phases

### Phase 1 — procure / identify

- host is ordered or otherwise assigned
- host metadata is created in control plane
- target cell is chosen
- expected substrate profile is declared

### Phase 2 — substrate install

- OS baseline applied
- packages installed
- runnerd installed
- Incus installed
- storage driver configured
- host proxy/routing helpers installed
- backup/recovery helpers installed

### Phase 3 — control-plane enrollment

- runner token issued
- host registered in control plane
- host linked to cell
- runner health confirmed

### Phase 4 — validation gate

- runnerd health check
- Incus ready check
- storage pool verification
- image import/publish check
- VM smoke test
- proxy/routing smoke test
- daemon heartbeat smoke test
- warm-pool fill smoke test

### Phase 5 — active service

- host marked `active`
- scheduler allowed to place there
- host appears as sellable only if reserve policy permits it

---

## C. Bootstrap artifact requirements

Every host bootstrap should produce a structured validation artifact stored in the control plane.

### Minimum fields

- host ID
- cell ID / region / host class / generation
- bootstrap version
- runnerd version
- Incus version
- storage driver/pool
- validation started/completed timestamps
- smoke-test VM result
- warm-pool readiness result
- operator or automation identity that triggered the bootstrap

### Why

This turns bootstrap from “script seems to have run” into an auditable admission gate.

---

## D. Bootstrap profile standardization

Each cell should eventually reference a declared host bootstrap profile.

### Example profile dimensions

- CPU generation/vendor class
- storage backend standard
- Incus network/profile assumptions
- warm-pool policy baseline
- image locality seed policy
- security baseline

### Rule

Hosts should not silently drift from the cell standard once active.

---

## E. Drift detection

After bootstrap, the control plane should continuously detect drift on:

- runnerd version
- Incus version
- storage pool configuration
- expected network/proxy config
- backup timer/recovery helper presence
- security baseline markers

### Outcome model

- `in_policy`
- `warning_drift`
- `blocking_drift`

Blocking drift should be able to mark a host reserve-only or unsellable.

---

## 3. Fleet Admin requirements

Fleet Admin should eventually show for each host:

- bootstrap profile
- last validation artifact
- drift status
- Incus UI exposure status (disabled / operator-only / cluster-console)
- runnerd version
- Incus version
- storage pool driver/name
- warm-pool validation status

### Operator actions needed

- request bootstrap
- re-run validation
- mark host active after successful validation
- disable/enable operator-only Incus UI exposure
- mark host reserve-only if drift is detected

---

## 4. Capability checklist

- [ ] Incus UI is explicitly categorized as operator substrate UI only
- [ ] No public/global Incus UI is assumed for the whole fleet
- [ ] Host bootstrap is validation-gated before `active`
- [ ] Bootstrap produces a structured validation artifact
- [ ] Cell bootstrap profiles are explicit and enforceable
- [ ] Drift detection can affect sellability/admission state
- [ ] Fleet Admin surfaces bootstrap, drift, and optional Incus UI exposure state

---

## 5. Recommended implementation order

### Phase 1

1. add bootstrap validation artifact schema + API
2. extend bootstrap script/worker to emit artifact results
3. surface last validation and drift summary in Fleet Admin

### Phase 2

1. formalize bootstrap profiles by cell
2. add drift checks against the declared profile
3. tie blocking drift to reserve-only / unsellable state

### Phase 3

1. implement operator-only Incus UI exposure model
2. log Incus UI exposure and access in operator audit trails
3. if homogeneous cell clusters later exist, expose Incus UI at the cell-cluster level

---

## Bottom line

The Incus UI should exist only as an **operator substrate console**, and host bootstrap should become a **policy-checked admission workflow**, not just a shell script that happened to run.

That is the production-grade path for adding more nodes safely while keeping JustAVPS Fleet Admin as the real cloud control plane.
