# Phase 1 Batch B verification

Date: 2026-04-10

## Summary

- Added durable `machine_create` control-plane jobs and removed V2 machine create's dependency on `after(...)` as the source of provisioning truth.
- Added `host_capacity_reservations` schema + migration and used reservations before enqueuing machine create work.
- Machine create job now commits the reservation after runner create succeeds and releases it on terminal failure.
- Reconcile now expires stale reserved leases and releases reservations tied to deleted/error machines.

## Key implementation files

- `src/server/db/schema.ts`
- `drizzle/0008_machine_create_reservations.sql`
- `src/server/lib/control-plane-jobs.ts`
- `src/server/lib/baremetal/reservations.ts`
- `src/server/lib/baremetal/scheduler.ts`
- `src/server/lib/baremetal/reconcile.ts`
- `src/server/lib/v2/machines.ts`
- `src/server/lib/machine-lifecycle.ts`

## Verification against task criteria

1. **Machine create no longer depends on `after(...)`**
   - Verified in `src/server/lib/v2/machines.ts`: API path now creates the machine row, leases host capacity, enqueues a durable `machine_create` job, kicks the job worker, and returns.
2. **Reservation schema/state exists**
   - Verified via new `host_capacity_reservations` table and migration.
3. **Reservation written before runner create and committed/released appropriately**
   - `createMachineV2()` writes the reservation in the transaction before job enqueue.
   - `handleMachineCreateJob()` commits reservation after successful `provider.createServer()`.
   - `markMachineCreateFailed()` releases reservation on terminal failure.
   - `reconcileBaremetalFleet()` expires stale reservations and releases reservations for deleted/error machines.
4. **Targeted tests/lint pass**
   - Tests:
     - `pnpm exec vitest run src/__tests__/lib/baremetal-reservations.test.ts src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/baremetal-reconcile.test.ts src/__tests__/lib/v2-machines.test.ts src/__tests__/lib/v2-machine-create-flow.test.ts src/__tests__/lib/control-plane-jobs.test.ts`
   - Lint:
     - `pnpm exec eslint src/server/lib/v2/machines.ts src/server/lib/baremetal/reservations.ts src/server/lib/baremetal/scheduler.ts src/server/lib/baremetal/reconcile.ts src/server/lib/control-plane-jobs.ts src/server/db/schema.ts src/server/lib/machine-lifecycle.ts src/__tests__/lib/baremetal-reservations.test.ts src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/baremetal-reconcile.test.ts src/__tests__/lib/v2-machine-create-flow.test.ts`

## Notes

- Scheduler placement now has reservation-aware helpers for custom-resource machine placement.
- Worker runtime was updated so multiple job types can register over time instead of the first registered job type permanently constraining worker polling.
- The current cleanup path is intentionally narrow: expired reserved leases and reservations for deleted/error machines are cleaned now, with room for broader lifecycle reuse in later batches.
