# Phase 1 Batch A verification

Date: 2026-04-10

## Scope verified

- `src/server/lib/webhook-delivery.ts` now queues durable webhook delivery jobs instead of using in-process `setTimeout` retries.
- `src/server/lib/control-plane-jobs.ts` provides the first reusable control-plane job runtime with persisted claim/lease/retry/dead-letter state.
- `src/server/db/schema.ts` now contains Phase 1 Batch A hot-path indexes plus durable `control_plane_jobs` and expanded `webhook_deliveries` state.
- `src/server/routes/v1/internal.ts` watchdog now drains due webhook jobs so persisted retries are processed after restarts.

## Verification details

### No in-process retry truth in webhook delivery

- Searched `src/server/lib/webhook-delivery.ts` for `setTimeout` and found no matches.
- Delivery flow now:
  1. persist `webhook_deliveries` row
  2. persist matching `control_plane_jobs` row
  3. worker claims due job
  4. worker updates delivery status to `delivering` / `retry_waiting` / `delivered` / `dead_lettered`

### Schema / index changes present

- Added hot-path indexes for:
  - `machines(account_id, deleted_at, created_at desc)`
  - `machines(status, deleted_at)`
  - `machines(provider, region, status, deleted_at)`
  - `machines(provider_server_id)`
  - `machines(last_heartbeat_at)`
  - `machine_events(machine_id, created_at desc)`
  - `machine_events(account_id, created_at desc)`
  - `images(account_id, status, created_at desc)`
  - `baremetal_hosts(region, status, host_class)`
  - `baremetal_hosts(status, updated_at)`
  - `webhooks(account_id, active)`
  - `webhook_deliveries(webhook_id, created_at desc)`
  - `webhook_deliveries(status, next_attempt_at)`
- Added durable job table: `control_plane_jobs`
- Expanded `webhook_deliveries` with `payload_version`, `status`, `next_attempt_at`, `last_attempt_at`, `delivered_at`, and `dead_lettered_at`
- Added SQL migration file: `drizzle/0007_phase1_batch_a_webhook_jobs.sql`

## Targeted validation commands

```bash
pnpm exec vitest run src/__tests__/lib/control-plane-jobs.test.ts src/__tests__/lib/webhook-delivery.test.ts
pnpm exec eslint src/server/lib/control-plane-jobs.ts src/server/lib/webhook-delivery.ts src/server/db/schema.ts src/server/routes/v1/internal.ts src/__tests__/lib/control-plane-jobs.test.ts src/__tests__/lib/webhook-delivery.test.ts
```

## Results

- Vitest: 2 files passed, 3 tests passed
- ESLint: passed with no reported errors

## Reuse notes for Batch B

- `control-plane-jobs.ts` is generic around job type, payload, handler registration, leasing, retries, and worker polling.
- Batch B machine lifecycle jobs can add new `jobType` handlers without changing the webhook-specific state model.
