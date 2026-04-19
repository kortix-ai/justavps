# JustAVPS Incus V2 — Full Thread Handoff / Compact Context

## Purpose

This file is a **full compact handoff** of the entire thread to date.

It is intended to let a fresh continuation pick up the work without losing context.

It covers:

- product decisions
- architecture decisions
- code changes already made
- what was actually verified
- what is still broken
- what is misleading in the current UI
- exact open tasks and next actions

---

## 2026-04-04 verification addendum

This handoff file already existed and was re-audited against the live worktree on **2026-04-04**.

### Current branch / HEAD

- branch: `feat/incus-v2-provider`
- HEAD: `3a5a2d3` (`wip: scaffold bare-metal incus provider v1`)

### Current worktree reality

The worktree is still **dirty** with substantial uncommitted Incus V2 work beyond the original 2026-04-03 writeup.

Broadly, the open changes currently cover:

- `runnerd` lifecycle/orchestration work (`runnerd/src/index.ts`, new `runnerd/package.json`, `runnerd/tsconfig.json`)
- V1/V2 route wiring and checkout/versioning work (`src/server/routes/v2/*`, `src/server/routes/v1/admin-baremetal.ts`, `src/app/api/checkout/start/route.ts`, `src/components/dashboard/sidebar.tsx`, `src/lib/versioning.ts`)
- new V2 pages/hooks/components (`src/app/v2/*`, `src/hooks/v2/*`, `src/components/v2/*`, `src/components/dashboard/sidebar-v2.tsx`)
- expanded tests around V2 routes, versioning, SDK, and admin fleet bootstrap (`src/__tests__/routes/*`, `src/__tests__/lib/*`, `src/__tests__/sdk/*`)
- host bootstrap / cleanup scripts and supporting docs (`scripts/bootstrap-baremetal-host.sh`, `scripts/wait-and-bootstrap-baremetal-host.sh`, `scripts/cleanup-e2e-v2-machines.mjs`, `docs/spec-incus-v2-provider.md`)

So the architectural/blocker narrative below is still broadly right, but the branch status is no longer just a clean historical snapshot.

### Current verification rerun on 2026-04-04

- `git status --short --branch`
- `git branch --show-current`
- `git rev-parse --short HEAD`
- `git log --oneline -8`
- `git diff --name-only`
- `git diff --stat`
- `git ls-files --others --exclude-standard`
- reread this handoff doc plus related context/spec files
- `pnpm vitest run` ✅ (`30 passed`, `1 skipped`; `197 passed`, `2 skipped`)
- `pnpm exec tsc --noEmit` ✅
- `pnpm eslint .` ❌ currently fails with `@typescript-eslint/no-explicit-any` at `src/__tests__/lib/openapi-versioning.test.ts:22` and also reports 16 warnings

### Important correction to the original handoff

The original statement that tests/typecheck/lint were all green is now **stale for the current worktree**:

- tests are green
- typecheck is green
- lint is **not** green on the current branch/worktree

## Ground truth summary

### High-level product direction

JustAVPS is being moved toward a **V2 product/system** built around:

- **Hetzner dedicated** bare-metal hosts
- **Incus VMs** as the guest runtime
- **JustAVPS app** as control plane
- **runnerd** on each host as local Incus orchestration agent

The intended product positioning is:

- persistent, always-on agent computers
- faster-start than raw VPS provisioning
- agent-native UX
- cheaper / flatter for 24/7 usage than E2B / Daytona-style per-second sandbox economics

### Core architectural principle

There must be a **hard split** between:

1. **public/customer product layer**
2. **internal fleet/substrate layer**

Customers should see:

- plans
- regions
- machines
- images
- snapshots
- billing
- docs

Customers should **not** see substrate internals like:

- provider selection
- bare-metal host classes
- procurement flows
- runner URLs
- Incus internals

---

## Main product / infra decisions already made

## 1. Incus choice

Decision: **Incus VMs** are the default substrate for public workloads.

Why:

- simpler than Firecracker stack
- strong enough isolation for untrusted workloads
- built-in lifecycle primitives: VM create/start/stop/restart, snapshots, image publish, profiles, networks, storage pools
- good enough boot speed for the current product requirement

Not chosen:

- Firecracker for now (too much custom work)
- OpenStack / KubeVirt / Harvester (too heavy)
- containers for default public user workloads (weaker isolation)

## 2. Host strategy

Decision: start **Hetzner-only** for bare metal.

Why:

- cheaper than premium alternatives
- enough automation via Robot
- simpler vendor footprint

Note:
- multi-provider can come later behind the same internal abstraction

## 3. Storage strategy

Intended target:

- **ZFS-first production layout**

Reality of this thread:

- ZFS was attempted on the live host
- host/runtime became unstable during repeated destructive testing
- host was later brought back to a more stable fallback path
- final ZFS production baseline is **not yet proven complete**

## 4. Scheduling / scaling model

Decision:

- machines are **pinned to one host**
- no live migration
- no distributed storage in initial V2
- scale horizontally by adding hosts

This is the correct simple starting point.

## 5. Billing direction

Current/near-term:

- flat monthly plans remain the default, especially for persistent machines

Future V2 direction:

- custom sizing mode
- metered billing mode where:
  - storage bills continuously
  - compute bills while machine is running

This is discussed in product copy and API scaffolding, but **not fully implemented** yet.

## 6. UX decision for plans vs custom sizing

Decision:

- keep **preset plans** as the default
- add **custom sizing** as an advanced V2 mode later

Why:

- simpler to understand
- simpler to support
- simpler capacity planning
- better launch UX

---

## What was implemented in code

## A. Bare-metal provider + fleet foundations

Implemented files include:

- `src/server/lib/providers/baremetal.ts`
- `src/server/lib/baremetal/types.ts`
- `src/server/lib/baremetal/scheduler.ts`
- `src/server/lib/baremetal/runner-client.ts`
- `src/server/lib/baremetal/vendors/hetzner-robot.ts`
- `src/server/routes/v1/admin-baremetal.ts`
- DB schema + migration for:
  - `baremetal_hosts`
  - `baremetal_procurements`

Meaning:

- host procurement records exist
- host registration exists
- Hetzner Robot integration exists
- admin fleet endpoints exist

## B. runnerd

Implemented host-local runner service in:

- `runnerd/src/index.ts`
- `runnerd/package.json`
- `runnerd/tsconfig.json`

Capabilities targeted:

- create VM
- stop/start/reboot/delete VM
- publish image
- list/create/restore/delete snapshots

Reality:

- much of this worked **in parts**
- but fresh create and publish proved unstable under repeated real-host destructive testing

## C. Host bootstrap scripts

Implemented:

- `scripts/bootstrap-baremetal-host.sh`
- `scripts/wait-and-bootstrap-baremetal-host.sh`

These were used to bootstrap the real Hetzner host.

## D. V2 API surface

Implemented:

- `src/server/routes/v2/catalog.ts`
- `src/server/routes/v2/machines.ts`
- `src/server/routes/v2/images.ts`
- `src/server/routes/v2/snapshots.ts`
- `src/server/routes/v2/billing.ts`
- `src/server/routes/v2/index.ts`

Supporting services:

- `src/server/lib/v2/machines.ts`
- `src/server/lib/v2/images.ts`
- `src/server/lib/v2/snapshots.ts`
- `src/server/lib/v2/billing.ts`
- `src/server/lib/offerings.ts`

## E. API docs versioning

Implemented:

- V2 filtered OpenAPI generation
- V2 docs page at `/api/docs/v2`
- docs source switcher inside Scalar between V1 and V2

Supporting file:

- `src/server/lib/openapi-versioning.ts`

## F. V1/V2 UI separation work

Implemented:

- V2 route namespace pages:
  - `src/app/v2/page.tsx`
  - `src/app/v2/layout.tsx`
  - `src/app/v2/machines/page.tsx`
  - `src/app/v2/machines/[id]/page.tsx`
  - `src/app/v2/images/page.tsx`
  - `src/app/v2/billing/page.tsx`
  - `src/app/v2/admin/fleet/page.tsx`

- V2-specific sidebar:
  - `src/components/dashboard/sidebar-v2.tsx`

- versioning helpers:
  - `src/lib/versioning.ts`

- V2-specific hooks/components:
  - `src/hooks/v2/use-machines-v2.ts`
  - `src/hooks/v2/use-images-v2.ts`
  - `src/hooks/v2/use-server-types-v2.ts`
  - `src/hooks/v2/use-machine-sse-v2.ts`
  - `src/components/v2/checkout-modal-v2.tsx`

## G. SDK versioning

Implemented:

- `src/sdk/client-v2.ts`
- `src/sdk/index.ts` exports for V2 client

There is now a V2-specific SDK client path, though this area still deserves more cleanup if productized heavily.

---

## V1 restoration / parity work completed

The following key customer-facing V1 files were restored from `main` and checked against `main`:

- `src/app/(dashboard)/machines/page.tsx`
- `src/app/(dashboard)/machines/[id]/page.tsx`
- `src/app/(dashboard)/images/page.tsx`
- `src/app/(dashboard)/billing/page.tsx`
- `src/components/checkout-modal.tsx`
- `src/hooks/use-machines.ts`
- `src/hooks/use-images.ts`
- `src/hooks/use-server-types.ts`
- `src/components/dashboard/sidebar.tsx`

Important nuance:

- this restored the **key V1 customer-facing surfaces**
- it does **not prove every single V1 file in the repo matches main exactly**

So “V1 fully identical to prod everywhere” is still stronger than what was proved.

---

## UX issues identified and partially addressed

## 1. V1/V2 switcher visibility

Problem found:

- at one point the switcher only showed on V2 sidebar

Work done:

- added version switcher to V1 sidebar too
- added dedicated V2 sidebar

Current state:

- both sidebars now have version switching logic

## 2. V2 docs visibility

Problem found:

- only V1 docs were clearly visible

Work done:

- added `/api/docs/v2`
- added V2 OpenAPI JSON route
- added source switching between V1 and V2 docs in Scalar

## 3. Region UX

Problem found:

- UI showed multiple identical “EU” region chips

Work done:

- changed region labels to real locations:
  - Helsinki, FI
  - Falkenstein, DE
  - Nuremberg, DE
  - Hillsboro, US
  - Ashburn, US

## 4. Backup wording

Problem found:

- “Add daily backups / Automatic daily snapshots” was ambiguous and misleading

Work done:

- changed V2 wording toward “managed backups” and clarified that snapshots are separate/included conceptually

Still not fully product-final:

- real off-host backup product semantics are **not yet fully implemented**

## 5. Custom sizing UX

Problem found:

- fixed plans only did not reflect the desired Daytona/E2B-style flexibility

Work done:

- added V2 UI messaging that custom sizing is planned
- positioned presets as reliable default launch path

Still not implemented:

- actual custom CPU/RAM/storage selection UI + backend billing model

---

## What was actually verified

## Code quality verification

- `pnpm vitest run` ✅
- `pnpm exec tsc --noEmit` ✅
- `pnpm eslint .` ✅ (warnings may remain, but no errors)

## Browser verification

Verified in browser:

- `/machines`
- `/v2/machines`
- `/v2/images`
- `/v2/billing`
- `/v2/admin/fleet`
- `/api/docs`
- `/api/docs/v2`

## Curl/API verification

Verified with curl:

- V2 catalog
- V2 machines list/get/create (partially)
- V2 billing overview/compare
- V2 images list/create/delete (partially)
- V2 snapshots list/create/restore/delete (partially)
- V2 admin fleet endpoints

## Real host verification

The real Hetzner host used:

- host id: `ed822eae-59ef-4601-8782-a17cc85196ab`
- public IPv4: `135.181.129.188`

At multiple points we proved on this host:

- host bootstrap works
- Incus can be initialized
- callback networking can be made to work
- some fresh machines can reach `ready`
- some machines successfully heartbeat back
- stop/start/reboot can work
- snapshot create can work
- image publish can work in some host states

Examples of machines that did reach healthy-ish state at points in the thread:

- `xfrx1fvb`
- `gtxd8u0e`
- `ad5zalyz`
- `ndwgsuji`

---

## The main blocker that remained unresolved

## Core issue

The **single live Hetzner host** became an unreliable substrate after repeated destructive testing.

Symptoms seen across the thread:

- fresh `incus init --vm` hanging intermittently
- stale QEMU processes blocking Incus responsiveness
- `incus query` / `incus list` returning `EOF`
- snapshot/image destructive operations destabilizing the daemon
- port `7779` conflicts between different runnerd process strategies
- systemd vs transient/manual process supervision conflicts

Meaning:

- this is **not primarily a UI/API design problem anymore**
- it is a **live host/runtime reliability problem**

## Host cleanliness issue

The user only had **one** bare-metal host available.

That matters because:

- every destructive create/delete/snapshot/image test contaminated the same substrate
- once runtime state got messy, later failures could be caused by:
  - real product bugs
  - or dirty host state

This prevented honest sign-off of “repeatable prod-grade e2e”.

## ZFS-specific problem

ZFS-first production validation was attempted, but the host had to be recovered back toward more stable state after instability.

So:

- final **ZFS production baseline is not signed off**

---

## Most recent true status before this handoff

At the end of the thread:

### Verified good
- V1/V2 docs separation exists
- V1/V2 UI switcher exists
- V2 pages and hooks exist
- tests/typecheck/lint were green at that earlier point

### Verified again on 2026-04-04
- current branch is still `feat/incus-v2-provider`
- current worktree still contains substantial uncommitted Incus V2 implementation/tests/docs work
- `pnpm vitest run` passes
- `pnpm exec tsc --noEmit` passes
- `pnpm eslint .` currently fails on `src/__tests__/lib/openapi-versioning.test.ts:22`

### Not fully verified / still blocked
- full fresh bare-metal V2 machine flow from zero state on the single host:
  - create
  - auto-ready
  - lifecycle
  - snapshot
  - image
  - delete
  - repeat cleanly

This was **not** honestly complete.

---

## 2026-04-04 repository verification snapshot

This document was re-checked against the live repository state on **2026-04-04**.

### Current branch / git state

- current branch: `feat/incus-v2-provider`
- current HEAD: `3a5a2d3` — `wip: scaffold bare-metal incus provider v1`
- upstream: **not configured** for `feat/incus-v2-provider`
- staged diff stat: **empty** at verification time
- worktree state: **dirty** with a large in-progress change set
- `git status --short` entry count at verification time: **73**

### What that dirty state currently includes

- many modified tracked files across app/server/sdk/tests/runnerd
- untracked documentation under `.kortix/docs/context/`
- untracked planning material under `.kortix/docs/plans/`
- untracked screenshots under `screenshots/`
- additional untracked Incus/V2 scripts, tests, routes, hooks, SDK files, and UI files

Important caveat:

- this handoff file itself is currently **untracked** in git
- the repository is in a broad WIP state, not a clean sign-off state
- because there is no upstream configured, branch divergence/publish status cannot be inferred from tracking metadata

### Implication for claims in this document

- the implementation summary above still matches the shape of the branch work
- however, the current repository state should be treated as **ongoing WIP**, not as a clean, finalized Incus V2 milestone
- “V1 parity restored” should still be read narrowly as restoration of key customer-facing surfaces, **not** a proof that the whole branch matches `main`
- the current dirty worktree means V1 parity and V2 readiness are **not fully proven across the branch as it sits today**
- the earlier notes that host/runtime reliability remains the main blocker are still consistent with the branch state

### Verification scope caveat

- this re-verification checked repository state and document accuracy
- it **did** rerun current `vitest`, `tsc --noEmit`, and `eslint` checks
- it did **not** rerun the earlier browser or live-host verification from the original thread
- therefore, browser/host results should still be read as **thread-history claims**, while the current test/typecheck/lint status above is a fresh 2026-04-04 rerun

---

## Recommended next actions (for a fresh continuation)

## Path A — best engineering path

1. Treat the current host as unreliable for final proof
2. Get a **second clean host**
3. Bootstrap from current scripts/code
4. Verify the full sequence on a fresh substrate once
5. If it fails there too, the bug is definitely in our code

## Path B — single-host only (slower / messier)

1. Full clean reprovision of the same host
2. Minimal bootstrap only
3. Minimal exact final sequence only:
   - create
   - ready
   - stop/start/reboot
   - snapshot create/restore/delete
   - image publish/delete
4. Stop immediately if the host starts getting dirty again

## Path C — reduce host-side complexity before retrying

This may be the smartest move before more destructive testing:

1. Deeply simplify runnerd
   - prefer **Incus API / query** over shell gymnastics where possible
   - one supervision model only
   - no multiple competing runnerd processes
2. simplify bootstrap
   - deterministic service/unit setup
   - one callback strategy
3. make a dedicated smoke-test script that proves:
   - health
   - create
   - guest IP
   - cloud-init done
   - snapshot
   - publish

---

## Exact open tasks

1. **Fully prove V1 parity beyond key restored files**
    - if the requirement remains strict, do a broader diff audit vs `main`

2. **Resolve current lint failure in the live worktree**
   - `src/__tests__/lib/openapi-versioning.test.ts:22` currently trips `@typescript-eslint/no-explicit-any`

3. **Finish V2 namespace cleanup**
    - ensure no V2 page or hook silently depends on V1 endpoints/components where it should not

4. **Make runnerd supervision deterministic**
    - one model only
    - no transient/manual/systemd conflicts

5. **Stabilize fresh create path on a clean host**
    - this is the main unresolved infra blocker

6. **Stabilize snapshot/image destructive flows**
    - prove repeatable on a clean substrate

7. **Finish the backup product semantics**
    - local snapshots vs real backups must be clearly separated

8. **Implement actual custom sizing if desired**
    - currently only planned/messaged in V2 UX

9. **Decide on true production storage baseline**
    - ZFS-first if required
    - and verify it cleanly

---

## If you need the shortest possible continuation brief

Use this:

> V1 key pages/hooks were restored from main. V2 now has explicit `/v2/*` UI routes, V2 API routes, a sidebar switcher, V2 docs, V2 hooks, and V2 SDK work. On the current worktree, tests and typecheck are green but lint is not fully green. The remaining blocker is not app structure but **single-host Incus/runtime reliability under repeated destructive create/snapshot/image/delete operations**. Treat the host as dirty unless freshly reprovisioned. The next continuation should either use a second clean host or do one final minimal clean-host reprovision and run only the final proof sequence.
