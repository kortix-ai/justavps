# JustAVPS v2 — Incus control-plane spec

> Status: living spec
> Purpose: define the simplest correct v2 architecture and implementation order

---

## 1. Core decisions

1. **Topology**
   - `region -> cluster -> host -> instance`
   - `cluster` is the main runtime unit.
   - One cluster = one Incus cluster.

2. **Launch shape**
   - Start with **one cluster per region**.
   - Add more clusters inside a region later if needed.

3. **Runtime defaults**
   - Default runtime: **hardened container**.
   - VM: optional, later, or policy-driven.

4. **Host OS**
   - All hosts run **IncusOS** by default.

5. **Public vs internal naming**
   - Public/API/UI term: **machine**
   - Internal/runtime term: **instance**

6. **Scope cuts for base v2**
   - No warm pools
   - No shared multi-attach volumes
   - No direct customer access to Incus
   - Quotas deferred until after topology + placement + core lifecycle are stable

7. **Build strategy**
   - Keep v1 running.
   - Build v2 mostly separately.
   - New `/api/v2`, new services, new workers.
   - Reuse only shared auth/account primitives where clean.

8. **Testing rule**
   - Build v2 fully TDD.
   - Every important flow must have unit, integration, and curl-level E2E coverage.

---

## 2. Terms

### Product terms

- **Account**: ownership boundary
- **Machine**: customer-facing compute object
- **Region**: user-selectable geography

### Infrastructure terms

- **Cluster**: one Incus cluster in one region
- **Host**: one bare-metal server in a cluster
- **Instance**: one Incus instance (`container` or `vm`)
- **Project**: one Incus project inside one cluster
- **Volume**: storage attached to an instance
- **Snapshot**: fast local restore point
- **Backup**: exported restore artifact

---

## 3. What the control plane owns

The control plane owns:

- regions
- clusters
- hosts
- host registration and health
- placement
- capacity leasing
- instance lifecycle orchestration
- snapshots / backups / restores
- procurement decisions
- admin visibility

The control plane does **not** expose Incus directly to customers.

## 3.1 Current repo status quo

The current repo already has meaningful v2 infrastructure work.

### Already present

- `/api/v2` route tree exists
- public v2 routes exist for:
  - machines
  - images
  - snapshots
  - billing
  - catalog
- admin v2 fleet routes exist for:
  - hosts
  - procurements
  - procurement recommendations
  - host mutations / reconciliation
- script-based E2E already exists:
  - `tests/scripts/v2/01-region-cluster-host-foundation.ts`
  - `tests/scripts/v2/02-placement-and-capacity.ts`
  - `tests/scripts/v2/03-create-machine-container.ts`
  - `tests/scripts/v2/04-baremetal-lifecycle.ts`
  - `tests/scripts/v2/05-capacity-and-procurement.ts`
- placement/capacity primitives already exist in code:
  - `cells`
  - `baremetal_hosts`
  - `host_capacity_reservations`
  - `cell_capacity_snapshots`
  - `baremetal_procurements`
- snapshots already exist in v2 routes/services
- image creation already exists in v2 routes/services

### Important current implementation facts

1. v2 currently uses the shared `machines` table with `apiVersion = 'v2'`
2. current DB/runtime naming still uses **cells** internally
3. current `createMachineV2()` already:
   - checks machine limits
   - reserves host capacity
   - records placement metadata
   - supports `docker_image` for container machines
   - enqueues a control-plane job
4. current public create schema defaults `machine_mode` to `vm`, which must change for the new base plan
5. current snapshot flow is already real and should be reused, not rebuilt blindly

### Concrete implication

v2 should not ignore the current repo state.

The fastest robust path is:

- keep existing good primitives
- simplify and tighten them
- rename conceptually at the service/API/spec layer only where necessary

Not recommended:

- deleting all current v2 work and starting from zero

## 3.2 Concrete reuse / replace plan

### Reuse now

- `machines` table as the initial canonical instance table
- `cells` table as the underlying cluster table for now
- `baremetal_hosts`
- `host_capacity_reservations`
- `cell_capacity_snapshots`
- `baremetal_procurements`
- current v2 snapshot service
- current v2 image service
- current script E2Es as the starting harness

### Rename conceptually now, physically later

For clarity in new code/spec:

- **cluster** = current `cell`
- **capacity lease** = current `host_capacity_reservation`
- **cluster capacity sample** = current `cell_capacity_snapshot`
- **host order** = current `baremetal_procurement`

### Must change soon

1. default `machine_mode` from `vm` -> `container`
2. make the public/admin plan cluster-first, not cell-first
3. freeze exact state machines
4. freeze exact route contract
5. split the large current E2E into smaller gated suites
6. decide whether quota checks are bypassed or feature-flagged during core-first implementation

---

## 4. What every host runs

Every production host should run:

1. **IncusOS**
2. **Incus cluster member**
3. **local ZFS**
4. **`runnerd` host agent**
5. **heartbeat / telemetry hooks** required by the control plane

Hosts should stay minimal and standardized.

---

## 5. Base v2 data model

These are the minimum first-class objects for v2.

## 5.1 Core now

### `regions`

Purpose: customer-visible geography.

Fields:

- `id`
- `slug`
- `name`
- `status`
- `metadata`
- `created_at`
- `updated_at`

### `clusters`

Purpose: one Incus cluster.

Fields:

- `id`
- `region_id`
- `slug`
- `name`
- `incus_cluster_name`
- `incus_api_url`
- `status`
- `admission_state`
- `sellability_state`
- `host_class`
- `generation`
- `storage_profile`
- `network_profile`
- `reserve_policy_json`
- `metadata`
- `created_at`
- `updated_at`

### `hosts`

Purpose: physical server inventory.

Fields:

- `id`
- `region_id`
- `cluster_id`
- `provider`
- `provider_product_id`
- `provider_server_id`
- `name`
- `status`
- `maintenance_state`
- `public_ipv4`
- `public_ipv6`
- `runner_base_url`
- `runner_token_ref`
- `incus_member_name`
- `total_vcpu`
- `total_memory_gb`
- `total_disk_gb`
- `used_vcpu`
- `used_memory_gb`
- `used_disk_gb`
- `last_heartbeat_at`
- `last_drift_status`
- `cost_model_json`
- `metadata`
- `created_at`
- `updated_at`

### `host_heartbeats`

Purpose: latest host health state.

Fields:

- `host_id`
- `checked_at`
- `incus_ok`
- `zfs_ok`
- `runner_ok`
- `drift_status`
- `instance_count`
- `image_count`
- `alerts_json`
- `updated_at`

### `instances`

Purpose: canonical runtime object.

Fields:

- `id`
- `account_id`
- `owner_user_id`
- `region_id`
- `cluster_id`
- `host_id`
- `slug`
- `name`
- `runtime_kind`
- `security_tier`
- `status`
- `incus_instance_name`
- `image_id`
- `requested_image_kind`
- `requested_image_ref`
- `vcpu`
- `ram_gb`
- `disk_gb`
- `provider_meta`
- `last_ready_at`
- `last_heartbeat_at`
- `created_at`
- `updated_at`
- `deleted_at`

### `images`

Purpose: launchable images for instances.

Fields:

- `id`
- `scope`
- `account_id`
- `name`
- `slug`
- `status`
- `runtime_kind_compatibility`
- `default_runtime_kind`
- `source_kind`
- `source_ref`
- `incus_fingerprint`
- `metadata`
- `created_at`
- `updated_at`

### `snapshots`

Purpose: point-in-time capture used for restore and image workflows.

Fields:

- `id`
- `account_id`
- `instance_id`
- `cluster_id`
- `host_id`
- `snapshot_kind`
- `status`
- `incus_snapshot_name`
- `created_by_user_id`
- `metadata`
- `created_at`
- `updated_at`

### `capacity_leases`

Purpose: transactional reservation of host capacity.

Fields:

- `id`
- `host_id`
- `instance_id`
- `lease_type`
- `state`
- `vcpu`
- `memory_gb`
- `disk_gb`
- `expires_at`
- `committed_at`
- `released_at`
- `metadata`
- `created_at`
- `updated_at`

### `host_orders`

Purpose: procurement queue and history.

Fields:

- `id`
- `region_id`
- `target_cluster_id`
- `provider`
- `provider_product_id`
- `host_class`
- `generation`
- `quantity`
- `order_reason`
- `status`
- `automation_source`
- `requires_approval`
- `approved_by_user_id`
- `provider_transaction_id`
- `budget_estimate_cents`
- `decision_context_json`
- `error`
- `created_at`
- `approved_at`
- `ordered_at`
- `completed_at`
- `updated_at`

### `cluster_capacity_samples`

Purpose: scheduling and admin rollups.

Fields:

- `id`
- `cluster_id`
- `region_id`
- `host_count`
- `active_host_count`
- `schedulable_host_count`
- `total_vcpu`
- `total_memory_gb`
- `total_disk_gb`
- `used_vcpu`
- `used_memory_gb`
- `used_disk_gb`
- `reserved_vcpu`
- `reserved_memory_gb`
- `reserved_disk_gb`
- `reserve_budget_vcpu`
- `reserve_budget_memory_gb`
- `reserve_budget_disk_gb`
- `sellable_vcpu`
- `sellable_memory_gb`
- `sellable_disk_gb`
- `utilization_score_basis_points`
- `sample_window_start`
- `created_at`

## 5.4 Exact state machines

These should be treated as the canonical first-pass states.

### Host state machine

- `requested`
- `ordering`
- `bootstrapping`
- `active`
- `draining`
- `disabled`
- `error`
- `deleted`

Rule:

- only `active` hosts may become schedulable

### Host maintenance state machine

- `in_service`
- `drain_requested`
- `draining`
- `drained`
- `maintenance`

### Instance state machine

Keep the first public/runtime status set tight and consistent with the current code:

- `provisioning`
- `ready`
- `error`
- `stopped`
- `deleted`

Use `provisioning_stage` for sub-state detail instead of inventing too many top-level states.

### Provisioning stage values

First-pass stage values:

- `capacity_reserved`
- `create_queued`
- `create_running`
- `cloud_init_running`
- `cloud_init_done`
- `services_ready`
- `timeout`
- `failed`

### Capacity lease state machine

- `reserved`
- `committed`
- `released`
- `expired`

### Snapshot state machine

- `creating`
- `ready`
- `failed`
- `deleted`

### Image state machine

- `creating`
- `ready`
- `failed`
- `deleted`

### Host order state machine

- `requested`
- `approved`
- `ordering`
- `bootstrapping`
- `active`
- `failed`
- `cancelled`

## 5.2 Add next

After core topology + placement + lifecycle are stable:

- `account_cluster_projects`
- `quota_tiers`
- `volumes`
- `backups`
- `restore_runs`
- `provider_products`
- `host_cost_samples`

## 5.3 Deferred

- `warm_pool_definitions`
- `warm_pool_members`

---

## 6. Placement and capacity rules

## 6.1 Create flow

Default user create:

- user chooses **region**
- scheduler chooses **cluster**
- scheduler chooses **host**

Admin create may pin:

- region
- cluster
- host

## 6.2 Placement steps

1. validate request
2. resolve image source
   - golden image
   - existing account image
   - docker image import path
3. pick eligible clusters
4. score eligible clusters
5. pick eligible hosts inside selected cluster
6. create capacity lease
7. create instance
8. commit lease on success
9. release lease on failure

## 6.3 Capacity rules

Always track:

- `total`
- `used`
- `reserved`
- `reserve_budget`
- `sellable`

Definitions:

- `used`: real placed instances
- `reserved`: active leases
- `reserve_budget`: capacity intentionally held back
- `sellable`: capacity available for new placement

## 6.4 Utilization score

Default weights:

- CPU = `0.45`
- memory = `0.40`
- disk = `0.15`

## 6.5 Capacity system shape

The capacity system has three loops.

### Loop 1 — host heartbeat loop

Every host reports:

- Incus health
- ZFS health
- runner health
- drift status
- instance count
- image count

Output:

- host health state
- schedulable / unschedulable decision

### Loop 2 — capacity sampling loop

Every N minutes:

1. read active hosts
2. read active capacity leases
3. compute host-level totals / used / reserved
4. roll up into cluster-level capacity sample

Output:

- current utilization
- reserve pressure
- sellable capacity

### Loop 3 — procurement recommendation loop

Every N minutes:

1. read latest cluster samples
2. calculate time-to-exhaustion
3. compare against threshold and lead time assumptions
4. create procurement recommendation / host order when needed

Output:

- human-reviewable recommendation now
- optional auto-approval later

### Day-one rule

Base v2 includes:

- automatic capacity measurement
- automatic procurement recommendation

Base v2 does **not** require:

- fully automatic host purchasing with no approval

## 6.6 Initial scaling thresholds

These are starting values, not permanent truths.

- cluster utilization warning: `70%`
- procurement recommendation threshold: `80%`
- emergency threshold: `90%`
- lease TTL: `10 minutes`
- soft max hosts per cluster: `25`
- hard max hosts per cluster: `40`

Once a cluster crosses the soft cap, prefer adding a new cluster in the same region over endless growth.

## 6.7 Exact first route contract

These are the first routes the spec should treat as canonical.

### Public routes

- `GET /api/v2/machines`
- `POST /api/v2/machines`
- `GET /api/v2/machines/{id}`
- `POST /api/v2/machines/{id}/exec`
- `POST /api/v2/machines/{id}/start`
- `POST /api/v2/machines/{id}/stop`
- `POST /api/v2/machines/{id}/reboot`
- `DELETE /api/v2/machines/{id}`

- `GET /api/v2/images`
- `POST /api/v2/images`
- `DELETE /api/v2/images/{id}`

- `GET /api/v2/snapshots/{machineId}`
- `POST /api/v2/snapshots/{machineId}`
- `POST /api/v2/snapshots/{machineId}/{snapshotId}/restore`
- `DELETE /api/v2/snapshots/{machineId}/{snapshotId}`

### Admin fleet routes

- `POST /api/v2/admin/fleet/cells`
- `POST /api/v2/admin/fleet/hosts`
- `GET /api/v2/admin/fleet/hosts`
- `GET /api/v2/admin/fleet/hosts/{id}/bootstrap-config`
- `POST /api/v2/admin/fleet/hosts/{id}/register`
- `POST /api/v2/admin/fleet/hosts/{id}/heartbeat`
- `POST /api/v2/admin/fleet/hosts/reconcile`

- `GET /api/v2/admin/fleet/procurements`
- `POST /api/v2/admin/fleet/procurements`
- `GET /api/v2/admin/fleet/procurement-recommendations`
- `POST /api/v2/admin/fleet/procurements/{id}/approve`
- `POST /api/v2/admin/fleet/procurements/{id}/sync`

### Status-quo note

These routes already substantially exist in the repo.
The plan should extend and tighten them rather than replace them casually.

---

## 7. Runtime rules

1. Default runtime = hardened container
2. VM is optional and later/policy-driven
3. Root disk stays on local fast storage
4. Volumes are not part of the first topology/placement slice
5. Snapshot support is part of the base lifecycle, not a later extra
6. Docker image support should flow through image import/publish, not ad hoc direct execution

## 7.1 Docker image path

If a user brings a Docker image, the system should do this:

1. accept docker image reference
2. import / convert it into a launchable internal image record
3. create instance from that image
4. allow snapshotting that resulting instance

This is why image + snapshot support belongs in the base system.

---

## 8. Procurement rules

The control plane should:

1. aggregate latest cluster capacity samples
2. calculate sellable capacity
3. estimate time-to-exhaustion
4. create procurement recommendation when thresholds are crossed
5. create/track host order
6. provision and join host into target cluster

Important simplification:

- do **not** auto-create new regions in base v2
- only add hosts inside existing regions/clusters first

---

## 9. Billing and usage tracking

Yes: if we want correct cloud billing, we must track usage explicitly from day 1.

## 9.1 Billing rule

For v2, use this billing model:

### Bill on allocation for core machine resources

Bill based on what the machine is provisioned with, not on fluctuating live consumption.

Billable dimensions:

- allocated vCPU
- allocated RAM GB
- allocated root disk GB
- machine lifetime in seconds

Reason:

- predictable
- hard to game
- easy to reconcile
- matches cloud primitives better than “actual CPU used” billing

### Bill on stored bytes for storage artifacts

Bill based on stored size and retention duration for:

- snapshots
- backups
- later: detachable volumes

Billable dimensions:

- snapshot stored bytes
- backup stored bytes
- retention time

## 9.2 What to meter from day 1

Even if customer pricing starts simple, the platform should record these metrics from day 1:

### Machine allocation facts

- `vcpu_allocated`
- `ram_gb_allocated`
- `disk_gb_allocated`
- `runtime_kind`
- `cluster_id`
- `host_id`

### Machine lifetime facts

- `started_at`
- `stopped_at`
- `deleted_at`
- cumulative active seconds

### Observed runtime telemetry

- CPU seconds
- memory working set / RSS
- filesystem usage bytes
- network in/out bytes
- process count

### Artifact facts

- snapshot count
- snapshot bytes
- backup count
- backup bytes
- backup retention

## 9.3 Source-of-truth rule for billing

Use this hierarchy:

1. **control-plane DB** = billing source of truth
2. **Incus metrics / host telemetry** = observed usage and sanity checks
3. **billing rollups** = invoice inputs

Do **not** generate invoices directly from raw Incus metrics.

Raw metrics are for:

- observability
- sanity checks
- anomaly detection
- future usage-priced products

## 9.4 What to add to the schema later

When billing work starts, add:

- `usage_samples`
- `usage_rollups_hourly`
- `usage_rollups_daily`
- `billing_line_items`
- `snapshot_storage_rollups`
- `backup_storage_rollups`

## 9.5 Current status quo

Current repo reality:

- v2 currently prices machines as **flat monthly allocation pricing**
- there is already a billing overview route
- there are already billing comparison helpers

So the correct next step is **not** to invent a whole new billing model now.

The correct step is:

1. keep allocated-resource billing for base v2
2. add high-quality usage metering in parallel
3. use those rollups for visibility first
4. later decide whether any product surface should become true usage-billed

---

## 10. Observability and cloud insight

We should build strong observability from day 1.

## 10.1 Incus telemetry

Yes, we can hook into Incus telemetry.

Per Incus docs, metrics are exposed through:

- `GET /1.0/metrics`

And can be exposed with:

- `incus config set core.https_address ":8443"`
- `incus config set core.metrics_address ":8444"`

The metrics are in OpenMetrics / Prometheus format.

Incus exposes instance metrics for:

- CPU
- memory
- disk I/O
- filesystem usage
- network I/O
- process count

This is enough to build real host/cluster/instance dashboards.

## 10.2 Incus web UI

Yes, Incus has a web UI and server-side UI config support.

But for v2:

- use Incus web UI as an **operator diagnostic tool**
- do **not** make it the product control plane

Recommended use:

- operator-only access
- deep links from admin host/cluster pages
- debugging cluster state, instances, storage, and network issues

Not recommended:

- exposing raw Incus UI as the customer-facing cloud product

## 10.3 Day-1 observability stack

Track at four levels.

### Level 1 — host

- host heartbeat
- Incus health
- ZFS health
- runner health
- drift status
- total/used/reserved/sellable capacity

### Level 2 — cluster

- host count
- schedulable host count
- cluster utilization
- reserve pressure
- image locality health
- placement failure rate
- procurement recommendation state

### Level 3 — instance

- lifecycle state
- provisioning duration
- ready signal (`heartbeat` vs `probe`)
- CPU / memory / filesystem / network telemetry
- snapshot count
- backup state

### Level 4 — control plane

- API latency
- create-machine success rate
- lease conflicts
- stuck jobs
- reconcile failures
- restore success rate
- procurement loop health

## 10.4 Required metrics and dashboards

Day-1 dashboards should include:

### Fleet dashboard

- regions
- clusters
- active hosts
- unhealthy hosts
- schedulable hosts
- total and sellable capacity

### Placement dashboard

- create requests
- placement success rate
- placement rejection reasons
- lease counts
- average time to ready

### Machine health dashboard

- ready vs provisioning vs error vs stopped
- heartbeat freshness
- top CPU / RAM / disk consumers

### Storage safety dashboard

- snapshot counts
- snapshot failures
- backup counts
- backup failures
- restore success/failure rate

### Procurement dashboard

- latest cluster samples
- threshold breaches
- recommendations
- pending host orders
- bootstrapping hosts

## 10.5 Required observability loops

In addition to the three scaling loops, add:

### Telemetry ingestion loop

- scrape or receive Incus/host metrics
- normalize into internal time-series / rollups

### Reconciliation loop

- compare DB desired state vs Incus observed state
- detect drift
- repair or flag inconsistencies

### Billing rollup loop

- aggregate machine allocation-time
- aggregate snapshot bytes-time
- aggregate backup bytes-time
- publish invoice-ready line items

## 10.6 Practical recommendation

For day 1:

1. keep product billing simple (allocated resources)
2. still collect rich observed telemetry everywhere
3. expose strong admin dashboards immediately
4. hook Prometheus/Grafana into Incus metrics early
5. use Incus web UI as operator-only debugging support

That gives us both:

- correct customer billing
- strong cloud-wide visibility

---

## 11. Implementation order

Build vertical slices in this exact order.

## Slice 1 — topology foundation

Build:

- regions
- clusters
- hosts
- host registration state machine
- host heartbeat ingestion
- host schedulable gating

Prove:

- region can exist
- cluster can exist
- host can register into cluster
- host becomes schedulable only after health checks

## Slice 2 — capacity and placement

Build:

- capacity leases
- cluster eligibility
- host eligibility
- placement decision recording

Prove:

- create reserves capacity before provisioning
- failed create releases lease
- concurrent creates cannot oversell a host

## Slice 3 — minimal machine lifecycle

Build:

- create hardened container machine
- start / stop / reboot / delete
- list / get
- exec
- create snapshot
- restore snapshot

Prove:

- user creates machine by region only
- scheduler selects cluster + host
- instance becomes ready
- exec works end to end
- snapshot/restore works end to end

## Slice 4 — image and snapshot flow

Build:

- image registration
- docker image import path
- create from imported image
- snapshot inventory
- restore from snapshot

Prove:

- user can bring a docker image
- system turns it into a launchable image path
- machine can be created from it
- snapshot works on that machine

## Slice 5 — tenancy and quotas

Build later:

- account_cluster_projects
- quota tiers
- Incus project sync
- quota enforcement

## Slice 6 — storage safety

Build later:

- volumes
- backups
- restore

## Slice 7 — mutation correctness

Build later:

- resize
- pre-resize snapshot
- rollback
- reconciliation

## Slice 8 — procurement and economics

Build later:

- cluster capacity samples
- host cost samples
- procurement recommendations
- host order lifecycle

---

## 12. Base flow to nail first

This is the spine of v2:

1. create region
2. create first cluster in region
3. bootstrap first IncusOS host into the cluster
4. add more hosts into the cluster
5. create machine by region only
6. scheduler chooses cluster and host
7. reserve capacity
8. create instance
9. exec works
10. snapshot works
11. delete works
12. utilization can trigger host-order recommendation

If this chain is solid, the base platform is solid.

---

## 13. Required flows

These are the flows that must eventually exist.

## 13.1 Topology

1. create region
2. update region
3. disable region
4. create cluster
5. update cluster admission state
6. update cluster sellability state
7. bootstrap first host with IncusOS
8. seed first Incus cluster
9. add host to existing cluster
10. mark host schedulable only after health checks
11. put host into maintenance
12. drain host
13. retire host

## 13.2 Placement and capacity

14. reserve capacity lease before create
15. commit capacity lease after successful create
16. release capacity lease after failed create
17. reject create when cluster is closed
18. reject create when host is unschedulable
19. compute host utilization
20. compute cluster capacity sample
21. compute sellable capacity after reserve budget
22. produce procurement recommendation
23. add host into existing region/cluster after approval

## 13.3 Machine lifecycle

24. create machine by region only
25. admin create machine pinned to cluster
26. admin create machine pinned to host
27. default create as hardened container
28. create as VM when requested
29. create machine from imported docker image
30. start instance
31. stop instance
32. reboot instance
33. delete instance
34. force-delete broken instance
35. list machines for account
36. get machine detail
37. exec into machine
38. open console
39. push file
40. pull file
41. configure routing/proxy for machine
42. deny access for wrong account

## 13.4 Snapshot and image flows

43. register image
44. import docker image into internal image path
45. create snapshot
46. list snapshots
47. restore snapshot in place
48. delete snapshot

## 13.5 Later flows

49. account-cluster project ensure/sync
50. quota assignment
51. quota enforcement
52. root volume flow
53. backups
54. restore
55. resize

---

## 14. Test strategy

Every important flow needs:

1. **unit tests**
2. **DB/repository tests**
3. **service integration tests**
4. **adapter contract tests**
5. **curl-level E2E tests**

Browser tests are secondary. Infrastructure correctness should be proven by scripted HTTP E2E.

## 14.1 Rule for each flow

At minimum test:

- happy path
- invalid input
- permission denied
- resource unavailable
- idempotent retry
- rollback after partial failure

## 14.2 TDD workflow

For every slice:

1. write failing curl-level E2E first
2. write failing service integration tests
3. write failing DB/logic tests
4. implement minimum code to pass
5. add failure-path E2Es
6. move to next slice only after green

## 14.3 Test file structure

- `src/**/*.test.ts`
  - unit and small service tests
- `tests/integration/**/*.test.ts`
  - DB + service orchestration tests
- `tests/scripts/v2/*.ts`
  - curl/HTTP E2E tests
- `tests/e2e/**/*.spec.ts`
  - browser/admin UI tests only

Long-running script E2Es should support checkpoints in:

- `.e2e-checkpoints/`

So failures or interruptions can resume from the last completed phase instead of restarting from zero.

Shared script helpers should live in:

- `tests/scripts/v2/lib/`

Current shared harness files:

- `tests/scripts/v2/lib/checkpoints.ts`
- `tests/scripts/v2/lib/harness.ts`

The harness should own:

- dotenv/bootstrap loading
- authenticated HTTP requests
- wait/retry helpers
- admin harness-user creation
- target-host discovery
- local host-capacity reconciliation
- checkpoint save/load helpers

## 14.4 Current command strategy

Use the existing tooling:

- `pnpm test`
- `pnpm test:integration`
- `pnpm e2e:v2:01:topology`
- `pnpm e2e:v2:02:placement`
- `pnpm e2e:v2:03:container`
- `pnpm e2e:v2:04:baremetal-lifecycle`
- `pnpm e2e:v2:05:procurement`
- `pnpm e2e:v2:07:host-bootstrap-validation`
- `pnpm e2e:v2:08:external-proxy-daemon`
- `pnpm e2e:v2:09:ui-machines`
- `pnpm e2e:v2:10:ui-images`
- `pnpm e2e:v2:11:ui-billing`
- `pnpm e2e:v2:core`
- `pnpm e2e:v2:06:dashboard`
- `pnpm e2e:v2:ui`
- `pnpm test:e2e`

Primary v2 correctness harness should be the script-based E2E suite.

---

## 15. First E2E suites to write

1. `e2e-v2-region-cluster-host-foundation`
   - create region
   - create cluster
   - register host
   - heartbeat
   - mark host schedulable

   Status:
   - implemented as `tests/scripts/v2/01-region-cluster-host-foundation.ts`

2. `e2e-v2-placement-and-capacity`
   - cluster eligibility
   - host eligibility
   - reserve capacity
   - reject unschedulable placement

3. `e2e-v2-create-machine-container`
   - create machine by region
   - scheduler chooses cluster + host
   - instance becomes ready
   - exec works

4. `e2e-v2-image-and-snapshot-flow`
   - import docker image
   - create machine from imported image
   - create snapshot
   - restore snapshot

5. `e2e-v2-capacity-and-procurement`
   - generate capacity sample
   - cross threshold
   - create procurement recommendation / host order

   Status:
   - implemented as `tests/scripts/v2/05-capacity-and-procurement.ts`

7. `e2e-v2-host-bootstrap-validation`
   - host register
   - bootstrap validation artifact
   - runnerd/incus/storage metadata
   - smoke test result
   - operator-only Incus UI metadata

   Status:
   - implemented as `tests/scripts/v2/07-host-bootstrap-validation.ts`

8. `e2e-v2-external-proxy-daemon`
   - machine create
   - routing repair
   - auth cache repair
   - external proxy root
   - external terminal
   - daemon `/health` via proxy

   Status:
   - implemented as `tests/scripts/v2/08-external-proxy-daemon.ts`

Later:

6. `e2e-v2-tenancy-and-quotas`
9. `e2e-v2-ui-machines`
10. `e2e-v2-ui-images`
11. `e2e-v2-ui-billing`
12. `e2e-v2-backup-restore`
13. `e2e-v2-resize-and-reconcile`

Current real-world coverage note:

- `tests/scripts/v2/04-baremetal-lifecycle.ts` currently covers:
  - machine create
  - ready/heartbeat
  - stop/start/reboot
  - snapshot create/restore/delete
  - image create/delete

This is the current deepest end-to-end runtime verification path.

## 15.1 Current verified status

Currently verified green:

- `pnpm e2e:v2:01:topology`
- `pnpm e2e:v2:02:placement`
- `pnpm e2e:v2:03:container`
- `pnpm e2e:v2:04:baremetal-lifecycle`
- `pnpm e2e:v2:05:procurement`
- `pnpm e2e:v2:07:host-bootstrap-validation`
- `pnpm e2e:v2:08:external-proxy-daemon`
- `pnpm e2e:v2:core`
- `pnpm e2e:v2:06:dashboard`
- `pnpm e2e:v2:09:ui-machines`
- `pnpm e2e:v2:10:ui-images`
- `pnpm e2e:v2:11:ui-billing`
- `pnpm e2e:v2:ui`
- `pnpm e2e:v2:all`

Important note:

- the container-only E2E now verifies real runtime behavior via HTTP service availability on a Docker image (`nginx:alpine`) plus snapshot/restore, rather than relying on the runner `/exec` path.
- this is a better end-to-end verification for generic Docker-image containers.

---

## 16. Definition of done

A feature is not done until:

- schema exists
- service logic exists
- failure handling exists
- audit/event recording exists
- automated tests exist
- curl-level verification exists if it changes API behavior

---

## 17. Living implementation checklist

## Phase 0 — lock architecture

- [ ] lock topology: `region -> cluster -> host -> instance`
- [ ] lock `cluster = one Incus cluster`
- [ ] lock `one cluster per region at launch`
- [ ] lock `machine` public / `instance` internal naming
- [ ] lock IncusOS host baseline

## Phase 1 — schema and boundaries

- [ ] add `regions`
- [ ] add `clusters`
- [ ] add `hosts`
- [ ] add `instances`
- [ ] add `images`
- [ ] add `snapshots`
- [ ] add `capacity_leases`
- [ ] add placement decision recording
- [ ] add `cluster_capacity_samples`
- [ ] add `host_heartbeats`
- [ ] add `host_orders`
- [ ] decide whether current `machines` table stays canonical or gets replaced

## Phase 2 — fleet foundation

- [ ] region CRUD
- [ ] cluster CRUD
- [ ] host order flow
- [ ] host registration flow
- [ ] IncusOS bootstrap flow
- [ ] first-node cluster bootstrap flow
- [ ] add-host-to-cluster flow
- [ ] host heartbeat ingestion
- [ ] host drift detection
- [ ] schedulable gating

## Phase 3 — capacity and placement

- [ ] cluster eligibility filtering
- [ ] host eligibility filtering
- [ ] reserve capacity before create
- [ ] commit/release lease correctly
- [ ] placement decision audit trail
- [ ] rejection path for unschedulable placement

## Phase 4 — core machine lifecycle

- [ ] create machine by region
- [ ] admin create by pinned cluster
- [ ] admin create by pinned host
- [ ] container create path
- [ ] VM create path
- [ ] image import path
- [ ] create from imported docker image
- [ ] start/stop/reboot/delete
- [ ] exec/console/file access
- [ ] snapshot create/list/restore/delete
- [ ] routing/proxy setup

## Phase 5 — later

- [ ] account_cluster_projects
- [ ] quota_tiers
- [ ] volumes
- [ ] backups
- [ ] restore
- [ ] resize

## Phase 6 — verification gate

- [ ] full curl E2E suite green
- [ ] failure-path E2E suite green
- [ ] host replacement / capacity recommendation E2E suite green

---

## 18. Final recommendation

If the goal is simple and scalable, the correct v2 base is:

- `region`
- `cluster`
- `host`
- `instance`
- `image`
- `snapshot`
- `capacity_lease`
- `cluster_capacity_samples`
- `host_orders`

Build topology first.
Build placement second.
Build machine + image + snapshot lifecycle third.
Add quotas and broader storage safety after the base is solid.
