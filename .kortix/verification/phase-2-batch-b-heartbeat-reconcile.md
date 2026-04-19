# Phase 2 Batch B verification

Date: 2026-04-10

## Scope verified

1. Heartbeat ingestion now persists hot heartbeat rollup state in `machine_heartbeat_states` via `src/server/lib/heartbeat-state.ts` instead of treating the `machines` row as the only write sink.
2. Machine-row heartbeat projection is now compatibility-focused and throttled (`HEARTBEAT_MACHINE_PROJECTION_MS`) while first-ready transitions still project immediately.
3. Watchdog health evaluation now prefers explicit heartbeat rollup state via `effectiveHeartbeatForMachine(...)`.
4. Bare-metal reconcile now supports targeted/incremental operation with `onlyDueHosts`, `hostIds`, `maxHosts`, and global-audit skip controls.
5. Admin host listing no longer forces reconcile-on-read, and bare-metal placement no longer runs a fleet-wide reconcile before every host selection.

## Files changed

- `src/server/db/schema.ts`
- `src/server/lib/heartbeat-state.ts`
- `src/server/routes/v1/internal.ts`
- `src/server/lib/machine-watchdog.ts`
- `src/server/lib/baremetal/reconcile.ts`
- `src/server/lib/providers/baremetal.ts`
- `src/server/routes/v1/admin-baremetal.ts`
- `src/__tests__/lib/heartbeat-state.test.ts`
- `src/__tests__/lib/baremetal-reconcile.test.ts`

## Verification commands

```bash
pnpm exec vitest run src/__tests__/lib/heartbeat-state.test.ts src/__tests__/lib/baremetal-reconcile.test.ts
pnpm exec eslint src/server/routes/v1/internal.ts src/server/lib/heartbeat-state.ts src/server/lib/machine-watchdog.ts src/server/lib/baremetal/reconcile.ts src/server/lib/providers/baremetal.ts src/server/routes/v1/admin-baremetal.ts src/__tests__/lib/heartbeat-state.test.ts src/__tests__/lib/baremetal-reconcile.test.ts
pnpm exec eslint src/server/db/schema.ts
```

## Results

- Targeted Vitest: passed (`2 files, 7 tests`)
- Targeted ESLint: passed
- Schema ESLint: passed

## Notes

- This batch intentionally stops short of a separate heartbeat ingestion service; the new rollup table and projection boundary are in-process but ready for later extraction.
- Product-visible ready/status behavior remains driven by immediate projection on first ready heartbeat.
