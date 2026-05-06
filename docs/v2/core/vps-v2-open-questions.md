# JustAVPS V2 Open Questions and Alignment Plan

This document tracks the remaining decisions needed to make `docs/v2/core/vps-v2-requirements.md` fully correct and align it with the already-built `apps/v2-api` implementation.

## Current Implementation Signals

`apps/v2-api` already implements or partially implements a lot of the target shape:

- standalone V2 API service
- Prisma schemas split across `v2_core`, `v2_incus`, and `v2_ops`
- Incus clusters, members, instances, images observation cache
- machines, images, snapshots, backups, operations
- regions, hosts, procurements, node provisioning runs
- per-second usage sessions, cost ledger, revenue ledger
- utilization samples, scaling proposals, economics/P&L helpers
- admin endpoints for clusters, hosts, regions, procurement, orders, economics, forecast, proposals, drain/cordon/terminate
- `POST /machines` with `container | vm`, custom CPU/RAM/disk, image/snapshot/backup/empty sources
- Incus-native snapshots/backups/images
- exec/files/toolbox endpoints
- lifecycle sweeper with stopped-to-archive default of 7 days

The requirements doc is now directionally aligned, but the items below still need explicit decisions.

## Decisions Resolved in Latest Review

- Incus is the only production runtime for V2. A future non-Incus runtime can be a separate V3/API, not a V2 abstraction goal.
- `POST /machines` supports `source: image | snapshot | backup | empty`.
- Users select region; scheduler selects cluster/host. Cluster may be shown as read-only advanced/debug metadata but is not user-selected.
- Keep current V2 API field `type: container | vm`; document it as runtime type.
- V2 needs full account/auth/quota enforcement before production use.
- Default Incus project mapping: one JustAVPS account -> one Incus project per Incus cluster where that account has resources.
- Warm machine pools are separate from image pre-cache and can be a paid/reserved-capacity feature for faster create/start latency.
- Machine lifecycle must not depend on a JustAVPS guest daemon, but full managed-machine UX should use a small helper installed into platform images and managed BYOI derivatives where possible.

## Blocking Product/API Decisions

### 1. Runtime commitment vs provider flexibility — RESOLVED

Current V2 docs say: Incus permanently, no runtime swap. Requirements say: Incus-first with a small provider interface.

Decision:

- Incus is the only production runtime for V2.
- Keep a narrow internal driver boundary for mock/testing.
- Do not design V2 around multi-runtime abstraction.
- If a future non-Incus runtime exists, it can be a separate V3/API.

### 2. Machine create source — RESOLVED

We said machines are created from images and snapshots/backups are separate flows. Current code supports `source: image | snapshot | backup | empty` in `POST /machines`.

Decision:

- Keep current flexible source model: `image | snapshot | backup | empty`.
- Image is the normal/default source, but snapshot/backup/empty are valid create sources because they map cleanly to Incus and current V2 implementation.

### 3. Public response cluster details — RESOLVED

Requirements say users see region only; cluster/host is operator-only. Current schema exposes `cluster` in `Machine` responses.

Decision:

- Users choose region only; scheduler chooses cluster/host.
- Cluster/member can be exposed as read-only advanced/debug metadata, but not as a selectable user input.

### 4. `type` vs `runtime_type` — RESOLVED

Current API uses `type: container | vm`. Requirements say visible `runtime_type`.

Decision:

- Keep current API field `type: container | vm`.
- Document it as the machine runtime type.

### 5. Account/auth model integration

Requirements say full account/org system with configurable limits. Current V2 API mostly uses admin token and `x-account-id` headers.

Decision needed:

- Does V2 own auth/account tables itself, or integrate with existing JustAVPS account/session/API-key system?
- How does V2 receive active account/user identity in production?

Recommendation: V2 should integrate with the existing account system but own V2-specific limits/usage in V2 tables.

### 6. Quota enforcement model

Requirements define account quotas, but current schema does not clearly expose `AccountLimit` tables.

Decision needed:

- Add V2 account limit tables, or source limits from existing billing/account system.

Recommendation: add/own V2 limit records keyed by account ID; sync or seed from product/admin config.

### 7. Incus project mapping — RESOLVED

Decision:

- Keep `provider_namespace` in product model.
- Default Incus mapping is one JustAVPS account -> one Incus project per Incus cluster where that account has resources.
- Incus project is runtime isolation/organization; Product DB remains ownership/billing/audit truth.

## Image and Cache Decisions

### 8. BYOI supported sources

Current code supports Docker/OCI-ish pull, SimpleStreams, and publishing from machine/snapshot. Requirements say BYOI broadly.

Decision needed:

- Which sources are V2 initial scope?
  - Incus/SimpleStreams image
  - OCI/Docker image
  - publish from machine/snapshot
  - local upload/import
  - rootfs tarball
  - qcow2/raw VM image

Recommendation: document initial support exactly as current code: SimpleStreams, Docker/OCI where Incus supports it, publish from machine/snapshot. Mark raw upload/qcow2/rootfs as later unless implemented.

### 9. Image region vs cluster readiness

We decided images are user-visible by region. Current implementation has `region` and `cluster_id` knobs.

Decision needed:

- Region-ready means ready in at least one eligible cluster in the region, or all eligible clusters?

Current recommendation:

- Region-ready = available in at least one healthy eligible cluster.
- Scheduler only places into clusters where image is ready.
- Replicate to additional clusters by demand/policy.

### 10. Image prewarm semantics

Requirements say fast create requires pre-pulled/pre-cached images. Current API has `/images/{id}/prewarm`.

Decision needed:

- Does prewarm mean all members in one cluster, all clusters in region, or selected target members?

Recommendation:

- For a cluster, use Incus image replication and/or `cluster.images_minimal_replica = -1` when the policy requires all members.
- Public image status should distinguish `available` vs `prewarmed` if needed.

### 10b. Machine warm pool product semantics

Machine warm pools are separate from image pre-cache. They are a paid/reserved-capacity feature for faster machine create/start latency.

Decision needed:

- Is warm pool configured per account, per image/source, per runtime type, per resource shape, or all of the above?
- Does the warm pool keep machines stopped, running, or provider-specific pre-created states?
- How is warm pool capacity billed: full running compute, discounted reserved capacity, or a separate warm-pool fee?
- Who can enable it: user self-serve, admin-only, or account contract setting?

Recommendation:

- Model warm pools by exact pool key: account + region + cluster policy + source/image + runtime type + resources.
- Treat it as reserved capacity and bill it explicitly, even when unassigned.
- Start with admin/account-level configuration before exposing self-serve UI.

### 11. Guest helper / daemon requirement — RESOLVED

If users bring arbitrary images, they should not need to manually include `justavps-daemon`, but JustAVPS can create a managed derivative image with helper tooling installed/validated.

Decision:

- Incus remains lifecycle/runtime truth; guest helper never owns lifecycle, billing, scheduling, or ownership.
- Platform templates should include helper tooling by default for best V1-style developer/agent UX.
- BYOI import should try to install/validate helper tooling at image materialization time and publish/cache a managed derivative image.
- BYOI source images are not expected to already contain JustAVPS code.
- If helper installation is impossible, image should be limited/unsupported for full toolbox/proxy UX, or rejected depending product policy.

Still open under this resolved direction:

- exact implementation of file/PTY/process APIs: direct Incus APIs only vs a node-side helper bridge
- how much functionality is guaranteed for minimal/raw images with no shell or unusual userspace
- exact image import policy: reject unsupported BYOI images vs allow limited mode

Recommended implementation direction:

- Use Incus APIs as the primitive.
- Keep Cloudflare Worker / edge auth semantics from V1.
- Add a small trusted cluster/node access gateway where needed for streaming/local-network reliability and private Incus network reachability.
- Install/validate helper tooling in platform images and managed BYOI derivative images where possible.
- For VMs, rely on standard `incus-agent` where Incus requires it for exec/file/detailed metrics; document degraded support for BYOI VM images without the Incus agent.
- For full V1-style localhost proxy parity, use helper support in managed images plus node namespace techniques where possible.

## Lifecycle, Storage, Archive

### 12. Archive backend

Requirements say archive/offload to cheap storage. Current idle reaper models archive state but actual archive backend is not fully specified.

Decision needed:

- First archive backend: S3/R2, filesystem, Ceph, or Incus export storage?

Recommendation:

- Use S3/R2-compatible object storage first unless Incus-native backup export to local storage is already easier.

### 13. Archive-to-delete policy

Current idle reaper defaults to stopped → archive after 7 days, archived → delete after 30 days. Requirements only say stopped machines eventually archive.

Decision needed:

- Should archived machines ever auto-delete?
- If yes, is 30 days default correct and user-visible?

Recommendation:

- Keep auto-delete as policy-gated/admin-configurable; do not surprise-delete paid archived machines without explicit product policy and notifications.

### 14. Storage classes / volumes

Requirements say keep storage simple. V2 docs mention future multi-pool storage and volumes.

Decision needed:

- Are user-visible storage classes/volumes in initial V2, or later?

Recommendation:

- Initial: simple root disk only, grow-only.
- Later: attachable volumes and optional storage classes.

## Access and Networking Decisions

### 15. Proxy domains

Requirements use `kortix.cloud` examples but actual domains may change.

Decision needed:

- Final prod/dev proxy domains and namespace shape.

Recommendation:

- Keep domain configurable; require wildcard HTTPS and V1-equivalent URL shapes.

### 16. V2 proxy implementation path

V1 Worker/KV exists. V2 feature plan recommends reusing V1 KV with namespaced keys.

Decision needed:

- Reuse V1 Worker/KV with `v2:` prefixes, or deploy a separate V2 Worker/KV?

Recommendation:

- Reuse Worker/KV initially with namespaced keys, unless blast-radius concerns dominate.

### 17. SSH exposure

Requirements say SSH disabled by default and secure tunnel/proxy if enabled. V2 notes propose expiring SSH grants through Cloudflare Access SSH.

Decision needed:

- Is Cloudflare Access SSH the chosen implementation?

Recommendation:

- Yes, unless there is a simpler existing secure tunnel path.

### 18. Custom domains

Do users get custom domains mapped to machine ports in V2 initial scope?

Recommendation:

- Not initial; generated proxy domains first.

## Scheduling, Migration, Procurement

### 19. Procurement automation level

Current node-provisioning docs explicitly gate real Hetzner orders with operator confirmation.

Decision needed:

- recommendation-only, one-click operator-approved, or fully automatic procurement?

Recommendation:

- system recommends, operator approves. Never spend money automatically initially.

### 20. Host OS default

Node-provisioning docs currently default to Ubuntu+Incus until IncusOS path has repeated green runs.

Decision needed:

- Keep Ubuntu+Incus default now, or make IncusOS default target architecture in requirements?

Recommendation:

- Requirements should say target is Incus cluster member, not mandate host OS. Operational docs can track IncusOS migration.

### 21. User-facing migration

Requirements say migration/drain is operator/internal. Current provider may support migration.

Decision needed:

- Is `POST /machines/:id/migrate` user-facing, admin-only, or future?

Recommendation:

- Admin/operator-only for initial V2.

### 22. Overcommit policy

Containers can overcommit; VMs generally need stricter reservation.

Decision needed:

- Strict reserved capacity vs controlled overcommit for containers?

Recommendation:

- Start conservative; model overcommit as per-cluster policy later.

## Pricing and Billing Decisions

### 23. Final unit prices

Current code has default µEUR/sec values. Requirements say per-second billing but do not lock prices.

Decision needed:

- Final vCPU-second, RAM-GB-second, disk-GB-second, archive-GB-second rates.

Recommendation:

- Keep pricing code configurable and requirements non-numeric until launch.

### 24. Bandwidth/proxy billing

Requirements say bandwidth/proxy usage if charged.

Decision needed:

- Is bandwidth free/included initially, or metered?

Recommendation:

- Include initially; meter internally if easy, charge later.

## Best Alignment Process

1. Treat `docs/v2/core/vps-v2-requirements.md` as the target product truth.
2. Create an implementation matrix with columns: requirement, current V2 support, gap, decision needed, owner, priority.
3. Resolve the blocking API semantics first: machine source, cluster visibility, auth/account integration, image import sources, archive/delete policy.
4. Patch `apps/v2-api` docs to stop conflicting with the final requirements.
5. Patch `docs/v2/core/vps-v2-requirements.md` only when a decision is product-level, not just implementation detail.
6. Then implement gaps in slices: account/quota → images/prewarm → proxy tokens → archive backend → admin economics/procurement polish.
