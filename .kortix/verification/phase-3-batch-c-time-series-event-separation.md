# Phase 3 Batch C verification — time-series and event storage separation groundwork

Date: 2026-04-11

## What changed

- Added `machine_telemetry_rollups` in `src/server/db/schema.ts` as a bucketed retained-history table for heartbeat/anomaly telemetry.
- Modeled explicit retention classes with DB enums:
  - `heartbeat_minute_7d`
  - `alert_30d`
- Kept `machine_heartbeat_states` as the hot summary/current-state model and clarified `machine_events` as the lifecycle/SSE hot path only.
- Added `src/server/lib/machine-telemetry.ts` to classify telemetry, assign retention classes, bucket observations, and upsert rollups.
- Updated `src/server/lib/event-bus.ts` so transient heartbeat/watchdog/security/network events persist to telemetry rollups instead of the lifecycle event stream.
- Added targeted unit coverage in `src/__tests__/lib/machine-telemetry.test.ts` and kept `src/__tests__/lib/heartbeat-state.test.ts` passing.

## Verification run

### Lint

Command:

```bash
pnpm exec eslint src/server/db/schema.ts src/server/lib/event-bus.ts src/server/lib/machine-telemetry.ts src/__tests__/lib/heartbeat-state.test.ts src/__tests__/lib/machine-telemetry.test.ts
```

Result: passed with no lint output.

### Tests

Command:

```bash
pnpm exec vitest run src/__tests__/lib/heartbeat-state.test.ts src/__tests__/lib/machine-telemetry.test.ts
```

Result:

- 2 test files passed
- 7 tests passed

## Verification against task goals

1. **Time-series/event responsibilities more explicitly separated**
   - `machine_events` is now the lifecycle/SSE stream.
   - `machine_telemetry_rollups` is now the retained telemetry/anomaly history store.
   - `machine_heartbeat_states` remains the hot summary projection.
2. **Retention/summary boundaries concretely modeled**
   - Summary boundary: `machine_heartbeat_states`
   - Retained history boundary: `machine_telemetry_rollups`
   - Retention classes: `heartbeat_minute_7d`, `alert_30d`
   - Partition-friendly columns: `bucket_start`, `bucket_resolution_sec`, `retention_until`
3. **Targeted verification passed**
   - Lint passed for changed files.
   - Targeted unit tests passed.
