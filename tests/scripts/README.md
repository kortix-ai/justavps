# E2E scripts

This folder is split by product generation.

## Structure

- `tests/scripts/v1/`
  - preserved V1 scripted flows
  - docs: `tests/scripts/v1/README.md`
- `tests/scripts/v2/`
  - active numbered V2 infrastructure flow
  - docs: `tests/scripts/v2/README.md`

## Main commands

### V1

- `pnpm e2e:v1:all`

### V2

- `pnpm e2e:v2:core` — scripted infra flow (01–08)
- `pnpm e2e:v2:ui` — Playwright UI specs (06, 09, 10, 11, 12)
- `pnpm e2e:v2:all` — core + UI
- `pnpm e2e:v2:fresh` — reset v2 state + checkpoints, then run `all`

### V2 dev ops

- `pnpm v2:inventory` — read-only v2 state dump
- `pnpm v2:reset:dry` — preview v2 wipe
- `pnpm v2:reset` — wipe v2 scope (machines, hosts, cells, procurements, checkpoints)
