# JustAVPS production-readiness execution roadmap

Date: 2026-04-10

## Purpose

This roadmap converts the existing JustAVPS research into a concrete execution plan tied to the current repo and live architecture.

It is based on the current realities documented in:

- `.kortix/research/justavps-production-readiness-and-incus-scale-strategy.md`
- `.kortix/research/production-readiness-current-state.md`
- `.kortix/research/incus-feature-map.md`
- `.kortix/research/economics-and-scaling.md`
- `docs/spec-incus-v2-provider.md`
- `src/server/db/schema.ts`
- `src/server/lib/v2/machines.ts`
- `src/server/lib/baremetal/scheduler.ts`
- `src/server/lib/baremetal/reconcile.ts`
- `src/server/lib/webhook-delivery.ts`
- `src/server/routes/v1/internal.ts`
- `src/server/routes/v1/sse.ts`
- `runnerd/src/index.ts`

This is a planning document only. No code changes are proposed here.

---

## Repo reality summary the roadmap is built around

These are the specific implementation facts that matter most.

### Control plane

- V2 create currently happens in `src/server/lib/v2/machines.ts`.
- The request returns `202`, creates DB state, then continues provisioning via `after(...)` in the app process.
- This means deploy/restart can interrupt work mid-flight.

### Scheduling / capacity

- V2 placement still does a DB read of hosts and chooses an eligible host in memory.
- `baremetal_hosts.used_vcpu/used_memory_gb/used_disk_gb` are refreshed later by reconcile, not transactionally reserved at placement time.
- `src/server/lib/baremetal/scheduler.ts` and `src/server/lib/v2/machines.ts` are still small-fleet schedulers.

### Reconciliation

- `src/server/lib/baremetal/reconcile.ts` loads all hosts, all machines, and all images.
- `src/server/routes/v1/admin-baremetal.ts` currently triggers reconcile before listing hosts.
- Reconcile is acting as both auditor and compensating control.

### Events / status / routing

- Heartbeats write directly into the transactional path via `src/server/routes/v1/internal.ts`.
- SSE in `src/server/routes/v1/sse.ts` polls DB every 2s.
- Webhook retries in `src/server/lib/webhook-delivery.ts` are in-process timer based.
- Cloudflare KV + Worker + broker are real, but routing correctness is still dependent on best-effort updates.

### Data plane / runner

- `runnerd/src/index.ts` is the per-host control boundary and should stay that way.
- Warm pools are in-memory maps.
- `sshPortForInstance()` and `httpPortForInstance()` hash into a 1000-port range per host.
- This is acceptable for early hosts, not for dense long-term production cells.

### Schema

Current core tables exist for:

- `machines`
- `images`
- `baremetal_hosts`
- `baremetal_procurements`
- `machine_events`
- `webhooks`
- `webhook_deliveries`

Current core tables do **not** exist for:

- durable jobs
- placement reservations / leases
- machine lifecycle operations
- backup artifacts / restore history
- host maintenance windows
- per-host sync checkpoints
- image replication state
- cells

### Economics / host classes

- The current live production shape is still two small `general-small` hosts at roughly 12 vCPU each.
- This class is good for proving the model and the warm-path UX.
- It is not the long-run unit for a 100k-machine business.

---

## Non-negotiable architecture principles

1. **Keep JustAVPS control plane + runnerd + Incus as the base shape.** Evolve it; do not replace it.
2. **Make correctness explicit before scaling.** Durable jobs, reservations, and backups come before clustering or migration work.
3. **Reconcile must become an auditor.** It should no longer be the normal mechanism that makes placement safe.
4. **Keep host-local storage/failure domains through all three phases.** Do not introduce distributed storage as the default substrate.
5. **Scale by cells, not by a single mega-fleet abstraction.**

---

## Global rollout and dependency order

This is the recommended master order across all phases.

1. Add missing hot-path DB indexes
2. Add durable job tables and worker runtime
3. Move webhook delivery onto durable jobs
4. Add host capacity reservations / leases
5. Move machine create/delete onto durable jobs + reservations
6. Add backup artifacts + restore tracking
7. Add host maintenance / drain state and enforce it in placement
8. Replace reconcile-on-read behavior
9. Introduce scheduler v2 in shadow mode
10. Introduce heartbeat ingestion / rollups in shadow mode
11. Add image locality + replication metadata
12. Cut new creates to scheduler v2
13. Introduce cell model
14. Split control-plane services by workload
15. Move high-volume telemetry/event retention off primary OLTP
16. Standardize denser production host classes and cell reserve control

If sequence must be shortened, do **not** skip steps 2-7.

---

## Phase 1 — must do before calling the platform truly production-ready

### Phase 1 objective

Make the current architecture durable, recoverable, and concurrency-safe for the first real production fleet.

### Phase 1 success definition

JustAVPS can survive app restarts during provisioning, concurrent create bursts do not oversubscribe hosts, webhook delivery is durable, backups/restores are real, and maintenance/draining is operationally enforceable.

### Phase 1 exact workstreams

| ID | Workstream | Why it exists | Current repo reality | Concrete deliverable |
| --- | --- | --- | --- | --- |
| P1-1 | Durable machine lifecycle jobs | Remove `after(...)` as the source of provisioning truth | `src/server/lib/v2/machines.ts` runs provisioning in-process | Machine create/delete/rebuild/publish/export all run from durable jobs claimed by workers |
| P1-2 | Placement reservations | Stop oversubscription races | Host pick uses DB snapshots, reconcile updates used capacity later | Capacity lease created before any runner create call; lease committed or released explicitly |
| P1-3 | Hot-path indexes | Prevent avoidable DB degradation | `schema.ts` has core tables but little explicit indexing | All hot queries in machine/host/webhook paths have explicit indexes |
| P1-4 | Durable webhook delivery | Remove timer-based retries | `src/server/lib/webhook-delivery.ts` uses in-process timers | Retryable webhook queue with persisted attempts/dead-letter state |
| P1-5 | Backup/restore baseline | Turn snapshots into real DR | Research shows no production-grade off-host recovery yet | DB restore drill + machine backup export/restore drill both exist and pass |
| P1-6 | Host drain / maintenance | Make pinned-to-node ops safe | `draining` exists conceptually but scheduler/ops are still incomplete | Operators can cordon/drain a host and the scheduler honors it |
| P1-7 | Host substrate standardization | Remove mixed-host drift from the production baseline | Research notes mixed storage-driver reality (`zfs` vs `dir`) | One documented prod host baseline per host class; non-standard hosts are transitional only |

### Phase 1 detailed execution plan by workstream

#### P1-1 Durable machine lifecycle jobs

**Target repo areas**

- `src/server/lib/v2/machines.ts`
- `src/server/lib/providers/baremetal.ts`
- `src/server/lib/v2/snapshots.ts`
- `src/server/lib/webhook-delivery.ts`
- any internal/admin routes that currently cause async lifecycle work implicitly

**Exact changes to plan for**

1. Introduce a single durable job framework for:
   - `machine_create`
   - `machine_delete`
   - `machine_rebuild`
   - `image_publish`
   - `snapshot_export`
   - `webhook_deliver`
   - `routing_repair`
2. Replace one long provisioning path with explicit steps:
   - create machine row
   - create operation row
   - create reservation
   - enqueue job
   - worker resolves image/template
   - worker calls runner
   - worker writes provider metadata and credentials
   - worker schedules billing/routing side effects as child jobs
   - worker marks readiness only after the agreed readiness source fires
3. Every step must be idempotent by `(job_type, subject_id, idempotency_key)`.
4. API workers stop owning long-lived lifecycle work.

**Important repo-specific rule**

Do not move provisioning logic into `runnerd`. The worker should orchestrate; `runnerd` should stay host-local executor.

#### P1-2 Placement reservations

**Target repo areas**

- `src/server/lib/v2/machines.ts`
- `src/server/lib/baremetal/scheduler.ts`
- `src/server/lib/baremetal/reconcile.ts`
- `src/server/db/schema.ts`

**Exact changes to plan for**

1. Add lease-based reservation write before runner create.
2. Scheduler decision returns:
   - host candidate
   - projected utilization after placement
   - reservation token/id
3. Worker commits reservation only after runner confirms create.
4. Worker releases reservation on terminal failure.
5. Reconcile gains one narrow role here: clean expired/stranded reservations.

**What must be modeled separately**

- active customer allocation
- stopped-but-billed disk allocation
- warm reserve allocation
- transient maintenance/migration reserve

#### P1-3 Hot-path indexes

**Target repo area**

- `src/server/db/schema.ts`

**Exact indexes to add first**

- `machines(account_id, deleted_at, created_at desc)`
- `machines(status, deleted_at)`
- `machines(provider, region, status, deleted_at)`
- `machines(provider_server_id)`
- `machines(slug)` is already unique; keep it as a hot-path lookup primitive
- `machines(last_heartbeat_at)`
- `machine_events(machine_id, created_at desc)`
- `machine_events(account_id, created_at desc)`
- `images(account_id, status, created_at desc)`
- `baremetal_hosts(region, status, host_class)`
- `baremetal_hosts(status, updated_at)`
- `webhooks(account_id, active)`
- `webhook_deliveries(webhook_id, created_at desc)`
- `webhook_deliveries(success, created_at)` or `status, next_attempt_at` once status fields exist

**Reason this is Phase 1, not later**

These are low-risk, immediately useful, and make every later phase safer.

#### P1-4 Durable webhook delivery

**Target repo areas**

- `src/server/lib/webhook-delivery.ts`
- `src/server/lib/event-bus.ts`
- `src/server/db/schema.ts`

**Exact changes to plan for**

1. Event production stays in app code.
2. Delivery scheduling moves to durable jobs.
3. `webhook_deliveries` becomes authoritative for attempt state.
4. Add explicit statuses:
   - `queued`
   - `delivering`
   - `retry_waiting`
   - `delivered`
   - `dead_lettered`
5. Add payload version field so downstream infra consumers can depend on a stable contract.

#### P1-5 Backup / restore baseline

**Target repo/ops areas**

- snapshot/image/export paths in server/provider code
- operator runbook area under `.kortix/docs/specs/`
- runner/image export capabilities already exposed through runnerd/Incus paths

**Exact changes to plan for**

1. Define one DB backup implementation and one documented restore drill.
2. Define one machine backup export format and object-storage location model.
3. Store backup artifact metadata in DB.
4. Store restore execution history in DB.
5. Separate clearly:
   - operator DR export
   - user-facing backup product

**Repo-specific caution**

Do not claim `backups_enabled` in `machines` means production backups are solved. The current repo has pricing hooks and fields, not the full system.

#### P1-6 Host drain / maintenance

**Target repo areas**

- `src/server/lib/baremetal/scheduler.ts`
- `src/server/routes/v1/admin-baremetal.ts`
- `src/app/v2/admin/fleet/page.tsx`
- `src/server/db/schema.ts`

**Exact changes to plan for**

1. Add explicit host schedulability state separate from purely descriptive status if needed.
2. Scheduler rejects new placements to `draining`, `maintenance`, `disabled`, and unhealthy hosts.
3. Add operator workflow states:
   - requested drain
   - draining
   - drained
   - maintenance
   - return to service
4. Add host drain report with blockers:
   - active machines
   - stopped machines retaining disk
   - warm reserves
   - pending backup export
   - stale reservations

#### P1-7 Host substrate standardization

**Target repo/ops areas**

- bootstrap scripts
- runnerd environment conventions
- operator runbooks and host metadata

**Exact changes to plan for**

1. Make storage driver explicit in DB and inventory.
2. Make host generation explicit.
3. Define exactly one production baseline per host class for:
   - storage driver
   - image layout
   - runnerd version
   - daemon version
   - firewall/port policy
   - warm-pool policy
4. Mark non-conforming hosts as non-default placement targets.

### Phase 1 proposed schema changes

#### New tables

1. `control_plane_jobs`
   - `id`
   - `job_type`
   - `subject_type`
   - `subject_id`
   - `status`
   - `priority`
   - `attempt`
   - `max_attempts`
   - `lease_owner`
   - `lease_expires_at`
   - `run_after`
   - `idempotency_key`
   - `payload`
   - `result`
   - `error`
   - `created_at`
   - `updated_at`
   - `completed_at`
2. `host_capacity_reservations`
   - `id`
   - `host_id`
   - `machine_id` nullable
   - `job_id` nullable
   - `reservation_type`
   - `vcpu`
   - `memory_gb`
   - `disk_gb`
   - `status`
   - `lease_expires_at`
   - `committed_at`
   - `released_at`
   - `metadata`
3. `machine_operations`
   - `id`
   - `machine_id`
   - `operation_type`
   - `requested_by`
   - `status`
   - `job_id`
   - `input`
   - `result`
   - `error`
   - timestamps
4. `backup_artifacts`
   - `id`
   - `machine_id` nullable
   - `image_id` nullable
   - `artifact_type`
   - `provider`
   - `storage_url`
   - `size_bytes`
   - `checksum`
   - `retention_until`
   - `status`
   - `source_host_id`
   - timestamps
5. `restore_executions`
   - `id`
   - `artifact_id`
   - `target_host_id` nullable
   - `target_machine_id` nullable
   - `status`
   - `result`
   - `error`
   - timestamps
6. `host_maintenance_windows`
   - `id`
   - `host_id`
   - `state`
   - `reason`
   - `scheduled_start_at`
   - `started_at`
   - `completed_at`
   - `operator_notes`

#### Existing table extensions

- `machines`
  - `host_id` if current semantics are ambiguous in `provider_meta`
  - `last_operation_id`
  - `readiness_source`
  - `status_reason`
  - `capacity_reservation_id`
- `baremetal_hosts`
  - `schedulable`
  - `schedulable_reason`
  - `drain_started_at`
  - `storage_driver`
  - `host_generation`
  - `capacity_version`
- `webhook_deliveries`
  - `status`
  - `next_attempt_at`
  - `dead_lettered_at`
  - `payload_version`

### Phase 1 new services / components

| Component | Deployable in Phase 1? | Ownership |
| --- | --- | --- |
| Job worker | Yes | Executes durable lifecycle jobs |
| Reservation allocator | Maybe shared with worker initially | Owns capacity lease decisions |
| Webhook dispatcher worker | Can share worker runtime | Executes webhook delivery/retry jobs |
| Backup exporter | Can share worker runtime | Schedules/records off-host backup exports |
| Restore verifier | Can share worker runtime | Runs periodic restore verification |

### Phase 1 rollout order

1. Add Phase 1 indexes
2. Add new tables
3. Deploy worker runtime with no traffic cutover
4. Move webhook delivery first
5. Add reservation writes and cleanup
6. Move machine create path off `after(...)`
7. Move delete/rebuild/publish/export paths onto jobs
8. Add backup/export metadata + restore drill path
9. Add drain/maintenance workflow and enforce it in scheduler
10. Mark non-standard hosts as non-default placement targets

### Phase 1 exit criteria

Phase 1 is complete only when all are true:

1. Machine create/delete no longer depend on API process memory.
2. Two concurrent creates cannot oversubscribe the same host by racing on stale `used_*` fields.
3. Webhook retries survive app restarts and have dead-letter visibility.
4. DB restore drill passes on schedule.
5. At least one machine/image restore-from-backup drill passes on schedule.
6. `draining` hosts receive no new placements.
7. Production fleet hosts are auditable against a documented substrate baseline.

### What to defer / avoid in Phase 1

- No distributed storage.
- No giant Incus cluster.
- No OVN/private-network product work.
- No live migration promises.
- No broad multi-provider expansion.
- No large runnerd rewrite.

---

## Phase 2 — scaling from 1k to 10k machines

### Phase 2 objective

Replace the current small-fleet scheduler/reconcile/heartbeat shape with systems that scale to many hosts and thousands of machines without pushing all hot traffic through primary Postgres and fleet-wide scans.

### Phase 2 exact workstreams

| ID | Workstream | Why it exists | Current repo reality | Concrete deliverable |
| --- | --- | --- | --- | --- |
| P2-1 | Scheduler v2 | Current scheduler is first-fit and host-snapshot based | `v2/machines.ts` and `baremetal/scheduler.ts` are simple selectors | Policy-driven placement service with explainable decisions |
| P2-2 | Heartbeat ingestion split | Heartbeats directly mutate OLTP machine rows | `routes/v1/internal.ts` writes heartbeat/status path directly | Buffered ingestion + rollups + conditional machine-row writes |
| P2-3 | Reconcile redesign | Current reconcile is O(fleet) and triggered on admin reads | `reconcile.ts` loads all hosts/machines/images; admin list triggers reconcile | Per-host sync checkpoints + targeted repair + scheduled audits |
| P2-4 | Image locality / replication | Image placement is not first-class today | Local image availability is implicit and host-local | Explicit image distribution state and replication policy |
| P2-5 | Customer-visible backup productization | Backups must become a real product surface | Current repo has partial fields/pricing hooks, not the finished product | Policy, inventory, restore history, and billing semantics |
| P2-6 | Routing state hardening | Routing is real but still partly best-effort | KV/broker correctness depends on multiple code paths writing state | Durable routing-state events + reconciler |

### Phase 2 detailed execution plan by workstream

#### P2-1 Scheduler v2

**Target repo areas**

- `src/server/lib/baremetal/scheduler.ts`
- `src/server/lib/v2/machines.ts`
- host metadata / inventory schema

**Exact placement inputs to support**

- region
- host status / schedulability
- host class policy
- projected utilization after reservation
- warm-pool availability by CPU bucket
- image locality / cache state
- drain / maintenance state
- reserve budget / spare capacity threshold

**Exact outputs to support**

- selected host
- decision score / reasons
- rejection reasons when no host is eligible
- reservation object

#### P2-2 Heartbeat ingestion split

**Target repo areas**

- `src/server/routes/v1/internal.ts`
- `src/server/routes/v1/sse.ts`
- `src/server/db/schema.ts`

**Exact plan**

1. Keep `machines.last_heartbeat_at` and coarse health summary in OLTP.
2. Move raw heartbeat frequency into a buffered ingestion path.
3. Create rollups for current health and readiness state.
4. Change SSE/status fanout to rely on event/rollup feed instead of repeated DB polling as the main design.

#### P2-3 Reconcile redesign

**Target repo areas**

- `src/server/lib/baremetal/reconcile.ts`
- `src/server/routes/v1/admin-baremetal.ts`

**Exact plan**

1. Remove reconcile-on-read from admin list paths.
2. Add per-host sync checkpoints.
3. Reconcile by host or shard, not by whole fleet each pass.
4. Split responsibilities:
   - host inventory sync
   - machine drift repair
   - image drift repair
   - reservation cleanup

#### P2-4 Image locality / replication

**Target repo/ops areas**

- image publish/import logic
- host state sync
- scheduler inputs

**Exact plan**

1. Make golden image pre-staging explicit by region/cell.
2. Track whether a host/cell has a given image ready.
3. Add selective replication for hot custom images only.
4. Feed image readiness into placement scoring.

#### P2-5 Customer-visible backup productization

**Exact plan**

1. Distinguish clearly in data model and UX:
   - snapshots
   - images
   - operator DR backups
   - customer restorable backups
2. Store backup policy and retention per machine.
3. Track restore history and target host selection.
4. Tie billing to real artifacts/policies, not only toggles.

#### P2-6 Routing state hardening

**Target repo areas**

- `src/server/lib/cloudflare.ts`
- `src/server/routes/v1/internal.ts`
- Worker/broker routing code

**Exact plan**

1. Make routing state changes durable events.
2. Introduce routing-state reconciler separate from machine reconcile.
3. Define target SLOs for routing propagation.
4. Start planning replacement of current per-host hashed NAT port model where density requires it.

### Phase 2 proposed schema changes

#### New tables

1. `host_inventory_state`
   - `host_id`
   - `last_sync_at`
   - `runner_state_version`
   - `image_summary`
   - `warm_pool_summary`
   - `error`
2. `heartbeat_rollups`
   - `machine_id`
   - `last_heartbeat_at`
   - `health_state`
   - `readiness_state`
   - `summary`
3. `routing_state_events`
   - `machine_id`
   - `event_type`
   - `payload`
   - `status`
   - `applied_at`
4. `image_replica_state`
   - `image_id`
   - `region`
   - `host_id` nullable
   - `cell_id` nullable
   - `status`
   - `last_verified_at`
5. `backup_policies`
   - retention, schedule, product/billing mapping

#### Existing table extensions

- `machines`
  - `health_state`
  - `readiness_state`
  - `backup_policy_id`
  - `cell_id` nullable in Phase 2
- `baremetal_hosts`
  - `cell_id` nullable in Phase 2
  - `image_cache_state`
- `images`
  - `distribution_policy`
  - `source_type`
  - `last_exported_at`

### Phase 2 new services / components

| Component | Ownership |
| --- | --- |
| Scheduler v2 / allocator service | Placement policy + reservations |
| Heartbeat ingestor | Raw heartbeat intake |
| State rollup processor | Produces current health/readiness view |
| Image distribution manager | Image pre-stage/replication policy |
| Routing state reconciler | KV/broker replay and repair |
| Shard-aware reconcile worker | Audits hosts/shards without full-fleet scans |

### Phase 2 rollout order

1. Remove admin-path implicit reconcile
2. Add host sync checkpoints
3. Deploy heartbeat ingestor + rollups in shadow mode
4. Deploy scheduler v2 in shadow mode
5. Add image locality metadata
6. Add routing-state events and reconciler
7. Cut new placements to scheduler v2
8. Move readiness/health to rollups
9. Launch customer-visible backup policy/inventory/restore history

### Phase 2 exit criteria

1. Scheduler decisions are policy-driven and explainable.
2. Reconcile no longer loads the whole fleet on routine execution.
3. Heartbeat volume is no longer written directly into primary OLTP as the only path.
4. Image locality is explicit and visible to placement.
5. Customer backup semantics are real and testable.
6. Routing-state drift can be replayed from durable state.

### What to defer / avoid in Phase 2

- No global mega-cluster rollout.
- No full distributed event-platform migration unless Phase 1/2 queues prove inadequate.
- No broad custom-image warm pools without explicit reserve economics.
- No wide multi-vendor expansion before host-class/cell policy is stable.

---

## Phase 3 — scaling from 10k to 100k machines

### Phase 3 objective

Make the platform operationally plausible at 100k machines by shifting from a host-centric fleet to a cell-centric platform with independently scaling control-plane services and economically appropriate host classes.

### Phase 3 exact workstreams

| ID | Workstream | Why it exists | Current repo reality | Concrete deliverable |
| --- | --- | --- | --- | --- |
| P3-1 | Cell architecture | 100k requires operational boundaries above individual hosts | Current repo thinks mostly in hosts/regions, not cells | `cell = region × host_class × generation` becomes a first-class object |
| P3-2 | Control-plane service split | API app should not remain executor for everything | Current app still owns too much orchestration responsibility | Independently scaled allocator/provisioner/telemetry/routing services |
| P3-3 | Time-series + event storage separation | Raw telemetry/event retention should not stay in OLTP | Heartbeats/events currently lean on primary DB path | Dedicated high-volume storage path + OLTP summaries |
| P3-4 | Denser host classes / procurement evolution | Current `general-small` class is too shallow for 100k | Economics research shows current host class is wrong for 100k mainstream fleet | Denser standard production class becomes dominant |
| P3-5 | Regional reserve / admission control | Reserve must be regional/cell-based at scale | Current logic is host-level free-capacity thinking | Cell reserve budgets and sellability/admission controls |
| P3-6 | Routing/access-plane authority | KV/broker state needs a clearer system-of-record | Current routing updates come from several paths | Routing state manager becomes authoritative |

### Phase 3 detailed execution plan by workstream

#### P3-1 Cell architecture

**Exact plan**

1. Introduce `cells` table and assign every production host to a cell.
2. Make placement cell-first, host-second.
3. Define per-cell:
   - warm-pool policy
   - reserve policy
   - image policy
   - maintenance windows
   - rollout/canary order

#### P3-2 Control-plane service split

**Exact plan**

Split responsibilities into explicit services/components:

- allocator service
- provisioner service
- telemetry ingestor
- routing state manager
- webhook dispatcher
- backup/orchestration controller
- fleet auditor

The customer API remains the front door, not the place where long-running orchestration lives.

#### P3-3 Time-series and event storage separation

**Exact plan**

1. Keep only summaries and recent operational state in primary Postgres.
2. Move raw heartbeat history and dense event logs to a separate retention path.
3. Partition/archive `machine_events` and `webhook_deliveries` aggressively even if some support queries remain in Postgres.

#### P3-4 Denser host classes / procurement evolution

**Exact plan**

1. Introduce one denser mainstream production host class.
2. Relegate `general-small` to starter/edge/regional bootstrap duty.
3. Make host generation explicit for placement and migration policy.
4. Connect procurement to cell-level reserve targets.

#### P3-5 Regional reserve / admission control

**Exact plan**

1. Budget reserve at cell/region scope, not per host guesswork.
2. Track:
   - warm reserve
   - failure reserve
   - procurement reserve
3. Add cell sellability state and admission control when thresholds are breached.

#### P3-6 Routing/access-plane authority

**Exact plan**

1. Routing state manager becomes the system of record for access metadata.
2. Machine code paths emit routing intents/events, not ad hoc final writes.
3. Replace any remaining per-host networking assumptions that cap density, including the 1000-port hash model if still present.

### Phase 3 proposed schema changes

#### New tables

1. `cells`
   - `id`
   - `region`
   - `host_class`
   - `generation`
   - `status`
   - `reserve_policy`
   - `warm_pool_policy`
   - `image_policy`
   - `metadata`
2. `cell_capacity_snapshots`
   - `cell_id`
   - `captured_at`
   - `total_vcpu`
   - `reserved_vcpu`
   - `sellable_vcpu`
   - equivalent memory/disk fields
3. `cell_admission_controls`
   - `cell_id`
   - `state`
   - `reason`
   - `set_at`
4. `service_leases` / `consumer_offsets`
   - leases/checkpoints for independently scaled services

#### Existing table extensions

- `baremetal_hosts`
  - `cell_id` mandatory
- `machines`
  - `cell_id` mandatory
  - `placement_version`
  - `capacity_reservation_id`
- `images`
  - per-cell readiness/replication fields if not fully normalized elsewhere

### Phase 3 new services / components

| Component | Ownership |
| --- | --- |
| Allocator service | Global/cell-aware placement |
| Provisioner service | Machine lifecycle orchestration |
| Telemetry ingestor | High-volume heartbeat/event intake |
| Routing state manager | Authoritative routing/access state |
| Fleet auditor | Cell/host drift audit |
| Backup/orchestration controller | Backup/export/restore workflows |
| Cell capacity controller | Reserve budgets and admission control |

### Phase 3 rollout order

1. Introduce cell model
2. Assign hosts into cells
3. Shift scheduler to cell-first placement
4. Split allocator/provisioner from general API runtime
5. Move telemetry/event retention off primary OLTP
6. Roll out denser host classes into new cells
7. Enable cell reserve/admission control
8. Make routing state manager authoritative

### Phase 3 exit criteria

1. Every production host belongs to an explicit cell.
2. Placement is cell-first and reserve-aware.
3. Control-plane services scale independently.
4. High-volume telemetry/event retention is no longer a primary-OLTP responsibility.
5. Denser host classes dominate mainstream production capacity.
6. Routing/access-plane state has one clear authority and replay path.

### What to defer / avoid in Phase 3

- No default distributed storage unless product strategy forces it.
- No universal live-migration promise across heterogeneous cells.
- No customer-facing Incus IAM/project exposure.
- No single giant heterogeneous Incus cluster as the main scaling story.

---

## Workstreams that should explicitly wait until after Phase 3

These may become useful later, but they are not on the critical path to production readiness or 100k plausibility.

1. Broad OVN/private-cloud networking products
2. Distributed storage as default substrate
3. Live migration as a baseline customer promise
4. OpenFGA/customer-facing Incus authorization models
5. One global mega-cluster across heterogeneous hardware

---

## Short executive summary by phase

### Phase 1

Fix the things that can lose work, oversubscribe hosts, or make recovery impossible.

### Phase 2

Fix the things that make the current small-fleet scheduler/reconcile/heartbeat design too expensive at 1k-10k machines.

### Phase 3

Fix the fleet shape, service boundaries, and host economics needed to make 10k-100k machines plausible.

---

## Bottom line

The roadmap is deliberately evolutionary, not a rewrite:

1. Phase 1 makes the current JustAVPS architecture truly production-ready.
2. Phase 2 makes it operationally credible from 1k to 10k machines.
3. Phase 3 makes the 10k to 100k path plausible by introducing cells, service separation, and denser production host classes.

The biggest mistake would be to jump to advanced cloud patterns before fixing the current repo’s actual blockers: `after(...)` provisioning, snapshot-based capacity truth, in-process webhook retries, DB-heavy reconcile, and missing DR primitives.
