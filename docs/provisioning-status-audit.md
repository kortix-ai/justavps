# Provisioning Status System — Audit & Fix Plan

## The User Experience Problem

1. **Progress sits at 0% for the first 10-20s**, then jumps to 25%, then **straight to 100%**
2. After hitting 100%, the user sees **"Connecting..."** for a long time
3. Overall: feels broken, progress bar provides zero useful feedback

---

## Root Cause Analysis

### Why progress jumps 0 → 25 → 100

The `computer` frontend (`use-sandbox-poller.ts`) maps provisioning stages to progress %:

```
server_creating:    10%
server_created:     25%
cloud_init_running: 40%
cloud_init_done:    55%
docker_pulling:     65%    ← DEAD (removed)
docker_running:     80%    ← DEAD (removed)
services_starting:  90%
services_ready:     100%
```

**What actually happens in practice:**

1. Machine is created → `server_creating` (10%) — but by the time the first SSE event arrives, the server is already created
2. Provider reports `server_created` (25%) — this is the first stage the user actually sees
3. Cloud-init runs, but the stages `cloud_init_running` and `cloud_init_done` are only reported **if the cloud-init callback reaches the platform** — this is often missed or delayed
4. The daemon heartbeat arrives → machine goes straight to `ready` → 100%
5. Stages `docker_pulling`, `docker_running` are dead code (Docker was removed)
6. `services_starting` is never emitted by cloud-init — cloud-init only reports `cloud_init_running`, `cloud_init_done`, then the daemon heartbeat marks ready

**Result:** User sees 0% → 25% → (maybe 40-55% if cloud-init callbacks work) → 100%. Most of the time it's 0 → 25 → 100.

### Why "Connecting..." takes forever

After JustAVPS marks the machine as `ready`, the `computer` frontend enters the **"connecting" phase** (`instances/[id]/page.tsx:122`). This phase:

1. Calls `switchToInstanceAsync()` to register the server
2. Then polls `GET {opencode-url}/global/health` every 3 seconds for up to **2 minutes**
3. It's waiting for OpenCode/services on port 8000 to respond

**The problem:** JustAVPS marks the machine `ready` when the **daemon heartbeat** arrives (`:80` health), but OpenCode (`:3456`) and other services may not be booted yet. So there's a gap between "machine ready" and "services actually reachable through the proxy."

### The SSE endpoint on JustAVPS

`/api/v1/machines/{id}/status/stream` works but has issues:
- Polls the DB every 2 seconds — fine
- Sends `status` and `stage` events — fine
- BUT: the stages it reports depend entirely on what cloud-init callbacks and daemon heartbeats arrive. If cloud-init callbacks are slow/missing, there's nothing to stream.
- The `provider_progress` (Hetzner action progress 0-100%) IS available but only used on the JustAVPS dashboard, NOT forwarded to the computer frontend's SSE poller.

### Webhooks

JustAVPS has a webhook system (`POST /api/v1/webhooks`) that allows registering URLs for events like `machine.stage_changed`, `machine.status_changed`, `machine.heartbeat`. The `computer` backend already uses this — `sandbox-provision-poller.ts` polls JustAVPS every 8s AND the webhook fires events to SSE consumers.

**Webhooks are NOT redundant** — they're the mechanism that pushes real-time events to the computer backend, which then forwards them via its own SSE to the frontend. Without webhooks, the computer backend would only discover status changes via its 8s poll interval.

---

## Fix Plan

### 1. Clean up dead stages in `computer` frontend

**Files:** `computer/apps/frontend/src/lib/provisioning-stages.ts`, `computer/apps/frontend/src/hooks/platform/use-sandbox-poller.ts`

Remove `docker_pulling` and `docker_running` from both `STAGE_PROGRESS` maps and `STAGE_LABELS`. The actual stage sequence is now:

```
server_creating → server_created → cloud_init_running → cloud_init_done → services_ready
```

### 2. Smooth out progress with time-based interpolation

Instead of jumping between discrete stage percentages, interpolate progress based on **elapsed time** between stages. The server-selector sidebar already does this (`server-selector.tsx:694`). The `ProvisioningProgress` component should do the same.

**Approach:** When a stage is active, gradually animate progress toward the next stage's target % over expected duration. This gives the user smooth visual feedback even when real events are sparse.

### 3. Forward `provider_progress` through the computer SSE

JustAVPS already tracks `create_progress` (0-100% from Hetzner API). This should be forwarded through the computer backend's provision poller/SSE so the frontend can use it for the first 25% of progress (server creation phase).

### 4. Merge "Connecting..." into the progress bar

Instead of a separate "Connecting..." phase with just a spinner, extend the provisioning progress to include the service-readiness check. Show 90-100% during the "waiting for services" phase, with a message like "Starting services..." — so the user sees one continuous progress experience, not two separate screens.

### 5. Re-map progress percentages to match reality

New stage → progress mapping based on actual timing:

```
server_creating:    5%   (instant — API call placed)
server_created:     15%  (10-20s — Hetzner creates VM)
cloud_init_running: 35%  (20-40s — cloud-init starts)
cloud_init_done:    65%  (40-90s — cloud-init finishes)
services_starting:  80%  (60-120s — daemon boots, services starting)  
services_ready:     95%  (90-180s — daemon heartbeat received)
connecting:         98%  (machine ready, waiting for proxy/services)
ready:              100% (services reachable)
```

---

## Priority

1. **Clean dead stages** — trivial, do it now
2. **Time-based interpolation** — biggest UX impact, moderate effort
3. **Merge connecting phase** — medium effort, high UX impact
4. **Forward provider_progress** — requires computer backend change
5. **Re-map percentages** — easy, pair with interpolation
