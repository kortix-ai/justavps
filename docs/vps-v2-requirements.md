# JustAVPS V2 Requirements

## Goal

Define **JustAVPS V2**: an Incus-backed machine cloud for AI agent sandboxes, long-running agent/dev machines, and general AI infrastructure with a great web dashboard, optional secure SSH, browser access, images, snapshots, backups, regions, clusters, hosts, storage, and operator tooling.

This should be **Incus as the V2 production runtime**, because Incus already solves many hard runtime problems: instances, images, snapshots, storage pools, projects, clusters, migration, and lifecycle operations.

V2 should not spend effort designing a generic multi-runtime cloud. If a future non-Incus runtime exists, it can be a separate V3 API/product line. V2 should still keep a small internal driver boundary for mock/dev tests and clean Incus wrapping, but Incus is the only production runtime target.

## Product Principle

Users should manage only:

1. **Machines** — Incus-backed containers or VMs they can create, open in browser, optionally SSH into, stop/start/reboot, resize, snapshot, back up, and delete.
2. **Images** — platform templates, user-imported images, and snapshots promoted to reusable templates.
3. **Access** — SSH keys, API keys, proxy links, port exposure, firewall/security settings.

Everything else is platform-managed:

- regions
- clusters
- hosts/nodes
- storage pools
- image placement
- scheduling
- capacity
- migrations
- backups/archive
- health/repair
- billing events

## High-Level Architecture

```text
Web Dashboard + Public API
          ↓
JustAVPS Control Plane
Postgres: product intent, ownership, billing, audit
Provider interface: Incus production driver + mock/dev driver
          ↓
Regions
  └── Incus clusters
        └── hosts/nodes
              ├── instances/machines
              ├── local ZFS/NVMe image cache
              └── storage pools
          ↓
Node/control-plane access layer
Incus API + node-side proxy/exec/file/PTY bridge + optional secure SSH
```

## Source of Truth

### Product DB owns product truth

- users, teams, permissions
- machine ownership and desired configuration
- image catalog and visibility
- billing/usage/audit
- per-second metering records and invoice inputs
- idempotency keys
- desired proxy/access state
- backup retention policy

### Incus owns runtime truth for the Incus driver

- actual instances
- instance state
- cluster members
- runtime placement
- snapshots
- images/artifacts
- storage pools
- migration operations

### JustAVPS reconciles between them

The control plane stores user intent, calls the provider driver, observes runtime state back, and repairs drift where safe.

## Functional Requirements

### 0. Accounts, Users, and Quotas

JustAVPS V2 must have a normal account/organization model.

Requirements:

- an account can contain multiple users
- account owns machines, images, keys, billing, usage, limits, and audit history
- simple roles/permissions are enough initially: owner/admin/member/viewer or equivalent
- pricing is global/resource-based, not tied to predefined plans
- account limits are configurable per account rather than hard-coded pricing tiers
- initial limits are global per account, not per-region

Required account limits:

- max running vCPU
- max running RAM GB
- max total disk/storage GB
- max non-deleted machine count
- max snapshot/backup/archive GB where useful

Quota rules:

- CPU/RAM quota counts only active running compute
- stopped and archived machines do not count against running CPU/RAM quota
- storage quota counts machine disks, snapshots, backups, and archives
- machine count counts all non-deleted machines
- scheduler still checks real host/cluster capacity separately

### 1. Machines

Users must be able to:

- create machine from region + source + runtime type + custom CPU/RAM/disk
- see provisioning status
- open browser terminal
- enable/connect over secure SSH if SSH is explicitly enabled
- expose/proxy ports
- run commands through toolbox API
- upload/download/manage files
- start, stop, reboot
- resize CPU/RAM/disk where supported
- rebuild from image
- snapshot
- back up
- restore from snapshot/backup
- delete

Machine runtime type:

- every machine has a visible `runtime_type`: `container` or `vm`
- user chooses runtime type at creation
- default runtime type is `container`
- runtime type is fixed after creation; no in-place container-to-VM or VM-to-container conversion
- internal Incus term is instance, but product/API term is machine

Machine creation source:

- `POST /machines` supports source types: image, snapshot, backup, and empty
- image is the normal/default source
- snapshot/backup/empty sources are allowed because they map cleanly to Incus workflows and current V2 API shape
- snapshot and backup management still have their own routes for list/create/restore/delete

Machine resources:

- no fixed plans
- users configure vCPU, RAM GB, and disk GB directly
- product enforces machine-level min/max bounds
- account quotas and real cluster capacity are checked before placement
- disk is grow-only
- CPU/RAM resize follows Incus capability: live resize where Incus supports it, otherwise stopped/restart-required

Machine states should remain product-stable while preserving raw Incus state internally:

- public states include `creating`, `running`, `stopped`, `starting`, `stopping`, `rebooting`, `deleting`, `archived`, and `error`
- long operations expose operation details such as `snapshotting`, `backing_up`, `restoring`, `migrating`, or `archiving`
- raw Incus/provider state is stored separately for operators/debugging

Stopped and archived behavior:

- stopped machines keep machine ID, hostname/slug, proxy/access config, and disk state
- stopped machines stop compute billing but continue storage billing
- archived machines remain visible as machines, but their state is offloaded to cheaper archive storage
- archived machines keep machine ID, hostname/slug, and product configuration
- starting an archived machine requires restore/rehydration and may be slower
- auto-archive should eventually apply to every stopped machine to keep nodes/storage pools uncluttered
- default auto-archive target is roughly 7 days after stop/inactivity
- auto-archive timing should be configurable per machine, but permanent opt-out is not required initially

### 2. Images

Support:

- platform base images
- product templates like OpenCode/Kortix/devbox images
- user/private images
- bring-your-own image support using Incus-supported image formats/workflows wherever possible
- image import/materialization as a first-class asynchronous flow
- image created from machine snapshot
- image versioning by digest/fingerprint
- visibility: private, team, public/platform
- per-region availability status

Important: images must be content-addressed internally. Human names are aliases.

Image scope and readiness:

- images are region-scoped from the user perspective
- user creates/imports an image into one or more target regions
- an image can be `importing`, `available`, `failed`, or `deleting`
- Incus image fingerprint/digest is the runtime identity
- platform images/templates and BYOI images use the same product image model
- machines can be created from images, snapshots, backups, or empty sources; images remain the normal/default source and the primary reusable template object

Image replication/caching:

- machine creation should not pull/import an image for the first time on the critical path whenever avoidable
- in an Incus cluster, images should be pre-pulled/pre-cached/materialized onto eligible members so machine creation is fast
- Incus cluster image replication should be used where possible; `cluster.images_minimal_replica = -1` is appropriate when a cluster should replicate images to all members
- when a new node joins a cluster, it must catch up on required image artifacts before it is fully schedulable for images that require local readiness
- if a region has multiple clusters, initial V2 can treat an image as region-ready when it is available in at least one healthy eligible cluster; scheduler must then place only into clusters where that image is ready
- broader replication across all clusters in a region can be policy/demand-based later

### 3. Regions, Clusters, Hosts

Model:

```text
Region -> Cluster -> Host/Node -> Machine
```

Requirements:

- region is user-visible
- cluster is operator-visible and may be shown as read-only advanced/debug metadata, but users do not select it
- host/node is operator-visible
- users choose region, not cluster/host
- scheduler auto-selects the cluster inside the selected region
- operators can drain/quarantine hosts
- operators can disable/drain clusters/regions
- scheduler must never place onto unhealthy or draining hosts
- product accounts may map to Incus projects/provider namespaces, but this is an internal implementation detail and must not leak into the user API

Incus project mapping:

- V2 should support an internal `provider_namespace` mapping for each account and/or machine group
- for the Incus driver, that namespace should normally be an Incus project
- default Incus mapping is one JustAVPS account -> one Incus project per Incus cluster where that account has resources
- this mapping helps isolation, quotas, cleanup, and operator debugging
- the public API must not expose Incus project names as product identity
- Product DB remains the source of ownership, permissions, billing, and audit; Incus project is runtime isolation/organization only

### 4. Scheduling and Capacity

Machine placement must consider:

- requested region
- healthy cluster
- healthy host
- CPU/RAM/disk availability
- storage pool availability
- image locality
- tenant quota
- paid/reserved capacity
- host drain/quarantine status
- cluster maintenance status
- anti-abuse/noisy-neighbor constraints
- host utilization and margin impact
- capacity fragmentation
- procurement lead time and reserve capacity

The scheduler should prefer hosts that already have the requested image/artifact locally.

Scheduling must be economics-aware, not just first-fit:

- track utilization by host, cluster, region, runtime type, CPU, RAM, and storage
- target healthy utilization bands per region/cluster
- bin-pack where sensible to avoid unnecessary node purchases
- avoid overfilling hosts so migrations, maintenance, and burst capacity remain possible
- prefer placements that preserve high-value scarce resources
- expose scheduler reason codes for each placement or rejection

### 5. Economics, Utilization, and P&L

The platform must understand unit economics continuously.

Required views:

- revenue by account, region, runtime type, and resource dimension
- cost by host, cluster, region, storage backend, bandwidth, and provider
- gross margin/P&L by region and cluster
- host-level utilization and effective revenue per host
- idle capacity cost
- storage growth and archive savings
- image-cache storage overhead
- procurement recommendations based on demand and utilization

Required automation:

- alert when projected capacity runway is low
- alert when region/cluster margin drops below threshold
- identify underutilized hosts or clusters
- identify hotspots and capacity fragmentation
- recommend node procurement before capacity exhaustion
- recommend drain/consolidation when utilization is too low

### 6. Procurement and Node Lifecycle

Operators need one-click or guided procurement for new nodes.

Node lifecycle:

```text
requested -> approved -> ordered -> provisioned -> bootstrapping -> joined_cluster -> validating -> schedulable -> draining -> retired
```

Requirements:

- capacity system recommends new nodes when region/cluster runway is low
- operator can approve/procure new node from admin UI
- procurement flow records provider, SKU, datacenter, cost, expected capacity, and target cluster/region
- new nodes must bootstrap into the Incus cluster
- new nodes must pass validation before becoming schedulable
- required platform images/cache must be prepared before full schedulability where policy requires it
- failed procurement/bootstrap must be visible and retryable
- node removal/retirement must drain machines safely first

### 7. Migration, Draining, and Maintenance

Use Incus-native migration/stateful migration where supported.

Requirements:

- operators can drain a host for maintenance
- scheduler stops placing new machines on draining hosts
- existing machines should migrate within the same Incus cluster where supported and safe
- if stateful/live migration is unavailable for a runtime/config, fall back to stop/move/start or require manual action
- migration operations must be observable, auditable, and retryable
- cross-cluster and cross-region migration is not an initial requirement; restore/create-from-backup is the safer path

### 8. Storage

Need clear storage lifecycle:

- running machine volume
- stopped persistent volume
- snapshot
- backup
- archive/offload
- delete after retention

Incus/ZFS should be used where appropriate for cheap snapshots/clones. Durable backups/archive should be pluggable: filesystem, S3-compatible storage, Ceph, or another backend.

Never delete local state until remote backup/archive verification succeeds.

Storage UX should stay simple:

- users should not need to choose complex storage classes initially
- running/stopped machine disk is normal persistent storage
- archived storage is still billed per GB-second, likely at a cheaper archive rate
- archive/offload exists to keep active nodes/storage pools clean and reduce platform storage cost
- storage billing continues while any disk, snapshot, backup, or archive exists

### 9. Image Caching and Warm Capacity

Do not build one global warm pool.

There are two separate concerns:

1. **Image pre-cache / pre-pull** — making image artifacts available on Incus cluster members so a create operation does not pull/import on the critical path.
2. **Machine warm pool** — optional paid/reserved capacity where the platform keeps pre-created/pre-started unassigned machines for a specific source/runtime/resource/account shape to reduce create/start latency.

Caches/warm capacity must be keyed by:

```text
region + cluster/host + source/image_digest + runtime_type + resources + tenant_scope
```

Rules:

- hot platform images can be pre-cached broadly
- private images should be cached/warmed only based on demand or paid reservation
- first use of cold image may be slower
- repeated use should become faster through local cache
- unused image replicas should be garbage-collected safely
- capacity budgets prevent warming every image everywhere
- machine warm pools are separate from image caching and can be a paid feature for faster create/start latency
- machine warm pools must be scoped tightly enough that a machine from one account/source/runtime/resource shape is never assigned incorrectly

### 10. Networking and Access

V2 proxy/access requirements should match the current V1 behavior.

Every machine gets stable HTTPS proxy hostnames:

```text
https://{slug}.kortix.cloud
https://{port}--{slug}.kortix.cloud

https://{slug}.kortix-dev.cloud
https://{port}--{slug}.kortix-dev.cloud
```

Requirements:

- authenticated account users can access any internal machine port through the proxy without pre-creating a port rule
- default hostname proxies the machine default HTTP service
- `{port}--{slug}` proxies arbitrary ports from `1..65535`
- path-based fallback `https://{slug}.domain/_port/{port}/...` remains supported where useful
- normal HTTP and WebSocket upgrades work through the same authenticated proxy
- machine access never requires users to understand host IPs or cluster topology
- no unauthenticated public access exists by default

Default network posture:

- machines are private by default
- no direct public inbound ports are opened by default
- inbound HTTP/WebSocket access goes through the authenticated proxy/share-token system
- SSH is disabled by default and, if enabled, should use secure JustAVPS-controlled tunnel/proxy access
- outbound internet can be enabled by default for normal dev/agent workloads unless an account/machine policy restricts it
- east-west/private networking between machines should be explicit, account-scoped, and policy-controlled
- advanced direct networking/full VPS-style exposure can exist later, but must be explicit and firewall-controlled

VPS networking roadmap:

- **Initial default:** private machine networking + authenticated proxy for inbound access + outbound internet/NAT for normal dev and agent workloads
- **Account private networks:** account-scoped private networks/VPC-like segments so machines in the same account can talk privately when enabled
- **Firewall/security rules:** per-machine or per-network allow/deny rules for inbound and possibly egress policy
- **Direct public exposure:** optional advanced mode for public IPv4/IPv6 or routed ports, never enabled by default
- **Static/floating addresses:** future operator-managed public IP assignment where Incus/network provider supports it
- **Bandwidth/accounting:** measure network usage even if bandwidth is initially included

Implementation should use Incus networking primitives where possible: managed bridge/OVN networks, projects, ACLs/security rules, routed NICs, and host firewall integration. Do not build a custom SDN unless Incus cannot cover the required product behavior.

V1 implementation behavior to preserve:

- Cloudflare Worker handles auth at the edge
- Worker verifies API keys/proxy tokens/proxy JWTs from KV or signed cookies
- Worker resolves `{slug}` to machine routing metadata
- Worker forwards traffic to the machine access path and preserves HTTP/WebSocket behavior
- V1 reaches localhost-only services by sending port traffic through the machine-side `/_port/{port}` proxy; V2 must preserve equivalent UX even if implemented differently

Simplest V2 proxy architecture:

```text
Browser/API
  -> Cloudflare Worker / edge auth
  -> V2 machine access gateway inside the Incus network
  -> machine IP:port or optional guest helper for localhost-only ports
```

The edge layer should stay close to V1. The machine access gateway replaces ad hoc direct machine exposure and gives the Worker a stable private origin that can reach Incus networks/clusters.

Accepted proxy auth methods, matching V1:

1. `X-Proxy-Token: pt_xxx` — short-lived proxy token
2. `?__proxy_token=pt_xxx` — browser-friendly share URL; worker stores an HTTP-only proxy-token cookie and redirects to a clean URL
3. `__justavps_pt` cookie — proxy-token cookie from a previous share-link visit
4. `Authorization: Bearer sk_live_xxx` — API key with `proxy` or `*` permission
5. `?token=<jwt>` — JWT query token for websocket/iframe-style flows
6. `__justavps_proxy` cookie — logged-in dashboard/session proxy JWT

Proxy-token requirements:

- proxy tokens are machine-scoped
- proxy tokens can be port-scoped or all-ports
- proxy tokens always expire
- default proxy-token TTL is 1 hour
- maximum proxy-token TTL is 7 days
- proxy tokens can be revoked immediately
- full raw token is shown only once at creation
- share links are generated as `https://{port}--{slug}.domain?__proxy_token=pt_xxx` for port-scoped tokens, or `https://{slug}.domain?__proxy_token=pt_xxx` for all/default-port access

SSH is disabled by default. If enabled, it should use the secure JustAVPS access/proxy/tunnel system rather than exposing direct public port 22 by default.

### 11. Machine Interaction Runtime

Machine lifecycle must not depend on a JustAVPS guest daemon. Incus remains the runtime source of truth for create/start/stop/delete, snapshots, backups, images, migration, and state.

However, full JustAVPS developer/agent UX should be delivered by a small managed guest helper where needed.

The reliable API surface should be provided from outside the guest wherever possible:

- Incus API for lifecycle, exec, console/PTY where appropriate, file push/pull where appropriate, snapshots, backups, images, migration, and state
- node-side or control-plane-side bridge for browser terminal, file API, process/exec API, and toolbox features
- edge/node proxy routing for HTTP/WebSocket port access to the machine network
- optional secure SSH grants/tunnel if SSH is explicitly enabled

Requirements:

- platform templates should include the managed helper by default
- BYOI import should produce a JustAVPS-managed image artifact where the helper is installed or installable
- the original user image should remain conceptually source material; JustAVPS can publish/cache a derived managed image for machine creation
- helper install/validation should happen at image import/materialization time where possible, not on every machine create hot path
- if helper installation is impossible for a BYOI image, the image should be marked limited/unsupported for full toolbox/proxy UX, or rejected depending product policy
- machine lifecycle, billing, ownership, snapshots, backups, and basic Incus runtime operations must still be based on Incus, not the helper
- if a guest OS lacks shell/filesystem/network capabilities required for a specific operation, that operation can fail clearly, but the platform should not require an installed JustAVPS daemon to attempt it
- any node-side helper must be operator-controlled infrastructure, not tenant image state
- control-plane and node-side access tooling must not own platform truth like billing, scheduling, host health, or cluster lifecycle

Best-practice implementation shape:

- Control plane talks to Incus for product lifecycle operations and records product state/audit/billing in Postgres.
- Cloudflare Worker or equivalent edge layer owns public auth, proxy-token validation, API-key proxy validation, cookie cleanup/refresh, CORS, and websocket upgrades.
- A small trusted cluster/node access gateway should run on the Incus side to receive authenticated edge/control-plane traffic and reach private Incus machine networks.
- A small trusted node-side bridge may run on each Incus host/cluster edge to stream exec/file/PTY/proxy traffic reliably from the local Incus API and local machine network.
- The node-side bridge is stateless infrastructure glue: it does not own machine state, scheduling, billing, or lifecycle truth.
- Containers can usually support Incus exec/file operations directly through Incus without a guest agent.
- VMs need the standard `incus-agent` inside the guest for Incus exec/file/detailed metrics; official Incus VM images usually include it, while arbitrary BYOI VM images may have reduced toolbox support until they include/support the Incus agent.
- This is acceptable because `incus-agent` is an Incus VM compatibility primitive, not a JustAVPS product daemon.
- Direct node/edge routing to `machine_ip:port` only reaches services bound to the machine network interface. It does not reach services bound only to `127.0.0.1` inside the guest.
- V1-style “any localhost port” UX is important for dev servers and AI agent workflows.
- Platform images should preserve that UX by including or enabling a lightweight guest helper / port-forwarder.
- BYOI images should be converted into managed JustAVPS image artifacts with that helper where possible.
- BYOI images without that helper still work as raw Incus-backed machines only if product allows limited mode; arbitrary localhost-port proxying may require services to bind to `0.0.0.0` or the machine IP unless a node namespace technique works for that runtime.
- A JustAVPS guest helper is therefore part of the full managed-machine UX, but it is not the source of lifecycle truth.

### 12. Backups, Snapshots, Archive

Use regular Incus-native snapshot and backup semantics wherever Incus already provides the primitive. JustAVPS wraps these operations with product ownership, billing, audit, permissions, and UI/API shape; it should not invent different snapshot/backup behavior unless Incus lacks a required product capability.

Users need:

- manual snapshots
- scheduled backups
- restore from snapshot
- restore from backup
- promote snapshot to image
- retention settings by plan/policy
- list/delete snapshots
- list/delete backups

Operators need:

- backup status
- failed backup alerts
- storage usage by tenant
- restore verification
- archive/offload for inactive machines if product policy supports it

### 13. Billing and Metering

Billing must be **per second**, not hourly-rounded.

Metered dimensions:

- running vCPU seconds
- running RAM GB-seconds
- machine disk GB-seconds
- stopped machine storage seconds
- snapshot storage seconds
- backup/archive storage seconds
- bandwidth/proxy usage if charged
- reserved capacity seconds if offered

Requirements:

- every billable state transition emits an idempotent usage event
- usage records include tenant, machine, region, resource profile, start time, end time, duration seconds, and price version
- running compute billing starts only when a machine is actually provisioned/running, not when the request is submitted
- running compute billing stops when the machine reaches stopped/deleted/failed state
- CPU and RAM are billed only while the machine is running
- storage billing continues while persistent volumes, snapshots, backups, or archives exist
- stopped machines bill only storage
- archived machines bill only archive/storage
- pricing is based on CPU-second, RAM-GB-second, disk-GB-second, and archive/storage-GB-second; there are no fixed machine plans
- retries/reconciliation must not double-bill
- operators can inspect raw usage events and reconstructed billing intervals

### 14. Admin Dashboard

Admin/operator UI must show:

- regions
- clusters
- hosts/nodes
- host health
- capacity by region/cluster/host
- machine placement
- image replicas/caches
- storage usage
- utilization, margin, and capacity runway
- procurement recommendations and node lifecycle state
- failed operations
- migrations/drains
- backup/archive status
- audit/events

Operators must be able to:

- quarantine host
- drain host
- disable cluster/region
- approve/procure a recommended node
- validate/bootstrap a newly procured node
- trigger sync from Incus
- inspect failed machines
- retry safe operations

### 15. Observability

Track:

- machine create latency
- provisioning failure reasons
- start/stop/reboot latency
- image cache hit/miss rate
- backup/restore/archive duration and failures
- host capacity and pressure
- host/cluster/region utilization and margin
- capacity runway and procurement recommendation events
- migration/drain operation status
- cluster health
- proxy latency/error rate
- node/control-plane access bridge health
- guest operation failure rates for exec/file/PTY operations
- per-second billing usage events and reconciliation gaps
- reconciliation drift/errors

### 16. Security

Must cover:

- tenant isolation
- scoped SSH keys
- scoped API keys
- scoped proxy tokens
- private image access control
- no cross-tenant volume/image leakage
- audit log for lifecycle and access actions
- rate limits and abuse controls
- secure host admission
- secrets not baked into reusable images

## Internal Provider Interface

The product should define a narrow internal interface, with Incus as the only V2 production implementation and mock/dev support for tests.

Example capabilities:

```text
listRegions / listClusters / listHosts
createMachine
startMachine
stopMachine
rebootMachine
resizeMachine
deleteMachine
execMachine
createSnapshot
restoreSnapshot
createImageFromSnapshot
importImage
exportBackup
restoreBackup
migrateMachine
drainHost
getRuntimeState
```

The interface should expose capability flags where Incus capabilities differ by runtime/config. It should not become a broad generic cloud abstraction in V2.

## Public API Scope

Minimum user API:

```text
GET    /account
GET    /account/users
POST   /account/users
GET    /account/limits
GET    /account/usage
GET    /regions
GET    /images
POST   /images
GET    /machines
POST   /machines
GET    /machines/:id
POST   /machines/:id/start
POST   /machines/:id/stop
POST   /machines/:id/reboot
POST   /machines/:id/archive
POST   /machines/:id/resize
POST   /machines/:id/rebuild
POST   /machines/:id/exec
GET    /machines/:id/files
POST   /machines/:id/files
POST   /machines/:id/proxy-tokens
GET    /machines/:id/proxy-tokens
DELETE /machines/:id/proxy-tokens/:tokenId
GET    /machines/:id/snapshots
POST   /machines/:id/snapshots
POST   /machines/:id/snapshots/:snapshotId/restore
GET    /machines/:id/backups
POST   /machines/:id/backups
POST   /machines/:id/backups/:backupId/restore
DELETE /machines/:id
```

Minimum admin API:

```text
GET    /admin/regions
GET    /admin/clusters
POST   /admin/clusters/:id/sync
GET    /admin/hosts
POST   /admin/hosts/:id/quarantine
POST   /admin/hosts/:id/drain
GET    /admin/capacity
GET    /admin/economics
GET    /admin/procurements
POST   /admin/procurements
POST   /admin/procurements/:id/approve
POST   /admin/procurements/:id/bootstrap
GET    /admin/events
```

## Initial Build Scope

The implementation should deliver these product/runtime capabilities first. Later phases can deepen provider support, billing, and multi-region operations without changing the core model.

### Design Requirements

Cover:

1. Product model: machines/images/access.
2. Region/cluster/host model.
3. Incus-first runtime architecture.
4. Provider interface boundary.
5. Machine lifecycle and reconciliation.
6. Scheduling/capacity model.
7. Economics, utilization, and P&L model.
8. Procurement and node lifecycle model.
9. Migration/draining/maintenance model.
10. Image cache/warm strategy.
11. Storage/snapshot/backup/archive strategy.
12. Networking/proxy/access model.
13. Per-second billing/metering model.
14. Security, observability, and failure modes.

### First Implementation Slice

Implement one working vertical slice:

1. Core models: `Account`, `User`, `AccountLimit`, `UsageEvent`, `Region`, `Cluster`, `Host`, `Image`, `Machine`, `Snapshot`, `Backup`.
2. `POST /machines` accepting region, source, runtime type, and custom CPU/RAM/disk.
3. Scheduler chooses a healthy host with capacity in the requested region.
4. Provider driver interface with Incus as the primary driver and mock/dev support for tests.
5. Machine lifecycle: `pending -> provisioning -> running -> stopped -> archived -> deleted` plus error/recovery states.
6. Image cache decision result: `warm_hit`, `local_cache_hit`, `remote_cache_hit`, `cold_import`.
7. Per-second usage event model for machine state transitions.
8. V1-matching proxy behavior: slug hostnames, arbitrary authenticated port proxy, proxy-token share links, API-key proxy auth, websocket support.
9. Admin API for clusters/hosts/capacity/economics/procurement.
10. Tests for scheduling, quotas, node drain, image cache isolation, lifecycle transitions, no duplicate billing events, and proxy-token access rules.

This slice should be production-shaped even if some advanced operations start behind capability flags.

## Acceptance Criteria

- Users create machines by choosing region, source, runtime type, and custom CPU/RAM/disk.
- Users choose `container` or `vm`, with `container` as the default.
- Machines use custom CPU/RAM/disk resources, not fixed plans.
- Users do not choose cluster or host.
- Account quotas cover running CPU/RAM, total storage, and machine count.
- Admins can inspect regions, clusters, hosts, capacity, and placement.
- Admins can inspect utilization, margin/P&L, capacity runway, and procurement recommendations.
- Scheduler avoids unhealthy/draining hosts.
- Draining/migration uses Incus-native operations where supported and is observable.
- Machine lifecycle is reconciled and observable.
- Image cache/warm logic is image-keyed, not global.
- Billing is modeled as per-second metering with idempotent usage events.
- Running machines bill CPU/RAM/storage; stopped or archived machines bill storage only.
- Proxy/access semantics match V1: authenticated users can proxy any port, public/share access requires expiring proxy tokens, and API keys require `proxy` permission.
- Storage model supports snapshots, backups, archive, and restore.
- Incus responsibilities are clearly separated from product control-plane responsibilities.
- Provider interface is flexible without becoming generic nonsense.
- Tests prove core scheduling and lifecycle behavior.

## Non-Goals for V2 Initial Scope

- Full production Incus cluster deployment.
- Full invoicing/payment implementation beyond per-second metering events.
- Perfect dashboard polish.
- Real multi-region replication.
- Full Ceph/S3 archive implementation.
- Migration of all existing JustAVPS code.

## Guardrails

- Do not build only a thin Hetzner wrapper.
- Do not expose clusters/hosts to normal users.
- Do not treat Postgres as runtime truth while ignoring Incus state.
- Do not ignore storage pressure or backup verification.
- Do not keep one global image/warm cache.
- Do not ship without an admin/operator model.
