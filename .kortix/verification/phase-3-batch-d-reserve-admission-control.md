# Phase 3 Batch D verification — reserve/admission control groundwork

Date: 2026-04-11

## What changed

- Reconciled the retry by updating the stale `src/__tests__/lib/v2-machines.test.ts` expectation so verification matches the now-expanded cell state shape (`status`, `reservePolicy`, and `admission` are part of the baseline derived cell model).
- Added explicit schema primitives for cell-level reserve/admission state:
  - `cells.reserve_policy`
  - `cell_admission_controls`
- Extended bare-metal cell modeling/snapshots to compute:
  - reserve budgets
  - sellable capacity after reserve
  - admission/sellability state per cell
- Made scheduler placement enforce cell-level policy:
  - rejects `closed` admission cells
  - rejects `restricted` cells unless explicitly allowed by placement policy hooks
  - rejects `reserve_only` / `unsellable` cells unless explicitly allowed by placement policy hooks
  - rejects placements that would breach a cell reserve budget
  - applies a reserve-aware sellable headroom penalty when scoring eligible cells
- Extended admin fleet API/UI visibility with:
  - host-level cell admission/sellability badges
  - cell-level reserve budget totals
  - cell-level sellable capacity after reserve
  - cell admission reason in fleet view

## Key files

- `src/server/db/schema.ts`
- `src/server/lib/baremetal/cells.ts`
- `src/server/lib/baremetal/types.ts`
- `src/server/lib/baremetal/scheduler.ts`
- `src/server/lib/baremetal/reservations.ts`
- `src/server/lib/providers/baremetal.ts`
- `src/server/lib/v2/machines.ts`
- `src/server/routes/v1/admin-baremetal.ts`
- `src/hooks/use-fleet.ts`
- `src/app/v2/admin/fleet/page.tsx`
- `src/__tests__/lib/v2-machines.test.ts`

## Verification run

### Lint

Command:

`pnpm exec eslint src/app/v2/admin/fleet/page.tsx src/hooks/use-fleet.ts src/server/lib/baremetal/cells.ts src/server/lib/baremetal/scheduler.ts src/server/lib/baremetal/reservations.ts src/server/lib/baremetal/reconcile.ts src/server/lib/providers/baremetal.ts src/server/lib/v2/machines.ts src/server/routes/v1/admin-baremetal.ts src/server/db/schema.ts src/server/lib/baremetal/types.ts src/__tests__/lib/v2-machines.test.ts`

Result: passed (exit 0)

### Targeted tests

Command:

`pnpm vitest run src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/baremetal-reservations.test.ts src/__tests__/lib/baremetal-reconcile.test.ts src/__tests__/lib/baremetal-provider.test.ts src/__tests__/lib/v2-machines.test.ts src/__tests__/routes/admin-baremetal.test.ts src/__tests__/routes/admin-baremetal-hosts.test.ts`

Result:

- 7 test files passed
- 28 tests passed

## Verification against task criteria

1. Regional/cell reserve or admission-control state is explicitly modeled in schema/code.
   - Yes: `cells.reserve_policy` and `cell_admission_controls`.
2. Scheduler or placement uses that state concretely.
   - Yes: scheduler enforces admission/sellability state and reserve-budget breach checks during candidate evaluation/scoring.
3. Targeted tests/lint for changed files pass.
   - Yes: targeted eslint + vitest runs passed.
