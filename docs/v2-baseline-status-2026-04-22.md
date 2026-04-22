# JustAVPS v2 baseline status — 2026-04-22

## Executive summary

Current truth:

- **Admin UI loads for real** at `/v2/admin`
- **Core host + region + procurement + container-machine flow works**
- **VM flow is not production-safe right now**
- **`region -> host -> machine` exists today**
- **`cluster` exists only as spec/internal cell residue, not as clean first-class runtime/UI concept yet**
- **organization default region does not exist yet**
- **resize and archive do not exist yet**
- **procurement is still Hetzner Robot-specific, not provider-agnostic**

If goal is “100% smooth e2e base flow”, then current honest baseline is:

- **containers: mostly yes**
- **VMs: no**
- **admin visibility: yes**
- **cluster model: not finished**

---

## What I verified for real

### Real app/browser verification

Verified against running local app at `http://localhost:4100`.

Real browser/admin pages loaded successfully:

- `/v2/admin` → `Fleet Overview`
- `/v2/admin/regions` → `Regions`
- `/v2/admin/hosts` → `Hosts`
- `/v2/admin/procurements` → `Procurements`
- `/v2/admin/accounts` → `Accounts`
- `/v2/admin/machines` → `Admin — Machines`

Artifacts:

- `screenshots/v2-admin-real.png`
- `screenshots/settings-org-real.png`

Real org settings page verified:

- org name edit exists
- org ID exists
- danger zone delete org exists
- **default region setting does not exist**

### Deterministic command results

Passed:

```bash
pnpm e2e:v2:01:topology
pnpm e2e:v2:02:placement
pnpm e2e:v2:05:procurement
pnpm e2e:v2:07:host-bootstrap-validation
pnpm e2e:v2:03:container
```

Failed:

```bash
pnpm e2e:v2:04:baremetal-lifecycle
pnpm e2e:v2:08:external-proxy-daemon
```

Health endpoint was up:

```bash
curl http://localhost:4100/api/health
```

---

## What works today

## 1. Regions

Current regions are already simple and coarse:

- `eu`
- `us`

Good:

- matches desired simple launch shape
- datacenter stays on host via `location`
- user-facing region stays stable

Current issue:

- no account/org-level `default_region`

## 2. Hosts

Hosts are already real first-class objects.

Working today:

- create host inventory row
- get bootstrap config
- register host runner + capacity
- heartbeat host
- track schedulability
- track maintenance state
- track validation artifact
- track Incus UI exposure metadata

This part is close to useful baseline.

## 3. Machines — container path

Working today:

- create v2 machine
- place onto host
- reserve and commit host capacity
- start container
- reach HTTP service
- create snapshot
- restore snapshot
- delete snapshot
- stop/start/reboot container
- delete machine

This is the strongest part of current v2.

## 4. Procurements

Working today:

- create procurement row
- approval flow exists
- Hetzner Robot sync exists
- procurement → host bootstrap progression exists

## 5. Admin UI visibility

Working today:

- fleet overview
- regions page
- hosts page
- procurements page
- accounts page
- admin machines page

---

## What is broken or incomplete

## 1. VM path is broken for real e2e

Both failing scripts create machines without `machine_mode`, so they fall onto current default:

- schema default: `machine_mode = 'vm'`
- public v2 create default: `machine_mode = 'vm'`
- admin machine create default: `machine_mode = 'vm'`

Observed failure pattern:

- machine becomes `ready`
- machine never gets heartbeat
- machine `health` stays `null`
- later fleet reconciliation marks machine `missing_from_host`
- machine becomes `deleted`

Concrete failed example inspected in DB:

- machine id: `56dec66d-0c9a-4e57-8769-8100c407b6df`
- status transitioned to `ready`
- then reconciled to `deleted`
- `providerMeta.reconciliation.missing_from_host = true`

Implication:

**v2 cannot honestly claim full VM e2e right now.**

## 2. Cluster model not finished

Desired model:

- `region -> cluster -> host -> machine`

Actual runtime today:

- public/admin runtime is basically `region -> host -> machine`
- old internal `cell` concept still leaks in docs/tests/service language
- no clean first-class cluster CRUD / browse / placement surface yet

Implication:

Incus clustering direction is documented, but not yet cleanly expressed in product/runtime shape.

## 3. Organization default region missing

Desired settings:

- organization name
- organization ID
- default region
- delete org

Actual today:

- name: yes
- ID: yes
- delete org: yes
- **default region: no**

Also no `default_region` on `accounts` table yet.

## 4. Procurement is not provider-agnostic yet

Current implementation is hard-wired to Hetzner Robot in core flow:

- UI copy says Hetzner
- backend calls `HetznerRobotClient` directly
- approval path places Hetzner order directly
- sync path polls Hetzner directly

Implication:

Current implementation is **provider-specific procurement with some generic-looking fields**, not true provider-agnostic procurement.

## 5. Admin machines still ride legacy v1 admin routes

Current admin machines page uses:

- `/api/v1/admin/machines`

and not a clean v2-native admin machine surface.

Implication:

- mixed mental model
- resize/lifecycle semantics split across old/new code
- harder to simplify

## 6. Resize not implemented

Current truth:

- `can_resize: false`
- admin machine patch explicitly rejects resize
- baremetal provider `resizeServer()` throws `Bare metal resize is not implemented yet`

So resize is **missing**, not partial.

## 7. Archive not implemented

No real archive lifecycle exists today.

Desired archive meaning should be:

- machine stopped
- compute lease released
- storage retained
- machine can later be resumed/restored

Current code has stop/start/delete, but no archive abstraction.

---

## Simplicity-first target baseline

This is the clean version I recommend locking now.

## 1. Topology

Launch topology:

- `region -> cluster -> host -> machine`

Launch policy:

- one cluster per region for now
- `eu` cluster
- `us` cluster

Future:

- later add more clusters per region
- naming can evolve to `eu-1`, `eu-west-1`, etc.

But **customer-facing region remains simple**.

## 2. Runtime defaults

For baseline launch:

- default machine runtime = **container**
- VM = **explicit, gated, not default**

Reason:

- container path is real today
- VM path is not stable today
- defaulting to broken path is killing e2e confidence

## 3. Account model

Add to account/org:

- `default_region`

Settings page should show exactly:

- organization name
- organization ID
- default region
- danger zone

## 4. Cluster model

Public/admin language:

- use **cluster**, not cell

Implementation shortcut:

- keep existing internal cell primitives temporarily if needed
- wrap/rename them at service/API/UI level as `cluster`

No more new cell-facing product code.

## 5. Host model

Each host should belong to exactly one:

- region
- cluster

Each host should track:

- vendor/provider
- procurement source
- bootstrap state
- Incus member name
- runner health
- schedulability
- maintenance state
- capacity totals
- capacity used

## 6. Procurement model

Procurement should become 2-layer:

### Generic control-plane interface

- request procurement
- approve procurement
- place procurement
- poll procurement
- provision host
- join cluster
- mark host active

### Provider adapters

- Hetzner Robot
- later OVH
- later others

This keeps one common host outcome:

**ready host in target region/cluster**

## 7. Machine lifecycle

Baseline machine operations:

- create
- get
- list
- stop
- start
- reboot
- snapshot create/list/restore/delete
- delete
- resize
- archive
- unarchive

## 8. Archive semantics

Lock this definition:

- `stopped` = machine off, capacity may still be logically attached for quick restart
- `archived` = machine off, root disk retained, active compute lease released, routing disabled, resumable later
- `deleted` = machine destroyed, storage deleted unless preserved as snapshot/image

That gives clear product meaning.

## 9. Resize semantics

Baseline resize should be:

1. validate requested size
2. validate target host/cluster capacity
3. stop machine if required
4. apply Incus limits / storage growth
5. restart machine
6. update lease and DB shape

Start with:

- vertical upsize only
- disk grow only

Do not overcomplicate first version.

---

## Hardcore simplification / refactor plan

## Phase 1 — stop lying with defaults

Must do first:

1. change machine default from `vm` → `container`
2. mark VM create as explicit-only
3. update failing VM-oriented E2Es so baseline suite tests container-first flow
4. split VM suite into separate explicit gate

Outcome:

- baseline e2e goes green on real supported path

## Phase 2 — cluster-first naming

1. rename public/admin `cell` language to `cluster`
2. add one cluster per region read model
3. bind each host to a cluster
4. make placement select cluster then host

Outcome:

- clean mental model without huge DB rewrite day 1

## Phase 3 — procurement abstraction

1. introduce provider-agnostic procurement service interface
2. move Hetzner specifics behind adapter
3. keep `procurement -> ready host` as single common contract

Outcome:

- future OVH support becomes straightforward

## Phase 4 — make admin machines v2-native

1. stop driving admin machine page through v1 admin routes
2. build v2-native admin machine CRUD/lifecycle surface
3. remove duplicate lifecycle logic

Outcome:

- one machine model, one lifecycle model

## Phase 5 — add missing lifecycle features

1. resize
2. archive / unarchive
3. then VM stabilization

Outcome:

- complete baseline machine product

---

## No-BS release gate

Do **not** call v2 fully working until all of this is true:

### Required green suites

```bash
pnpm e2e:v2:01:topology
pnpm e2e:v2:02:placement
pnpm e2e:v2:03:container
pnpm e2e:v2:05:procurement
pnpm e2e:v2:07:host-bootstrap-validation
pnpm e2e:v2:08:external-proxy-daemon
```

And later, separate explicit VM suite:

```bash
pnpm e2e:v2:04:baremetal-lifecycle
```

### Product checks

- `/v2/admin` loads in real browser
- `/v2/admin/hosts` loads in real browser
- `/v2/admin/procurements` loads in real browser
- `/settings` org page shows default region
- machine create form defaults to container
- resize works
- archive works

---

## Bottom line

Best current path:

1. **declare container-first baseline**
2. **introduce clean cluster abstraction**
3. **add account default region**
4. **make procurement provider-agnostic behind adapter**
5. **move admin machines fully onto v2**
6. **implement resize + archive**
7. **only then claim VM parity**

That is simplest path to real `region -> hosts -> machines` with Incus underneath and room to scale to clustered regions later.
