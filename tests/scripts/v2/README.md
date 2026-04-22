# V2 script flows

This folder contains the active numbered V2 infrastructure flow.

## From-scratch setup

Clear v2 DB state + on-disk test checkpoints, then run the full numbered
suite. Use this whenever previous runs left stale machines/checkpoints behind
(the most common cause of `Timed out waiting for ...` in 03/04).

```bash
pnpm v2:inventory    # read-only — what v2 state exists right now
pnpm v2:reset:dry    # preview what would be deleted
pnpm v2:reset        # actually delete v2 scope + clear checkpoints
pnpm e2e:v2:fresh    # reset then run v2:all (shortcut for the two above)
```

The reset is **v2-scoped only** — v1 machines, users, and accounts are left
untouched. See `scripts/ops/v2-reset.ts`.

## Run order

### 01. Topology foundation

```bash
pnpm e2e:v2:01:topology
```

- file: `tests/scripts/v2/01-region-cluster-host-foundation.ts`
- verifies:
  - cluster creation
  - host registration
  - heartbeat
  - schedulable gating

### 02. Placement and capacity

```bash
pnpm e2e:v2:02:placement
```

- file: `tests/scripts/v2/02-placement-and-capacity.ts`
- verifies:
  - host selection
  - capacity lease reserve/commit
  - rejection on oversubscription

### 03. Container lifecycle

```bash
pnpm e2e:v2:03:container
```

- file: `tests/scripts/v2/03-create-machine-container.ts`
- verifies:
  - create from Docker image
  - HTTP service readiness
  - snapshot create/restore/delete
  - stop/start/reboot
  - checkpoint/resume support

### 04. Baremetal lifecycle

```bash
pnpm e2e:v2:04:baremetal-lifecycle
```

- file: `tests/scripts/v2/04-baremetal-lifecycle.ts`
- verifies:
  - full machine lifecycle
  - ready/heartbeat
  - stop/start/reboot
  - snapshot create/restore/delete
  - image create/delete
  - checkpoint/resume support

### 05. Capacity and procurement

```bash
pnpm e2e:v2:05:procurement
```

- file: `tests/scripts/v2/05-capacity-and-procurement.ts`
- verifies:
  - capacity recommendation
  - procurement creation
  - procurement listing

### 06. Dashboard

```bash
pnpm e2e:v2:06:dashboard
```

- file: `tests/e2e/e2e/14-v2-admin-fleet.spec.ts`
- verifies:
  - admin fleet dashboard visibility for cells, hosts, capacity, recommendations

### 07. Host bootstrap validation

```bash
pnpm e2e:v2:07:host-bootstrap-validation
```

- file: `tests/scripts/v2/07-host-bootstrap-validation.ts`
- verifies:
  - bootstrap validation artifact
  - runnerd/incus/storage metadata
  - smoke test result
  - warm pool result field
  - operator-only Incus UI settings

### 08. External proxy + daemon

```bash
pnpm e2e:v2:08:external-proxy-daemon
```

- file: `tests/scripts/v2/08-external-proxy-daemon.ts`
- verifies:
  - external proxy root
  - external terminal route
  - daemon heartbeat is present in platform state
  - routing + auth-cache repair loops

### 09. Machines UI

```bash
pnpm e2e:v2:09:ui-machines
```

- files:
  - `tests/e2e/e2e/13-v2-flow.spec.ts`
  - `tests/e2e/e2e/15-v2-machines-ui.spec.ts`

### 10. Images UI

```bash
pnpm e2e:v2:10:ui-images
```

- file: `tests/e2e/e2e/16-v2-images-ui.spec.ts`

### 11. Billing UI

```bash
pnpm e2e:v2:11:ui-billing
```

- file: `tests/e2e/e2e/17-v2-billing-ui.spec.ts`

## Aggregate commands

- `pnpm e2e:v2:core` → 01 through 05 + 07 + 08
- `pnpm e2e:v2:ui` → 06 + 09 + 10 + 11
- `pnpm e2e:v2:all` → core + ui

## Harness

Shared helpers live in:

- `tests/scripts/v2/lib/harness.ts`
- `tests/scripts/v2/lib/checkpoints.ts`

Checkpoint files live in:

- `.e2e-checkpoints/`
