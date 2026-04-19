# User Image Reserve Spec

## Goal
Give **custom user images** the same fast-start treatment as the default golden image.

We already have a live ladder for the platform golden image:
1. warm reserve (~4s)
2. stopped reserve (~10-11s)
3. full cold create (~27s)

This spec extends the same model to **user-created images**.

## Key idea
A "user image" should not just be a dead published image record.
It should optionally have **reserve capacity** attached to it.

That means we treat images as launchable artifacts with three possible provisioning modes:

1. **warm reserve for image**
2. **stopped reserve for image**
3. **cold clone from image**

## Core distinction
There are two image classes:

### 1. Platform image
- `justavps-golden`
- owned by us
- shared
- always eligible for global warm/stopped reserves

### 2. User image
- created from a user machine
- private to an account
- should be eligible for image-specific reserves
- reserves must be scoped to that account/image

## Recommended runtime ladder for user images
For a create request that targets `image_id = X`:

1. **image warm reserve** for the exact CPU bucket
2. **image stopped reserve** for the exact CPU bucket
3. **cold clone from that image**

This is the same structure as the platform image path, but keyed by image.

## Reserve keys
Reserves should be keyed by:
- `image_id`
- `cpu_bucket`

Not by full RAM/disk.

Why:
- CPU cannot be safely changed for the guest after boot in our current VM model
- RAM can be hotplugged upward
- disk can be expanded online

So the reserve identity is:
`(image_id, vcpu)`

## Product model
Three modes should exist for user images:

### Mode A — no reserve
- cheapest
- image boots cold from clone
- current expected speed: ~27s class unless more cold optimizations land

### Mode B — stopped reserve
- cheap reserve
- disk cost only
- expected speed: ~10-11s

### Mode C — warm reserve
- expensive reserve
- RAM cost
- expected speed: ~4s or lower

## Billing model
This must not be hidden infra magic.
It should be productized.

### Stopped reserve pricing
Charge for:
- reserved disk footprint
- optional small management surcharge

### Warm reserve pricing
Charge for:
- reserved RAM
- reserved CPU capacity slot
- reserved disk footprint
- optional management surcharge

## Practical UX
Per custom image, the user should be able to select:
- no acceleration
- stopped reserve
- warm reserve

And optionally a reserve count.

Simple first version:
- one reserve slot max per image

Advanced later:
- N reserve slots per image
- regional reserve placement
- auto-scaling reserve counts based on demand

## Smart defaults
A sane first product policy:

### Default platform golden image
- warm reserve enabled by us
- hidden from the user as product infra

### Custom user image
- default = no reserve
- optional upgrade = stopped reserve
- premium option = warm reserve

This avoids us silently eating cost for every custom image.

## Operational model
### For stopped reserves
- keep one stopped VM per `(image_id, cpu_bucket)` if enabled
- when claimed, immediately enqueue replenish in background

### For warm reserves
- keep one running VM per `(image_id, cpu_bucket)` if enabled
- when claimed, immediately enqueue replenish in background

### Replenish source
For a user image reserve, the replenish source is:
- the user image itself (or the latest image version/fingerprint for that image record)

## Image versioning requirement
If reserves are tied to a user image, we need stable image version semantics.

At minimum:
- `images.provider_image_id`
- `images.updated_at`
- `images.status`

If the user recreates the image, reserves must either:
1. be invalidated and rebuilt
or
2. be version-pinned to the previous image fingerprint until rebuilt

Recommendation:
- invalidate and rebuild

## Scheduling rules
The scheduler must prefer:
1. reserve on the same host if available
2. cold clone from host-local image cache if available
3. otherwise transfer/import image to chosen host and then clone

This implies a second-level question:
### Do we replicate user images to every host?
Answer:
- not by default

Recommendation:
- keep image locality metadata
- prefer the host that already has the image cached
- if no host has it cached, import lazily on first use

## Data model additions
We likely need a new table, something like:

### `image_reserves`
Fields:
- `id`
- `account_id`
- `image_id`
- `host_id`
- `mode` (`warm` | `stopped`)
- `cpu_bucket`
- `vcpu`
- `base_ram_gb`
- `base_disk_gb`
- `current_instance_name`
- `status`
- `last_claimed_at`
- `created_at`
- `updated_at`

This makes reserves explicit and billable.

## Why this is better than stateful snapshots as core design
Stateful snapshots in Incus are awkward because:
- tied to a specific VM
- memory constraints before resume
- more fragile lifecycle

A reserve VM is simpler:
- it is just a VM
- running or stopped
- easy to reason about
- easy to bill
- easy to replenish

## Bottom line
Yes — we absolutely can extend the same fast-start model to user images.

But the correct product architecture is:
- **reserves are explicit, scoped, and billable**
- not magical hidden infra for every custom image

Recommended first productization:
1. platform golden image: global warm reserve
2. custom user image: optional stopped reserve
3. custom user image premium: optional warm reserve
