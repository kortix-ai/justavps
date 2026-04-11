# Phase 3 Batch B — control-plane service split groundwork

Date: 2026-04-11

## What changed

- Added explicit control-plane service modules under `src/server/lib/control-plane/` for:
  - allocator
  - provisioner
  - telemetry
  - routing
- Added `control_plane_service_states` to `src/server/db/schema.ts` as a generic lease/checkpoint primitive for service extraction groundwork.
- Moved API-facing orchestration code to call service-specific wrappers instead of reaching directly into generic control-plane helpers for:
  - V2 machine create placement/job enqueue
  - heartbeat ingestion
  - routing sync on heartbeat ready
  - watchdog provisioner/routing maintenance passes

## Architectural effect

- Allocator responsibility is now represented by `control-plane/allocator.ts`, which owns placement/lease entrypoints and placement metadata shaping.
- Provisioner responsibility is now represented by `control-plane/provisioner.ts`, which owns machine-create job type constants, enqueue/kick/worker registration, and a leased maintenance pass.
- Telemetry responsibility is now represented by `control-plane/telemetry.ts`, which owns heartbeat ingestion/projection orchestration.
- Routing responsibility is now represented by `control-plane/routing.ts`, which owns heartbeat-driven routing sync and leased repair passes.
- Generic service lease/checkpoint state now has an explicit schema model via `control_plane_service_states`.

## Verification run

### Lint

Command:

```bash
pnpm exec eslint "src/server/db/schema.ts" "src/server/lib/control-plane/service-state.ts" "src/server/lib/control-plane/allocator.ts" "src/server/lib/control-plane/provisioner.ts" "src/server/lib/control-plane/telemetry.ts" "src/server/lib/control-plane/routing.ts" "src/server/lib/v2/machines.ts" "src/server/routes/v1/internal.ts" "src/__tests__/lib/v2-machine-create-flow.test.ts" "src/__tests__/lib/control-plane-services.test.ts"
```

Result: passed

### Targeted tests

Command:

```bash
pnpm exec vitest run "src/__tests__/lib/v2-machine-create-flow.test.ts" "src/__tests__/lib/control-plane-services.test.ts" "src/__tests__/lib/control-plane-jobs.test.ts" "src/__tests__/lib/heartbeat-state.test.ts" "src/__tests__/lib/routing-state.test.ts"
```

Result: 5 files passed, 13 tests passed

## Notes

- This batch keeps the app single-runtime/deployable; the new service modules are groundwork for later extraction, not a multi-process cutover.
- Lease/checkpoint primitives are modeled generically so later independently scaled service workers can reuse them without another schema rethink.
