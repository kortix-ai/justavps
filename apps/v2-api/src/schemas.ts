import { z } from '@hono/zod-openapi';

// Source-of-truth Zod schemas for the V2 API. Used both for runtime validation
// inside the route handlers and for the auto-generated OpenAPI spec served at
// /docs/openapi.json. Keeping a single set of schemas means request types,
// response types, and SDK types never drift.

export const ErrorResponseSchema = z.object({
  // Always `true` at runtime, but typed as boolean here so handlers can return
  // `error: true` literally without needing `as const` everywhere.
  error: z.boolean(),
  message: z.string(),
  status: z.number().int().optional(),
}).openapi('ErrorResponse');

export const OkResponseSchema = z.object({
  ok: z.boolean(),
}).openapi('OkResponse');

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('justavps-v2-api'),
  database_configured: z.boolean(),
  incus_clusters_configured: z.number().int(),
  hetzner_robot_configured: z.boolean(),
  telemetry: z.object({
    enabled: z.boolean(),
    driver: z.enum(['clickhouse', 'memory', 'disabled']),
    ingest_reachable_from_sandbox: z.boolean(),
    warnings: z.array(z.string()),
  }).optional(),
}).openapi('HealthResponse');

export const RegionsResponseSchema = z.object({
  regions: z.array(z.string()),
}).openapi('RegionsResponse');

const ResourcesSchema = z.object({
  vcpu: z.number().int().positive(),
  memory_gb: z.number().int().positive(),
  disk_gb: z.number().int().positive(),
}).openapi('Resources');

export const SourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), image_id: z.string().min(1) }),
  z.object({ type: z.literal('snapshot'), snapshot_id: z.string().min(1) }),
  z.object({ type: z.literal('backup'), backup_id: z.string().min(1) }),
]).openapi('MachineSource');

// Lifecycle policy fields are minutes-based (Daytona convention). 0 / null
// disables that particular trigger. `ephemeral` is sugar for "delete on stop"
// and is mutually-exclusive with auto_archive_min — if both are set, ephemeral
// wins on the stop transition.
export const LifecycleSchema = z.object({
  // Fractional minutes allowed so tests can exercise sub-minute timers without
  // waiting an actual minute. UI surfaces them as integers; the sweeper just
  // multiplies.
  auto_stop_min: z.number().nonnegative().optional().openapi({ description: 'Idle minutes (no exec) before automatic stop. 0 disables.' }),
  auto_archive_min: z.number().nonnegative().optional().openapi({ description: 'Minutes after stop before machine is archived (snapshot + retained). 0 disables.' }),
  auto_delete_min: z.number().nonnegative().optional().openapi({ description: 'Minutes after stop before machine is hard-deleted. 0 disables.' }),
  ephemeral: z.boolean().optional().openapi({ description: 'If true, automatically delete the machine the moment it stops (no archive grace).' }),
}).openapi('Lifecycle');

export const CreateMachineBodySchema = z.object({
  region: z.enum(['eu', 'us']).optional().openapi({ description: 'Optional region assertion. If omitted, the Machine Template region is used.' }),
  type: z.literal('container').default('container'),
  name: z.string().trim().min(1).max(80).optional().openapi({ description: 'Display/search label only. The Incus hostname is always a generated UUID to avoid collisions.' }),
  template_id: z.string().min(1).openapi({ description: 'Machine Template id, slug, or prepared image alias. Direct image/snapshot/backup machine sources are disabled.' }),
  start_strategy: z.enum(['auto', 'running_pool', 'stopped_pool', 'cold']).default('auto').openapi({ description: 'Launch strategy. auto checks Running Hot Pool, then Stopped Pool, then cold create. Explicit pool strategies fail if that Pool has no ready slot; cold bypasses Pools.' }),
  resources: ResourcesSchema.optional().openapi({ description: 'Optional override. Defaults to the Machine Template default initial size; resize remains available later.' }),
  // Daytona-style ergonomics: env vars are merged into every exec, labels are
  // free-form tagging, lifecycle drives the background sweeper.
  env: z.record(z.string(), z.string()).optional().openapi({ description: 'Environment variables auto-merged into every exec call (per-call env still wins).' }),
  labels: z.record(z.string(), z.string()).optional().openapi({ description: 'Free-form tags returned in machine listings.' }),
  lifecycle: LifecycleSchema.optional(),
  target_cluster_id: z.string().min(1).optional().openapi({ description: 'Optional admin override. If omitted, the scheduler places the machine in an eligible cluster/member in the requested region.' }),
}).openapi('CreateMachineBody');

const ClusterPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  endpoint: z.string(),
  project: z.string().optional(),
  links: z.object({ ui_url: z.string().optional(), api_url: z.string().optional() }).partial().optional(),
}).openapi('ClusterPublic');

const MachineSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['container', 'vm']).optional(),
  region: z.string().optional(),
  status: z.string().optional(),
  cluster: ClusterPublicSchema.optional(),
  member: z.string().optional().nullable(),
  source: z.unknown().optional(),
  resources: z.unknown().optional(),
  metadata: z.unknown().optional(),
  incus: z.unknown().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).passthrough().openapi('Machine');

export const MachineEnvelopeSchema = z.object({
  machine: MachineSchema,
}).openapi('MachineEnvelope');

export const MachineListResponseSchema = z.object({
  machines: z.array(MachineSchema),
}).openapi('MachineListResponse');

const SnapshotSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  created_at: z.string().optional(),
  stateful: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
  size: z.number().optional(),
  metered_bytes: z.number().optional(),
  billable_gib: z.number().optional(),
  account_id: z.string().optional(),
  machine_id: z.string().optional(),
}).passthrough().openapi('Snapshot');

const BackupSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  incus_backup_name: z.string().optional(),
  created_at: z.string().optional(),
  expires_at: z.string().nullable().optional(),
  instance_only: z.boolean().optional(),
  optimized_storage: z.boolean().optional(),
  size: z.number().optional(),
  metered_bytes: z.number().optional(),
  billable_gib: z.number().optional(),
  storage_components: z.array(z.object({ label: z.string(), metered_bytes: z.number(), billable_gib: z.number() })).optional(),
  account_id: z.string().optional(),
  machine_id: z.string().optional(),
  restore_snapshot: z.string().optional(),
}).passthrough().openapi('Backup');

const ImageSchema = z.object({
  id: z.string().optional(),
  fingerprint: z.string(),
  type: z.string().optional(),
  public: z.boolean().optional(),
  size: z.union([z.number(), z.string()]).nullable().optional(),
  cluster: ClusterPublicSchema.optional(),
  aliases: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
  properties: z.record(z.string(), z.string()).optional(),
  uploaded_at: z.string().nullable().optional(),
}).passthrough().openapi('Image');

export const SnapshotListResponseSchema = z.object({
  snapshots: z.array(SnapshotSchema),
}).openapi('SnapshotListResponse');

export const SnapshotOperationResponseSchema = z.object({
  snapshot: SnapshotSchema,
  operation: z.unknown().optional(),
}).openapi('SnapshotOperationResponse');

export const BackupListResponseSchema = z.object({
  backups: z.array(BackupSchema),
}).openapi('BackupListResponse');

export const BackupOperationResponseSchema = z.object({
  backup: BackupSchema,
  operation: z.unknown().optional(),
}).openapi('BackupOperationResponse');

export const ImageListResponseSchema = z.object({
  images: z.array(ImageSchema),
}).openapi('ImageListResponse');

export const ImageOperationResponseSchema = z.object({
  image: ImageSchema,
  operation: z.unknown().optional(),
}).openapi('ImageOperationResponse');

export const LifecycleResponseSchema = z.object({
  ok: z.boolean(),
  noop: z.boolean().optional(),
  operation: z.unknown().optional(),
}).openapi('LifecycleResponse');

export const CreateSnapshotBodySchema = z.object({
  name: z.string().min(1).optional(),
  stateful: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
}).openapi('CreateSnapshotBody');

export const CreateBackupBodySchema = z.object({
  name: z.string().min(1).optional(),
  instance_only: z.boolean().optional(),
  optimized_storage: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
}).openapi('CreateBackupBody');

export const RestoreBodySchema = z.object({
  stateful: z.boolean().optional(),
}).openapi('RestoreBody');

// Mirrors the inline `createImageSchema` validator the route uses at runtime.
// Three mutually-exclusive flavors driven by which sub-object is present:
//   • `docker: { ref, server? }` → OCI pull (Docker Hub etc).
//   • `simplestreams: { ref, server? }` → simplestreams pull
//     (linuxcontainers.org).
//   • `machine_id` (+ optional `snapshot_id`) → publish from a running instance.
export const CreateImageBodySchema = z.object({
  machine_id: z.string().uuid().optional(),
  snapshot_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  cluster_id: z.string().min(1).optional(),
  public: z.boolean().optional(),
  properties: z.record(z.string(), z.string()).optional(),
  docker: z.object({
    ref: z.string().min(1),
    server: z.string().url().optional(),
    as_vm: z.literal(false).optional().openapi({ description: 'VM image imports are disabled; containers only.' }),
  }).optional(),
  simplestreams: z.object({
    ref: z.string().min(1).openapi({ example: 'ubuntu/22.04' }),
    server: z.string().url().optional(),
    as_vm: z.literal(false).optional().openapi({ description: 'VM image imports are disabled; containers only.' }),
  }).optional(),
}).openapi('CreateImageBody');

export const MachineParamsSchema = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' }, example: 'fd7510ee-2be6-49f2-a747-c0ccd2660c53' }),
}).openapi('MachineParams');

export const SnapshotBackupParamsSchema = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }),
  name: z.string().min(1).openapi({ param: { name: 'name', in: 'path' } }),
}).openapi('SnapshotBackupParams');

// ─── Sandbox runtime: exec + files ───────────────────────────────────
export const PatchMachineBodySchema = z.object({
  // Hot-resize on the running instance via Incus PATCH /instances/<n>.
  // CPU + memory apply live (Incus pushes new limits to the running cgroup).
  // disk_gb resizes the root device size — Incus accepts the change but the
  // actual ZFS volume grows lazily; the new size is the cap, not an immediate
  // allocation.
  resources: z.object({
    vcpu: z.number().int().min(1).max(256).optional(),
    memory_gb: z.number().int().min(1).max(2048).optional(),
    disk_gb: z.number().int().min(1).max(100_000).optional(),
  }).optional(),
}).openapi('PatchMachineBody');

export const ExecBodySchema = z.object({
  command: z.union([z.string(), z.array(z.string())]).openapi({ description: 'Either a single shell command (run via /bin/sh -c) or argv list executed directly.' }),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  user: z.number().int().nonnegative().optional(),
  group: z.number().int().nonnegative().optional(),
  stdin: z.string().optional(),
  timeout_ms: z.number().int().positive().max(3_600_000).optional(),
}).openapi('ExecBody');

export const ExecResponseSchema = z.object({
  exit_code: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
}).openapi('ExecResponse');

export const FileWriteBodySchema = z.object({
  path: z.string().min(1).openapi({ description: 'Absolute path inside the sandbox.' }),
  content: z.string().openapi({ description: 'File content. Treated as UTF-8 unless `encoding=base64`.' }),
  encoding: z.enum(['utf8', 'base64']).default('utf8').optional(),
  mode: z.number().int().nonnegative().optional(),
  create_dirs: z.boolean().optional(),
}).openapi('FileWriteBody');

export const FileReadResponseSchema = z.object({
  path: z.string(),
  type: z.string(),
  mode: z.string().nullable(),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']),
}).openapi('FileReadResponse');

export const FileListResponseSchema = z.object({
  path: z.string(),
  entries: z.array(z.string()),
}).openapi('FileListResponse');
