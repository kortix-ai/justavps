# PRD — Incus V2 API + FE Implementation

## Title

JustAVPS V2 — Persistent Agent Compute on Incus + Hetzner Dedicated

## Problem

The current product and codebase are still structurally shaped around a Hetzner Cloud VPS provisioning model. That leaks the wrong concepts into the public surface:

- provider-oriented server types
- cloud-provider assumptions around backups/resize/lifecycle
- no clean distinction between customer product layer and internal substrate layer

At the same time, the business and product direction has shifted:

- own bare-metal-backed provider
- persistent 24/7 agent computers
- Incus VM substrate
- fleet scaling via Hetzner Robot
- future support for both flat monthly and metered usage pricing

We need a real V2 that is designed from first principles around the actual product.

## Product thesis

JustAVPS is:

- **persistent agent infrastructure**
- **fast-start always-on compute**
- **the missing middle between raw VPS and burst sandboxes**

This V2 should make that thesis explicit in the API, FE, billing model, and fleet abstractions.

## Goals

1. Deliver a clean V2 customer API centered on:
   - plans
   - regions
   - machines
   - images / snapshots
   - billing state
2. Fully separate internal fleet concerns from customer API concerns
3. Make Hetzner dedicated + Incus VM provisioning a first-class production substrate
4. Make the system scale cleanly as more bare-metal nodes are added
5. Support both current flat monthly pricing and future metered billing design
6. Make FE flows match the new model end-to-end

## Non-goals for initial V2 cut

- Firecracker memory snapshot platform
- multi-provider parity from day one
- live migration
- distributed storage / Ceph
- GPU orchestration in initial release
- public exposure of Incus or runner internals

## User personas

### 1. Persistent agent power user
Wants an always-on machine that behaves like a long-lived remote computer.

### 2. Startup/team operator
Wants predictable monthly cost, snapshots, resize, backups, and simple agent-native workflows.

### 3. Admin / infra operator
Wants controlled fleet growth, host lifecycle visibility, and procurement approval.

## Product model

### Customer-facing primitives
- **Plan** — abstract product tier (`starter`, `basic`, `pro`, `power`, `ultra`)
- **Region** — public geographic choice (`hel1`, `fsn1`, `nbg1`, later more)
- **Machine** — persistent customer computer
- **Image** — reusable machine template / snapshot derived from a machine
- **Snapshot** — point-in-time state save/restore artifact
- **Billing mode** — flat or metered (future-selectable)

### Internal primitives
- **Fleet host** — one dedicated bare-metal machine
- **Runner** — host-local orchestration endpoint (`runnerd`)
- **Procurement** — order / approval / sync record for buying a host
- **Placement** — decision mapping a machine to a fleet host
- **Warm pool slot** — pre-created but unassigned machine capacity (future)

## API design requirements

## Public V2 API

Required namespaces:

### `/api/v2/catalog/*`
- list public plans
- list public regions
- future pricing/billing explanations

### `/api/v2/machines/*`
- create machine from `{ plan, region, image?, billing_mode? }`
- get machine
- list machines
- start / stop / reboot
- resize
- destroy
- get connection details / URLs / SSH instructions

### `/api/v2/images/*`
- list images
- create image from machine
- delete image

### `/api/v2/snapshots/*`
- list snapshots
- create snapshot
- restore snapshot
- delete snapshot

### `/api/v2/billing/*`
- show active billing mode
- usage counters
- plan cap behavior for hybrid metered mode

## Internal/admin V2 API

### `/api/v2/admin/fleet/*`
- list products from providers (internal only)
- list procurements
- create procurement request
- approve procurement
- sync procurement
- list hosts
- fetch bootstrap config
- register bootstrapped host
- future: drain/disable host, mark maintenance, show per-host allocation

## Critical API rule

The public API must not expose:

- `provider=baremetal`
- host classes
- runner URLs
- procurement/order identifiers
- vendor-specific server SKUs

The product chooses substrate internally.

## FE requirements

## Customer FE

### New V2 machine creation flow
User chooses:
- region
- plan
- base image
- billing mode (initially flat monthly only is acceptable)

User should **not** choose substrate/provider.

### Machine detail page
Must show:
- machine status
- plan
- region
- billing state
- machine URLs / SSH / agent runtime details
- image/snapshot actions
- lifecycle actions

### Resize flow
User selects a new plan. The FE should show:
- current plan
- new plan
- billing impact
- downtime expectations if any

### Image/snapshot management
Users can:
- save current machine as image
- view images
- create/restore snapshots

### Billing UI
Need eventual support for:
- flat monthly tiers
- metered usage breakdown
- cap-at-monthly messaging
- storage vs compute explanation

## Admin FE

### Fleet dashboard
Must show:
- host inventory
- capacity totals and remaining headroom
- procurement requests
- host statuses (`ordering`, `bootstrapping`, `active`, `draining`, `disabled`, `error`)
- runner registration state

### Procurement approval flow
Admin can:
- view recommended host purchase
- approve order
- watch order transition into bootstrapping

### Host detail page
Show:
- provider server number
- region/location
- public IP
- capacity totals / used
- runner URL
- last heartbeat
- metadata/bootstrap status

## Infra / orchestration requirements

## Host bootstrap
- bootstrap from Hetzner dedicated order result
- SSH via bootstrap key
- install Incus, qemu, node/npm, runnerd dependencies
- initialize Incus storage + networking
- register runner to control plane
- expose capacity and readiness back to JustAVPS

## Storage

### Phase 1 (already proven)
- `dir` storage acceptable for real validation

### Phase 2 (required before production)
- ZFS-first bootstrap on clean host layout
- image/snapshot workflows validated on ZFS
- documented backup/export path

## Placement and scaling

### Initial model
- one machine pinned to one host
- no live migration
- no distributed storage
- scheduling based on free CPU/RAM/disk + host class policy

### Scaling expectations
- scale horizontally by adding more hosts
- keep enough spare capacity for user creates and warm-pool replenishment
- host procurement is slower than VM placement, so capacity planning must be conservative

## Billing model requirements

## Phase 1
- keep flat monthly tiers working cleanly
- stopped/offline machines still bill flat monthly in this mode

## Phase 2
- add hybrid metered model:
  - storage billed continuously
  - CPU billed only while running
  - RAM billed while running, or while paused if pause is treated as RAM-reserved
  - optional cap at monthly plan equivalent

### Billing truth sources
- machine state from Incus / runner
- storage usage from host/Incus/ZFS dataset measurements
- usage aggregation in app DB

## Success criteria

1. User can create a machine in V2 without selecting provider
2. Placement chooses an active bare-metal host automatically when eligible
3. Machine create returns a working machine with connection details
4. Image and snapshot flows work through V2 API and FE
5. Admin can buy, bootstrap, register, and monitor hosts
6. Additional hosts can be added without architecture changes
7. Public API remains substrate-agnostic

## Risks

1. **Runnerd create complexity** — proved solvable, but still needs cleanup/hardening
2. **Storage productionization** — current host is not yet ZFS-first
3. **Billing complexity** — metered mode must be introduced carefully
4. **Resize semantics** — Incus resize behavior must be mapped cleanly into product expectations
5. **Image portability** — cross-host image workflows need more polish and explicit strategy
6. **Pinned-node failure domain** — acceptable initially, but still requires strong recovery UX

## Phased execution plan

### Stream A — Core V2 domain and API
- build `/api/v2/machines`, `/images`, `/snapshots`, `/billing`
- move machine service logic out of V1 assumptions

### Stream B — Fleet hardening
- productionize runnerd create path
- add host heartbeat + capacity updates
- add ZFS-first bootstrap path

### Stream C — FE V2
- new plan/region/machine creation flow
- machine detail pages
- admin fleet dashboard

### Stream D — Billing V2
- preserve flat monthly
- lay metered primitives and usage capture

## Recommendation

Use **`/autowork-team`** for execution.

This should be split into at least four bounded workstreams:
- API/domain
- runner/fleet infra
- FE/admin UI
- billing/usage model
