# JustAVPS V2 Incus cluster completion map - 2026-04-25

## Executive summary

Current truth:

- V2 has a real Incus-backed bare-metal runtime path: `api/v2 -> control-plane jobs -> capacity reservation -> runnerd -> Incus`.
- The live HEL1 Incus cluster is real: `justavps-hel1-1` and `justavps-hel1-2` both report online from `incus cluster list`.
- The third active EU host at `65.21.92.151` has healthy runnerd/Incus but is not part of an Incus cluster.
- The product/control-plane cluster model is not yet first-class. Clusters are derived from host metadata and region defaults, not persisted as durable cluster rows.
- Host bootstrap installs and initializes Incus, but it does not automate Incus cluster creation or member joining.
- The next critical milestone is not "make Incus work". Incus already works. The milestone is "make procurement/bootstrap automatically add a new host as an Incus cluster member and prove it with E2E."

## Verified live state

Commands run during this investigation:

```bash
pnpm v2:inventory
curl -fsS http://localhost:4100/api/health
curl -fsS http://135.181.129.188:7779/healthz
curl -fsS http://65.109.65.169:7779/healthz
curl -fsS http://65.21.92.151:7779/healthz
ssh -i ~/.ssh/justavps_host root@135.181.129.188 "incus cluster list --format json"
ssh -i ~/.ssh/justavps_host root@65.109.65.169 "incus cluster list --format json"
ssh -i ~/.ssh/justavps_host root@65.21.92.151 "incus cluster list --format json"
```

Live DB inventory:

- `v2_machines`: 50 total, 13 live, 37 soft-deleted.
- Live V2 machine modes: mostly `container`, one live `vm` still provisioning.
- `regions`: `eu` is open/sellable, `us` is closed/unsellable.
- `baremetal_hosts`: 4 total.
- Active schedulable hosts reported by health endpoint: 3.
- Pending validation hosts reported by health endpoint: 2.
- `host_capacity_reservations`: 46 total, with 11 committed, 33 released, 2 expired.
- `control_plane_jobs`: 136 succeeded, 13 running, 5 dead-lettered.

Live Incus cluster verification:

- `135.181.129.188` runner health: Incus `6.23`, 4 instances, 6 images, warm pool 2/2.
- `65.109.65.169` runner health: Incus `6.23`, 4 instances, 6 images, warm pool 0/0.
- `65.21.92.151` runner health: Incus `6.23`, 7 instances, 3 images, warm pool 0/0.
- Both hosts see the same Incus cluster members:
  - `justavps-hel1-1` online, database leader/database.
  - `justavps-hel1-2` online, database standby.
- `65.21.92.151` returns `Server isn't part of a cluster` for `incus cluster list`.

Live DB table presence check:

- Present: `baremetal_hosts`, `host_capacity_reservations`, `control_plane_jobs`.
- Not present in the connected DB: `cells`, `cell_capacity_snapshots`.
- Current source schema also does not define first-class `clusters` or `cells` tables.

## Current architecture map

### Interface plane

Primary files:

- `src/app/v2/admin/**`
- `src/shared/hooks/use-fleet.ts`
- `src/server/v2/routes/public/machines.ts`
- `src/server/v2/routes/admin/fleet.ts`

Current state:

- Public V2 machine APIs exist.
- Admin pages exist for overview, regions, clusters, hosts, machines, procurements, images, billing, audit, routing, and control-plane services.
- `/v2/admin/clusters` exists, but it renders derived cluster aggregates from host grouping.
- `/v2/admin/fleet` redirects to `/v2/admin/hosts`.

### Control plane

Primary files:

- `src/server/v2/services/machines.ts`
- `src/server/platform/control-plane/allocator.ts`
- `src/server/platform/control-plane/provisioner.ts`
- `src/server/v2/services/control-plane-jobs.ts`
- `src/server/platform/control-plane/runtime.ts`
- `src/server/platform/control-plane/fleet-auditor.ts`

Current flow:

1. `POST /api/v2/machines` validates quota, kill-switches, region, resources, image choice, and pricing.
2. DB transaction creates the V2 machine row.
3. Allocator reserves host capacity through `host_capacity_reservations`.
4. Machine row is bound to `baremetal_host_id`.
5. A durable `machine_create` job is enqueued.
6. Provisioner job calls the selected host's `runnerd` API.
7. On success, the reservation is committed and the machine becomes ready.
8. On terminal failure, the reservation is released and the machine is marked error.

This is the strongest part of the current V2 design.

### Scheduler and capacity plane

Primary files:

- `src/server/platform/baremetal/scheduler.ts`
- `src/server/platform/baremetal/reservations.ts`
- `src/server/platform/baremetal/host-maintenance.ts`
- `src/server/platform/baremetal/image-locality.ts`

Current state:

- Placement is host-level and region-filtered.
- It checks maintenance state, scheduler quarantine metadata, bootstrap drift, image locality, and resource fit.
- It uses row-level locking on `baremetal_hosts` before inserting a reservation.
- It is not cluster-aware yet beyond region grouping.

### Compute plane

Primary files:

- `apps/runnerd/src/index.ts`
- `src/server/platform/baremetal/runner-client.ts`
- `src/server/platform/providers/baremetal.ts`

Current state:

- `runnerd` is the host-local Incus adapter.
- It shells out to local Incus via `incus` CLI.
- It creates containers and VMs, manages warm pools, snapshots, images, exec, start/stop/reboot/delete, and exposes `/v1/state`.
- The control plane talks to `runnerd`, not to Incus directly.

This boundary is correct and should stay.

### Operations/bootstrap plane

Primary files:

- `scripts/deploy/bootstrap-baremetal-host.sh`
- `scripts/deploy/wait-and-bootstrap-baremetal-host.sh`
- `scripts/deploy/host-bootstrap/10-install-incus.sh`
- `scripts/deploy/host-bootstrap/20-configure-incus.sh`
- `scripts/deploy/host-bootstrap/25-seed-incus-baseline.sh`
- `scripts/deploy/host-bootstrap/30-install-runnerd.sh`
- `scripts/deploy/host-bootstrap/doctor.sh`

Current state:

- Host bootstrap installs Incus and runnerd.
- `20-configure-incus.sh` initializes standalone Incus with storage/network/profile preseed.
- It does not create or join an Incus cluster.
- Cluster member metadata is passed into runnerd env and registration metadata, but not used to perform `incus cluster add` or clustered `incus admin init --preseed`.

## Cluster model map

Current intended model:

```text
region -> cluster -> host -> machine
```

Current implemented model:

```text
region -> derived cluster grouping -> host -> machine
```

Where cluster data comes from today:

- `src/shared/lib/fleet-clusters.ts` derives default cluster identity.
- `src/server/v2/routes/admin/fleet.ts` groups hosts by derived cluster id.
- Host metadata can carry `metadata.cluster` or `metadata.bootstrap.cluster`, but live manually registered HEL1 hosts currently have neither.
- Missing cluster metadata defaults to `eu-1`, `Europe Cluster 1`, and `justavps-eu-1`.

Where actual Incus membership comes from today:

- The real HEL1 hosts are already clustered in Incus.
- This is verified externally by SSH and `incus cluster list`.
- The control plane does not ingest actual `incus cluster list` into a durable cluster/member model.

## Main gaps

### 1. No first-class clusters table

There is no durable `clusters` table in the current schema. This blocks:

- cluster admission separate from region admission,
- expected member list,
- seed member tracking,
- Incus API endpoint tracking,
- join-token workflow state,
- cluster health/quorum visibility,
- cluster-level capacity and reserve policy.

### 2. Host bootstrap does not join Incus clusters

Per Incus documentation, a bootstrap cluster preseed needs:

```yaml
config:
  core.https_address: <ip>:8443
cluster:
  server_name: <member-name>
  enabled: true
```

Additional members need a join-token preseed:

```yaml
cluster:
  enabled: true
  server_address: <new-member-ip>:8443
  cluster_token: <single-use-token-from-incus-cluster-add>
  member_config:
  - entity: storage-pool
    name: <pool>
    key: source
    value: <member-local-source>
```

Current `20-configure-incus.sh` does standalone `incus admin init --preseed` only.

### 3. Procurement stops before cluster join

Procurement can create/order/sync hosts, and scripts can manually bootstrap a host. There is no durable worker-owned state machine for:

```text
ordered -> reachable -> bootstrap_started -> incus_seeded_or_joined -> runnerd_registered -> validated -> active_schedulable
```

### 4. Cluster E2E verifies existing state, not expansion

`tests/scripts/v2/13-incus-cluster-membership.ts` verifies that known live hosts are in one Incus cluster and online. It does not prove a newly procured host is automatically joined.

### 5. Scheduler is not cluster-first yet

Placement is host-first inside a region. It should become:

```text
region eligibility -> cluster eligibility -> host eligibility -> capacity lease
```

The host-level lease is good and should remain the safety primitive, but cluster selection must become explicit.

### 6. Reconciliation is host-local

`reconcileBaremetalFleet()` asks each host runner for local state. In a clustered Incus world, this must become member-aware and eventually cluster-aware, otherwise evacuated/moved instances could be misclassified as missing from the original host.

### 7. Networking is host-bound

Public port allocation and routing are currently host-bound. This is fine for pinned local-storage workloads, but cluster evacuation or host replacement requires explicit routing ownership transfer.

### 8. Metadata shape drift

Live manually registered hosts store Incus UI info at `metadata.incus_ui`, while the fleet serializer reads `metadata.operator.incus_ui`. This can hide operator Incus UI state in the admin UI until normalized.

### 9. DB/schema drift around old `cells`

Some historical docs/migrations/tests reference `cells` and `cell_capacity_snapshots`, but the current source schema and connected DB do not expose those as active first-class tables. The current direction should be `clusters`, not new `cells` product language.

## Completion plan

### Phase 1 - Normalize current cluster truth

Goal: make the current live cluster state visible and canonical without changing provisioning behavior.

Tasks:

1. Add a first-class `clusters` table.
2. Add `cluster_id` and `incus_member_name` columns to `baremetal_hosts` instead of relying on metadata only.
3. Backfill `eu-1` / `justavps-eu-1` for current EU hosts.
4. Normalize Incus UI metadata into `metadata.operator.incus_ui` or explicit columns.
5. Add an admin endpoint to return cluster members, expected members, and observed members.
6. Add a cluster detail page or expand `/v2/admin/clusters` to show actual observed Incus member status.

Acceptance checks:

```bash
pnpm lint
pnpm e2e:v2:01:topology
pnpm e2e:v2:13:cluster-membership
```

### Phase 2 - Add Incus cluster observer

Goal: ingest real Incus cluster state into the control plane.

Tasks:

1. Add a runnerd endpoint such as `GET /v1/cluster` that returns `incus cluster list --format json`.
2. Extend `HttpBaremetalRunnerClient` with `getClusterState()`.
3. Store latest observed cluster/member state in cluster/host metadata or a `cluster_member_states` table.
4. Update fleet auditor to reconcile cluster membership separately from host instance inventory.
5. Mark host unschedulable if its expected Incus member is absent/offline.

Acceptance checks:

```bash
pnpm lint
pnpm e2e:v2:13:cluster-membership
```

### Phase 3 - Automate seed/join during bootstrap

Goal: a fresh host can either seed the first region cluster or join an existing one.

Tasks:

1. Add `cluster_bootstrap_state` or equivalent state fields for host bootstrap.
2. Teach bootstrap config to return cluster mode: `seed` or `join`.
3. For seed mode, render preseed with `cluster.enabled=true`, `cluster.server_name`, and `core.https_address=<host-ip>:8443`.
4. For join mode, generate join token on an existing online cluster member with `incus cluster add <new-member-name>`.
5. Pass the single-use join token to the new host bootstrap script.
6. Render join preseed with `cluster.enabled=true`, `server_address`, `cluster_token`, and member storage config.
7. After join, run `incus cluster list --format json` from multiple members and verify all expected members online.

Acceptance checks:

```bash
pnpm lint
pnpm e2e:v2:07:host-bootstrap-validation
pnpm e2e:v2:13:cluster-membership
```

### Phase 4 - Durable host bootstrap worker

Goal: remove the human-run polling/bootstrap loop from normal operations.

Tasks:

1. Add control-plane job type `host_bootstrap`.
2. Enqueue it when procurement sync promotes a server to `bootstrapping`.
3. Job stages should include SSH reachability, bootstrap files copied, Incus seeded/joined, runnerd started, registration posted, validation artifact posted, cluster membership verified.
4. Persist logs/stage/errors in DB metadata or a bootstrap job table.
5. Make retries idempotent and safe.
6. Keep manual `scripts/deploy/bootstrap-baremetal-host.sh` as an operator fallback.

Acceptance checks:

```bash
pnpm lint
pnpm e2e:v2:05:procurement
pnpm e2e:v2:07:host-bootstrap-validation
pnpm e2e:v2:13:cluster-membership
```

### Phase 5 - Cluster-first scheduler

Goal: scale beyond one derived cluster per region.

Tasks:

1. Add cluster eligibility filters: active, admission open, sellable, quorum healthy, under soft host cap.
2. Add cluster capacity rollups from host reservations and observed usage.
3. Pick cluster before host.
4. Keep the existing host-level reservation and row lock as the final oversell guard.
5. Add support for more than one cluster per region.
6. Add procurement recommendations per cluster, not only per region.

Acceptance checks:

```bash
pnpm lint
pnpm e2e:v2:01:topology
pnpm e2e:v2:02:placement
pnpm e2e:v2:05:procurement
```

### Phase 6 - Scale hardening

Goal: make large clustered regions operationally safe.

Tasks:

1. Add Incus production sysctl/limits tuning to host bootstrap.
2. Add per-cluster and per-host reconciliation sharding.
3. Add cluster quorum/leader/failure-domain dashboarding.
4. Add drain/evacuation semantics. For current local-ZFS/pinned workloads, default to `cluster.evacuate=stop` or controlled migrate only when storage/networking supports it.
5. Add durable off-host backups before relying on evacuation for recovery.
6. Add capacity reserve policies for burst, procurement lead time, and host failure budget.

Acceptance checks:

```bash
pnpm lint
pnpm e2e:v2:core
pnpm e2e:v2:13:cluster-membership
```

## Release gate for "clustered Incus nodes are complete"

Do not call this complete until all are true:

- A new host ordered through procurement is automatically bootstrapped.
- The new host automatically joins the target Incus cluster.
- Control plane stores first-class cluster and member state.
- Admin UI shows expected vs observed cluster membership.
- Scheduler selects `region -> cluster -> host`.
- Host capacity reservation remains transactional and prevents oversell.
- Cluster membership is verified from at least two members.
- A failed/offline Incus member blocks scheduling to that host.
- Routing continues to work for machines created after cluster join.
- The following suites are green:

```bash
pnpm e2e:v2:01:topology
pnpm e2e:v2:02:placement
pnpm e2e:v2:03:container
pnpm e2e:v2:05:procurement
pnpm e2e:v2:07:host-bootstrap-validation
pnpm e2e:v2:08:external-proxy-daemon
pnpm e2e:v2:13:cluster-membership
```

## Bottom line

The live Incus cluster exists and is healthy, but the platform does not yet own cluster formation or expansion. The fastest correct path is to keep the current runnerd/control-plane/job/reservation architecture, add first-class cluster state, then automate the missing Incus seed/join workflow inside durable host bootstrap jobs.
