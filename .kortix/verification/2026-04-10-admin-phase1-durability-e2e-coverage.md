# Admin + Phase 1 durability E2E/integration verification

Date: 2026-04-10

## Scope covered

- `/v2/admin/machines` alias + admin machines page safety
- durable webhook delivery + control-plane job execution/retry/dead-letter flow
- durable machine create job + reservation commit/release behavior
- reservation expiry + reconcile cleanup behavior
- backup artifact persistence + restore execution drill path
- maintenance/drain placement enforcement in realistic lease flows

## New coverage added

- `src/__tests__/app/admin-machines-page.test.tsx`
- `src/__tests__/lib/webhook-delivery.integration.test.ts`
- `src/__tests__/lib/v2-machine-create-job.integration.test.ts`
- `src/__tests__/lib/v2-snapshots-drill.integration.test.ts`
- `src/__tests__/lib/baremetal-reservations.integration.test.ts`

## Bugs found and fixed while verifying

1. `control-plane-jobs.ts` claimed due jobs with raw `Date` parameters in `db.execute(sql\`...\`)`, which broke durable job claiming under postgres.js during real integration execution. Fixed by binding ISO timestamp strings with explicit `::timestamp` casts and by tolerating both array and `{ rows }` execute result shapes.
2. `reservations.ts` stale-expiry query used a raw `Date` binding inside SQL, which broke real expiry/reconcile execution under postgres.js. Fixed by binding an ISO timestamp string with explicit `::timestamp` cast.

## Verification commands

```bash
set -a && source .env.local && set +a && pnpm run db:push
set -a && source .env.local && set +a && pnpm exec vitest run \
  src/__tests__/app/admin-machines-page.test.tsx \
  src/__tests__/lib/admin-machines.test.ts \
  src/__tests__/lib/versioning.test.ts \
  src/__tests__/routes/version-switcher.test.ts \
  src/__tests__/lib/control-plane-jobs.test.ts \
  src/__tests__/lib/webhook-delivery.test.ts \
  src/__tests__/lib/webhook-delivery.integration.test.ts \
  src/__tests__/lib/v2-machine-create-flow.test.ts \
  src/__tests__/lib/v2-machine-create-job.integration.test.ts \
  src/__tests__/lib/baremetal-reservations.test.ts \
  src/__tests__/lib/baremetal-reservations.integration.test.ts \
  src/__tests__/lib/baremetal-reconcile.test.ts \
  src/__tests__/routes/admin-baremetal-hosts.test.ts \
  src/__tests__/lib/v2-snapshots-drill.test.ts \
  src/__tests__/lib/v2-snapshots-drill.integration.test.ts
```

## Result

- `db:push`: passed
- targeted admin + durability suite: **15 files, 34 tests passed**

## Notes

- Local verification required applying the latest schema to the benchmark Postgres first because the new Phase 1 columns/tables were present in repo code but not yet in the local DB.
