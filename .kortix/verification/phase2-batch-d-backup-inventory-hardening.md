# Phase 2 Batch D verification — backup inventory and restore history hardening

Date: 2026-04-11

## Scope completed

Implemented concrete product/ops improvements for backup artifacts and restore executions:

- Added richer backup inventory fields in `src/server/db/schema.ts` and `drizzle/0010_backup_inventory_hardening.sql`
  - `backup_artifacts`: account/user ownership, backup kind, inventory scope, storage scope, display name, source machine slug, last verified time, restore count, last restore time
  - `restore_executions`: account, source host, trigger source, duration
- Hardened snapshot/restore persistence in `src/server/lib/backup-artifacts.ts`
  - restore completion now records duration and increments artifact restore counters
  - snapshot deletion now marks artifacts as `deleted` so inventory/audit history survives
- Expanded `src/server/lib/v2/snapshots.ts` / `src/server/routes/v2/snapshots.ts`
  - `GET /v2/snapshots/:machineId` now returns merged provider + DB inventory, restore execution history, and summary counts
  - create/restore paths now persist richer artifact/execution metadata
- Updated V2 machine UI in `src/app/v2/machines/[id]/page.tsx`
  - snapshot tab now shows inventory summary cards
  - snapshot rows now surface inventory source/storage/restore metadata
  - restore execution history is visible as a dedicated section
- Updated targeted tests for new API and persistence behavior

## Verification run

### Lint

Command:

`pnpm exec eslint "src/server/lib/backup-artifacts.ts" "src/server/lib/v2/snapshots.ts" "src/server/routes/v2/snapshots.ts" "src/hooks/v2/use-machines-v2.ts" "src/app/v2/machines/[id]/page.tsx" "src/__tests__/lib/v2-snapshots-drill.test.ts" "src/__tests__/routes/v2-snapshots.test.ts"`

Result: passed

### Targeted unit tests

Command:

`pnpm exec vitest run "src/__tests__/lib/v2-snapshots-drill.test.ts" "src/__tests__/routes/v2-snapshots.test.ts"`

Result:

- 2 test files passed
- 5 tests passed

### Targeted integration test file

Command:

`pnpm exec vitest run "src/__tests__/lib/v2-snapshots-drill.integration.test.ts"`

Result: skipped because `DATABASE_URL` was unset in this session

## Outcome against task goals

1. **Backup artifacts are more first-class inspectable entities**
   - explicit inventory scope/storage scope/display metadata
   - restore counters and delete-state retention preserve usable inventory history
2. **Restore executions are more auditable**
   - account/source host/trigger/duration metadata is now persisted and queryable
3. **API/UI are more product/ops usable**
   - snapshot list endpoint now returns inventory + restore history + summary
   - machine UI now exposes restore history instead of only minimal snapshot rows

## Files changed

- `drizzle/0010_backup_inventory_hardening.sql`
- `src/server/db/schema.ts`
- `src/server/lib/backup-artifacts.ts`
- `src/server/lib/v2/snapshots.ts`
- `src/server/routes/v2/snapshots.ts`
- `src/hooks/v2/use-machines-v2.ts`
- `src/app/v2/machines/[id]/page.tsx`
- `src/__tests__/lib/v2-snapshots-drill.test.ts`
- `src/__tests__/lib/v2-snapshots-drill.integration.test.ts`
- `src/__tests__/routes/v2-snapshots.test.ts`
