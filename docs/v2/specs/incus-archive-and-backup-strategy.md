# Incus Archive and Backup Strategy

## Summary

For VPS v2 sandboxes, keep **archival** and **backup** as separate concerns:

- **Archive**: operational cold/warm tier for fast resume. Move inactive sandboxes from the production Incus cluster to a dedicated cheap-storage Incus archive cluster.
- **Backup**: disaster-recovery tier. Export Incus backups to S3/R2/object storage regardless of whether the sandbox is active, stopped, or archived.

Recommended path:

```txt
Prod Incus cluster
  fast compute + fast local/NVMe storage
      ↓ archive via incus copy/refresh
Archive Incus cluster
  cheap/high-capacity storage, stopped instances
      ↓ resume via incus copy back
Prod Incus cluster
  start restored sandbox

Any Incus tier
      ↓ periodic export
S3/R2/object storage
  durable disaster backups
```

## Why not use S3/R2 as the primary archive tier?

S3/R2 is excellent for durable backups, but less ideal for interactive archive/resume:

- Restore requires downloading a backup artifact and importing it with Incus.
- Backups are archive files, not live Incus instances.
- Resume latency is usually worse than Incus-to-Incus copy.
- The restore path has more moving parts: object download, checksum validation, `incus import`, storage conversion, and then start.

So object storage should be treated as **backup/disaster recovery**, not the primary operational archive tier.

## Archive tier: dedicated Incus cluster with cheap storage

The archive cluster is a normal Incus server/cluster optimized for capacity instead of hot performance:

- large cheap disks,
- ZFS/Btrfs/LVM/Ceph depending on infra,
- mostly stopped instances,
- no production workload scheduling,
- used as the source of truth for archived-but-resumable sandboxes.

Archive operation:

```bash
incus stop prod:<sandbox>
incus copy prod:<sandbox> archive:<sandbox> --mode=push --storage archive-pool
incus info archive:<sandbox>
incus delete prod:<sandbox>
```

Resume operation:

```bash
incus copy archive:<sandbox> prod:<sandbox> --mode=pull --storage hot-pool
incus start prod:<sandbox>
```

Prefer **copy → verify → delete** over `incus move` so archive failures do not destroy the production instance.

## Best optimization: pre-warmed archive copy

Instead of waiting until the archive deadline to copy the entire sandbox, keep a warm archive mirror updated periodically:

```bash
incus copy prod:<sandbox> archive:<sandbox> --refresh
```

Suggested flow:

```txt
Running/Stopped on prod
  ↓ periodic/nightly refresh
Warm copy on archive cluster
  ↓ reaches archive threshold
Final refresh
  ↓ verify archive copy
Delete prod copy
  ↓
Archived state
```

This makes the final archive transition much faster because most disk data is already present on the archive cluster.

## Lifecycle states

Suggested DB states:

```txt
running
stopped
archive_syncing
archiving
archived
restoring
backup_exporting
deleted
archive_failed
restore_failed
backup_failed
```

Suggested timestamps/metadata:

```txt
last_active_at
auto_stop_after_minutes
auto_archive_after_minutes
archived_at
archive_cluster_id
archive_instance_name
archive_storage_pool
last_archive_refresh_at
last_archive_verified_at
backup_object_url
backup_size_bytes
backup_checksum
last_backup_at
```

## Backup tier: S3/R2/object storage

Object storage remains the durable disaster-recovery layer.

Export example:

```bash
incus export archive:<sandbox> - | aws s3 cp - s3://<bucket>/incus-backups/<sandbox>.tar.gz
```

Restore from backup example:

```bash
aws s3 cp s3://<bucket>/incus-backups/<sandbox>.tar.gz /scratch/<sandbox>.tar.gz
incus import /scratch/<sandbox>.tar.gz <sandbox>
incus start <sandbox>
```

Use S3/R2 for:

- disaster recovery,
- long retention,
- accidental deletion protection,
- archive-cluster failure recovery,
- compliance/audit backup history.

## Backwards compatibility

This design is cleanly backwards compatible if current sandboxes already have persistent Incus root disks.

The initial implementation can keep doing only:

```txt
running → stopped → deleted/manual retention
```

Later, add archive support as an optional lifecycle extension:

```txt
running → stopped → archived → restoring → running
```

No sandbox image format needs to change. No user-facing VPS semantics need to change. A sandbox that exists today as a normal Incus instance can later be archived by copying it to the archive cluster and deleting the prod copy after verification.

Compatibility requirements:

- Keep stable sandbox IDs separate from Incus instance location.
- Do not assume an active sandbox always exists on the production cluster.
- Store the current placement: prod cluster, archive cluster, or object backup only.
- Make restore idempotent and resumable.
- Keep `ephemeral=false` for persistent user sandboxes.

## Product behavior

Recommended user-facing behavior:

- **Auto-stop** after idle timeout: frees CPU/RAM, keeps disk on prod.
- **Auto-archive** after long inactivity: offloads disk to archive Incus cluster.
- **Resume archived sandbox**: show a restoring state, copy back to prod, then start.
- **Backups**: independent background process; should not block normal stop/archive unless policy requires it.

Example lifecycle:

```txt
15 min idle:
  incus stop prod:<sandbox>
  state = stopped

Nightly:
  incus copy prod:<sandbox> archive:<sandbox> --refresh
  update last_archive_refresh_at

7 days inactive:
  incus copy prod:<sandbox> archive:<sandbox> --refresh
  verify archive copy
  incus delete prod:<sandbox>
  state = archived

User resumes:
  state = restoring
  incus copy archive:<sandbox> prod:<sandbox> --storage hot-pool
  incus start prod:<sandbox>
  state = running
```

## Key decision

Use both tiers:

```txt
Incus archive cluster = fast operational resume
S3/R2/object storage = durable disaster backup
```

This gives the best blend of cost, performance, and safety while allowing archive support to be added later without breaking existing VPS persistence behavior.
