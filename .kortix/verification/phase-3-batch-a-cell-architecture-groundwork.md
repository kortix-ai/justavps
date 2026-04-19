# Phase 3 Batch A verification — cell architecture groundwork

Date: 2026-04-11

## What changed

- Added an explicit `cells` schema model plus `baremetal_hosts.generation` and `baremetal_hosts.cell_id` so the baseline cell identity is now `region × host_class × generation`.
- Added cell identity helpers plus DB-backed cell upsert/host-assignment helpers in `src/server/lib/baremetal/cells.ts` and `src/server/lib/baremetal/cell-store.ts`.
- Made host inventory and placement surfaces cell-aware:
  - scheduler candidates now carry cell identity and cell-capacity snapshots
  - scheduler policy now supports `requiredCellId` / `preferredCellIds` and applies cell-level utilization hooks
  - reservations/provider/V2 machine metadata now propagate cell identity
  - reconcile ensures hosts are assigned to cells
- Expanded admin fleet visibility so `/admin/fleet/hosts` returns both host-level cell membership and aggregated cell capacity snapshots; the V2 admin fleet page now renders a Cells section.

## Concrete verification against task requirements

1. **Cell architecture explicitly modeled in schema/code**
   - `src/server/db/schema.ts` now defines `cells`
   - `baremetal_hosts` now stores `generation` and `cell_id`
   - `src/server/lib/baremetal/cells.ts` defines shared cell identity/capacity logic

2. **Hosts associated with cells and scheduler/inventory use cell identity concretely**
   - `src/server/lib/baremetal/cell-store.ts` ensures cells exist and hosts are assigned
   - `src/server/lib/baremetal/reconcile.ts` calls `ensureBaremetalHostCellAssignment(...)`
   - `src/server/lib/baremetal/scheduler.ts` now computes `decision.cells`, candidate `cell`, and cell-aware policy/score hooks
   - `src/server/routes/v1/admin-baremetal.ts` exposes host cell fields and aggregated cell snapshots
   - `src/server/lib/v2/machines.ts` and `src/server/lib/providers/baremetal.ts` now persist cell identity into placement/provider metadata

3. **Targeted tests/lint passed**

### Lint

```bash
pnpm exec eslint src/server/db/schema.ts src/server/lib/baremetal/cells.ts src/server/lib/baremetal/cell-store.ts src/server/lib/baremetal/types.ts src/server/lib/baremetal/scheduler.ts src/server/lib/baremetal/reservations.ts src/server/lib/providers/baremetal.ts src/server/lib/baremetal/reconcile.ts src/server/lib/v2/machines.ts src/server/routes/v1/admin-baremetal.ts src/hooks/use-fleet.ts src/app/v2/admin/fleet/page.tsx src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/baremetal-reconcile.test.ts src/__tests__/lib/v2-machines.test.ts src/__tests__/lib/baremetal-provider.test.ts src/__tests__/lib/v2-machine-create-flow.test.ts src/__tests__/routes/admin-baremetal-hosts.test.ts
```

Result: passed

### Tests

```bash
pnpm exec vitest run src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/baremetal-reconcile.test.ts src/__tests__/lib/v2-machines.test.ts src/__tests__/lib/baremetal-provider.test.ts src/__tests__/lib/v2-machine-create-flow.test.ts src/__tests__/routes/admin-baremetal-hosts.test.ts
pnpm exec vitest run src/__tests__/lib/baremetal-reservations.test.ts src/__tests__/routes/admin-baremetal.test.ts
```

Result: 8 files passed, 26 tests passed.

## Notes

- This batch stays foundational: placement is still executed per-host, but cells are now first-class scheduling/inventory inputs and policy hooks.
- No service split or control-plane decomposition was attempted in this batch.
