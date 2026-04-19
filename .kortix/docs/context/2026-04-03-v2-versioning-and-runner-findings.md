# Context Snapshot — 2026-04-03 — V2 Versioning + Runner Findings

## Current state

- V1 key customer-facing files were restored from `main` for the most important prod-facing surfaces.
- Explicit `/v2/*` page namespace exists and renders in the dashboard shell.
- A sidebar version switcher exists and flips between V1 and V2 route spaces.
- V2 hooks/components/pages are partially namespaced under `src/hooks/v2`, `src/components/v2`, and `src/app/v2`.
- V2 API surface exists for:
  - `/api/v2/catalog/*`
  - `/api/v2/machines/*`
  - `/api/v2/images/*`
  - `/api/v2/snapshots/*`
  - `/api/v2/billing/*`
  - `/api/v2/admin/fleet/*`
- SDK now has a `JustAVPSV2` export.

## Verified working today

- `pnpm vitest run` passes
- `pnpm exec tsc --noEmit` passes
- `pnpm eslint .` passes with warnings only (no errors)
- Browser-tested V1/V2 switcher shows route separation
- Real Hetzner dedicated host exists and is bootstrapped
- Runnerd lifecycle on already-created instances has been proven before

## Primary blocker still open

The fresh bare-metal VM create path is **not yet repeatably stable**.

### Observed behavior
- `runnerd` logs `create <name> from images:ubuntu/noble/cloud`
- then hangs before `init complete`
- state files under `/run/justavps-runnerd/*.init.{out,err,exit}` are created but remain empty in hanging cases
- this means the detached `incus init ... --vm` process is hanging before observable stderr/output is flushed

### Additional finding
- stale paused QEMU processes can wedge Incus responsiveness
- killing the stuck QEMU process restored `incus list` responsiveness
- host recoverability is good, but create repeatability is not yet solved

## Host state

- host id: `ed822eae-59ef-4601-8782-a17cc85196ab`
- IPv4: `135.181.129.188`
- Incus currently back on a stable dir-backed layout after ZFS experiments destabilized the daemon
- ZFS-first production layout remains unresolved and should be treated as a separate hardening stream

## Recommendation for execution

Before broader UI/SDK cleanup finishes, stabilize `runnerd` fresh create using a more deterministic mechanism than the current detached shell around `incus init --vm`.

Likely candidates:
- direct Incus REST API / Unix socket client instead of CLI wrapping
- long-lived serialized worker process on-host
- alternative image import/launch strategy using pre-cached aliases or local image copies

Only after that should the V2 branch be called production-ready.
