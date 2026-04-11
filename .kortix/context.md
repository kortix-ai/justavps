# justavps.com

1-click VPS provisioner with templates for AI agents (OpenCode, Claude Code, Kortix). Fancy UI over Hetzner/OVH/Contabo. SSH-first, always-on compute.

Created: 2026-03-15T22:58:20.398Z

- 2026-04-07: VM fast path now uses exact-CPU warm reserve (~<5s) with exact-CPU stateful reserve (~10s) as default fallback before full cold boot (~27s). Cold boot is still dominated by Incus/QEMU q35+OVMF firmware overhead; direct kernel boot and microvm machine type are blocked by Incus.

- 2026-04-07: Removed stateful fallback from the live VM runtime path. Current VM model is exact-CPU warm reserve + full cold boot fallback only. Warm reserve measured ~4.6s live after rollback; cold boot remains ~27s.

- 2026-04-07: Added internal GTM doc at `docs/plan-icp-persona.md`. Primary ICP is technical users/small teams running long-lived AI agent workflows who need persistent Linux machines, care about 24/7 economics, and want better DX/security than a raw VPS. Primary persona is the “agent infrastructure operator.”

- 2026-04-07: Custom user images can use the same reserve model as the platform golden image, but reserves should be keyed by (image_id, cpu_bucket) and exposed as explicit billable product options rather than hidden infra.

- 2026-04-10: V2 E2E required local benchmark Postgres plus a live public callback tunnel. Browser E2E fixtures had drifted from the current V2 API (`resources` instead of `plan`, updated provisioning copy), and the runtime script now treats `warm_pool.target=0` as cold-fallback mode instead of a hard failure.

- 2026-04-10: V2 proxy routing was fixed by writing the baremetal runner `http_port` into Cloudflare KV and having the Worker/Broker dial the machine via that origin port. The dev Worker also needed a live broker origin during verification; direct broker availability can still break runtime proxy E2E even when machine provisioning succeeds.

- 2026-04-10: A second real Hetzner host was ordered and registered: `a1e0cdbc-72d9-46dd-9a03-983d15d50326` / `bm-general-small-HEL1-a1e0cdbc` / `65.109.65.169`. Full pinned V2 E2E passed on that host using the `justavps standard` template row (`4baec0c1-aaec-4093-aa71-bd0dcc1b5d8a`) after forcing the non-golden path through full cloud-init.

- 2026-04-10: V2 needed a real fallback for non-golden images. Fixes made: V2 now uses full cloud-init (not minimal V2 cloud-init) whenever the resolved image is not `justavps-golden`; full cloud-init now explicitly installs/enables `openssh-server`; runnerd’s non-golden create path now sets up SSH/HTTP proxy devices and returns `httpPort` so proxy + SSH work end to end on raw/template images.

- 2026-04-10: Host 2 golden/warm-pool path is now healthy too. Root causes were: (1) the image builder’s GRUB tweaks caused published `justavps-golden` clones to drop to a raw `grub>` prompt; (2) the builder’s in-VM daemon download produced a zero-byte `/usr/local/bin/justavps-daemon` in the published image. Fixes: removed aggressive GRUB tuning from `scripts/build-golden-image.sh`, added support to inject a known-good host daemon binary (`HOST_DAEMON_BIN`) into the build VM, rebuilt the image on host 2, then verified pinned runtime E2E on the default golden path, pinned baremetal E2E, and the pinned cold benchmark. Host 2 was left with `WARM_POOL_PER_CPU=1`, `POOL_CPU_BUCKETS=1`, and health showing warm pool ready `1/1`.

- 2026-04-10: Local dashboard auth could fail after login with `Account access denied` if the browser still had a stale `__justavps_account` cookie from an older account/session. `api-guard` now auto-heals stale account cookies for session auth (still rejects explicit unauthorized `X-Account-Id` headers), and both V1/V2 machines pages no longer render the misleading `No machines match ""` state when an API error is already present.

- 2026-04-10: Capacity economics analysis saved at `.kortix/research/economics-and-scaling.md`. Current live HEL1 bare-metal fleet snapshot was 2 active `general-small` hosts, each around `12 vCPU / 62 GB RAM / 435-460 GB disk`; the analysis concludes this host class is fine for MVP validation but too shallow to reach 100k machines economically without denser host classes, explicit reserve policy, and sharded fleet control.

- 2026-04-10: Production-readiness audit found the current bare-metal v2 stack is real but still MVP-shaped: provisioning runs in-process via `after(...)` instead of a durable job queue; host capacity is selected from DB snapshots and corrected later by reconcile rather than transactionally reserved; `runnerd` per-host NAT ports are hashed into only 1000 SSH + 1000 HTTP slots; and the watchdog still contains Hetzner-cloud assumptions that do not fully match the new host-local Incus operating model.

- 2026-04-10: Phase 1 Batch A added a reusable `control_plane_jobs` runtime for durable async work and moved webhook delivery onto persisted jobs + `webhook_deliveries` state. The runtime now owns queue/lease/retry truth for webhook jobs, hot-path indexes were added in `src/server/db/schema.ts`, and watchdog drains due webhook jobs so retries/dead-letter state survive restarts without `webhook-delivery.ts` using `setTimeout` as the source of truth.

- 2026-04-10: Phase 1 Batch B moved V2 machine create onto durable `machine_create` control-plane jobs and added `host_capacity_reservations` as the create-time capacity lease model. The API path now creates the machine row + reservation + job transactionally, the job commits the reservation after runner create succeeds or releases it on terminal failure, reconcile expires stale reserved leases and releases reservations for deleted/error machines, and the control-plane worker now unions registered job types instead of being pinned to the first one started.

- 2026-04-10: Admin machines had a versioning gap: `/v2/admin/machines` was missing even though the canonical page existed at `src/app/(dashboard)/admin/machines/page.tsx`. Fix was a thin alias page at `src/app/v2/admin/machines/page.tsx` plus defensive helpers in `src/lib/admin-machines.ts` so pagination/health UI cannot leak malformed `NaN` state when admin payload numbers are partial or invalid.

- 2026-04-11: V2 admin fleet/bare-metal APIs were moved out of the V1 route tree into `src/server/routes/v2/admin-fleet.ts`, and the old dashboard fleet page now re-exports the V2 page instead of drifting separately. V1/V2 admin route separation is now explicit.

- 2026-04-11: Cells now have explicit operator admission controls and reserve policy mutation routes in V2 admin fleet (`/api/v2/admin/fleet/cells/:id/admission-state` and `/api/v2/admin/fleet/cells/:id/reserve-policy`), and the V2 Fleet UI exposes actions to open sales / reserve-only / close sales per cell.

- 2026-04-11: Host-class/procurement evolution groundwork added `src/server/lib/baremetal/host-class-profiles.ts`, procurement `generation`, `target_cell_id`, and `procurement_purpose`, plus reserve-aware procurement recommendations by cell. `general-small` is now explicitly treated as starter/edge/bootstrap while `general-medium` is the preferred mainstream growth class in code.

- 2026-04-11: Routing/access-plane authority groundwork added explicit `machine_port_allocations` so the control plane can own public SSH/HTTP port assignment per host instead of relying only on runnerd’s 1000-port hash windows. `runnerd` now accepts explicit `sshPort` / `httpPort` from the control plane, while legacy callers can still fall back to hashed ports until the full migration is finished.

- 2026-04-11: The explicit port-allocation authority is now used on read/repair paths too, not just create-time allocation. V2 machine serialization prefers `machine_port_allocations` for SSH port truth, and routing repair prefers the explicit HTTP allocation over stale provider metadata when rebuilding routing state.

- 2026-04-11: Fleet auditor groundwork added explicit reconciliation reporting to V2 admin fleet hosts plus `POST /api/v2/admin/fleet/hosts/:id/cleanup-orphans`, which deletes non-warm orphan Incus instances on a host and then re-reconciles it. The V2 Fleet UI now exposes orphan counts and a cleanup action. Warm-pool instances are intentionally skipped.

- 2026-04-11: Local runtime verification exposed three real operational bugs and they were fixed: (1) `baremetal_host_images` reconcile tried to write runner-local image hashes into the `image_id` UUID column; now those hashes stay in `metadata.provider_image_id` unless they are real UUIDs. (2) Deleted bare-metal machines were leaking committed `host_capacity_reservations`; cleanup now releases reservations immediately instead of waiting for reconcile. (3) explicit port allocation must consider legacy `providerMeta.ssh_port/http_port` and live reachable ports on a host during the transition, not just rows in `machine_port_allocations`, otherwise new machines can reuse a still-live public port.

- 2026-04-11: `src/server/db/index.ts` now uses a process-global postgres.js/drizzle singleton with explicit pool sizing (`DB_MAX_CONNECTIONS`, `DB_IDLE_TIMEOUT_SECONDS`, `DB_MAX_LIFETIME_SECONDS`). This was needed because local `next dev` hot-reload/module churn was exhausting the benchmark Postgres connection limit during repeated real E2E runs.

- 2026-04-11: Added a dedicated control-plane runtime/worker shape. `src/server/lib/control-plane/runtime.ts` now starts periodic provisioner / routing repair / watchdog / fleet auditor loops with a process-global startup guard, `src/server/app.ts` starts it by default, and `scripts/control-plane-worker.ts` plus `pnpm control-plane:worker` allow running those loops in a separate worker process. `CONTROL_PLANE_RUNTIME_DISABLED=true` can now be used on web-only replicas.

- 2026-04-11: V2 admin fleet now exposes `GET /api/v2/admin/fleet/control-plane/services` so operators can inspect control-plane lease/checkpoint state, and the V2 Fleet UI now shows control-plane service status cards (provisioner, routing repair, watchdog, fleet auditor).

- 2026-04-11: Telemetry retention is now an explicit background control-plane responsibility: `runTelemetryRetentionServicePass()` prunes expired `machine_telemetry_rollups`, the control-plane runtime runs it on an interval, and the `telemetry:retention` service lease/checkpoint now appears in the V2 fleet control-plane services view.

- 2026-04-11: Webhook deliveries and terminal control-plane jobs now have explicit retention pruning via the `webhook_dispatcher` service pass, and deleted-machine `machine_port_allocations` are pruned by the fleet auditor pass. This closed a real leak: live verification showed 6 explicit port allocations still attached to deleted machines until fleet auditor pruning was added.

- 2026-04-11: API key deletion now removes the Worker-auth KV record for that key (`apikey:<sha256>`). Previously delete only removed the DB row and logged a message, leaving the Cloudflare KV entry orphaned. This is now verified live: create key → KV 200, delete key → KV 404.

- 2026-04-11: Added `auth_cache:api_keys` as a first-class control-plane service that re-syncs stored API key SHA-256 records into Cloudflare KV. This closes the Worker-auth drift gap where KV loss could break valid API keys even if the DB remained correct. After a runtime restart the service now records successful completions in `/api/health`, `/api/readyz`, and `/api/v2/admin/fleet/control-plane/services`.

- 2026-04-11: Control-plane service state is now more operator-friendly: service profiles (`critical`, `mode`, `description`) are exposed via `GET /api/v2/admin/fleet/control-plane/services`, `/api/readyz` ignores event-driven services like `allocator` but treats critical periodic services as readiness-gating, and a leased service only stays "fresh" while its lease is still current and recently started.

- 2026-04-11: `POST /api/v2/admin/fleet/control-plane/run` now supports selective execution via `{ services: [...] }`, so operators can force just one class of work (for example only `auth_cache`) instead of always running the full maintenance pass.

- 2026-04-11: Added `POST /api/v2/admin/fleet/control-plane/reset-lease` so operators can clear a wedged control-plane service lease (for example `auth_cache:api_keys`) without direct DB access. This is now covered by route tests and works live.

- 2026-04-11: The deprecated direct platform proxy path under `/api/v1/machines/:machineId/proxy/:port/*` is now feature-flagged with `LEGACY_PLATFORM_PROXY_ENABLED`, and the default is now **off**. The Worker path is the default production path; only flip the legacy flag on as a temporary rollback if an older caller still depends on the direct platform proxy.

- 2026-04-11: `/api/health` now reports database status plus a control-plane service summary, and `/api/readyz` returns `503` when the DB is unavailable or critical control-plane services are stale. These routes are now covered by tests and are intended for real deployment monitoring, not just local smoke checks.

- 2026-04-11: `machines` now has an explicit `baremetal_host_id` column (with index) in addition to the legacy providerMeta field. Create-time placement now writes it directly, reconcile backfills it for live machines, and host-affinity lookups in fleet/snapshot/provider code now prefer the explicit column before falling back to providerMeta. This is the first step away from JSON-only host affinity lookups.

- 2026-04-11: The old `GET /api/v1/internal/watchdog` control-plane trigger no longer exists. Control-plane maintenance now lives under `POST /api/v2/admin/fleet/control-plane/run`, while true machine callbacks stay in `v1/internal` (`/heartbeat`, `/stage`, etc.). This keeps V1/V2 boundaries cleaner: V1 internal = machine agent contract, V2 admin fleet = operator control-plane surface.

- 2026-04-11: Added `cell_capacity_snapshots` plus `recordCellCapacitySnapshots()` and wired it into the fleet auditor loop. `GET /api/v2/admin/fleet/cell-capacity-snapshots` now returns recent cell history, and the V2 Fleet UI shows recent snapshot rows so reserve/sellable trends are visible instead of only current point-in-time state.

- 2026-04-11: Vitest config now loads `.env` / `.env.local` directly and promotes `TEST_DATABASE_URL` into `DATABASE_URL` for test runs when needed, so DB-backed integration suites no longer require manual command-line env injection just to participate in normal regression runs.

- 2026-04-11: Webhook delivery is now modeled as its own control-plane service (`webhook_dispatcher:webhook_deliver`) instead of only generic job-worker kicks, and allocator now records explicit checkpoint/metadata into `control_plane_service_states` so rejected/successful placement attempts are visible in admin fleet service-state inspection.

- 2026-04-11: The control-plane operator trigger moved fully out of `v1/internal`; `GET /api/v1/internal/watchdog` is gone and the operator surface is now `POST /api/v2/admin/fleet/control-plane/run`. `GET /api/v2/admin/fleet/control-plane/services` and `GET /api/v2/admin/fleet/cell-capacity-snapshots` are live and verified.

- 2026-04-11: Warm-pool claims no longer attempt to rename reserve VMs. Reserve VMs are now marked with `user.justavps.role=warm_pool_reserve`, claimed VMs flip that role to `machine`, and reconcile/orphan classification now separates warm reserves from true orphan instances using explicit role-aware reporting. This avoided rename-related create stalls and restored real host-1/host-2 warm-path runtime E2E.

- 2026-04-11: Cell capacity history is now persisted in `cell_capacity_snapshots` on each fleet auditor pass (5-minute windowed snapshots with 30-day retention pruning). Operators can inspect the history via `GET /api/v2/admin/fleet/cell-capacity-snapshots`, and the V2 Fleet UI now shows recent snapshot rows.

- 2026-04-11: Capacity-blocked create requests now return `409` with structured `details.placement_decision` explaining why no host was schedulable (for example reserve-budget pressure). This was verified live by temporarily setting an oversized cell reserve policy and observing the conflict response.

- 2026-04-11: The legacy full infrastructure E2E (`src/__tests__/e2e/machine-lifecycle.test.ts`) was brought back in line with the current platform contract and now passes end-to-end against the live stack. Fixes included: V1 create falling back off stale default template images, legacy E2E loading `.env/.env.local`, proxy-domain expectations updated to use `PROXY_DOMAIN`, `proxy-auth` verified via redirect token flow instead of impossible cross-domain cookie assumptions, and the suite now uses the real session-backed API key path for Worker auth.

- 2026-04-11: `pnpm exec tsc --noEmit -p tsconfig.json` is clean again after a compile-debt pass across the new control-plane/cell/fleet code. The worst remaining drift had been around DB `execute()` result typing, cell identity vs full cell state, nullable fleet UI IDs, and test harness mock shapes.

- 2026-04-11: `/api/health` is now richer (database status + control-plane service summary), and `/api/readyz` is now a true readiness endpoint: it returns `503` if the DB is unavailable or critical control-plane services are stale beyond the readiness freshness window. Both are now covered by route tests.

- 2026-04-11: Smaller API surfaces are being brought back under real compile-time checking instead of blanket suppression. `v2/catalog`, `v2/images`, `v2/billing`, `v2/snapshots`, `v2/machine-status-stream`, and `v1/server-types` now compile without `@ts-nocheck` while preserving the mixed success/error Hono handler behavior via narrow local casts.

- 2026-04-11: `v2/machines` and `v2/admin-fleet` are now also compile-clean without blanket `@ts-nocheck`. The remaining pattern on these route files is narrow local handler casting for mixed success/error Hono responses, but the files themselves now participate in full `tsc --noEmit` again.

- 2026-04-11: There are now no remaining `@ts-nocheck` or route-level `@ts-expect-error` markers under `src/server/routes/`. Route surfaces that still need mixed success/error typing use explicit local handler casts instead of blanket suppression, and the full app compile still passes.

- 2026-04-11: Real pinned runtime E2E now passes again on both HEL1 hosts after the latest control-plane/runnerd changes:
  - host 2 (`65.109.65.169`) passed warm-path runtime E2E with slug `nwrer7qx`
  - host 1 (`135.181.129.188`) passed warm-path runtime E2E with slug `pvx7uexx`

- 2026-04-11: After the warm-pool role conversion and control-plane route cleanup, real pinned runtime E2E passed again on both hosts with fresh slugs:
  - host 2 (`65.109.65.169`) passed with slug `0jef3muf`
  - host 1 (`135.181.129.188`) passed with slug `r4e5cm2o`

- 2026-04-10: Phase 1 Batch C added a production-readiness backup/restore baseline and host drain workflows. `backup_artifacts` now records snapshot-derived DR artifacts, `restore_executions` records restore drill history, V2 snapshot create/restore paths persist those records, and bare-metal placement now rejects hosts unless they are runner-registered, `status=active`, and `maintenance_state=in_service`. Admin fleet APIs/UI now expose maintenance state plus drain blockers and allow operators to request drain / mark maintenance / return hosts to service.

- 2026-04-10: Admin/Phase 1 durability verification added real DB-backed integration coverage for webhook jobs, machine-create reservations, reservation expiry/reconcile cleanup, backup restore drills, and maintenance-state placement enforcement. Verification exposed two postgres.js/raw-SQL bugs: durable job claiming and reservation expiry failed when raw `Date` objects were interpolated into SQL; both were fixed by binding ISO timestamp strings with explicit `::timestamp` casts. Local verification also required `pnpm run db:push` first because the benchmark Postgres schema was behind the repo migrations.

- 2026-04-10: Phase 2 Batch A introduced a scheduler-v2 foundation in `src/server/lib/baremetal/scheduler.ts` and moved V2 create placement auditing onto a structured decision object. Placement scoring now exposes per-host explanations plus hooks for warm-pool awareness, image locality, host-class policy, and scheduler metadata, while `leaseHostCapacity()` remains the transactional correctness boundary so Phase 1 reservation durability is preserved.

- 2026-04-10: Phase 2 Batch B split heartbeat hot-path state into `machine_heartbeat_states` plus `src/server/lib/heartbeat-state.ts`, so heartbeat ingestion now upserts explicit rollup state and only projects back onto `machines` on readiness or coarse compatibility intervals. `runWatchdog()` now prefers the rollup state, admin host listing no longer reconciles on read, bare-metal provider placement no longer forces fleet-wide reconcile, and `reconcileBaremetalFleet()` now supports targeted/due-host operation (`hostIds`, `onlyDueHosts`, `maxHosts`, skip-global-audit flags).

- 2026-04-10: Phase 2 Batch C added explicit `baremetal_host_images` locality inventory plus `machine_routing_states` as durable routing truth. Placement now overlays requested image locality from DB-backed host image availability before scoring/leasing, placement marks selected images as `warming` vs `local`, reconcile refreshes host image inventory from runner state, heartbeat/provisioning/cleanup paths upsert and apply explicit routing state instead of only best-effort KV writes, and watchdog now repairs pending/error routing rows in batches.

- 2026-04-11: Phase 2 Batch D hardened backup productization and restore auditability. `backup_artifacts` now carries account/user/scope/storage/display/restore counters, `restore_executions` now carries account/source-host/trigger/duration metadata, snapshot delete marks artifacts deleted instead of dropping inventory truth, `GET /v2/snapshots/:machineId` now returns merged live+DB snapshot inventory plus restore history/summary, and the V2 machine snapshots tab surfaces inventory and restore execution history as a first-class operator/customer view.

- 2026-04-11: Phase 3 Batch A introduced the first explicit cell model. `cells` now exists in schema/code, `baremetal_hosts` now carries `generation` + `cell_id`, reconcile can assign hosts into cells, scheduler decisions now compute cell-level capacity snapshots plus `requiredCellId` / `preferredCellIds` hooks, and admin fleet visibility now exposes both per-host cell membership and aggregated cell capacity snapshots.

- 2026-04-11: Phase 3 Batch B added explicit internal control-plane service boundaries under `src/server/lib/control-plane/` for allocator/provisioner/telemetry/routing concerns, plus a generic `control_plane_service_states` schema primitive for service leases/checkpoints. V2 machine create, heartbeat ingestion, routing repair, and watchdog passes now go through service-specific wrappers so later service extraction can happen without first untangling those API/runtime responsibilities again.

- 2026-04-11: Phase 3 Batch C separated telemetry retention groundwork from OLTP lifecycle state. `machine_heartbeat_states` remains the hot summary/read model, new `machine_telemetry_rollups` stores retained bucketed heartbeat/anomaly history with explicit retention classes (`heartbeat_minute_7d`, `alert_30d`), and `event-bus.ts` now keeps SSE/lifecycle writes on `machine_events` while transient heartbeat/watchdog/security/network events roll into telemetry storage instead.

- 2026-04-11: Phase 3 Batch D added first-class cell reserve/admission-control groundwork. `cells.reserve_policy` plus `cell_admission_controls` now model cell-level reserve budgets and sellability/admission state, scheduler placement enforces closed/restricted/reserve-only cells and rejects placements that would breach cell reserve budgets, and admin fleet APIs/UI now surface reserve budgets plus sellable capacity per cell/host.
