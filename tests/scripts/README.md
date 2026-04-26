# E2E scripts

This folder is split by product generation.

## Structure

- `tests/scripts/v1/`
  - preserved V1 scripted flows
  - docs: `tests/scripts/v1/README.md`
- `tests/scripts/v2-api/`
  - standalone clean V2 API flow

## Main commands

### V1

- `pnpm e2e:v1:all`

### V2 API

- `pnpm e2e:v2api:core` — standalone API smoke, inventory/sync, machine lifecycle, snapshots/images/backups
