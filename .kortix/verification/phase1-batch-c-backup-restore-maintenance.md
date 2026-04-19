# Phase 1 Batch C verification

Date: 2026-04-10

## Scope verified

1. Drain / maintenance state is modeled on bare-metal hosts and enforced by placement logic.
2. Backup artifact + restore execution baseline schema exists and is exercised by real snapshot create / restore code paths.
3. Targeted tests and lint for changed files pass.

## Implementation summary

- Added `backup_artifacts` and `restore_executions` tables plus migration `drizzle/0009_backup_restore_host_maintenance.sql`.
- Added bare-metal host `maintenance_state` tracking to `baremetal_hosts` and surfaced it in admin fleet APIs/UI.
- Added `src/server/lib/backup-artifacts.ts` so snapshot creation persists artifact metadata and snapshot restore creates restore execution history.
- Updated scheduler, reservation placement, and bare-metal provider host selection to reject hosts unless they are `status=active`, runner-registered, and `maintenance_state=in_service`.
- Added admin route `POST /admin/fleet/hosts/{id}/maintenance-state` and drain-blocker reporting in host list payloads.

## Verification commands

### Tests

```bash
pnpm exec vitest run src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/baremetal-reconcile.test.ts src/__tests__/lib/v2-snapshots-drill.test.ts src/__tests__/routes/v2-snapshots.test.ts src/__tests__/routes/admin-baremetal-hosts.test.ts
```

Result: 5 test files passed, 14 tests passed.

### Lint

```bash
pnpm exec eslint src/server/lib/baremetal/host-maintenance.ts src/server/lib/baremetal/scheduler.ts src/server/lib/baremetal/reservations.ts src/server/lib/baremetal/reconcile.ts src/server/lib/providers/baremetal.ts src/server/lib/backup-artifacts.ts src/server/lib/v2/snapshots.ts src/server/routes/v1/admin-baremetal.ts src/server/routes/v2/snapshots.ts src/hooks/use-fleet.ts src/app/v2/admin/fleet/page.tsx "src/app/(dashboard)/admin/fleet/page.tsx" src/__tests__/lib/baremetal-scheduler.test.ts src/__tests__/lib/baremetal-reconcile.test.ts src/__tests__/lib/v2-snapshots-drill.test.ts src/__tests__/routes/v2-snapshots.test.ts src/__tests__/routes/admin-baremetal-hosts.test.ts
```

Result: completed with no lint errors.

## Notes

- Restore drill baseline is intentionally snapshot-based and operator/DR-oriented, not a full customer backup SKU.
- Reconcile now preserves manually disabled hosts instead of blindly flipping them back to `active`.
