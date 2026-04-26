# JustAVPS V2 API Philosophy

This folder is the clean JustAVPS V2 API.

The mission is to build a simple, reliable E2B/Daytona-style cloud by wrapping Incus as directly as possible. Complexity is the enemy. If Incus already owns a primitive, do not reinvent it.

## North Star

JustAVPS V2 is not a Hetzner VPS wrapper anymore.

V1 wrapped Hetzner cloud/VPS primitives. V2 wraps Incus primitives:

- clusters
- members
- instances
- images
- snapshots
- backups/exports
- operations
- networks/storage where needed

Our API exists to add product semantics around Incus:

- users
- ownership
- billing
- quotas
- product IDs
- inventory
- procurement
- scheduling policy
- audit
- routing
- toolbox authorization

Everything else should be Incus.

## Mental Model

```text
Hetzner Robot -> physical hosts
IncusOS       -> boring host/node OS
Incus cluster -> runtime platform
v2-api        -> product API and policy wrapper
Postgres      -> product state and Incus cache
daemon        -> per-machine toolbox
```

The clean path is:

```text
buy host -> boot IncusOS -> join Incus cluster -> sync Incus -> schedule machines -> expose toolbox
```

Not:

```text
buy host -> mutate Ubuntu forever -> custom runner orchestration -> fake cluster state -> hope it works
```

## Hard Rules

- `apps/v2-api` is a standalone deployable API.
- Do not import legacy app code from `src/server/*`, `src/shared/*`, old V1, or current-V2.
- Do not write legacy V1/current-V2 tables.
- Do not create fake runtime state in the DB.
- Do not schedule standalone hosts.
- Do not buy, delete, wipe, or reimage hosts without explicit user approval.
- Do not add compatibility layers unless there is a concrete deployed compatibility need.

## Source Of Truth

Incus owns runtime truth:

- cluster membership
- member online/offline state
- instance existence
- instance type: container or virtual-machine
- instance placement
- instance status
- image fingerprints and aliases
- snapshots
- backups/exports
- operation state

Postgres owns product truth:

- accounts and ownership
- product machine IDs
- billing/quotas
- requested resources
- capacity reservations
- idempotency keys
- audit/events/jobs
- backup retention policy
- product-facing catalog metadata
- public routing desired state

Hetzner Robot owns physical inventory/procurement truth:

- ordered servers
- server numbers
- server IPs
- product/SKU/datacenter
- order state before the host joins Incus

`justavps-daemon` owns per-machine user tooling:

- filesystem API
- bash/process API
- PTY terminal
- port proxying
- guest health/heartbeat

The daemon must not own placement, billing, cluster state, or lifecycle truth.

## Host Philosophy

IncusOS is the target host OS.

- New hosts should run IncusOS by default.
- Existing hosts should converge to IncusOS when reprovisioned.
- Ubuntu bootstrap is not the target architecture.
- Host behavior should be boring: boot IncusOS, join Incus cluster, expose Incus API, validate, done.
- A physical host is inventory, not capacity.
- A host becomes capacity only when Incus reports it as an online cluster member.

If a host is not an online Incus member, it is not schedulable.

## Incus-First Boundary

Wrap Incus directly for runtime primitives:

- list clusters/members
- list/create/delete instances
- start/stop/reboot instances
- inspect instance state
- list/publish/delete images
- create/list/restore/delete snapshots
- export/import backups
- observe operations

Do not build custom runtime abstractions when Incus has the primitive.

The correct V2 implementation should often look like:

```text
validate product request -> call Incus -> observe Incus -> persist product metadata
```

Not:

```text
invent internal runtime model -> call helper daemon -> infer state -> reconcile later
```

## Custom Logic Boundary

Custom logic is allowed only where Incus does not own the concern:

- auth and account ownership
- billing and quotas
- product IDs and slugs
- physical inventory and procurement
- cluster/member scheduling policy
- capacity reservations/idempotency
- audit/events/jobs
- backup retention policy
- public routing state
- per-machine toolbox authorization
- admin workflows

Before adding custom logic, ask: “Can Incus already do this?”

If yes, wrap Incus.

## Database Philosophy

Use Prisma for all Postgres access.

Do not add raw application SQL unless Prisma cannot reasonably express the operation.

Schemas:

- `v2_core`: product truth
- `v2_incus`: rebuildable Incus observation cache
- `v2_ops`: jobs, audit, operations, procurement

`v2_incus` is cache. It can be dropped and rebuilt from Incus.

`v2_core` is product truth. It must not be silently inferred from stale cache.

Keep public IDs as product IDs. Do not expose raw Incus names as the primary product identity unless deliberately chosen.

## API Philosophy

Keep the API small and explicit.

Machine creation is one route:

```text
POST /machines
```

Source belongs in the request body:

```json
{
  "region": "eu",
  "type": "container",
  "resources": {
    "vcpu": 2,
    "memory_gb": 4,
    "disk_gb": 80
  },
  "source": {
    "type": "image",
    "image_id": "ubuntu-24.04"
  }
}
```

Machine type maps directly to Incus instance type:

- `container` -> Incus container
- `vm` -> Incus virtual-machine

Do not create extra machine kinds unless Incus supports them or there is a concrete external provider requirement.

Prefer:

- fewer routes
- explicit request bodies
- clear product names
- direct Incus mapping

Avoid:

- hidden side effects
- fake schedulers
- duplicate state machines
- clever abstractions
- route explosion

## Implementation Style

- Keep code direct and readable.
- Prefer boring functions over frameworks inside the framework.
- Prefer thin clients over service layers that hide what is happening.
- Keep routes close to the primitive they expose.
- Keep the scheduler small and policy-driven.
- Add E2E shell tests for every core flow before UI work.
- Preserve this philosophy over local cleverness.

The best V2 code should feel obvious: product validation, Incus call, Prisma write, response.
