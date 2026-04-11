# Phase 2 Batch A — scheduler v2 foundation verification

Date: 2026-04-10

## Verification target

`createMachineV2` no longer performs inline host scan placement, scheduler v2 returns a structured decision/explanation object, and targeted tests/lint for scheduler and affected create path pass.

## Code evidence

1. `src/server/lib/v2/machines.ts:685-710`
   - `createMachineV2` now calls `leaseHostCapacity(...)` with `imageId` / `imageAlias` scheduler hints.
   - The create path persists `placement_decision` audit data into `providerMeta` instead of embedding host scan logic in `createMachineV2`.

2. `src/server/lib/baremetal/scheduler.ts`
   - Added `scheduleBaremetalPlacement(...)`.
   - Scheduler returns a typed `BaremetalPlacementDecision` with:
     - `outcome`
     - `selectedHostId`
     - `summary`
     - `explanation`
     - `policy`
     - per-host `candidates[]` including projected usage/utilization and scheduling hints.
   - Decision scoring now considers:
     - schedulability / maintenance state
     - projected post-placement utilization
     - warm-pool metadata hooks
     - image locality metadata hooks
     - host-class preference hooks

3. `src/server/lib/baremetal/reservations.ts`
   - Reservation leasing now uses scheduler output to order candidate hosts.
   - Lease result includes the scheduler decision for auditability.
   - Final reservation still re-checks host locks/capacity under transaction to preserve Phase 1 reservation correctness.

## Targeted verification commands

### Tests

```bash
pnpm exec vitest run src/__tests__/lib/baremetal-provider.test.ts src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/v2-machine-create-flow.test.ts src/__tests__/lib/v2-machines.test.ts
```

Result: passed (`4` files, `14` tests)

### Lint

```bash
pnpm exec eslint src/server/lib/baremetal/scheduler.ts src/server/lib/baremetal/reservations.ts src/server/lib/baremetal/types.ts src/server/lib/providers/baremetal.ts src/server/lib/v2/machines.ts src/__tests__/lib/baremetal-provider.test.ts src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/v2-machine-create-flow.test.ts src/__tests__/lib/v2-machines.test.ts
```

Result: passed

## Notes

- The scheduler foundation is intentionally hook-oriented: warm-pool/image-locality/host-class data can be fed through host metadata now and expanded in later Phase 2 batches without reworking the placement API shape.
- Reservation leasing still acts as the transactional correctness boundary, so this batch strengthens explainability/policy without regressing Phase 1 durability work.
