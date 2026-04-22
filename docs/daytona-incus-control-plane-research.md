# Daytona vs. JustAVPS Incus v2 — architecture research report

> Status: research report  
> Date: 2026-04-19  
> Audience: JustAVPS control-plane / runtime design work  
> Related internal spec: [JustAVPS v2 — Incus control-plane spec](./incus-control-plane-v2-spec.md)

## Executive summary

The main conclusion is straightforward: **JustAVPS should copy Daytona’s plane separation, operational patterns, and agent-facing access surfaces, but should not copy Daytona’s Docker-first runtime model.** Daytona is organized cleanly into interface, control, and compute planes, with explicit services for proxying, snapshots, SSH access, and an in-sandbox toolbox ([Daytona architecture docs](https://www.daytona.io/docs/architecture/)). That overall shape is strong and worth adopting.

However, Daytona’s scheduler and runtime are built around **`region -> runner -> sandbox`** on Docker-backed runner nodes, while JustAVPS v2 is intentionally moving toward **`region -> cluster -> host -> instance`**, where one cluster maps to one Incus cluster and `machine` is the public term while `instance` remains the runtime term ([JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 10-34). For an Incus-native bare-metal platform, the JustAVPS model is the better foundation.

The practical implication is:

- **Use Daytona as an architectural reference, not a runtime blueprint.**
- **Keep Incus behind `runnerd` as the private compute substrate.**
- **Keep the control plane database-first and lease-first.**
- **Add Daytona-grade toolbox/access capabilities where they improve agent UX.**
- **Do not expose Incus directly to customers or let Incus become the product API.**

## Scope and methodology

This report compares:

1. the current JustAVPS v2 Incus design and implementation direction,
2. Daytona’s control-plane / compute-plane architecture,
3. the delta between the two,
4. the correct placement of Incus in the JustAVPS stack.

The analysis is based on:

- internal JustAVPS docs and source code, especially the [v2 Incus spec](./incus-control-plane-v2-spec.md), [machine service](../src/server/v2/services/machines.ts), [placement / reservations](../src/server/platform/baremetal/reservations.ts), [public machine routes](../src/server/v2/routes/public/machines.ts), [baremetal runner client](../src/server/platform/baremetal/runner-client.ts), [runnerd](../apps/runnerd/src/index.ts), [daemon toolbox plan](../apps/daemon/TOOLBOX_PLAN.md), and [daemon main](../apps/daemon/main.go);
- Daytona public docs on [architecture](https://www.daytona.io/docs/architecture/), [runners](https://www.daytona.io/docs/runners/), and [regions](https://www.daytona.io/docs/regions/);
- Daytona implementation files including the [v2 runner adapter](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/runner-adapter/runnerAdapter.v2.ts), [runner service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/runner.service.ts), [sandbox service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/sandbox.service.ts), [toolbox daemon server](https://github.com/daytonaio/daytona/blob/main/apps/daemon/pkg/toolbox/server.go), [proxy](https://github.com/daytonaio/daytona/blob/main/apps/proxy/pkg/proxy/proxy.go), and [snapshot manager](https://github.com/daytonaio/daytona/blob/main/apps/snapshot-manager/internal/server/server.go).

## Current JustAVPS baseline

JustAVPS v2 already has the right high-level architecture for an Incus-backed platform. The internal spec explicitly fixes the topology as **`region -> cluster -> host -> instance`**, defines **one cluster as one Incus cluster**, sets the default runtime to **hardened container**, keeps **VM optional/later**, and explicitly states **no direct customer access to Incus** ([JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 10-34).

The most important implementation detail is that JustAVPS is **not starting from zero**. The v2 spec notes that the repo already has `/api/v2`, public v2 routes for machines/images/snapshots/billing/catalog, admin fleet routes, script E2Es, placement primitives, and snapshot/image services ([JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 85-173). That means the right move is not a greenfield rewrite; it is a controlled tightening of what already exists.

In code, the current machine path is already substantially control-plane-oriented:

- `createMachineV2()` resolves placement, reserves capacity, stores placement metadata, and queues provisioning work ([machine service](../src/server/v2/services/machines.ts));
- host capacity is leased transactionally, with scheduler decisions recorded before provisioning succeeds ([reservations](../src/server/platform/baremetal/reservations.ts), lines 149-354);
- the public machine API still defaults `machine_mode` to `vm`, which conflicts with the intended v2 baseline and should be corrected quickly ([public machine routes](../src/server/v2/routes/public/machines.ts), lines 76-89).

JustAVPS also already has the right **host-agent boundary**. The control plane does not talk to Incus directly. Instead, it uses `HttpBaremetalRunnerClient` to call host-local lifecycle endpoints such as `/v1/instances`, `/exec`, `/start`, `/stop`, `/reboot`, `/snapshots`, and `/images/publish` ([baremetal runner client](../src/server/platform/baremetal/runner-client.ts), lines 42-126). That boundary is strategically correct.

Finally, `runnerd` is already very clearly an **Incus host adapter**. It shells out to `incus`, supports Incus project scoping, performs instance lifecycle operations, snapshot publication, readiness checks, and warm-pool-related host behavior ([runnerd](../apps/runnerd/src/index.ts), lines 197-306). In other words: JustAVPS already has the beginnings of its Daytona-style compute node.

## What Daytona is actually doing

Daytona’s public architecture is unusually clean. Its docs split the product into:

- an **interface plane** for SDK, CLI, dashboard, MCP, and SSH,
- a **control plane** for the API, proxy, snapshot builder, and sandbox manager,
- a **compute plane** for runners, in-sandbox daemon, snapshot store, and volumes ([Daytona architecture docs](https://www.daytona.io/docs/architecture/)).

That is the first major takeaway: Daytona’s service decomposition is well-designed even if the runtime substrate is different.

### Control plane

In Daytona, the API is the central coordinator. It owns authentication, sandbox lifecycle, snapshots, volumes, and resource allocation, and it embeds internal control-plane processes such as the sandbox manager and snapshot builder ([Daytona architecture docs](https://www.daytona.io/docs/architecture/)).

The control plane is also deeply stateful and DB-backed. The sandbox service enforces both:

- **per-sandbox resource ceilings** such as max CPU, memory, and disk, and
- **aggregate per-region quota ceilings** such as total CPU, memory, and disk ([sandbox service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/sandbox.service.ts), lines 157-281; [region quota DTO](https://github.com/daytonaio/daytona/blob/main/apps/api/src/organization/dto/region-quota.dto.ts)).

Operationally, Daytona’s control plane also carries the access-plane coordination for toolbox proxy resolution, signed preview URLs, SSH access token validation, and region-aware proxy selection ([sandbox service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/sandbox.service.ts)).

### Compute plane

Daytona’s runners are compute nodes that host sandboxes. Each runner reports health and metrics, and runners are grouped into regions that may be shared, dedicated, or custom ([Daytona regions docs](https://www.daytona.io/docs/regions/); [Daytona runners docs](https://www.daytona.io/docs/runners/)).

For scheduling, Daytona filters runners by:

- readiness,
- `unschedulable = false`,
- `draining = false`,
- minimum availability score,
- optional snapshot locality,
- optional region and class filters,

then sorts by score and samples from the top set rather than doing a deterministic host lease flow ([runner service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/runner.service.ts), lines 289-358 and 747-758).

That approach is appropriate for Daytona’s runner model, but it is materially weaker than JustAVPS’s current transactional host-capacity lease model when the runtime is bare metal and oversell prevention matters.

### Async runner execution model

One of Daytona’s strongest implementation ideas is its v2 runner adapter. Instead of issuing imperative RPCs straight to the runner, the API creates jobs in the database and the v2 runner polls and executes them asynchronously ([v2 runner adapter](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/runner-adapter/runnerAdapter.v2.ts), lines 41-210).

That is a highly relevant pattern for JustAVPS. It aligns well with your own provisioner / control-plane-job direction and is a much better fit for long-running infrastructure actions than request-thread orchestration.

### In-sandbox daemon / toolbox

Another major Daytona advantage is the **toolbox daemon**. Inside each sandbox, Daytona exposes rich agent-facing endpoints for:

- files,
- process execution,
- code run,
- sessions,
- PTY,
- git,
- LSP,
- computer use,
- port inspection, and proxying ([toolbox daemon server](https://github.com/daytonaio/daytona/blob/main/apps/daemon/pkg/toolbox/server.go), lines 158-267).

This is not just implementation detail; it is a product capability layer. It is what makes Daytona feel “agent-native” rather than merely “container-hosting with an API.”

### Access plane

Daytona also decomposes preview and SSH into separate services:

- the **proxy** routes external traffic to the correct sandbox and maintains caches for runner/sandbox target lookup ([Daytona architecture docs](https://www.daytona.io/docs/architecture/); [proxy implementation](https://github.com/daytonaio/daytona/blob/main/apps/proxy/pkg/proxy/proxy.go));
- the **SSH gateway** is region-aware and is explicitly treated as part of the customer-managed compute story ([Daytona runners docs](https://www.daytona.io/docs/runners/)).

This separation is worth copying conceptually, even if the concrete implementation differs.

### Snapshot strategy

Daytona’s snapshot story is OCI-centric. Snapshots are built and pulled via runners, and the separate snapshot-manager is effectively an internal OCI registry service backed by filesystem or S3-compatible storage ([Daytona architecture docs](https://www.daytona.io/docs/architecture/); [snapshot manager](https://github.com/daytonaio/daytona/blob/main/apps/snapshot-manager/internal/server/server.go)).

This is useful reference material for artifact distribution, but it should not be copied 1:1 into an Incus-native platform.

## Comparative analysis: Daytona model vs. JustAVPS model

### Core mapping

| Daytona concept | Daytona role | Best JustAVPS equivalent | Recommendation |
| --- | --- | --- | --- |
| API | Control plane entry point | `src/server/v2/**` | Keep equivalent |
| Runner | Compute node | `runnerd` on each host | Keep concept, Incus-native |
| Sandbox | Public runtime object | `machine` / internal `instance` | Same role, different runtime |
| Runner selection | Region → runner | Region → cluster → host | **Do not flatten** |
| DB jobs for v2 runners | Async orchestration | control-plane jobs / provisioner | Copy pattern |
| Toolbox daemon | Agent UX inside sandbox | planned `justavps-daemon` / guest toolbox | Strongly consider copying |
| Proxy | Preview/toolbox routing | `proxy-worker` + routing state | Copy separation |
| SSH gateway | SSH access plane | future JustAVPS SSH gateway | Later / optional |
| Snapshot manager | OCI artifact registry | future backup/export/image distribution service | Adapt, don’t clone |

### The most important architectural difference

Daytona schedules **sandboxes to runners**. JustAVPS should schedule **instances to hosts inside Incus clusters**.

That difference changes almost everything:

- Daytona can use score-based runner choice and tolerate more indirection.
- JustAVPS needs deterministic, auditable, lease-backed placement because the unit of scarcity is a real host inside a real cluster.
- Daytona treats the runner as both compute and placement boundary.
- JustAVPS should treat the **cluster** as the first scheduling boundary and the **host** as the second.

This is why the v2 JustAVPS topology is stronger for your use case than Daytona’s flatter runner model.

## Where Incus should be used in JustAVPS

### Incus should be used as the private runtime substrate

The right boundary is:

**API / control plane → `runnerd` → Incus**

That means Incus should own:

- instance lifecycle,
- image import and publication,
- local snapshots,
- cluster membership,
- host membership,
- runtime inspection,
- metrics collection,
- operator diagnostics.

This is already consistent with the current code, where the control plane calls the host-local runner API and `runnerd` shells out to Incus ([baremetal runner client](../src/server/platform/baremetal/runner-client.ts), lines 42-126; [runnerd](../apps/runnerd/src/index.ts), lines 197-306).

### Incus should not become the public product API

The JustAVPS spec is correct to say there should be **no direct customer access to Incus** ([JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 30-34). The reasons are architectural, not merely cosmetic:

- the product surface is `machine`, not raw Incus instance;
- billing should come from control-plane facts, not raw runtime metrics;
- placement, quotas, and procurement are product-level concerns above Incus;
- customer-facing consistency requires a stable API contract that is not coupled to Incus internals.

### Incus projects belong later, not first

Daytona has strong tenancy primitives today, but its runtime is different. For JustAVPS, the spec is right to defer Incus project synchronization and quota enforcement until topology, placement, and lifecycle are stable ([JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 519-530 and 1123-1130). Using Incus projects too early would complicate a control plane that is still hardening its cluster and host semantics.

## What JustAVPS should copy from Daytona

### 1. Plane separation

You should explicitly preserve:

- interface plane,
- control plane,
- compute plane,
- access plane.

That model maps very well to your current repo split and future service boundaries.

### 2. Async job execution for host actions

Daytona’s job-based v2 runner flow is one of the best parts of the system ([v2 runner adapter](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/runner-adapter/runnerAdapter.v2.ts)). JustAVPS already has control-plane jobs and should push further in that direction for:

- create,
- start/stop/reboot,
- snapshot/restore,
- image publish/delete,
- host reconcile,
- future migration / maintenance actions.

### 3. A first-class toolbox surface

If JustAVPS wants Daytona-grade agent ergonomics, it needs a toolbox layer. The good news is that this is already recognized internally: the daemon toolbox plan explicitly calls for a Daytona/E2B-grade files/process/PTY API embedded in `justavps-daemon` ([daemon toolbox plan](../apps/daemon/TOOLBOX_PLAN.md), lines 9-48).

This is one of the highest-leverage areas to copy from Daytona.

### 4. Separate proxy and gateway services

Daytona is right to isolate proxying and SSH access instead of mixing them into the core API. JustAVPS should do the same over time:

- keep preview/toolbox routing separate from machine lifecycle,
- add SSH gateway later if SSH becomes a first-class product surface,
- keep routing state and authorization centralized in the control plane.

### 5. Dual quota model

Daytona’s quota shape is useful: total regional quota plus per-sandbox maximums ([sandbox service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/sandbox.service.ts), lines 157-281; [region quota DTO](https://github.com/daytonaio/daytona/blob/main/apps/api/src/organization/dto/region-quota.dto.ts)). JustAVPS should almost certainly adopt the same general shape later as:

- total account/region quota,
- max per-machine vCPU,
- max per-machine RAM,
- max per-machine disk,
- potentially separate rules for non-ephemeral disks or persistent artifacts.

## What JustAVPS should **not** copy from Daytona

### 1. Docker-first runtime assumptions

Daytona treats OCI images, runner-local Docker execution, and snapshot registry flows as the native runtime path. JustAVPS should not force itself into that model. In your platform, Docker image support should remain an **input path** that ends in an internal launchable image for Incus, exactly as your spec describes ([JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 723-733).

### 2. Flat region → runner scheduling

JustAVPS should not simplify its scheduler to “pick a runner in a region.” That would discard an important advantage you already have: cluster-aware, host-aware, reserve-aware placement with transactional capacity leasing ([reservations](../src/server/platform/baremetal/reservations.ts), lines 149-354).

### 3. Score-only placement as the primary safety mechanism

Daytona’s scoring model is useful for ranking, but it is not a substitute for resource leasing on bare metal. In JustAVPS, scoring may remain part of the placement heuristic, but **commit/release leases** should remain the safety primitive.

### 4. Early shared volumes and broad runtime surface area

Daytona exposes a wider surface including shared volumes and richer runtime tooling. Your current v2 scope cut is correct: no warm pools, no shared multi-attach volumes, no early direct quota complexity ([JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 30-34).

## The most important gaps in JustAVPS today

### 1. Default runtime still mismatches the spec

The public create schema still defaults `machine_mode` to `vm`, while the v2 design clearly wants hardened containers as the default ([public machine routes](../src/server/v2/routes/public/machines.ts), lines 76-89; [JustAVPS v2 spec](./incus-control-plane-v2-spec.md), lines 19-21 and 165-172).

### 2. `runnerd` is the right boundary, but its role needs to be frozen explicitly

Right now `runnerd` already acts as the host-local lifecycle and Incus adapter. That should be promoted from “implementation detail” to a first-class architectural decision:

- only `runnerd` talks to Incus,
- the control plane talks only to `runnerd`,
- reconciliation compares DB desired state to `runnerd` / Incus observed state.

### 3. Toolbox strategy is not yet fully productized

The internal daemon plan is strong, but JustAVPS has not yet locked whether the primary toolbox should live:

- on the host via `justavps-daemon`,
- inside every guest via a guest daemon,
- or as a hybrid with host-mediated fallbacks.

The current code already uses a toolbox fallback path for command execution when direct runner exec is unavailable, which suggests the platform is converging on a mixed approach ([machine service](../src/server/v2/services/machines.ts), lines 295-352).

### 4. Access-plane service split is still incomplete

You already have a Cloudflare-based proxy worker and a daemon that fronts PTY/port-forwarding/OpenCode routes ([proxy worker](../apps/proxy-worker/src/index.ts); [daemon main](../apps/daemon/main.go), lines 1-19). But compared with Daytona, the product-level separation between preview routing, toolbox routing, and SSH/gateway access is not yet fully crystallized.

### 5. Durable artifact strategy beyond local Incus snapshots is still incomplete

Local Incus snapshots are excellent for fast restore, but they are not the whole storage-safety story. Daytona solves this with an OCI snapshot store and explicit snapshot-manager service ([Daytona architecture docs](https://www.daytona.io/docs/architecture/); [snapshot manager](https://github.com/daytonaio/daytona/blob/main/apps/snapshot-manager/internal/server/server.go)). JustAVPS will need its own artifact/export layer later for cross-host recovery, backups, and potentially cluster-to-cluster mobility.

## Recommended target architecture for JustAVPS

### Recommended service model

| Plane | Service | Purpose | Runtime boundary |
| --- | --- | --- | --- |
| Interface | main app / dashboard / SDK / CLI | user and admin entry points | public |
| Control plane | `/api/v2` + jobs + scheduler + billing + reconciliation | product truth and orchestration | DB-first |
| Compute plane | `runnerd` | host-local lifecycle adapter | talks to Incus |
| Guest agent plane | toolbox daemon | files / exec / PTY / git / LSP | inside guest or mediated |
| Access plane | proxy worker + future SSH gateway | preview, toolbox proxying, SSH access | edge + dedicated services |
| Artifact plane | image / backup / export services | durable images, snapshots, backups | object storage / registry / export backend |

### Recommended runtime boundary

```text
Client / SDK / Dashboard
        ↓
JustAVPS API / Control Plane
        ↓
Placement + Capacity Lease + Job Enqueue
        ↓
Host-local runnerd
        ↓
Incus cluster member
        ↓
Instance (public: machine)
        ↓
Optional guest toolbox daemon
```

This preserves your strongest current decisions:

- cluster-first scheduling,
- DB-first truth,
- host leases before provisioning,
- Incus as substrate,
- no raw Incus exposure.

## Recommended phased roadmap

### Phase 1: lock the runtime boundary

- freeze `runnerd` as the only Incus-facing service;
- keep all lifecycle actions flowing through `runnerd`;
- formalize reconciliation as DB desired state vs. runner/Incus observed state.

### Phase 2: align the public API with the v2 baseline

- change default `machine_mode` from `vm` to `container`;
- keep Docker image support as import/convert/publish, not direct runtime execution;
- tighten route contracts around machine/image/snapshot semantics.

### Phase 3: finish the agent/toolbox story

- decide the primary toolbox boundary;
- implement Daytona-grade files/process/PTY first;
- add git and LSP once the basics are stable.

### Phase 4: strengthen the access plane

- separate preview, toolbox proxying, and SSH concerns more clearly;
- keep routing state under control-plane authority;
- add SSH gateway only if SSH becomes a stable customer requirement.

### Phase 5: add durable storage-safety primitives

- keep local Incus snapshots as fast restores;
- add export/backups for durable artifacts;
- introduce cross-host / cross-cluster recovery primitives later.

### Phase 6: layer in quotas and Incus project sync

- account/cluster project mapping;
- total regional quota;
- per-machine max resource rules;
- Incus project sync only after core lifecycle is solid.

## Final recommendation

The correct mental model is:

> **Copy Daytona’s architecture shape; keep JustAVPS’s Incus-native topology.**

More explicitly:

1. **Do copy** Daytona’s plane decomposition, async job execution model, toolbox concept, proxy/gateway separation, and quota shape.
2. **Do not copy** Daytona’s Docker-first runtime assumptions or its flatter region-to-runner scheduling model.
3. **Use Incus** as the private compute substrate behind `runnerd`, for lifecycle, cluster membership, telemetry, snapshots, and operator diagnostics.
4. **Do not use Incus** as the customer-facing API or the billing source of truth.
5. **Keep JustAVPS DB-first and lease-first**. That is one of the strongest parts of the current design and one of the main reasons the v2 architecture is better suited to Incus than Daytona’s runner model.

If the goal is “Daytona-grade agent ergonomics on an Incus-native bare-metal cloud,” the winning path is not to imitate Daytona literally. It is to **combine Daytona’s service design discipline with JustAVPS’s stronger cluster/host/lease model**.

## Source notes

### Internal JustAVPS references

- [JustAVPS v2 — Incus control-plane spec](./incus-control-plane-v2-spec.md)
- [machine service](../src/server/v2/services/machines.ts)
- [public machine routes](../src/server/v2/routes/public/machines.ts)
- [baremetal reservations](../src/server/platform/baremetal/reservations.ts)
- [baremetal runner client](../src/server/platform/baremetal/runner-client.ts)
- [runnerd](../apps/runnerd/src/index.ts)
- [daemon toolbox plan](../apps/daemon/TOOLBOX_PLAN.md)
- [daemon main](../apps/daemon/main.go)

### Daytona public references

- [Daytona architecture docs](https://www.daytona.io/docs/architecture/)
- [Daytona runners docs](https://www.daytona.io/docs/runners/)
- [Daytona regions docs](https://www.daytona.io/docs/regions/)
- [Daytona repository](https://github.com/daytonaio/daytona)
- [v2 runner adapter](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/runner-adapter/runnerAdapter.v2.ts)
- [runner service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/runner.service.ts)
- [sandbox service](https://github.com/daytonaio/daytona/blob/main/apps/api/src/sandbox/services/sandbox.service.ts)
- [toolbox daemon server](https://github.com/daytonaio/daytona/blob/main/apps/daemon/pkg/toolbox/server.go)
- [proxy](https://github.com/daytonaio/daytona/blob/main/apps/proxy/pkg/proxy/proxy.go)
- [snapshot manager](https://github.com/daytonaio/daytona/blob/main/apps/snapshot-manager/internal/server/server.go)
