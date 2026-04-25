# JustAVPS V2 Clean Rebuild Spec

## Goal

Rebuild V2 as a small, understandable Incus-native cloud API.

Keep current V2 running while building the clean implementation in parallel.

## Non-negotiables

- Incus is source of truth for runtime state.
- DB is source of truth for product intent, ownership, billing, idempotency, and audit.
- No schedulable standalone nodes.
- Every schedulable host must be an online Incus cluster member.
- User create input is only region, image, and resources.
- Cluster/host pinning is operator-only.
- Every core flow gets curl-level E2E before UI polish.
- Browser E2E is secondary.
- `justavps-daemon` is the per-machine user toolbox, not infrastructure truth.

## Runtime Truth Model

Incus owns:

- clusters
- cluster members
- instances
- images
- snapshots
- backups/exports where Incus can produce them
- actual instance placement
- runtime status

DB owns:

- users/accounts
- machine intent
- resource allocation intent
- billing shape
- capacity leases/idempotency
- audit/events
- desired routing state
- image catalog presentation
- backup retention policy

Runnerd, if kept, is only a thin host helper for things Incus does not own:

- bootstrap validation
- OS tuning
- proxy repair
- host-local diagnostics

`justavps-daemon` owns per-machine user control:

- public root proxy
- dynamic port proxy
- web terminal / PTY
- filesystem API
- process / bash API
- process list/kill API
- guest health and heartbeat

`justavps-daemon` must not own cluster, host, placement, billing, or machine lifecycle truth.

## Topology

```text
region -> incus cluster -> incus member/host -> machine/instance
```

Regions are product geography.

Clusters are real Incus clusters observed from Incus.

Hosts are Incus cluster members.

Machines are product records backed by Incus instances.

## API Surface

Build the clean API separately first, for example under:

```text
/api/v2-clean
```

Later, swap it into `/api/v2` once proven.

### Public API

```text
GET    /regions
GET    /images
GET    /images/:id
POST   /images
DELETE /images/:id
GET    /machines
POST   /machines
GET    /machines/:id
POST   /machines/:id/start
POST   /machines/:id/stop
POST   /machines/:id/reboot
POST   /machines/:id/exec
POST   /machines/:id/exec/stream
GET    /machines/:id/files
GET    /machines/:id/files/info
GET    /machines/:id/files/exists
GET    /machines/:id/files/download
POST   /machines/:id/files/upload
POST   /machines/:id/files/folder
DELETE /machines/:id/files
POST   /machines/:id/files/move
GET    /machines/:id/files/find
POST   /machines/:id/files/replace
POST   /machines/:id/files/permissions
GET    /machines/:id/processes
POST   /machines/:id/processes/kill
DELETE /machines/:id
GET    /machines/:id/snapshots
POST   /machines/:id/snapshots
POST   /machines/:id/snapshots/:snapshotId/restore
DELETE /machines/:id/snapshots/:snapshotId
GET    /machines/:id/backups
POST   /machines/:id/backups
GET    /machines/:id/backups/:backupId
POST   /machines/:id/backups/:backupId/restore
DELETE /machines/:id/backups/:backupId
```

### Admin API

```text
GET    /admin/clusters
GET    /admin/clusters/:id
POST   /admin/clusters/:id/sync
GET    /admin/clusters/:id/incus-ui
GET    /admin/hosts
GET    /admin/hosts/:id
GET    /admin/hosts/:id/incus-ui
POST   /admin/hosts/:id/quarantine
POST   /admin/hosts/:id/unquarantine
POST   /admin/hosts/:id/drain
POST   /admin/procurements
GET    /admin/procurements
POST   /admin/procurements/:id/approve
POST   /admin/procurements/:id/bootstrap
```

## Machine Create Flow

Input:

```json
{
  "region": "eu",
  "image": "ubuntu-24.04",
  "resources": {
    "vcpu": 2,
    "memory_gb": 4,
    "disk_gb": 80
  }
}
```

Flow:

1. Validate account, billing, limits, and request shape.
2. Query Incus-observed clusters for the region.
3. Reject clusters with bad quorum or no online members.
4. Resolve image availability.
5. Pick cluster.
6. Pick online member with enough observed/leased capacity.
7. Create DB machine intent and capacity lease transactionally.
8. Call Incus API to create instance on selected member.
9. Inject machine identity for `justavps-daemon` through cloud-init or image metadata.
10. Re-read Incus instance state.
11. Commit lease and mark machine provisioned only after observed Incus state matches intent.
12. Mark toolbox ready separately after daemon heartbeat/probe succeeds.
13. On failure, release lease and mark machine error with exact reason.

## Host Admission Rule

A host is schedulable only if all are true:

- Incus reports member online.
- Member belongs to the target cluster.
- Runner/helper health is ok or not required.
- Bootstrap validation passed.
- Host is not quarantined.
- Host is not draining or in maintenance.
- Capacity policy allows placement.

Standalone Incus servers are never schedulable.

## Cluster Sync

Cluster sync reads Incus and updates DB cache.

It must never invent members.

Sync records:

- cluster name
- member names
- member URLs
- member roles
- member status
- instance placement
- image fingerprints/aliases
- snapshot inventory
- backup inventory

DB cache can be stale, but never authoritative over Incus runtime state.

## Images, Snapshots, And Backups

The product should wrap the useful Incus image/snapshot/backup API instead of hiding it.

Product definitions:

- Image: reusable machine template a user can create machines from.
- Snapshot: point-in-time state attached to one machine.
- Backup: durable exported artifact used for recovery, migration, or retention.

Incus definitions remain the runtime source:

- Incus images back product images.
- Incus instance snapshots back product snapshots.
- Incus backups/exports back product backups where possible.

Public image flows:

- List catalog images.
- List owned custom images.
- Create image from machine.
- Create image from snapshot.
- Delete owned image.
- Create machine from catalog image through `POST /machines` with `source.type = image`.
- Create machine from owned image through `POST /machines` with `source.type = image`.

Public snapshot flows:

- List machine snapshots.
- Create snapshot.
- Restore machine to snapshot.
- Create new machine from snapshot through `POST /machines` with `source.type = snapshot`.
- Delete snapshot.

Public backup flows:

- List machine backups.
- Create backup/export.
- Restore backup to same machine if compatible.
- Create new machine from backup through `POST /machines` with `source.type = backup` if supported.
- Delete backup.

Implementation rules:

- Never pretend an image/snapshot exists until Incus confirms it.
- Store product metadata in DB, but store runtime fingerprint/name/source in Incus.
- Snapshot names must be deterministic and include product IDs.
- Image aliases must be product-controlled, not user-provided raw aliases.
- Cross-cluster create/restore needs explicit artifact copy/export/import.
- Backup retention is product policy in DB, enforced by scheduled jobs.
- Backups should be stored outside the source host when durability matters.

Minimum public API shape:

```text
GET    /images
GET    /images/:id
POST   /images                         create from machine or snapshot
DELETE /images/:id

GET    /machines/:id/snapshots
POST   /machines/:id/snapshots
POST   /machines/:id/snapshots/:id/restore
DELETE /machines/:id/snapshots/:id

GET    /machines/:id/backups
POST   /machines/:id/backups
GET    /machines/:id/backups/:id
POST   /machines/:id/backups/:id/restore
DELETE /machines/:id/backups/:id
```

Initial V2-clean can support only same-cluster restore/clone if needed, but the API must make cross-cluster limitations explicit.

Machine creation is always one route:

```text
POST /machines
```

Machine source is explicit in the request body:

```json
{
  "region": "eu",
  "resources": {
    "vcpu": 2,
    "memory_gb": 4,
    "disk_gb": 80
  },
  "source": {
    "type": "image",
    "image_id": "img_..."
  }
}
```

Valid source types:

- `image`
- `snapshot`
- `backup`
- `empty` if we ever support blank instances

## Per-Machine Toolbox

V1 already implements the desired user-control surface in `apps/daemon`.

Do not reimplement filesystem and bash control in the TypeScript API. The clean V2 API should expose a thin authenticated wrapper over the per-machine daemon toolbox.

Existing daemon capabilities:

- `GET /toolbox/files` lists files.
- `GET /toolbox/files/info` returns file metadata.
- `GET /toolbox/files/exists` checks existence.
- `GET /toolbox/files/download` streams file content.
- `POST /toolbox/files/upload` writes a file.
- `POST /toolbox/files/bulk-upload` writes multiple files.
- `POST /toolbox/files/bulk-download` returns a zip.
- `POST /toolbox/files/folder` creates directories.
- `DELETE /toolbox/files` deletes files/directories.
- `POST /toolbox/files/move` moves/renames.
- `GET /toolbox/files/find` searches text.
- `POST /toolbox/files/replace` replaces text.
- `POST /toolbox/files/permissions` chmod/chown.
- `POST /toolbox/process/execute` runs sync shell commands.
- `POST /toolbox/process/execute/stream` streams command output over SSE.
- `POST /toolbox/process/code-run` runs snippets.
- `GET /toolbox/process/list` lists processes.
- `POST /toolbox/process/kill` kills a process.
- `WS /_pty` exposes an interactive shell.
- `GET /_terminal` serves the terminal UI.
- `/_port/:port/*` proxies arbitrary local ports.

Clean V2 should keep this because it is product functionality, not infrastructure complexity.

The API wrapper should do all platform authorization and ownership checks before proxying.

Security rules:

- Do not expose unauthenticated toolbox endpoints directly to the internet.
- Prefer control-plane API proxying for `/machines/:id/*` toolbox routes.
- Sign every proxied toolbox request with a short-lived HMAC/JWT using the machine token.
- Make the daemon verify the signature for `/toolbox/*`, `/daemon/*`, and PTY upgrade requests.
- Keep direct origin access broker-only if possible.
- Treat filesystem/bash access as full machine control.

Incus can remain a fallback for lifecycle and emergency exec, but the user-facing filesystem/bash UX should use `justavps-daemon` once the toolbox is ready.

## Bootstrap / Scaling

Adding a host must become one durable flow:

```text
procure host -> SSH reachable -> install Incus -> join cluster -> enable Incus UI/admin access -> install helper -> validate -> sync cluster -> schedulable
```

Join flow:

1. Pick target region and cluster.
2. Ask existing cluster member for `incus cluster add <new-member-name>` token.
3. Bootstrap new host with join-token preseed.
4. Enable secure admin access to Incus UI/API.
5. Verify `incus cluster list` from at least two members.
6. Mark host active only after observed online membership.

## Admin Incus UI

Admins need direct operational visibility into Incus for every cluster/host.

Every bootstrap should configure secure admin access to Incus UI/API.

Requirements:

- Incus API/UI is not public to normal users.
- Admin access is authenticated and network restricted.
- The control panel records the admin UI URL for each cluster/host.
- `/admin/clusters/:id/incus-ui` returns or redirects to the cluster-level UI.
- `/admin/hosts/:id/incus-ui` returns or redirects to the member-level UI when useful.
- Bootstrap validates the UI/API is reachable from the admin path before the host becomes active.

Preferred access pattern:

```text
admin browser -> control panel admin route -> authenticated tunnel/proxy -> Incus UI/API
```

Avoid exposing raw Incus admin UI broadly on the internet. If direct exposure is needed temporarily, restrict by VPN, allowlist, or Cloudflare Access.

## E2E Strategy

Only keep tests that prove product invariants.

First suites:

```text
01-health-and-auth.sh
02-cluster-sync.sh
03-create-container.sh
04-lifecycle.sh
05-snapshots.sh
06-images.sh
07-backups.sh
08-placement-rejects-standalone-host.sh
09-host-joins-cluster.sh
10-admin-incus-ui.sh
11-proxy-and-exec.sh
12-toolbox-files.sh
13-toolbox-process.sh
14-toolbox-pty.sh
```

Each suite should be curl/API based, deterministic, and clean up after itself.

## Build Order

1. Write DB schema for clean intent/cache tables.
2. Implement Incus client.
3. Implement cluster sync from real Incus.
4. Implement read-only admin cluster/host APIs.
5. Implement machine create against real Incus cluster member.
6. Implement lifecycle through Incus.
7. Expose toolbox file/process APIs through authenticated daemon proxy.
8. Implement snapshots.
9. Implement images from machine/snapshot.
10. Implement backups/exports and retention jobs.
11. Implement host join automation.
12. Implement admin Incus UI access.
13. Build minimal UI on top.
14. Replace old V2 only after clean E2Es are green.

## Cutover Rule

Current V2 stays untouched until clean V2 can pass:

```bash
tests/scripts/v2-clean/01-health-and-auth.sh
tests/scripts/v2-clean/02-cluster-sync.sh
tests/scripts/v2-clean/03-create-container.sh
tests/scripts/v2-clean/04-lifecycle.sh
tests/scripts/v2-clean/05-snapshots.sh
tests/scripts/v2-clean/06-images.sh
tests/scripts/v2-clean/07-backups.sh
tests/scripts/v2-clean/08-placement-rejects-standalone-host.sh
tests/scripts/v2-clean/09-host-joins-cluster.sh
tests/scripts/v2-clean/10-admin-incus-ui.sh
tests/scripts/v2-clean/11-proxy-and-exec.sh
tests/scripts/v2-clean/12-toolbox-files.sh
tests/scripts/v2-clean/13-toolbox-process.sh
tests/scripts/v2-clean/14-toolbox-pty.sh
```

Then `/api/v2-clean` can replace `/api/v2`.
