# Machine Templates Refactor Spec

## Problem statement

JustAVPS V2 currently has three partially-overlapping concepts: Incus images, a curated `/templates` catalog, and Pool policies keyed directly by image alias + resource shape. Machine creation still accepts image/snapshot/backup sources directly, so the critical invariant “new machines boot from a prepared JustAVPS-ready artifact” is enforced only opportunistically. This makes the admin UX confusing and creates slow paths where user-facing creates perform source preparation work that should have happened before the user clicked **Create**.

We need one product primitive: **Machine Template**. A Machine Template is a prepared, second-boot-verified Incus image plus product metadata: default initial machine size, measured storage footprint, readiness status, and Pool configuration. New machines are created only from Machine Templates.

## Current status quo from code investigation

### Backend

- `POST /machines` accepts `source: image | snapshot | backup` and explicit `resources`.
- `POST /images` already prepares derived images from Docker/OCI, simplestreams, machine, and snapshot paths by calling `prepareAndPublishJustavpsImage()`.
- `prepareAndPublishJustavpsImage()` boots a temp instance, ensures the daemon, bakes daemon binary/unit, validates second boot, and publishes a final image with properties:
  - `justavps.daemon_baked=true`
  - `justavps.daemon_first_boot_verified=true`
  - `justavps.daemon_second_boot_verified=true`
  - `justavps.daemon_bake_strategy=temporary-instance-second-boot-validation`
- `/templates` is currently a static curated catalog from `src/templates/catalog.ts`; it is not the DB-owned product primitive.
- Prisma has `Image`, `WarmPoolPolicy`, and `Machine`; no first-class `MachineTemplate` table yet.
- Pool policies are stored in `WarmPoolPolicy` and keyed by `accountId + region + type + sourceType + sourceId + resources + mode`.
- Pools already support two modes:
  - stopped: cheap storage-only standby, starts on claim, currently ~2.8–5.1s depending resize.
  - running: hot/live standby, currently ~575ms measured because it still verifies live state; future route assignment can reduce perceived assignment toward sub-100ms.
- Storage cost for Pool rows is already exact/measured via Incus storage volume state, not disk quota.
- New fast-path code recognizes prepared images by Incus properties and avoids cloud-init/full install on machine create.

### Admin Web

- `/images` page presents “Images” but partially behaves like Templates.
- `/machines` create dialog lets admins choose direct source type: image, snapshot, backup.
- `/pools` page creates Pool policy independently from a source image and resource shape.
- The UX forces the operator to mentally align image alias, size, and Pool policy instead of configuring all of that on the Template.

## Target product model

### Core invariant

Every user-facing Machine Template must be:

1. A real Incus image/alias in the cluster.
2. Created through the JustAVPS preparation pipeline.
3. Marked ready only after:
   - temp boot succeeds,
   - cloud-init/guest init is finished during prep when present,
   - JustAVPS daemon/tooling is installed or baked,
   - machine-scoped tokens/config are removed before publish,
   - second boot passes actual-live checks,
   - measured storage footprint is recorded.
4. Associated with one fixed **default initial size**: `{ vcpu, memory_gb, disk_gb }`.
5. Optionally associated with one Pool config for that default size.

### Definitions

| Term | Meaning |
| --- | --- |
| Machine Template | Product object used to create Machines. Owns prepared image alias/fingerprint, default size, readiness, cost metadata, and Pool config. |
| Source artifact | Raw source used to make a Template: external image, existing Machine, Snapshot, or Backup. Never used directly by new Machine create. |
| Template image | The final prepared Incus image published by the preparation pipeline. |
| Pool config | Per-template standby policy for the Template's default initial size. |
| Stopped Pool | Primed and verified slot stopped after second boot. Billed measured local disk only. |
| Running Pool | Primed and kept running. Billed measured local disk + hot CPU/RAM. Claimed with live takeover. |

## Goals

1. **Create source clarity**: 100% of new Machines are created with `template_id`; direct `image/snapshot/backup` machine sources are removed from Admin Web and rejected by new API schema.
2. **Ready-to-boot guarantee**: 100% of active Templates have `justavps.daemon_baked=true` and `justavps.daemon_second_boot_verified=true` before they can be selected.
3. **Fast create path**: default Template + stopped Pool claims stay under 5s actual-live; running Pool claims stay under 1s, with a design path to sub-100ms assignment after route prebinding.
4. **Cost transparency**: Template and Pool cards show measured storage footprint, stopped Pool storage-only monthly cost, and running Pool hot-resource monthly cost.
5. **Operational simplicity**: Pool config is managed from the Template page, not as a detached image/shape policy the operator has to reconcile manually.

## Non-goals for this refactor

- Re-enable VMs. The system remains container-only.
- Build a customer self-service marketplace. This is admin/operator UX first.
- Implement cross-cluster template replication in this pass. The model should support it, but v1 can bind Template to one cluster/region.
- Replace Incus image primitives internally. Incus remains the runtime source of truth for actual images/fingerprints.
- Promise sub-100ms stopped Pool claims. Stopped Pool must start a container and verify actual-live, so it is a seconds-class path.

## Backend design

### Data model

Add `MachineTemplate` in `v2_core`.

Fields:

- `id`: stable product id, e.g. `tpl_...` or cuid.
- `accountId`: owner; `system` for catalog/default Templates.
- `name`: display name.
- `slug`: unique per account; good for URLs and external IDs.
- `status`: `preparing | active | failed | archived | deleted`.
- `visibility`: `catalog | private`.
- `region`: scheduling region.
- `type`: currently `container` only.
- `incusClusterId`, `incusProject`, `incusAlias`, `incusFingerprint`.
- `defaultResources`: JSON `{ vcpu, memory_gb, disk_gb }`.
- `sourceKind`: `image | machine | snapshot | backup | simplestreams | docker`.
- `sourceRef`: human/audit string.
- `preparedAt`, `verifiedAt`.
- `measuredBytes`, `billableGib`, `storageEurMonth`.
- `metadata`: preparation trace, daemon version, source details, warnings, cost estimate details.
- timestamps.

Indexes:

- unique `(accountId, slug)`.
- unique `(incusClusterId, incusProject, incusAlias)`.
- index `(accountId, status, visibility)`.
- index `(region, type, status)`.

Transition policy:

- Existing `Image` rows become implementation detail / migration source.
- Existing `WarmPoolPolicy.sourceId` should point at the template image alias initially for minimal runtime change, but API/UI should expose it as `template_id`.
- Add `template_id` into `WarmPoolPolicy.metadata` or a nullable column in a follow-up migration if we want strict DB relation. P0 can map policy ↔ template by alias + account + resources.

### API model

#### Machine Templates

New routes:

- `GET /machine-templates`
  - returns active/preparing Templates visible to `X-Account-Id` plus catalog Templates.
  - includes readiness, default size, image metadata, measured storage, pool summary.
- `GET /machine-templates/:id`
- `POST /machine-templates`
  - creates Template from one source:
    - `{ source: { type: 'simplestreams', ref, server? } }`
    - `{ source: { type: 'docker', ref, server? } }`
    - `{ source: { type: 'machine', machine_id } }`
    - `{ source: { type: 'snapshot', machine_id, snapshot_id } }`
    - `{ source: { type: 'backup', machine_id, backup_id } }`
  - requires `default_resources`.
  - runs the same preparation/bake/second-boot verification pipeline.
  - returns only when Template is `active` for now; background operations can come later.
- `PATCH /machine-templates/:id`
  - editable: name, status archive/delete, visibility, default_resources only when no active Pool rows or after draining.
- `DELETE /machine-templates/:id`
  - soft-deletes product row and optionally deletes Incus image if safe/no dependents.

Compatibility aliases:

- Keep `/templates` as an alias to `GET /machine-templates` during transition.
- Keep `/images` for low-level Incus cache/debug if needed, but remove it from primary Admin Web nav/copy.

#### Machine create

New request:

```json
{
  "name": "staging api",
  "region": "eu",
  "type": "container",
  "template_id": "tpl_ubuntu_24_04_2c_2g_10g",
  "resources": { "vcpu": 4, "memory_gb": 8, "disk_gb": 20 },
  "lifecycle": {},
  "labels": {},
  "env": {}
}
```

Rules:

- `template_id` is required.
- `resources` optional; default is Template `defaultResources`.
- If `resources` equals default, claim exact Pool rows.
- If `resources` differs, either:
  - claim flexible same-template Pool row and resize before start/takeover, or
  - cold create from prepared Template and apply requested resources.
- Direct `source` payloads should be rejected with a clear message: “Create a Machine Template from that source first, then create a Machine from the Template.”
- Persist machine `sourceType='template'`, `sourceId=template.id` and metadata with `template_id`, `template_image_alias`, `template_default_resources`, `requested_resources`.

#### Pool config per Template

Expose template-centric routes while reusing WarmPoolPolicy internally:

- `GET /machine-templates/:id/pool`
- `PUT /machine-templates/:id/pool`
  - body: `{ target, mode: 'stopped' | 'running', status?: 'active' | 'paused' }`
  - resources are implicit from Template default size.
  - source is implicit from Template image alias.
- `POST /machine-templates/:id/pool/refill`
- `DELETE /machine-templates/:id/pool`

Policy key:

- account + region + type + template image alias + Template default size + mode.

Changing Template default size:

- If Pool target > 0 or ready rows exist, require explicit drain/recreate.
- P0 UX can disable editing default size while Pool exists and instruct delete/recreate Pool config first.

### Cost model

Template card shows:

- Prepared image size from Incus image `size` when available.
- Exact measured rootfs size from prep/temp/Pool measurement when available.
- Default initial disk cap.
- Estimated monthly storage if one stopped Pool slot is maintained.

Stopped Pool estimate:

- `sum(measured_billable_gib_per_slot) * local_storage_rate`.
- CPU/RAM = `0` until claimed.

Running Pool estimate:

- stopped storage estimate plus `target * (vcpu_hot_rate * vcpu + ram_hot_rate * memory_gb)`.
- Show warning: hot Pool bills like running capacity and can get expensive.

Machine runtime estimate:

- Uses actual assigned `resources`, not Template default after resize.

## Admin Web UX

### Navigation

- Rename **Images** → **Templates**.
- Hide/remove detached “New container from image/snapshot/backup” flow.
- Keep **Pools** page as optional fleet-wide overview, but make primary Pool editing happen on Template cards.

### Templates page

Cards/table per Template:

- Name + slug/id.
- Status: preparing/active/failed.
- Source: image/snapshot/backup/machine/simplestreams/docker.
- Default size: vCPU/RAM/disk.
- Prepared readiness: daemon baked, second boot verified, actual-live verified.
- Measured storage footprint and cost.
- Pool panel:
  - Mode: off/stopped/running.
  - Target.
  - Ready/target.
  - Monthly estimate split: storage vs hot CPU/RAM.
  - Actions: Save, Refill, Pause/Resume, Delete Pool.
- Actions:
  - New Machine from Template.
  - Edit Template metadata/default size when safe.
  - Archive/Delete Template.

### New Template dialog

Source options:

1. External image / simplestreams.
2. Docker/OCI image.
3. Existing Machine.
4. Snapshot.
5. Backup.

Inputs:

- Name/slug.
- Default size.
- Visibility.
- Source picker/details.

Post-submit:

- Show preparation stages: pull/import, temp boot, cloud-init, daemon ensure, bake, second boot, publish, measure storage.
- Template appears as `preparing`/`active`/`failed`.

### New Machine dialog

Inputs:

- Template picker only.
- Display name.
- Region inherited from Template; show not editable unless template is replicated.
- Default size shown from Template.
- Optional “Customize size” section.
- Show Pool availability:
  - stopped ready: “Fast start, actual-live in ~3–5s.”
  - running ready: “Hot takeover, ~sub-second.”
  - no ready Pool: “Cold create from prepared Template; no daemon install on user path.”

## Migration / rollout plan

1. Add `MachineTemplate` Prisma model + migration.
2. Seed `Ubuntu 24.04` default Machine Template from the already prepared alias `justavps-ubuntu-24.04-template` with default size `2c/2GB/10GB`.
3. Backfill existing product `Image` rows that have `justavps.daemon_baked=true` into private Machine Templates where possible.
4. Add template-centric API routes.
5. Update `POST /machines` to require `template_id`; optionally accept old source only under an internal compatibility flag during local migration, but Admin Web must not use it.
6. Update Pool policy endpoints to accept `template_id` and expose template-centric pool summaries.
7. Refactor Admin Web:
   - Images page → Templates page.
   - New Template dialog.
   - Template Pool config panel.
   - New Machine dialog Template-only.
8. Keep low-level `/images` endpoint for debugging/cache but remove user-facing “pull image” terminology.
9. Run deterministic verification.

## Acceptance criteria

### Backend P0

- `GET /machine-templates` returns the seeded Ubuntu Template with:
  - active status,
  - default size `2/2/10`,
  - prepared image alias `justavps-ubuntu-24.04-template`,
  - `daemon_baked=true`, `second_boot_verified=true`,
  - Pool summary.
- `POST /machine-templates` from simplestreams creates a ready Template and publishes a prepared image.
- `POST /machine-templates` from snapshot creates a ready Template and publishes a prepared image.
- `POST /machine-templates` from backup is wired or explicitly fails with a precise “backup template source not implemented yet” only if backup export/import path is not robust enough; target design includes it.
- `POST /machines` with `template_id` creates a running, actual-live machine.
- `POST /machines` with old direct `source` is rejected.
- `PUT /machine-templates/:id/pool` creates/updates the correct Pool policy using Template default size.
- Pool claims from Template keep existing stopped/running behavior and measured billing.

### Admin Web P0

- Sidebar and page copy say Templates, not Images.
- Machine create UI offers Template picker only.
- Template page supports creating Template from external image and from snapshot.
- Template cards show Pool target/mode/ready/cost and allow editing target/mode.
- Template cards show accurate billing split for stopped vs running Pools.

### Verification

Commands:

- `pnpm --dir apps/v2-api typecheck`
- `pnpm --dir apps/v2-api test`
- `pnpm --dir apps/admin-web lint`
- `pnpm --dir apps/admin-web typecheck`
- Template E2E:
  - create Template from simplestreams.
  - create Machine from Template.
  - verify telemetry has no `usable: cloud-init done` wait and no full daemon install for prepared image path; it may show `activate baked managed daemon`.
  - configure stopped Pool on Template and claim under 5s actual-live.
  - configure running Pool on Template and claim under 1s.
  - direct old source create returns validation error.
- Browser/Admin Web E2E:
  - Templates page loads.
  - New Machine dialog only accepts Template.
  - Pool config is editable on Template card.

## Open questions

1. Should Template creation from Backup use native Incus backup import into temp instance first, then publish prepared image, or restore/clone from source machine when backup is local? Recommendation: use the most reliable native path per backup locality, same as current create-from-backup logic, but always end with `prepareAndPublishJustavpsImage()`.
2. Should Template IDs be human slugs or opaque ids? Recommendation: both: opaque DB id + account-unique slug. API accepts either.
3. Should changing Template default size mutate existing Pool config? Recommendation: no. Require drain/delete Pool first to keep accounting and Pool keys simple.
4. Should public catalog Templates be account-scoped or global? Recommendation: global/system Templates visible to all accounts; private Templates visible only to owner/admin.
