## Goal

Make machine provisioning status accurate and self-healing end-to-end so the dashboard never gets stuck on `server_created` when the machine is actually usable.

## Current State

- `src/server/routes/v1/machines.ts:412` emits `server_creating` before the background Hetzner create call.
- `src/server/routes/v1/machines.ts:443` emits `server_created` after Hetzner returns an IP.
- `src/server/lib/cloud-init.ts:39` and `src/server/lib/cloud-init.ts:259` make cloud-init and the daemon call back to `${platformCallbackUrl}/api/v1/internal/stage` and `/heartbeat`.
- `src/server/lib/machine-lifecycle.ts:25` resolves `platformCallbackUrl` from request origin or `PLATFORM_URL`; in local dev this can be `http://localhost:4100`, which is unreachable from a remote VPS.
- `src/server/routes/v1/internal.ts:51` is the only path that promotes a provisioning machine to `ready` during bootstrap, because the first heartbeat flips `status` to `ready`.
- `src/server/lib/machine-lifecycle.ts:351` has no active provider/daemon reconciliation when heartbeats never arrive; it only times out after 20-30 minutes.
- `src/server/routes/v1/sse.ts:64` streams DB-backed machine events correctly, but if no new events are written then SSE has nothing useful to send.

## Root Cause

- Provisioning progress currently depends on inbound callbacks from the VPS.
- When `callback_url` is loopback or otherwise unreachable from the VPS, cloud-init stages and heartbeats never land.
- The dashboard keeps polling/SSE-ing the same stale DB row forever because nothing advances `provisioning_stage` past `server_created` or flips `status` to `ready`.

## Success Criteria

- [ ] Provisioning never stays stuck indefinitely at `server_created` for a healthy machine.
- [ ] A provisioning machine can become `ready` even if VPS callbacks fail.
- [ ] Callback URL selection prefers a public URL and never silently chooses loopback for remote machines.
- [ ] Hetzner create-action progress is persisted and exposed to the frontend while the server is booting.
- [ ] Frontend shows a clean percentage/progress UI instead of only static stage text during early provisioning.
- [ ] SSE stays useful by streaming both stage/status changes and provider-progress changes.
- [ ] Local dev on `localhost` still reflects real machine readiness via backend reconciliation.

## Plan

### Step 1: Make callback URL resolution explicit and safe
- Files: `src/server/lib/config.ts`, `src/server/lib/machine-lifecycle.ts`
- Add a dedicated `MACHINE_CALLBACK_URL` config for remote machine callbacks.
- Resolution order:
  1. explicit `MACHINE_CALLBACK_URL` when set and public
  2. request origin when public
  3. `PLATFORM_URL` when public
- Treat loopback/private callback URLs as unsuitable for remote machines.
- Add a helper that reports whether callbacks are expected to work.
- Acceptance: new machines no longer silently embed `http://localhost:*` as their callback target.

### Step 2: Persist Hetzner creation action progress
- Files: `src/server/lib/providers/types.ts`, `src/server/lib/providers/hetzner.ts`, `src/server/routes/v1/machines.ts`, `src/server/routes/v1/stripe-webhooks.ts`, `src/server/db/schema.ts` usage only
- Extend provider create-server result to include Hetzner `action.id`.
- Persist action metadata in `machines.providerMeta` (`create_action_id`, `create_progress`, `create_status`, `callback_expected`).
- Add a provider method to fetch action progress from Hetzner.
- Acceptance: machine rows can report live provider-side progress before cloud-init callbacks begin.

### Step 3: Add active provisioning reconciliation
- Files: `src/server/lib/machine-lifecycle.ts`, `src/server/lib/event-bus.ts`
- In `syncMachineStatus`, when machine is still provisioning:
  - poll Hetzner action progress and write it into `providerMeta`
  - attempt active readiness probes once the provider action is nearly/fully done
  - probe origin hostname / machine endpoint (`/daemon/health`, toolbox health, or another cheap daemon path)
  - if probe succeeds, promote machine to `ready`, set `readyAt`, synthesize `services_ready` stage if missing, and emit status/stage events
- This becomes the fallback path when callbacks fail entirely.
- Acceptance: a healthy machine transitions to `ready` from polling alone.

### Step 4: Tighten internal stage/heartbeat handling
- Files: `src/server/routes/v1/internal.ts`
- When a heartbeat arrives during provisioning, also force `provisioningStage` to `services_ready` if it is stale.
- When stage callbacks arrive, optionally persist `providerMeta.last_callback_at` for debugging.
- Keep webhook/SSE events authoritative and DB-backed.
- Acceptance: callbacks remain the fast path, but no longer the only path.

### Step 5: Expose progress to the frontend
- Files: `src/lib/types.ts`, `src/server/routes/v1/machines.ts`, `src/lib/schemas.ts`
- Add serialized fields for provider progress and callback health, e.g. `provider_progress`, `provider_status`, `callback_expected`, `last_callback_at`.
- Acceptance: frontend can render progress without guessing from `providerMeta` internals.

### Step 6: Simplify the provisioning UI
- Files: `src/app/(dashboard)/machines/[id]/page.tsx`
- Replace the ambiguous “Machine is not ready” state with explicit progress sections:
  - provider boot progress percentage when still in Hetzner action phase
  - daemon/configuration stage progress when callbacks or fallback probes advance
  - actionable degraded message when callbacks are unavailable but fallback reconciliation is in use
- Ensure full IPv6 values wrap correctly everywhere they appear.
- Acceptance: the machine page clearly tells the user whether the box is still booting, configuring, or already reachable.

### Step 7: Verify end-to-end
- Files: targeted tests plus manual E2E
- Add/adjust tests for:
  - callback URL resolution
  - Hetzner action progress parsing
  - sync fallback promoting stuck provisioning machines to `ready`
  - serialization of provider progress fields
- Manual E2E:
  - create a machine
  - watch dashboard on `localhost`
  - confirm stage/progress advances automatically
  - confirm machine becomes `ready` even if callback URL is unreachable

## Anti-Patterns

- Do not rely on in-memory emitters for provisioning UI state; DB-backed events remain the source of truth.
- Do not keep waiting 20+ minutes for a missing heartbeat before showing the user anything useful.
- Do not make the frontend infer progress from status strings alone when backend already knows provider/action state.
- Do not assume callback URLs are reachable just because they are configured.

## Risks

- Polling Hetzner too aggressively could create noisy API traffic; keep reconciliation on the existing read/poll cadence.
- Readiness probes must not mark a machine `ready` before the daemon is actually serving the expected endpoints.
- Local dev and prod must share the same semantics even if their callback reachability differs.

## Verification

- `pnpm exec eslint` on changed frontend/server files
- targeted `vitest` coverage for provisioning logic
- manual API verification against a real provisioning machine
- browser check on `http://localhost:4100/machines/{id}` that progress updates and eventually flips to `ready`
