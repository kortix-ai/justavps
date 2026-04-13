# JustAVPS infrastructure refactor + maintainability hardening spec

Status: draft / proposed operating basis

Date: 2026-04-12

Owner: platform / infra

---

## 0. Executive summary

JustAVPS is now **real infrastructure**, not a toy app. It provisions real machines, drives real host daemons, persists control-plane jobs, allocates real host capacity, manages routing, and now supports multiple runtime modes (VM, hardened container, Docker/OCI app containers). That means the codebase has crossed the threshold where **speed of iteration alone is no longer the main concern**. The main concern is now **operational confidence**.

The repo works, but it is not yet organized like a system that “cannot fail.” The biggest risk is **concentration of critical behavior into a handful of oversized, mixed-responsibility files**. Those files are becoming the place where infrastructure truth, product logic, runtime semantics, routing behavior, readiness semantics, benchmarks, and operator controls all mix together. That is survivable in MVP, but dangerous in scale-up.

This spec proposes a **bold, deep refactor** that can include:

- moving major parts of the server/runtime directory structure
- splitting and deleting oversized files
- freezing V1 into a clean legacy boundary
- making V2 explicit as the canonical architecture
- formalizing machine kinds and readiness strategies
- rewriting large orchestration paths into smaller, typed modules
- making bootstrap/host provisioning idempotent and phase-based
- turning current conventions into hard quality gates
- enforcing strict **TDD-first implementation** with full regression coverage from unit to live E2E

This is not a cosmetic cleanup. This is a **structural reliability refactor**.

---

## 1. Why this refactor is necessary

### Core problem

The current codebase is already good enough to prove the product and run real workloads, but it is not yet organized in a way that creates strong operator confidence, fast incident diagnosis, or long-term maintainability under increasing machine/runtime diversity.

As more runtime modes are added (VMs, hardened containers, Docker image containers, warm pools, user images, backup restore, cell policy, host lifecycle, routing repair), the cost of “just add another special case” rises sharply. The result is a system that still works, but becomes harder to reason about and more fragile to change.

### Cost of not doing this

If we do not refactor now, the likely outcomes are:

1. slower infra iteration because every change touches giant mixed files
2. higher regression risk across VM/container/Docker paths
3. more incidents caused by mismatched readiness truth between components
4. longer operator debugging time because responsibilities are blurred
5. fear-driven development, where nobody wants to touch critical files
6. eventual rewrite pressure under stress instead of under control

---

## 2. Current-state diagnostics

### 2.1 Structural stats observed in the repo

Top large infra/product files under `src/` right now:

- `src/server/routes/v2/admin-fleet.ts` — **2070 lines**
- `src/server/routes/v1/machines.ts` — **1599 lines**
- `src/app/v2/machines/[id]/page.tsx` — **1246 lines**
- `src/server/lib/v2/machines.ts` — **951 lines**
- `src/server/db/schema.ts` — **838 lines**
- `src/__tests__/e2e/machine-lifecycle.test.ts` — **814 lines**

Route count:

- `src/server/routes/v1` — **17 files**
- `src/server/routes/v2` — **8 files**

Observations:

- V1 still owns too much surface area for a supposedly older contract.
- V2 is canonical product direction, but some of its most important logic is concentrated in only a few very large files.
- Frontend machine detail and backend machine orchestration are both oversized.

### 2.1.1 Top-level repo shape problems

The current repo root is also semantically messy. It contains a mix of:

- real product/runtime source (`src/`, `runnerd/`, `workers/`, `daemon/`, `agent/`)
- developer-only runtime clutter (`.next/`, `node_modules/`, `screenshots/`, `test-results/`)
- infra scripts (`scripts/`, `docker-compose.yml`)
- specs/docs (`docs/`, `SPEC.md`, `.kortix/`)
- deployment/config glue (`vercel.json`, `.wrangler/`, `.vercel/`)
- generated SDK output (`src/sdk/`, `openapi-ts.config.ts`)

The root is not yet communicating clean ownership. A new engineer has to infer too much.

Specific semantic problems:

1. `src/` mixes frontend app, reusable UI, SDK output, tests, and backend server code.
2. `scripts/` mixes one-off developer scripts, benchmark tooling, host bootstrap, E2E runners, and deployment helpers in one flat directory.
3. `runnerd/`, `daemon/`, `workers/`, and `agent/` are all “runtime products,” but they do not share a clearer top-level grouping.
4. generated and ephemeral content still sits close to authored source in ways that make repo scanning noisy.
5. V1/V2/API/domain layering is only partially visible from path structure.

This matters because infrastructure confidence is not only about code correctness — it is also about whether an operator or engineer can immediately understand where a responsibility lives.

### 2.2 Current hotspots

#### A. `src/server/lib/v2/machines.ts`

Currently mixes:

- create request validation/policy
- machine identity generation
- image resolution
- create job payload shaping
- machine serialization
- provider interaction orchestration
- benchmark persistence
- DNS/routing side effects
- Docker image special cases
- warm-pool special cases
- readiness-adjacent behavior

This file is now a **system hotspot**.

#### B. `runnerd/src/index.ts`

Currently mixes:

- HTTP app entrypoint
- Incus command wrapper logic
- VM runtime path
- container runtime path
- Docker/OCI support
- network/proxy device setup
- static bridge IP allocation
- warm-pool management
- health reporting
- startup benchmarking

This is too much responsibility for one daemon entrypoint file.

#### C. `src/server/lib/machine-lifecycle.ts`

Currently mixes:

- callback resolution
- SSH key provider lifecycle
- machine bootstrap user-data building
- cleanup flows
- status sync logic
- readiness inference

It now also contains Docker-image-specific readiness probing. That is a valid transitional fix, but it is not the final design.

#### D. `src/server/routes/v2/admin-fleet.ts`

Currently mixes almost every fleet/operator concern:

- hosts
- cells
- procurements
- maintenance/drain
- control-plane services
- benchmarks
- snapshots/history
- operator actions

This route file is effectively a mini-subsystem and should not stay monolithic.

#### E. `scripts/bootstrap-baremetal-host.sh`

Currently owns in one place:

- package repo setup
- Incus installation
- OCI tooling installation
- systemd unit installation
- backup setup
- Incus init/preseed
- runnerd environment config
- host registration data gathering

This is useful, but brittle and hard to reason about safely.

---

## 3. Root-cause themes

### 3.1 Critical responsibilities are not split by axis

The system should be separated by:

- **API contract**
- **domain logic**
- **control-plane orchestration**
- **host runtime execution**
- **operator/admin surfaces**
- **frontend views**

Right now, many files cross two or three of those axes.

### 3.2 Readiness truth is mode-dependent but not modeled explicitly enough

Today the system effectively has multiple readiness strategies:

- daemon heartbeat
- warm-pool TCP readiness
- Docker app HTTP probe
- plain provisioning timeout fallback

These are real and useful, but they are not yet encoded as a formal, first-class strategy model.

### 3.3 Critical runtime truth still leaks through JSON metadata too often

`providerMeta` is still carrying too much operational truth, including values that increasingly deserve explicit schema ownership.

### 3.4 V1 and V2 are not separated strongly enough

V2 is the future, but V1 still has large and operationally important route files. The codebase needs a cleaner “legacy boundary” so future changes do not accidentally keep deepening V1 coupling.

---

## 4. Refactor goals

The refactor succeeds only if it achieves all of the following:

1. **Critical behavior becomes obviously understandable** by reading small, purpose-specific modules.
2. **Machine orchestration paths become mode-driven and typed**, not special-case driven.
3. **Readiness semantics become explicit** and machine-kind specific.
4. **V1 and V2 boundaries become unmistakable** in both file layout and import direction.
5. **Bootstrap and runner behavior become phase-based and testable**.
6. **Oversized files are eliminated as system hotspots**.
7. **Regression confidence increases**, especially across VM vs container vs Docker image flows.
8. **Every critical branch is protected by tests before refactor code lands**.

---

## 5. Non-goals

This refactor does **not** need to:

- add new product features unrelated to system structure
- change billing model semantics
- change cell economics model itself
- replace Incus with a new substrate immediately
- migrate to microVMs during this refactor
- rewrite the whole app in one unsafe big bang without intermediate verification

This is a **structural refactor with reliability hardening**, not a random feature spree.

---

## 6. Architectural principles

These become non-negotiable design rules.

### 6.1 One source of truth per concern

No critical concern should be “owned by vibes.”

Examples:

- host placement → reservation tables / scheduler decision models
- public ports → explicit port-allocation model
- readiness → explicit readiness strategy + state
- machine image source → explicit machine image request/source model

### 6.2 JSON metadata is not allowed to be the long-term home for core state

`providerMeta` can remain for provider-specific spillover, but not for core platform truth.

### 6.3 Route files are adapters, not system brains

Route files should:

- validate input
- call domain/service layer
- map result to HTTP

They should not orchestrate infrastructure deeply.

### 6.4 Runtime kinds must be modeled explicitly

At minimum:

- `vm`
- `container_system`
- `container_app_docker`

Each kind has:

- image source rules
- bootstrap strategy
- readiness strategy
- access semantics
- capability matrix

### 6.5 No file should be a hidden subsystem

Any file above ~400 LOC in infra-critical code should be assumed suspicious until justified.

### 6.6 Every machine kind must declare its readiness contract

Examples:

- `daemon_heartbeat`
- `http_probe`
- `tcp_probe`
- `warm_pool_claim_ready`

No more “this special case sets ready like that because it works.”

### 6.7 Test-first is mandatory

This refactor must be executed with **strict TDD discipline**.

Rules:

1. for every extracted or rewritten behavior, write or update tests **before** changing the implementation
2. no refactor batch is considered complete until the corresponding test layer is green
3. if a behavior is infra-critical and not currently testable, testability work becomes part of the refactor itself
4. “we will test later” is not allowed on control-plane, runnerd, readiness, routing, bootstrap, or cleanup flows

This is not optional process overhead. It is part of the architecture.

---

## 7. Target architecture

## 7.0 Repo-root target structure

### Current problem

The repo root is too flat and too mixed. Product runtimes, scripts, docs, generated output, and dev-only artifacts are not clearly separated.

### Target

```text
justavps.com/
  apps/
    web/
      src/
        app/
        components/
        hooks/
        lib/
        server/
    runnerd/
    daemon/
    agent/
    workers/
      proxy/
  packages/
    sdk/
  infra/
    bootstrap/
    docker/
    deployment/
    migrations/
  scripts/
    dev/
    e2e/
    benchmarks/
    data/
    maintenance/
  docs/
  tests/
    browser/
    integration/
    e2e/
  generated/
  screenshots/
```

This does not need to land in one dangerous big-bang rename immediately, but it is the target shape the refactor should move toward.

### Minimum root cleanup requirements

Even before a full root re-layout, the following should happen:

1. `scripts/` must be split by intent:
   - `scripts/e2e/`
   - `scripts/benchmarks/`
   - `scripts/bootstrap/`
   - `scripts/dev/`
   - `scripts/maintenance/`
2. generated SDK output should stop feeling like hand-authored app code
3. ephemeral output directories should stay clearly non-source and out of mental paths
4. runtime products should be documented as separate deployable units with explicit boundaries

### Root-level weird-folder guidance

The following folders are semantically suspicious and should be reviewed/cleaned as part of this refactor program:

- `.next/` — build artifact, never part of structure planning
- `screenshots/` — useful artifact folder, but should remain clearly QA/output only
- `test-results/` — same as above
- `src/sdk/` — generated/package-like content should likely be moved toward `packages/` or `generated/`
- `agent/`, `daemon/`, `runnerd/`, `workers/` — should eventually be grouped conceptually as runtime apps

---

## 7.1 Server folder target

### Current problem

`src/server/lib` is too much of a kitchen sink.

### Target

```text
src/server/
  api/
    v1/
      legacy/
      internal/
    v2/
      public/
        machines/
        images/
        billing/
        snapshots/
      admin/
        fleet/
          hosts/
          cells/
          procurement/
          maintenance/
          services/
          benchmarks/
  domains/
    machine/
      model.ts
      serialization/
      creation/
      image-source/
      readiness/
      lifecycle/
      access/
    fleet/
      host/
      cell/
      maintenance/
      benchmarks/
    account/
    routing/
    image/
  control-plane/
    jobs/
    services/
    runtime/
  adapters/
    providers/
    cloudflare/
    stripe/
    database/
```

The important shift:

- routes stop importing random “lib” files
- domains own business/infra logic
- adapters own external-system specifics
- control-plane owns async orchestration

---

## 7.2 Route taxonomy target

### V1

V1 should be explicitly treated as:

- legacy user contract
- minimal compatibility layer
- security/internal endpoints where necessary

Target structure:

```text
src/server/api/v1/
  legacy/
    machines.ts
    images.ts
    keys.ts
    proxy.ts
  internal/
    machine-callbacks.ts
    heartbeat.ts
    stage.ts
```

Rules:

- no new product features added to V1
- no new orchestration logic added to V1
- V1 may delegate to shared domains, but shared domains must not import from V1

### V2

V2 becomes canonical.

```text
src/server/api/v2/public/machines/
  index.ts
  create.ts
  lifecycle.ts
  read.ts

src/server/api/v2/admin/fleet/
  hosts.ts
  cells.ts
  procurement.ts
  maintenance.ts
  services.ts
  benchmarks.ts
```

---

## 7.3 Machine domain target

### Current problem

Machine behavior is spread across:

- `v2/machines.ts`
- `machine-lifecycle.ts`
- provider code
- runnerd
- route handlers

### Target machine domain split

```text
src/server/domains/machine/
  model.ts
  types.ts
  serialization/
    machine-view.ts
    connectivity-view.ts
  creation/
    create-machine.ts
    create-request-policy.ts
    identity.ts
    machine-subscription.ts
    capacity-reservation.ts
    job-payload.ts
  image-source/
    catalog-image.ts
    docker-image.ts
    golden-image.ts
    image-source-resolution.ts
  readiness/
    strategy.ts
    daemon-heartbeat.ts
    http-probe.ts
    tcp-probe.ts
    readiness-state-machine.ts
  access/
    ssh-access.ts
    proxy-access.ts
  lifecycle/
    delete-machine.ts
    start-machine.ts
    stop-machine.ts
    reboot-machine.ts
    sync-machine-status.ts
```

### Required explicit types

```ts
type MachineRuntimeKind =
  | 'vm'
  | 'container_system'
  | 'container_app_docker';

type MachineReadinessKind =
  | 'daemon_heartbeat'
  | 'http_probe'
  | 'tcp_probe'
  | 'warm_pool_claim';

type MachineImageSourceKind =
  | 'golden'
  | 'catalog'
  | 'snapshot'
  | 'docker_oci';
```

### Required invariant

Every machine creation request must resolve into a typed runtime profile before any provisioning work begins.

That runtime profile should include:

- runtime kind
- image source kind
- bootstrap strategy
- readiness strategy
- access expectations
- capability flags

No more repeated `if (docker)`, `if (warm claim)`, `if (container)` branches across unrelated layers.

---

## 7.4 Readiness model target

### Current problem

“Ready” means different things today depending on machine kind.

### Target

Introduce an explicit readiness state model, for example:

```ts
type MachineReadinessPhase =
  | 'requested'
  | 'host_selected'
  | 'server_created'
  | 'network_ready'
  | 'access_ready'
  | 'services_ready'
  | 'ready'
  | 'failed';
```

And a machine-kind strategy map:

- VM golden → `daemon_heartbeat`
- VM non-golden → `daemon_heartbeat`
- container system image → `daemon_heartbeat` or explicit agent readiness if supported
- Docker app container → `http_probe`

### Required data model change

Machine readiness should stop being implicit JSON-only state. We should add explicit columns or a dedicated table for:

- readiness kind
- readiness phase
- ready via (`heartbeat`, `http_probe`, etc.)
- last successful probe
- last failed probe

---

## 7.5 Runnerd target

### Current problem

`runnerd/src/index.ts` is doing too much.

### Target runtime layout

```text
runnerd/src/
  app.ts
  auth.ts
  health/
    healthz.ts
  incus/
    client.ts
    query.ts
    devices.ts
    images.ts
  runtime/
    vm/
      create.ts
      warm-pool.ts
      tuning.ts
    container/
      create.ts
      hardening.ts
      static-ip.ts
    docker/
      oci-remote.ts
      docker-image.ts
  network/
    bridge-ip.ts
    proxy-devices.ts
    listener-readiness.ts
  benchmark/
    timings.ts
    scenarios.ts
  cleanup/
    delete.ts
```

### Required runnerd rules

1. HTTP entrypoint only validates input and dispatches to runtime module.
2. VM path and container path must never share large inline branching blobs.
3. OCI/Docker support must live in its own module.
4. benchmark emission must be reusable, not hand-built in every branch.

### Required quality gates

- no runtime flow file > 350–400 LOC
- no `catch(() => {})` on critical infra ops without logged classification
- device/network mutations must be centralized and typed

---

## 7.6 Bootstrap / host install target

### Current problem

One shell script is doing too much.

### Target

Split host bootstrap into explicit phases:

```text
scripts/host-bootstrap/
  00-prereqs.sh
  10-install-incus.sh
  20-configure-incus.sh
  30-install-runnerd.sh
  40-install-backups.sh
  50-configure-oci-remotes.sh
  60-register-host.sh
  doctor.sh
```

And keep a thin orchestrator:

```text
scripts/bootstrap-baremetal-host.sh
```

whose job is only sequencing, not embedding all logic inline.

### Required bootstrap properties

- idempotent
- phase-by-phase rerunnable
- clear preflight checks
- explicit host version artifact output
- doctor command for post-bootstrap validation

### Required host validation artifact

Every host should produce a durable bootstrap artifact including:

- Incus version
- runnerd version
- OCI remote support yes/no
- storage/network config summary
- smoke test results for:
  - VM create
  - container create
  - Docker image container create

---

## 7.7 Fleet/admin target

### Current problem

`admin-fleet.ts` is a subsystem hidden in one file.

### Target

Split by operator concern:

```text
src/server/api/v2/admin/fleet/
  hosts.ts
  cells.ts
  procurements.ts
  maintenance.ts
  services.ts
  snapshots.ts
  benchmarks.ts
  validations.ts
```

And corresponding domain modules:

```text
src/server/domains/fleet/
  hosts/
  cells/
  benchmarks/
  maintenance/
  procurement/
```

### Required result

- operator routes become readable
- each route file stays small
- each admin concern can be reasoned about independently

---

## 7.8 Schema cleanup target

### Current problem

Some critical runtime truth still lives in `providerMeta`.

### Target schema hardening

Move platform-truth fields out of JSON where appropriate.

Candidate fields/tables:

1. `machine_requested_image_kind`
2. `machine_requested_image_ref`
3. `machine_readiness_kind`
4. `machine_ready_via`
5. `machine_http_port`
6. `machine_ssh_port`
7. `machine_public_ipv4`
8. `machine_public_ipv6`

Potential dedicated tables:

- `machine_runtime_profiles`
- `machine_readiness_states`
- `machine_network_endpoints`
- `machine_image_requests`

### Rule

If a field is used to make provisioning, readiness, routing, or access decisions, it should strongly prefer explicit schema over JSON metadata.

---

## 7.9 Frontend cleanup target

### Current problem

Some large pages are too heavy and still reflect historical drift between dashboard-era and V2-era layouts.

### Target

```text
src/app/v2/machines/[id]/
  page.tsx
  components/
    machine-header.tsx
    machine-connect-panel.tsx
    machine-proxy-panel.tsx
    machine-stats-panel.tsx
    machine-bootstrap-image-card.tsx
```

And for create flow:

```text
src/components/v2/machine-create/
  modal.tsx
  host-selector.tsx
  runtime-selector.tsx
  docker-image-input.tsx
  resource-selector.tsx
  pricing-summary.tsx
```

### V1 vs V2 frontend rule

- V2 pages are canonical
- old dashboard aliases may re-export V2 pages temporarily
- no duplicated product logic between `(dashboard)` and `/v2`

---

## 7.10 Test architecture target

### Current problem

The repo has good tests already, but coverage is still uneven across runtime kinds, partial-failure paths, and refactor-sensitive orchestration seams. Some of the most dangerous behavior is still validated mainly by a mix of targeted tests plus operator memory instead of an explicit coverage map.

### Target

The refactor must leave behind a clear, layered test architecture:

```text
src/__tests__/
  unit/
    domains/
    adapters/
    runnerd/
  integration/
    api/
    control-plane/
    scheduler/
    db/
  browser/
    v2/
      machine-create/
      machine-detail/
  e2e/
    runtime/
      vm/
      container/
      docker-image/
    fleet/
      bootstrap/
      maintenance/
      reconcile/
```

### Required test layers

Every critical behavior must be covered by the correct combination of layers:

1. **Unit tests**
   - pure decision logic
   - strategy resolution
   - serializers
   - scheduler scoring
   - image-source resolution
   - readiness strategy branching

2. **Integration tests**
   - route → domain wiring
   - control-plane job execution
   - DB state transitions
   - reservation commit/release logic
   - readiness projection logic

3. **Browser tests**
   - login → create flow
   - machine detail rendering
   - mode-specific UI warnings
   - Docker image UI input + validation

4. **End-to-end infrastructure tests**
   - real host bootstrap
   - real VM create and ready path
   - real container create and ready path
   - real Docker image container create and app reachability
   - delete/reconcile/orphan cleanup paths

### Required testability seams

Refactor modules must be designed so they can be tested directly without spinning the entire app when that is unnecessary.

That means:

- strategy modules must be pure or close to pure
- external adapters must be mockable behind narrow interfaces
- route handlers must be thin enough that domain behavior is testable independently
- runnerd submodules must be separable from the HTTP entrypoint

### Coverage philosophy

The goal is not meaningless vanity line coverage. The goal is **critical-path behavioral coverage**.

But for this refactor, the standard should be extremely high:

- every new branch in machine create/runtime/readiness logic gets explicit tests
- every bug fix gets a regression test first
- every machine kind gets unit + integration + browser/E2E representation where applicable
- every partial-failure path that can leak cost, ports, reservations, or stale readiness gets explicit regression coverage

---

## 8. File-level actions

## 8.1 Must-split files

### Split immediately

- `src/server/lib/v2/machines.ts`
- `runnerd/src/index.ts`
- `src/server/routes/v2/admin-fleet.ts`
- `src/app/v2/machines/[id]/page.tsx`
- `scripts/bootstrap-baremetal-host.sh`

### Freeze and gradually retire

- `src/server/routes/v1/machines.ts`
- other V1 route files that still carry old product semantics

### Keep but slim through extraction

- `src/server/lib/machine-lifecycle.ts`
- `src/server/db/schema.ts`

---

## 8.2 Explicit deletions / removals

These are acceptable and encouraged when parity is reached:

1. delete duplicate V2 alias logic once canonical path is stable
2. delete dead V1 route helpers no longer used by any client
3. delete legacy fallback code that only exists to support recently removed runtime shapes
4. delete historical metadata readers once explicit schema replaces them
5. delete temporary import/publish scripts used only during migration if runner/bootstrap fully supersede them

---

## 8.3 Import rules

Add architectural rules and enforce them in CI if possible:

1. V1 route files cannot import from V2 route files
2. route files cannot import other route files
3. frontend V2 pages cannot depend on `(dashboard)` internals
4. domain modules cannot depend on route-layer types
5. runnerd runtime modules cannot import HTTP layer module state

---

## 9. Quality gates and statistical analysis rules

These become hard operating rules.

### 9.1 File size thresholds

Infra-critical files should target:

- route files: **< 250 LOC**
- domain/service modules: **< 350 LOC**
- UI page files: **< 300 LOC**
- scripts/bootstrap phase files: **< 200 LOC**

Anything above that needs explicit justification.

### 9.2 Special-case budget

Any new machine kind or readiness mode must add:

- one typed profile definition
- one readiness strategy
- one test matrix entry
- one regression test for the new branch/behavior before implementation is considered done

It must **not** add five scattered conditionals across unrelated files.

### 9.3 Regression matrix

Required matrix after refactor:

- VM golden cold
- VM warm-pool
- VM custom image
- container golden
- container Docker image
- routing/proxy readiness
- host bootstrap validation
- delete/cleanup/reconcile after partial failure

And each matrix row must have explicit coverage expectations:

| Scenario | Unit | Integration | Browser | Live E2E |
|---|---:|---:|---:|---:|
| VM golden cold | yes | yes | optional | yes |
| VM warm-pool | yes | yes | optional | yes |
| VM custom image | yes | yes | optional | yes |
| container golden | yes | yes | yes | yes |
| container Docker image | yes | yes | yes | yes |
| routing/proxy readiness | yes | yes | yes | yes |
| host bootstrap validation | limited | yes | no | yes |
| delete/reconcile/orphan cleanup | yes | yes | no | yes |

If a row lacks one of its required layers, the batch is not done.

### 9.4 Operational telemetry requirements

The system should report separately:

- `container_started_ms`
- `network_ready_ms`
- `proxy_ready_ms`
- `daemon_ready_ms`
- `final_ready_ms`

That prevents future debates about “what is slow?”

### 9.5 Test-driven development gates

Every refactor batch must follow this sequence:

1. identify behavior being extracted or rewritten
2. add or update tests first
3. prove tests fail when the new behavior is absent or old bug still exists
4. implement minimal code to make tests pass
5. run relevant full local regression layer
6. run live E2E if the batch touches infra-critical runtime/bootstrap/routing behavior

Forbidden patterns:

- implementation first, tests later
- large structural rewrites without preserving behavioral tests
- marking tests TODO for critical infra paths
- merging a refactor batch without at least one new or updated regression test proving the change

### 9.6 Minimum coverage bars for this refactor

The following are required:

- **100% of machine runtime kinds** covered by explicit scenario tests
- **100% of readiness strategies** covered by explicit scenario tests
- **100% of destructive/cleanup paths** covered by regression tests
- **100% of host bootstrap phases** covered by doctor/smoke validation checks
- **100% of public V2 machine create variants** covered by API tests

For pure line/branch metrics, the repo may choose exact numbers later, but for infra-critical modules introduced or rewritten in this refactor the expected standard is:

- near-total branch coverage on strategy/orchestration modules
- explicit regression tests for every prior incident root cause

---

## 10. Phased implementation plan

## Phase 0 — freeze rules and create guardrails

Goals:

- declare architectural rules
- stop adding new large mixed files
- add file-size/ownership linting where practical

Deliverables:

- this spec adopted as basis
- module ownership map
- file hotspot list checked into docs
- explicit test matrix checked into docs and owned by the refactor

## Phase 1 — split machine orchestration core

Targets:

- extract serialization from `v2/machines.ts`
- extract create request policy
- extract image-source resolution
- extract job payload creation
- add tests first for every extracted module before moving code

Exit gate:

- `v2/machines.ts` under 500 LOC
- extracted modules have unit/integration coverage

## Phase 2 — formalize machine runtime profiles and readiness strategies

Targets:

- explicit runtime kind types
- explicit readiness strategy registry
- remove ad hoc Docker special-casing from scattered paths
- add explicit tests for each runtime kind × readiness strategy combination

Exit gate:

- each machine kind resolved to a single runtime profile object
- readiness strategies fully covered by unit + integration tests

## Phase 3 — split runnerd by runtime concern

Targets:

- separate VM/container/Docker/network/proxy/benchmark modules
- keep HTTP entrypoint thin
- add module-level tests for image resolution, proxy device setup, static IP allocation, and benchmark timing shaping

Exit gate:

- `runnerd/src/index.ts` becomes app wiring only
- runnerd critical modules have direct tests and live validation still passes

## Phase 4 — split admin fleet subsystem

Targets:

- break `admin-fleet.ts` into hosts/cells/benchmarks/services/etc.
- preserve route coverage and add focused route tests per admin concern

Exit gate:

- no single admin route file above 300 LOC
- admin routes retain or improve pre-refactor coverage

## Phase 5 — bootstrap hardening

Targets:

- split bootstrap phases
- add host bootstrap doctor + smoke validation artifact
- create doctor/smoke checks for every bootstrap phase

Exit gate:

- new host bootstrap is idempotent and phase-rerunnable
- bootstrap validation covers VM, container, Docker image create smoke paths

## Phase 6 — schema hardening

Targets:

- promote core `providerMeta` truth into explicit columns/tables
- add readiness/image request explicit schema
- add migration + serializer + API regression tests first

Exit gate:

- core provisioning decisions no longer depend on JSON-only truth
- schema migrations and fallbacks are regression-tested

## Phase 7 — V1/V2 final separation

Targets:

- move V1 under explicit legacy boundary
- remove duplicated frontend/dashboard logic
- add tests proving V1 compatibility and V2 canonical behavior both still work

Exit gate:

- V2 canonical; V1 compatibility only
- route/import boundaries are enforced and tested where practical

## Phase 8 — full confidence gate

Targets:

- run full regression matrix
- verify real host bootstrap, VM/container/Docker paths, routing, delete/reconcile
- run browser E2E on the canonical V2 user flow

Exit gate:

- infra audit passes with no hotspot file above threshold and green E2E matrix
- all required test layers are green for every matrix row

---

## 11. Acceptance criteria

This refactor is not done until all of the following are true:

### Structure

- no infra-critical monolith route/service/runtime file remains above threshold without explicit waiver
- V1 and V2 are visibly separated in directory structure and imports
- runnerd runtime paths are moduleized by concern

### Clarity

- machine kinds are explicit and typed
- readiness strategies are explicit and typed
- Docker image path is first-class, not hidden special-case glue

### Reliability

- provisioning behavior is reproducible after process restart
- Docker app containers do not wait forever on daemon heartbeat semantics
- host bootstrap is phase-based and rerunnable

### Verification

- regression matrix passes
- benchmark telemetry distinguishes boot/network/proxy/daemon time
- real live E2E still passes for:
  - VM
  - system container
  - Docker app container
- browser E2E passes for canonical V2 create flows
- every refactor batch added or updated regression tests before implementation landed

### Test discipline

- every extracted module has direct tests
- every machine kind has explicit create/readiness/access tests
- every readiness strategy has explicit regression coverage
- every bug found during refactor is captured by a failing test before its fix

---

## 12. Implementation discipline

### 12.1 Feature freeze rule

Once this refactor starts in earnest, do not keep layering unrelated product features into the same hotspots.

### 12.2 No “while here” exceptions

Any new runtime mode or operational feature must land in the new target structure, not the old monoliths.

### 12.3 Migration style

Do not big-bang rewrite unsafely.

Preferred style:

- extract behind compatibility facades
- keep behavior identical
- run tests/live checks
- then delete old paths

### 12.4 Root-structure cleanup rule

Path cleanup is part of the refactor, not an optional polish pass.

If a directory is only preserved to avoid renaming discomfort, that is not good enough. Once canonical paths are adopted and references are migrated, obsolete wrappers and transitional files should be deleted.

That includes:

- old route wrappers once import graph is updated
- dead top-level script layouts once categorized script folders exist
- old compatibility shims once downstream callers are migrated

This is a bold refactor in target, but should still be phased in execution.

---

## 13. Immediate next actions

If implementation starts from this spec, the first batch should be:

1. create new target folders for `domains/machine`, `api/v2/public/machines`, and `runnerd/src/runtime`
2. extract machine serialization from `src/server/lib/v2/machines.ts`
3. extract Docker image source resolution + runtime profile building
4. define explicit readiness strategy types
5. split `runnerd/src/index.ts` into app + container + vm + network modules

That is the highest-leverage start.

---

## 14. Bottom line

The system is already **real**, but it is not yet organized like infrastructure that inspires “A to Z confidence.”

The good news:

- the hard parts exist
- the product works
- durability foundations are in place

The bad news:

- too much critical behavior is still compressed into a few giant files
- readiness semantics are not formal enough
- V1/V2 and route/domain boundaries are not strict enough

This spec is the proposed basis to fix that completely.
