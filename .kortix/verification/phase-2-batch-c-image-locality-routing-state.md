# Phase 2 Batch C — image locality and routing-state hardening verification

Date: 2026-04-10

## Scope verified

1. Explicit image locality / host image availability state exists and is used in placement.
2. Routing correctness is represented as explicit durable state and has a deterministic repair path.
3. Targeted lint/tests for the changed files pass.

## What changed

### Image locality

- Added `baremetal_host_images` in `src/server/db/schema.ts`.
- Added `src/server/lib/baremetal/image-locality.ts` for:
  - explicit requested image refs
  - scheduler metadata overlay from DB state
  - placement intent recording (`warming` / `local`)
  - reconcile-driven host image inventory refresh
- `leaseHostCapacity()` now overlays requested image locality from `baremetal_host_images` before calling `scheduleBaremetalPlacement()`.
- `createMachineV2()` records locality intent on the selected host.
- `reconcileBaremetalFleet()` refreshes host image availability from runner image state.

### Routing state

- Added `machine_routing_states` in `src/server/db/schema.ts`.
- Added `src/server/lib/routing-state.ts` for:
  - desired routing snapshot derivation
  - explicit KV/DNS sync state (`pending`, `synced`, `absent`, `error`)
  - durable versioned routing metadata
  - repair batching via `repairStaleMachineRoutingStates()`
- `setupProxyDNS()` now upserts/apply routing state instead of only best-effort KV/DNS side effects.
- `syncMachineStatus()` and heartbeat-ready flow now update explicit routing state.
- machine cleanup now marks routing absent through the same state model.
- `/v1/internal/watchdog` now repairs pending/error routing rows each run.

## Verification commands

### Lint

```bash
pnpm exec eslint src/server/lib/baremetal/image-locality.ts src/server/lib/routing-state.ts src/server/lib/baremetal/reservations.ts src/server/lib/baremetal/reconcile.ts src/server/lib/cloudflare.ts src/server/lib/machine-lifecycle.ts src/server/lib/v2/machines.ts src/server/routes/v1/internal.ts src/server/db/schema.ts src/__tests__/lib/image-locality.test.ts src/__tests__/lib/routing-state.test.ts
```

Result: passed

### Tests

```bash
pnpm exec vitest run src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/image-locality.test.ts src/__tests__/lib/routing-state.test.ts src/__tests__/lib/machine-lifecycle.test.ts src/__tests__/lib/v2-machine-create-flow.test.ts src/__tests__/lib/v2-machines.test.ts src/__tests__/lib/baremetal-reconcile.test.ts
```

Result: 7 files passed, 26 tests passed.

## Notes

- This batch intentionally stops at explicit inventory/state + scheduler/watchdog hooks. It does not add a full image replication controller or a new routing plane.
- DB schema was updated in `schema.ts`; applying it in a live/dev DB still requires the normal schema push workflow.
