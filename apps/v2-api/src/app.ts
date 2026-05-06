import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Account as PrismaAccount, AccountInvitation as PrismaAccountInvitation, AccountMembership as PrismaAccountMembership, Host, Machine as PrismaMachine, MachineBackupPolicy as PrismaMachineBackupPolicy, MachineTemplate as PrismaMachineTemplate, User as PrismaUser, WarmPoolPolicy as PrismaWarmPoolPolicy, Prisma } from '@prisma/client';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';

import {
  BackupListResponseSchema,
  BackupOperationResponseSchema,
  CreateBackupBodySchema,
  CreateImageBodySchema,
  CreateMachineBodySchema,
  CreateSnapshotBodySchema,
  ErrorResponseSchema,
  ExecBodySchema,
  ExecResponseSchema,
  FileListResponseSchema,
  FileReadResponseSchema,
  FileWriteBodySchema,
  HealthResponseSchema,
  ImageListResponseSchema,
  ImageOperationResponseSchema,
  LifecycleResponseSchema,
  MachineEnvelopeSchema,
  MachineListResponseSchema,
  MachineParamsSchema,
  OkResponseSchema,
  PatchMachineBodySchema,
  RegionsResponseSchema,
  SnapshotBackupParamsSchema,
  SnapshotListResponseSchema,
  SnapshotOperationResponseSchema,
  RestoreBodySchema,
} from './schemas.js';

import type { AppConfig, IncusClusterConfig } from './config.js';
import { normalizeClusterConfig } from './config.js';
import { registerAdminUi } from './admin-ui-static.js';
import { registerBillingV2Routes } from './billing/routes.js';
import { recordBillingRuntimeObservation } from './billing/runtimeMeter.js';
import { getPrisma } from './db/client.js';
import { IncusApiError, IncusClient, hardenedSecurityConfig, type CreateInstanceSource } from './incus/client.js';
import type { IncusImage, IncusInstance, IncusInstanceState, IncusOperation } from './incus/types.js';
import { sweepOnce, startLifecycleSweeper } from './lifecycle.js';
import { driveRun, type Step } from './services/nodeProvisioning.js';
import { applyTransition, type NodeLifecycleState } from './lifecycle/nodeLifecycle.js';
import { SKU_CATALOG, DEFAULT_SKU_ID, DEFAULT_BIG_SKU_ID, unitCostsAtFill, recommendNextSku } from './economics/skuCatalog.js';
import { computeClusterEconomics, parseCpuLimit, parseMemoryLimitGb, sumInstanceStorageGb } from './economics/utilization.js';
import { rollupPnL, type CostEntry, type RevenueEntry } from './economics/pnl.js';
import { bucketDaily, bucketHourly, fillSamplesToFillSeries, type LedgerRow, type SamplePoint } from './economics/timeseries.js';
import { forecastExhaustion, type FillSample } from './economics/autoscale.js';
import { DEFAULT_PRICING } from './economics/pricing.js';
import { syncHetznerServers, mapHetznerServer } from './services/hetznerInventory.js';
import { syncIncusObservation, type IncusObservation } from './services/incusSync.js';
import { cleanupInjectedManagedDaemon, ensureManagedDaemon, markManagedDaemonQueued, restartManagedDaemonService, waitForCloudInitDone, waitForGuestExecReady, waitForJustavpsLive, waitForManagedDaemonHealth } from './services/managedDaemon.js';
import { ensureGuestSshAccess, mergeSshMetadata } from './services/sshAccess.js';
import { HetznerRobotApiError, HetznerRobotClient, type HetznerRobotProduct } from './vendors/hetznerRobot.js';
import { TEMPLATES, TEMPLATE_IDS, imageMatchesTemplate } from './templates/catalog.js';
import {
  completeMachineCreationTelemetry,
  failMachineCreationTelemetry,
  getMachineCreationTelemetry,
  listMachineCreationTelemetry,
  type MachineCreationTelemetry,
  startMachineCreationTelemetry,
  updateMachineCreationLabels,
  withTelemetrySpan,
} from './telemetry.js';
import {
  eventEntriesFromPayload,
  getTelemetryStore,
  logEntriesFromPayload,
  metricSamplesFromPayload,
  traceSpansFromPayload,
} from './telemetry-store.js';
import {
  generateProxyToken,
  proxySlugForMachineId,
  proxyUrls,
  sha256Hex,
  type ProxyTokenDescriptor,
} from './proxy-routing.js';

const SUPPORTED_REGIONS = ['eu', 'us'] as const;
type SupportedRegion = typeof SUPPORTED_REGIONS[number];

function envInt(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

class AsyncSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  stats() {
    return { limit: this.limit, active: this.active, queued: this.queue.length };
  }

  private async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const WARM_POOL_POLICY_TARGET_MAX = envInt('V2_WARM_POOL_POLICY_TARGET_MAX', 500, 1, 10_000);
const WARM_POOL_STOPPED_START_CONCURRENCY = envInt('V2_WARM_POOL_STOPPED_START_CONCURRENCY', 100, 1, 500);
const warmPoolStoppedStartLimiter = new AsyncSemaphore(WARM_POOL_STOPPED_START_CONCURRENCY);
const CONTAINERS_ONLY_MESSAGE = 'VM usage is disabled; JustAVPS currently supports containers only';
const WARM_POOL_STOPPED_MODE = 'primed_stopped_exact' as const;
const WARM_POOL_RUNNING_MODE = 'primed_running_exact' as const;
const WARM_POOL_DEFAULT_MODE = WARM_POOL_STOPPED_MODE;
const WARM_POOL_MODE_INPUTS = ['stopped', 'running', WARM_POOL_STOPPED_MODE, WARM_POOL_RUNNING_MODE] as const;
type WarmPoolMode = typeof WARM_POOL_STOPPED_MODE | typeof WARM_POOL_RUNNING_MODE;
const DEFAULT_TEMPLATE_RESOURCES = { vcpu: 2, memory_gb: 2, disk_gb: 10 } as const;
const AUTO_BACKUP_POLICY = {
  cadence: 'daily',
  intervalHours: 24,
  retentionDays: 7,
  retentionCount: 7,
} as const;
const ACCOUNT_TYPES = ['personal', 'organization'] as const;
const ACCOUNT_ROLES = ['owner', 'admin', 'member'] as const;
const MACHINE_START_STRATEGIES = ['auto', 'running_pool', 'stopped_pool', 'cold'] as const;
type MachineStartStrategy = (typeof MACHINE_START_STRATEGIES)[number];

function normalizeWarmPoolMode(value: unknown): WarmPoolMode {
  return value === 'running' || value === WARM_POOL_RUNNING_MODE ? WARM_POOL_RUNNING_MODE : WARM_POOL_STOPPED_MODE;
}

function warmPoolModesForStartStrategy(strategy: MachineStartStrategy): WarmPoolMode[] {
  if (strategy === 'running_pool') return [WARM_POOL_RUNNING_MODE];
  if (strategy === 'stopped_pool') return [WARM_POOL_STOPPED_MODE];
  if (strategy === 'cold') return [];
  return [WARM_POOL_RUNNING_MODE, WARM_POOL_STOPPED_MODE];
}

function warmPoolModeKey(mode: WarmPoolMode): 'running' | 'stopped' {
  return mode === WARM_POOL_RUNNING_MODE ? 'running' : 'stopped';
}

const resourceShapeSchema = z.object({
  vcpu: z.number().int().min(1).max(256),
  memory_gb: z.number().int().min(1).max(2048),
  disk_gb: z.number().int().min(1).max(100_000),
});

const legacyMachineSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), image_id: z.string().min(1) }),
  z.object({ type: z.literal('snapshot'), snapshot_id: z.string().min(1) }),
  z.object({ type: z.literal('backup'), backup_id: z.string().min(1) }),
]);

const createMachineSchema = z.object({
  region: z.enum(SUPPORTED_REGIONS).optional(),
  type: z.literal('container').default('container'),
  // Product display/search label only. Never used as the Incus hostname.
  // Incus instance names are generated UUIDs to avoid customer collisions.
  name: z.string().trim().min(1).max(80).optional(),
  template_id: z.string().trim().min(1),
  start_strategy: z.enum(MACHINE_START_STRATEGIES).default('auto'),
  resources: resourceShapeSchema.optional(),
  source: legacyMachineSourceSchema.optional(),
  // Daytona-style ergonomics: env merged into every exec, labels for tagging,
  // lifecycle drives the background sweeper.
  env: z.record(z.string(), z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  lifecycle: z.object({
    auto_stop_min: z.number().nonnegative().optional(),
    auto_archive_min: z.number().nonnegative().optional(),
    auto_delete_min: z.number().nonnegative().optional(),
    ephemeral: z.boolean().optional(),
  }).optional(),
  target_cluster_id: z.string().min(1).optional(),
}).superRefine((data, ctx) => {
  if (data.source) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source'],
      message: 'Direct image/snapshot/backup machine sources are disabled. Create a Machine Template from that source first, then create the Machine with template_id.',
    });
  }
});

type CreateMachineRequest = z.infer<typeof createMachineSchema>;
type ResourceShape = z.infer<typeof resourceShapeSchema>;
type MachineSourceInput = z.infer<typeof legacyMachineSourceSchema>;
type CreateMachineInput = Omit<CreateMachineRequest, 'template_id' | 'resources' | 'source' | 'region'> & {
  region: SupportedRegion;
  resources: ResourceShape;
  source: { type: 'image'; image_id: string };
  template_id: string;
};
type SourceResolveInput = { source: MachineSourceInput; type: 'container' | 'vm'; resources: ResourceShape; region: SupportedRegion };

const createMachineTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.:-]*$/).optional(),
  region: z.enum(SUPPORTED_REGIONS).default('eu'),
  type: z.literal('container').default('container'),
  visibility: z.enum(['catalog', 'private']).default('private'),
  default_resources: resourceShapeSchema.default(DEFAULT_TEMPLATE_RESOURCES),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('image'), image_id: z.string().min(1) }),
    z.object({ type: z.literal('simplestreams'), ref: z.string().min(1), server: z.string().url().optional() }),
    z.object({ type: z.literal('docker'), ref: z.string().min(1), server: z.string().url().optional() }),
    z.object({ type: z.literal('machine'), machine_id: z.string().uuid() }),
    z.object({ type: z.literal('snapshot'), machine_id: z.string().uuid(), snapshot_id: z.string().min(1) }),
    z.object({ type: z.literal('backup'), machine_id: z.string().uuid(), backup_id: z.string().min(1) }),
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const patchMachineTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  status: z.enum(['active', 'archived']).optional(),
  visibility: z.enum(['catalog', 'private']).optional(),
  default_resources: resourceShapeSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const templatePoolConfigSchema = z.object({
  target: z.number().int().min(0).max(WARM_POOL_POLICY_TARGET_MAX).default(1),
  mode: z.enum(WARM_POOL_MODE_INPUTS).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

const warmPoolSourceSchema = z.object({ type: z.literal('image'), image_id: z.string().min(1) });

const warmPoolPolicySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  region: z.enum(SUPPORTED_REGIONS).default('eu'),
  type: z.literal('container').default('container'),
  mode: z.enum(WARM_POOL_MODE_INPUTS).optional(),
  billing_mode: z.enum(WARM_POOL_MODE_INPUTS).optional(),
  resources: z.object({
    vcpu: z.number().int().min(1).max(256),
    memory_gb: z.number().int().min(1).max(2048),
    disk_gb: z.number().int().min(1).max(100_000),
  }),
  source: warmPoolSourceSchema,
  target: z.number().int().min(0).max(WARM_POOL_POLICY_TARGET_MAX).default(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const patchWarmPoolPolicySchema = warmPoolPolicySchema.partial().extend({
  status: z.enum(['active', 'paused']).optional(),
});

type WarmPoolPolicyInput = z.infer<typeof warmPoolPolicySchema>;
type WarmPoolPolicyValidation =
  | { source: { sourceType: 'image'; sourceId: string } }
  | { error: { status: 400 | 404 | 409; body: { error: true; message: string } } };

const nodeOrderSchema = z.object({
  product_id: z.string().min(1),
  location: z.string().min(1),
  region: z.enum(SUPPORTED_REGIONS).optional(),
  confirm: z.string().optional(),
  ssh_key_fingerprints: z.array(z.string().min(1)).optional().default([]),
  addons: z.array(z.string().min(1)).optional().default([]),
  dist: z.string().min(1).optional(),
  target_cluster_id: z.string().min(1).optional(),
  note: z.string().max(1000).optional(),
});

type NodeOrderInput = z.infer<typeof nodeOrderSchema>;

const MACHINE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class BadRequestError extends Error {
  status = 400;
}

class ConflictError extends Error {
  status = 409;
}

function isMachineUuid(value: string | null | undefined): value is string {
  return Boolean(value && MACHINE_UUID_RE.test(value));
}

function requireMachineUuid(value: string) {
  if (!isMachineUuid(value)) {
    throw new BadRequestError('Machine id must be the sandbox UUID. Display names and Incus names are not accepted for machine CRUD.');
  }
  return value;
}

const createSnapshotSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/).optional(),
  stateful: z.boolean().optional().default(false),
  expires_at: z.string().datetime().optional().nullable(),
});

const restoreSnapshotSchema = z.object({
  stateful: z.boolean().optional().default(false),
});

const createImageSchema = z
  .object({
    machine_id: z.string().uuid().optional(),
    snapshot_id: z.string().min(1).optional(),
    docker: z
      .object({
        ref: z.string().min(1).max(200),
        server: z.string().url().optional(),
        as_vm: z.literal(false).optional().default(false),
      })
      .optional(),
    // Simplestreams is the canonical Incus image protocol — Ubuntu / Debian
    // / Fedora / Alpine all publish here as container rootfs images.
    simplestreams: z
      .object({
        ref: z.string().min(1).max(200),
        server: z.string().url().optional(),
        as_vm: z.literal(false).optional().default(false),
      })
      .optional(),
    region: z.string().min(1).optional(),
    cluster_id: z.string().min(1).optional(),
    name: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.:-]*$/).optional(),
    public: z.boolean().optional().default(false),
    properties: z.record(z.string(), z.string()).optional().default({}),
  })
  .refine((data) => {
    // Exactly one of: publish from a machine, OCI pull, simplestreams pull.
    const sources = [Boolean(data.machine_id), Boolean(data.docker), Boolean(data.simplestreams)].filter(Boolean).length;
    return sources === 1;
  }, {
    message: 'Provide exactly one of machine_id, docker, or simplestreams',
    path: ['machine_id'],
  });

const createProxyTokenSchema = z.object({
  machine_id: z.string().uuid(),
  label: z.string().trim().max(80).optional().nullable(),
  ports: z.array(z.number().int().min(1).max(65535)).optional().nullable(),
  expires_in_seconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional().default(3600),
});

const proxyTokenPublicSchema = z.object({
  id: z.string(),
  token: z.string().optional(),
  token_prefix: z.string(),
  label: z.string().nullable(),
  machine_id: z.string().uuid(),
  machine_slug: z.string(),
  ports: z.array(z.number().int()).nullable(),
  expires_at: z.string(),
  proxy_url: z.string().optional(),
  created_at: z.string(),
}).openapi('ProxyToken');

const proxyTokenListResponseSchema = z.object({
  proxy_tokens: z.array(proxyTokenPublicSchema),
}).openapi('ProxyTokenListResponse');

const proxyTokenParamsSchema = z.object({
  id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
}).openapi('ProxyTokenParams');

const proxyTokenQuerySchema = z.object({
  machine_id: z.string().uuid().optional(),
}).openapi('ProxyTokenQuery');

const createSshTokenSchema = z.object({
  machine_id: z.string().uuid(),
  label: z.string().trim().max(80).optional().nullable(),
  expires_in_seconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional().default(3600),
});

const sshTokenPublicSchema = z.object({
  id: z.string(),
  token: z.string().optional(),
  token_prefix: z.string(),
  label: z.string().nullable(),
  machine_id: z.string().uuid(),
  expires_at: z.string(),
  ssh_command: z.string().optional(),
  ssh_config: z.string().optional(),
  target: z.unknown().optional(),
  created_at: z.string(),
}).openapi('SshToken');

const sshTokenListResponseSchema = z.object({
  ssh_tokens: z.array(sshTokenPublicSchema),
}).openapi('SshTokenListResponse');

const sshValidateResponseSchema = z.object({
  valid: z.boolean(),
  machine_id: z.string().optional(),
  target_host: z.string().optional().nullable(),
  target_port: z.number().int().optional(),
  ssh_user: z.string().optional(),
  expires_at: z.string().optional(),
}).openapi('SshValidateResponse');

const ensureDaemonBodySchema = z.object({
  // Older admin-web builds sent `false` to mean "skip port verification".
  // Accept it for compatibility; normalize to null at the route boundary.
  verify_port: z.union([z.number().int().min(1).max(65535), z.literal(false), z.null()]).optional(),
}).optional();

const ensureDaemonResponseSchema = z.object({
  ok: z.boolean(),
  daemon: z.unknown(),
  machine: z.unknown().optional(),
}).openapi('EnsureDaemonResponse');

const imageParamsSchema = z.object({
  id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
}).openapi('ImageParams');

const createBackupSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/).optional(),
  instance_only: z.boolean().optional().default(false),
  optimized_storage: z.boolean().optional().default(true),
  expires_at: z.string().datetime().optional().nullable(),
});

const patchBackupPolicySchema = z.object({
  enabled: z.boolean(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120).optional(),
  is_admin: z.boolean().optional().default(false),
});

const createAccountSchema = z.object({
  type: z.enum(ACCOUNT_TYPES).default('organization'),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.:-]*$/).optional(),
  billing_email: z.string().email().optional().nullable(),
  owner_user_id: z.string().min(1).optional(),
  owner_email: z.string().email().optional(),
  owner_name: z.string().trim().min(1).max(120).optional(),
});

const patchAccountSchema = z.object({
  type: z.enum(ACCOUNT_TYPES).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.:-]*$/).optional(),
  billing_email: z.string().email().optional().nullable(),
  stripe_customer_id: z.string().trim().min(1).max(200).optional().nullable(),
  deleted: z.boolean().optional(),
});

const accountMemberSchema = z.object({
  user_id: z.string().min(1).optional(),
  email: z.string().email().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ACCOUNT_ROLES).default('member'),
});

const patchAccountMemberSchema = z.object({
  role: z.enum(ACCOUNT_ROLES),
});

const accountInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(ACCOUNT_ROLES).default('member'),
  expires_in_days: z.number().int().min(1).max(90).optional().default(7),
});

const toolboxConfigSchema = z.object({
  base_url: z.union([z.string().url(), z.literal('')]).nullable().optional(),
});

const toolboxCommandSchema = z.object({
  command: z.string().min(1).max(20_000),
  cwd: z.string().max(1000).optional().default(''),
  timeout: z.number().int().min(1).max(3600).optional().default(60),
  env: z.record(z.string(), z.string()).optional().default({}),
});

const procurementQuoteSchema = z.object({
  vendor: z.literal('hetzner_robot').default('hetzner_robot'),
  product_id: z.string().min(1),
  location: z.string().min(1),
  region: z.string().min(1).default('eu'),
  quantity: z.number().int().min(1).max(20).default(1),
  addons: z.array(z.string().min(1)).optional().default([]),
});

const createProcurementSchema = procurementQuoteSchema.extend({
  execute: z.boolean().optional().default(false),
  confirm: z.string().optional(),
  idempotency_key: z.string().min(1).max(120).optional(),
});

const procurementActionSchema = z.object({
  note: z.string().max(1000).optional(),
});

const procurementOrderSchema = z.object({
  execute: z.boolean().optional().default(false),
  confirm: z.string().optional(),
  note: z.string().max(1000).optional(),
  // Override / supply at order time. Without this, Hetzner delivers the
  // host with a random root password (we'd need rescue+reset to get in).
  ssh_key_fingerprints: z.array(z.string()).optional(),
  addons: z.array(z.string()).optional(),
  dist: z.string().optional(),
});

const bootstrapPlanSchema = z.object({
  host_id: z.string().min(1).optional(),
  provider_server_number: z.string().min(1).optional(),
  cluster_id: z.string().min(1),
  mode: z.enum(['incusos_join_cluster']).default('incusos_join_cluster'),
  execute: z.boolean().optional().default(false),
  confirm: z.string().optional(),
});

function publicCluster(cluster: IncusClusterConfig) {
  return {
    id: cluster.id,
    name: cluster.name,
    region: cluster.region,
    endpoint: cluster.endpoint,
    project: cluster.project,
    links: incusWebLinks(cluster.endpoint),
  };
}

function clientFor(cluster: IncusClusterConfig) {
  return new IncusClient(cluster);
}

async function observeCluster(cluster: IncusClusterConfig): Promise<IncusObservation> {
  const client = clientFor(cluster);
  const [server, members, images, instances] = await Promise.all([
    client.getServer(),
    client.listClusterMembers(),
    client.listImages(),
    client.listInstances(),
  ]);
  return { server, members, images, instances };
}

function pickCluster(config: AppConfig, region: string) {
  return config.clusters.find((cluster) => cluster.region === region) ?? null;
}

function findCluster(config: AppConfig, id: string) {
  return config.clusters.find((cluster) => cluster.id === id) ?? null;
}

function supportedRegion(value: unknown): SupportedRegion {
  return value === 'us' ? 'us' : 'eu';
}

function regionFromHetznerLocation(location: string): SupportedRegion {
  const upper = location.trim().toUpperCase();
  if (upper.startsWith('HEL') || upper.startsWith('FSN') || upper.startsWith('NBG')) return 'eu';
  return 'us';
}

async function pickNodeTargetCluster(config: AppConfig, input: { region: SupportedRegion; requestedClusterId?: string | null }) {
  if (input.requestedClusterId) {
    const cluster = findCluster(config, input.requestedClusterId);
    if (!cluster) throw new BadRequestError(`Cluster ${input.requestedClusterId} is not configured`);
    if (cluster.region !== input.region) throw new ConflictError(`Cluster ${cluster.id} is in ${cluster.region}, not ${input.region}`);
    return {
      cluster,
      selection: {
        mode: 'manual',
        policy: 'explicit target_cluster_id',
        region: input.region,
        selected_cluster_id: cluster.id,
      },
    };
  }

  const candidates = config.clusters.filter((cluster) => cluster.region === input.region);
  if (candidates.length === 0) throw new ConflictError(`No Incus cluster configured for region ${input.region}`);

  const observed = await Promise.all(candidates.map(async (cluster) => {
    try {
      const members = await clientFor(cluster).listClusterMembers();
      const online = members.filter((member) => member.status === 'Online').length;
      return { cluster, reachable: true, members: members.length, online, eligible: members.length < 100 };
    } catch (error) {
      return { cluster, reachable: false, members: Number.POSITIVE_INFINITY, online: 0, eligible: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const selected = observed
    .filter((item) => item.reachable && item.eligible)
    .sort((a, b) => a.members - b.members || b.online - a.online || a.cluster.id.localeCompare(b.cluster.id))[0];
  if (!selected) throw new ConflictError(`No reachable Incus cluster in ${input.region} has room for another node (100-node cluster cap)`);
  return {
    cluster: selected.cluster,
    selection: {
      mode: 'auto',
      policy: 'least-members-under-100-in-region',
      region: input.region,
      selected_cluster_id: selected.cluster.id,
      candidates: observed.map((item) => ({
        cluster_id: item.cluster.id,
        reachable: item.reachable,
        members: Number.isFinite(item.members) ? item.members : null,
        online: item.online,
        eligible: item.eligible,
        error: 'error' in item ? item.error : undefined,
      })),
    },
  };
}

function clusterSku(cluster: IncusClusterConfig) {
  return SKU_CATALOG[cluster.defaultMemberSku ?? DEFAULT_SKU_ID] ?? SKU_CATALOG[DEFAULT_SKU_ID];
}

function schedulerPolicy() {
  const num = (name: string, fallback: number) => {
    const parsed = Number(process.env[name] ?? '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    targetFill: num('V2_SCHEDULER_TARGET_FILL', 0.9),
    // Cloud-style overcommit: CPU is burstable/shared, so we sell more vCPU
    // than physical threads. RAM stays 1:1 because overcommitting memory is
    // how hosts fall over. Disk stays 1:1 until we have thin-provisioning
    // alerts + pool watermarks wired in.
    overcommit: {
      vcpu: num('V2_SCHEDULER_VCPU_OVERCOMMIT_RATIO', 4),
      memory: num('V2_SCHEDULER_MEMORY_OVERCOMMIT_RATIO', 1),
      disk: num('V2_SCHEDULER_DISK_OVERCOMMIT_RATIO', 1),
    },
  };
}

function sellableCapacity(physical: { vcpu: number; memory_gb: number; disk_gb: number }, policy = schedulerPolicy()) {
  return {
    vcpu: physical.vcpu * policy.overcommit.vcpu,
    memory_gb: physical.memory_gb * policy.overcommit.memory,
    disk_gb: physical.disk_gb * policy.overcommit.disk,
  };
}

function instanceAllocatedResources(instance: IncusInstance, hostRamGb?: number) {
  return {
    vcpu: parseCpuLimit(instance.config?.['limits.cpu']) ?? 0,
    memory_gb: parseMemoryLimitGb(instance.config?.['limits.memory'], hostRamGb) ?? 0,
    disk_gb: sumInstanceStorageGb(instance.devices) ?? 0,
  };
}

async function hostSchedulabilityByMember(clusterId: string, memberNames: string[]) {
  if (!memberNames.length || !loadConfigSafeDatabaseConfigured()) return new Map<string, { known: false; schedulable: true; lifecycle_state: 'unknown' }>();
  const rows = await getPrisma().host.findMany({
    where: { incusClusterId: clusterId, incusMemberName: { in: memberNames }, lifecycleState: { not: 'terminated' } },
  }).catch(() => []);
  return new Map(rows.map((row) => [row.incusMemberName!, {
    known: true,
    schedulable: Boolean(row.schedulable) && row.lifecycleState === 'online',
    lifecycle_state: row.lifecycleState,
    host_id: row.id,
  }]));
}

function loadConfigSafeDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

const WARM_POOL_STATUS = 'warm_pool';
const WARM_POOL_CLAIMING_STATUS = 'warm_pool_claiming';
const WARM_POOL_ACCOUNT_ID = 'system:warm-pool';
type WarmPoolSpec = {
  accountId?: string | null;
  policyId?: string | null;
  mode?: WarmPoolMode;
  region: SupportedRegion;
  type: 'container' | 'vm';
  sourceType: 'image' | 'snapshot';
  sourceId: string;
  resources: { vcpu: number; memory_gb: number; disk_gb: number };
  key: string;
};

function isWarmPoolStatus(status: string | null | undefined) {
  return status === WARM_POOL_STATUS || status === WARM_POOL_CLAIMING_STATUS;
}

function isWarmPoolInventoryRow(machine: { status?: string | null; metadata?: unknown } | null | undefined) {
  if (!machine) return false;
  if (isWarmPoolStatus(machine.status)) return true;
  const warm = jsonRecord(jsonRecord(machine.metadata).warm_pool);
  if (Object.keys(warm).length === 0) return false;
  return warm.runtime_state !== 'claimed_running';
}

function warmPoolInventoryDisplayName(machineId: string) {
  return `Pool slot ${machineId.slice(0, 8)}`;
}

function warmPoolMachineMutationError() {
  return {
    error: true,
    message: 'Warm Pool slots are reserved inventory. Claim one by creating a machine from its Machine Template; direct machine lifecycle actions are disabled.',
  };
}

function warmPoolProfiles() {
  const raw = process.env.V2_WARM_POOL_PROFILES?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const profiles = parsed.flatMap((item) => {
          const r = jsonRecord(item);
          const vcpu = Number(r.vcpu);
          const memoryGb = Number(r.memory_gb ?? r.memoryGb);
          const diskGb = Number(r.disk_gb ?? r.diskGb);
          return Number.isInteger(vcpu) && Number.isInteger(memoryGb) && Number.isInteger(diskGb) && vcpu > 0 && memoryGb > 0 && diskGb > 0
            ? [{ vcpu, memory_gb: memoryGb, disk_gb: diskGb }]
            : [];
        });
        if (profiles.length) return profiles;
      }
    } catch {
      // fall back to the product default profile
    }
  }
  return [{ vcpu: 2, memory_gb: 2, disk_gb: 10 }];
}

function warmPoolTarget() {
  const parsed = Number.parseInt(process.env.V2_WARM_POOL_TARGET ?? '1', 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(WARM_POOL_POLICY_TARGET_MAX, parsed)) : 1;
}

function imagePreparationResources(base?: { vcpu?: number | null; memory_gb?: number | null; disk_gb?: number | null }) {
  return {
    vcpu: Math.max(Number(base?.vcpu ?? 0) || 0, envInt('V2_IMAGE_PREP_VCPU', 2, 1, 32)),
    memory_gb: Math.max(Number(base?.memory_gb ?? 0) || 0, envInt('V2_IMAGE_PREP_MEMORY_GB', 2, 1, 128)),
    disk_gb: Math.max(Number(base?.disk_gb ?? 0) || 0, envInt('V2_IMAGE_PREP_DISK_GB', 10, 4, 10_000)),
  };
}

function warmPoolMaintainerEnabled() {
  return ['1', 'true', 'on', 'yes'].includes((process.env.V2_WARM_POOL_ENABLED ?? '').toLowerCase());
}

function warmPoolKey(input: { region: string; type: string; sourceType: string; sourceId: string; resources: { vcpu: number; memory_gb: number; disk_gb: number } }) {
  return `${input.region}:${input.type}:${input.sourceType}:${input.sourceId}:${input.resources.vcpu}c:${input.resources.memory_gb}g:${input.resources.disk_gb}d`;
}

function warmPoolSpecFromCreate(input: CreateMachineInput): WarmPoolSpec | null {
  if (input.source.type !== 'image') return null;
  const sourceId = input.source.image_id;
  return {
    region: input.region,
    type: input.type,
    sourceType: 'image',
    sourceId,
    resources: input.resources,
    key: warmPoolKey({ region: input.region, type: input.type, sourceType: 'image', sourceId, resources: input.resources }),
  };
}

function warmPoolSpecFromPolicy(policy: PrismaWarmPoolPolicy): WarmPoolSpec {
  const resources = machineResourceKey(policy.resources);
  const sourceType = policy.sourceType === 'snapshot' ? 'snapshot' : 'image';
  return {
    accountId: policy.accountId,
    policyId: policy.id,
    mode: normalizeWarmPoolMode(policy.billingMode),
    region: policy.region as SupportedRegion,
    type: policy.type === 'vm' ? 'vm' : 'container',
    sourceType,
    sourceId: policy.sourceId,
    resources,
    key: warmPoolKey({ region: policy.region, type: policy.type, sourceType, sourceId: policy.sourceId, resources }),
  };
}

function machineResourceKey(resources: unknown) {
  const r = jsonRecord(resources);
  return {
    vcpu: Number(r.vcpu ?? 0),
    memory_gb: Number(r.memory_gb ?? 0),
    disk_gb: Number(r.disk_gb ?? 0),
  };
}

function matchesWarmPoolSpec(machine: PrismaMachine, spec: WarmPoolSpec) {
  const r = machineResourceKey(machine.resources);
  return matchesWarmPoolSourceSpec(machine, spec)
    && machine.type === spec.type
    && machine.sourceType === spec.sourceType
    && machine.sourceId === spec.sourceId
    && r.vcpu === spec.resources.vcpu
    && r.memory_gb === spec.resources.memory_gb
    && r.disk_gb === spec.resources.disk_gb;
}

function matchesWarmPoolSourceSpec(machine: PrismaMachine, spec: WarmPoolSpec) {
  return isWarmPoolStatus(machine.status)
    && machine.region === spec.region
    && machine.type === spec.type
    && machine.sourceType === spec.sourceType
    && machine.sourceId === spec.sourceId;
}

function resourcesEqual(a: { vcpu: number; memory_gb: number; disk_gb: number }, b: { vcpu: number; memory_gb: number; disk_gb: number }) {
  return a.vcpu === b.vcpu && a.memory_gb === b.memory_gb && a.disk_gb === b.disk_gb;
}

function warmPoolResizeScore(base: { vcpu: number; memory_gb: number; disk_gb: number }, target: { vcpu: number; memory_gb: number; disk_gb: number }) {
  if (resourcesEqual(base, target)) return 0;
  const diskShrinkPenalty = base.disk_gb > target.disk_gb ? 1_000 : 0;
  return 1
    + diskShrinkPenalty
    + Math.abs(base.vcpu - target.vcpu) / Math.max(target.vcpu, 1)
    + Math.abs(base.memory_gb - target.memory_gb) / Math.max(target.memory_gb, 1)
    + Math.abs(base.disk_gb - target.disk_gb) / Math.max(target.disk_gb, 1);
}

function customerVisibleMachineWhere(): Prisma.MachineWhereInput {
  return { NOT: { status: { in: ['deleted', WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } };
}

function clusterById(config: AppConfig, clusterId: string) {
  return config.clusters.find((cluster) => cluster.id === clusterId) ?? null;
}

function warmPoolSourceIdentity(source: WarmPoolPolicyInput['source'] | CreateMachineInput['source']) {
  if (source.type !== 'image') return null;
  return { sourceType: 'image' as const, sourceId: source.image_id };
}

const BYTES_PER_GIB = 1024 ** 3;

function billableGib(bytes: number) {
  return bytes / BYTES_PER_GIB;
}

function exactPositiveBytes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function usageBytesFromRecord(value: unknown): number | null {
  const record = jsonRecord(value);
  const direct = exactPositiveBytes(record.usage) ?? exactPositiveBytes(record.used) ?? exactPositiveBytes(record.bytes) ?? exactPositiveBytes(record.metered_bytes);
  if (direct) return direct;
  for (const key of ['usage', 'used']) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const nestedValue = usageBytesFromRecord(nested);
      if (nestedValue) return nestedValue;
    }
  }
  return null;
}

function rootDiskUsageBytesFromState(state: IncusInstanceState | Record<string, unknown> | null | undefined): number | null {
  const disk = jsonRecord(jsonRecord(state).disk);
  const entries = Object.entries(disk);
  const root = entries.find(([name, value]) => name === 'root' || name === '/' || jsonRecord(value).path === '/');
  if (root) {
    const value = usageBytesFromRecord(root[1]);
    if (value) return value;
  }
  const candidates = entries.map(([, value]) => usageBytesFromRecord(value)).filter((value): value is number => Boolean(value));
  return candidates.length ? Math.max(...candidates) : null;
}

function storageVolumeUsageBytesFromState(state: Record<string, unknown> | null | undefined): number | null {
  return usageBytesFromRecord(state);
}

function storageUsageAttribution(input: {
  bytes: number;
  source: string;
  measuredAt?: string;
  diskLimitGb?: number;
  estimated?: boolean;
  error?: string;
}) {
  const gib = billableGib(input.bytes);
  return {
    storage_class: 'local',
    metered_bytes: Math.round(input.bytes),
    billable_gib: Number(gib.toFixed(9)),
    disk_limit_gb: input.diskLimitGb ?? null,
    estimated: input.estimated === true,
    measured_at: input.measuredAt ?? nowIso(),
    source: input.source,
    ...(input.error ? { error: input.error } : {}),
  };
}

function warmPoolStorageUsage(row: PrismaMachine) {
  const usage = jsonRecord(jsonRecord(row.metadata).warm_pool).storage_usage;
  const r = jsonRecord(usage);
  const bytes = exactPositiveBytes(r.metered_bytes);
  if (!bytes) return null;
  return storageUsageAttribution({
    bytes,
    source: typeof r.source === 'string' ? r.source : 'stored',
    measuredAt: typeof r.measured_at === 'string' ? r.measured_at : undefined,
    diskLimitGb: Number(r.disk_limit_gb ?? machineResourceKey(row.resources).disk_gb) || undefined,
    estimated: r.estimated === true,
    error: typeof r.error === 'string' ? r.error : undefined,
  });
}

function warmPoolEstimateFromStorageUsages(
  resources: { vcpu: number; memory_gb: number; disk_gb: number },
  target: number,
  usages: Array<ReturnType<typeof storageUsageAttribution>>,
  rowCount: number,
  mode: WarmPoolMode = WARM_POOL_DEFAULT_MODE,
) {
  const exactUsages = usages.filter((usage) => usage.estimated !== true);
  const totalBytes = exactUsages.reduce((sum, usage) => sum + usage.metered_bytes, 0);
  const totalGib = billableGib(totalBytes);
  const measuredCount = exactUsages.length;
  return {
    mode,
    pool_mode: mode === WARM_POOL_RUNNING_MODE ? 'running' : 'stopped',
    target,
    metered_bytes: totalBytes,
    billable_gib: Number(totalGib.toFixed(9)),
    measured_instances: measuredCount,
    estimated_instances: usages.length - measuredCount,
    unmeasured_instances: Math.max(0, rowCount - measuredCount),
    running_instances: mode === WARM_POOL_RUNNING_MODE ? rowCount : 0,
    disk_limit_gb_per_instance: resources.disk_gb,
    disk_limit_gb_total_cap: resources.disk_gb * target,
    note: mode === WARM_POOL_RUNNING_MODE
      ? 'Running pool reservations keep CPU/RAM hot for instant takeover. Usage is finalized centrally in Billing API v2; disk_gb is only the per-instance cap.'
      : 'Stopped pool reservations report actual measured local storage used by primed rows. Usage is finalized centrally in Billing API v2; disk_gb is only the per-instance cap.',
  };
}

function warmPoolEstimate(resources: { vcpu: number; memory_gb: number; disk_gb: number }, target: number, rows: PrismaMachine[] = [], mode: WarmPoolMode = WARM_POOL_DEFAULT_MODE) {
  const usages = rows.map(warmPoolStorageUsage).filter((usage): usage is ReturnType<typeof storageUsageAttribution> => Boolean(usage));
  return warmPoolEstimateFromStorageUsages(resources, target, usages, rows.length, mode);
}

function storedWarmPoolStorageUsageRecord(row: PrismaMachine) {
  const usage = jsonRecord(jsonRecord(row.metadata).warm_pool).storage_usage;
  const r = jsonRecord(usage);
  return typeof r.measured_at === 'string' && typeof r.metered_bytes === 'number' ? r : null;
}

async function measureInstanceStorageUsage(input: {
  client: IncusClient;
  cluster: IncusClusterConfig;
  instanceName: string;
  memberName?: string | null;
  machineType: 'container' | 'vm';
  diskLimitGb?: number;
  allowExecFallback?: boolean;
}) {
  const measuredAt = nowIso();
  const errors: string[] = [];
  if (input.cluster.rootPool) {
    try {
      const volumeState = await input.client.getStorageVolumeState({
        pool: input.cluster.rootPool,
        type: input.machineType === 'vm' ? 'virtual-machine' : 'container',
        name: input.instanceName,
        targetMember: input.memberName,
      });
      const bytes = storageVolumeUsageBytesFromState(volumeState);
      if (bytes) return storageUsageAttribution({ bytes, source: 'incus-storage-volume-state', measuredAt, diskLimitGb: input.diskLimitGb });
      errors.push('storage volume state did not contain usage bytes');
    } catch (error) {
      errors.push(`storage volume state: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push('cluster rootPool not configured');
  }
  try {
    const instanceState = await input.client.getInstanceState(input.instanceName);
    const bytes = rootDiskUsageBytesFromState(instanceState);
    if (bytes) return storageUsageAttribution({ bytes, source: 'incus-instance-state', measuredAt, diskLimitGb: input.diskLimitGb });
    errors.push('instance state did not contain root disk usage bytes');
  } catch (error) {
    errors.push(`instance state: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (input.allowExecFallback) {
    try {
      const result = await input.client.exec(input.instanceName, { command: ['/bin/sh', '-lc', 'du -sB1x / 2>/dev/null | cut -f1'], timeoutMs: 30_000 });
      const bytes = exactPositiveBytes(result.stdout.trim());
      if (bytes) return storageUsageAttribution({ bytes, source: 'guest-du-logical-fallback', measuredAt, diskLimitGb: input.diskLimitGb, estimated: true });
      errors.push(`guest du did not return bytes: ${result.stderr || result.stdout}`);
    } catch (error) {
      errors.push(`guest du: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return storageUsageAttribution({ bytes: 0, source: 'unmeasured', measuredAt, diskLimitGb: input.diskLimitGb, estimated: true, error: errors.join('; ') });
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function compactUsabilityResult(value: unknown) {
  const r = jsonRecord(value);
  return Object.fromEntries(Object.entries({
    ok: r.ok,
    duration_ms: r.duration_ms,
    attempts: r.attempts,
    present: r.present,
    active: r.active,
    exit_code: r.exit_code,
    version: r.version,
    daemon_source: r.daemon_source,
    token_prefix: r.token_prefix,
    health: r.health,
    error: typeof r.error === 'string' ? r.error.slice(0, 1000) : r.error,
  }).filter(([, item]) => item !== undefined));
}

async function timedUsabilityStep<T>(input: {
  steps: Record<string, unknown>[];
  name: string;
  telemetry?: MachineCreationTelemetry | null;
  details?: Record<string, unknown>;
  run: () => Promise<T>;
}) {
  const startedAtMs = Date.now();
  const startedAt = nowIso();
  try {
    const result = input.telemetry
      ? await withTelemetrySpan(input.telemetry, `usable: ${input.name}`, input.run, input.details)
      : await input.run();
    input.steps.push({
      name: input.name,
      status: 'ok',
      started_at: startedAt,
      ended_at: nowIso(),
      duration_ms: elapsedMs(startedAtMs),
      result: compactUsabilityResult(result),
    });
    return result;
  } catch (error) {
    input.steps.push({
      name: input.name,
      status: 'error',
      started_at: startedAt,
      ended_at: nowIso(),
      duration_ms: elapsedMs(startedAtMs),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function ensureMachineUsable(input: {
  config: AppConfig;
  client: IncusClient;
  instanceName: string;
  machineId: string;
  mode: 'warm-pool-prime' | 'warm-pool-prime-second-boot' | 'warm-pool-claim' | 'cold-create' | 'machine-start' | 'image-bake';
  telemetry?: MachineCreationTelemetry | null;
  installManagedDaemon?: boolean;
  repairManagedDaemon?: boolean;
  waitForCloudInit?: boolean;
  actualLiveProbe?: boolean;
  managedDaemonStepName?: string;
  verifyPort?: number | null;
  execTimeoutMs?: number;
  cloudInitTimeoutMs?: number;
  daemonHealthTimeoutMs?: number;
}) {
  const startedAtMs = Date.now();
  const startedAt = nowIso();
  const steps: Record<string, unknown>[] = [];

  if (input.actualLiveProbe && !input.installManagedDaemon) {
    let managedDaemon: Record<string, unknown> | null = null;
    let repairedManagedDaemon = false;
    if (input.repairManagedDaemon && (input.config.daemonLocalPath || input.config.daemonMountSource)) {
      const daemon = await timedUsabilityStep({
        steps,
        name: 'activate injected managed daemon',
        telemetry: input.telemetry,
        details: { mode: input.mode, instance: input.instanceName },
        run: () => ensureManagedDaemon({
          config: input.config,
          client: input.client,
          instanceName: input.instanceName,
          machineId: input.machineId,
          verifyPort: input.verifyPort ?? null,
        }),
      });
      managedDaemon = daemon as unknown as Record<string, unknown>;
      repairedManagedDaemon = true;
      if (!daemon.ok) throw new Error(`Injected daemon activation did not make ${input.machineId} ready: ${daemon.error ?? 'unknown daemon error'}`);
      const endedAt = nowIso();
      return {
        ok: true,
        mode: input.mode,
        contract: 'actual-live',
        started_at: startedAt,
        ended_at: endedAt,
        ready_at: endedAt,
        duration_ms: elapsedMs(startedAtMs),
        exec_ready: compactUsabilityResult(daemon),
        cloud_init: { ok: true, duration_ms: 0, skipped: true, reason: 'not part of claim hot path' },
        daemon_health: compactUsabilityResult(daemon),
        file_api_ready: true,
        command_api_ready: true,
        managed_daemon: managedDaemon,
        managed_daemon_state: 'ready',
        repaired_managed_daemon: repairedManagedDaemon,
        warnings: [],
        steps,
      };
    }
    let live = await timedUsabilityStep({
      steps,
      name: 'actual live: command file daemon',
      telemetry: input.telemetry,
      details: { mode: input.mode, instance: input.instanceName },
      run: () => waitForJustavpsLive({ client: input.client, instanceName: input.instanceName, timeoutMs: input.execTimeoutMs ?? 90_000 }),
    });
    if (!live.ok && input.repairManagedDaemon) {
      repairedManagedDaemon = true;
      const restarted = await timedUsabilityStep({
        steps,
        name: 'restart managed daemon service',
        telemetry: input.telemetry,
        details: { mode: input.mode, instance: input.instanceName },
        run: () => restartManagedDaemonService({ client: input.client, instanceName: input.instanceName, timeoutMs: 10_000 }),
      });
      if (restarted.ok) {
        live = await timedUsabilityStep({
          steps,
          name: 'actual live: command file daemon after restart',
          telemetry: input.telemetry,
          details: { mode: input.mode, instance: input.instanceName },
          run: () => waitForJustavpsLive({ client: input.client, instanceName: input.instanceName, timeoutMs: 15_000 }),
        });
      }
      if (!live.ok) {
        const daemon = await timedUsabilityStep({
          steps,
          name: 'repair managed daemon',
          telemetry: input.telemetry,
          details: { mode: input.mode, instance: input.instanceName },
          run: () => ensureManagedDaemon({
            config: input.config,
            client: input.client,
            instanceName: input.instanceName,
            machineId: input.machineId,
            verifyPort: input.verifyPort ?? null,
          }),
        });
        managedDaemon = daemon as unknown as Record<string, unknown>;
        if (!daemon.ok) throw new Error(`Managed daemon repair did not make ${input.machineId} actually live: ${daemon.error ?? 'unknown daemon error'}`);
        live = await timedUsabilityStep({
          steps,
          name: 'actual live: command file daemon after repair',
          telemetry: input.telemetry,
          details: { mode: input.mode, instance: input.instanceName },
          run: () => waitForJustavpsLive({ client: input.client, instanceName: input.instanceName, timeoutMs: 15_000 }),
        });
      }
    }
    if (!live.ok) throw new Error(`Machine ${input.machineId} did not become actually live: ${live.error ?? live.stderr ?? 'timeout'}`);
    const endedAt = nowIso();
    return {
      ok: true,
      mode: input.mode,
      contract: 'actual-live',
      started_at: startedAt,
      ended_at: endedAt,
      ready_at: endedAt,
      duration_ms: elapsedMs(startedAtMs),
      exec_ready: compactUsabilityResult(live),
      cloud_init: { ok: true, duration_ms: 0, skipped: true, reason: 'not part of claim hot path' },
      daemon_health: compactUsabilityResult(live),
      file_api_ready: true,
      command_api_ready: true,
      managed_daemon: managedDaemon,
      managed_daemon_state: 'ready',
      repaired_managed_daemon: repairedManagedDaemon,
      warnings: [],
      steps,
    };
  }

  const execReady = await timedUsabilityStep({
    steps,
    name: 'incus exec ready',
    telemetry: input.telemetry,
    details: { mode: input.mode, instance: input.instanceName },
    run: () => waitForGuestExecReady({ client: input.client, instanceName: input.instanceName, timeoutMs: input.execTimeoutMs ?? 90_000 }),
  });
  if (!execReady.ok) throw new Error(`Machine ${input.machineId} did not become Incus-exec-ready: ${execReady.error ?? execReady.stderr ?? 'timeout'}`);

  const cloudInit = input.waitForCloudInit === false
    ? { ok: true, checked_at: nowIso(), duration_ms: 0, present: false, exit_code: 0, stdout: 'JUSTAVPS_CLOUD_INIT_SKIPPED_FOR_PRIMED_INSTANCE', stderr: '' }
    : await timedUsabilityStep({
      steps,
      name: 'cloud-init done',
      telemetry: input.telemetry,
      details: { mode: input.mode, instance: input.instanceName },
      run: () => waitForCloudInitDone({ client: input.client, instanceName: input.instanceName, timeoutMs: input.cloudInitTimeoutMs ?? 180_000 }),
    });
  if (input.waitForCloudInit === false) {
    steps.push({ name: 'cloud-init done', status: 'skipped', started_at: cloudInit.checked_at, ended_at: cloudInit.checked_at, duration_ms: 0, result: compactUsabilityResult(cloudInit), reason: 'already completed during warm-pool priming' });
  }

  let managedDaemon: Record<string, unknown> | null = null;
  let daemonHealth: Record<string, unknown> | null = null;
  let repairedManagedDaemon = false;

  if (input.installManagedDaemon) {
    const daemon = await timedUsabilityStep({
      steps,
      name: input.managedDaemonStepName ?? 'install managed daemon',
      telemetry: input.telemetry,
      details: { mode: input.mode, instance: input.instanceName },
      run: () => ensureManagedDaemon({
        config: input.config,
        client: input.client,
        instanceName: input.instanceName,
        machineId: input.machineId,
        verifyPort: input.verifyPort ?? null,
      }),
    });
    managedDaemon = daemon as unknown as Record<string, unknown>;
    daemonHealth = compactUsabilityResult(daemon);
    if (!daemon.ok) throw new Error(`Managed daemon did not become ready for ${input.machineId}: ${daemon.error ?? 'unknown daemon error'}`);
  } else {
    const health = await timedUsabilityStep({
      steps,
      name: 'managed daemon health',
      telemetry: input.telemetry,
      details: { mode: input.mode, instance: input.instanceName },
      run: () => waitForManagedDaemonHealth({ client: input.client, instanceName: input.instanceName, timeoutMs: input.daemonHealthTimeoutMs ?? 60_000 }),
    });
    daemonHealth = health as unknown as Record<string, unknown>;
    if (!health.ok && input.repairManagedDaemon) {
      repairedManagedDaemon = true;
      const restarted = await timedUsabilityStep({
        steps,
        name: 'restart managed daemon service',
        telemetry: input.telemetry,
        details: { mode: input.mode, instance: input.instanceName },
        run: () => restartManagedDaemonService({
          client: input.client,
          instanceName: input.instanceName,
          timeoutMs: 10_000,
        }),
      });
      daemonHealth = restarted as unknown as Record<string, unknown>;
      if (!restarted.ok) {
        const daemon = await timedUsabilityStep({
          steps,
          name: 'repair managed daemon',
          telemetry: input.telemetry,
          details: { mode: input.mode, instance: input.instanceName },
          run: () => ensureManagedDaemon({
            config: input.config,
            client: input.client,
            instanceName: input.instanceName,
            machineId: input.machineId,
            verifyPort: input.verifyPort ?? null,
          }),
        });
        managedDaemon = daemon as unknown as Record<string, unknown>;
        daemonHealth = compactUsabilityResult(daemon);
        if (!daemon.ok) throw new Error(`Managed daemon repair did not make ${input.machineId} usable: ${daemon.error ?? 'unknown daemon error'}`);
      }
    } else if (!health.ok) {
      throw new Error(`Managed daemon health did not become ready for ${input.machineId}: ${health.error ?? health.stderr ?? 'timeout'}`);
    }
  }

  const actualLive = input.actualLiveProbe
    ? await timedUsabilityStep({
      steps,
      name: 'actual live: command file daemon',
      telemetry: input.telemetry,
      details: { mode: input.mode, instance: input.instanceName },
      run: () => waitForJustavpsLive({ client: input.client, instanceName: input.instanceName, timeoutMs: input.execTimeoutMs ?? 90_000 }),
    })
    : null;
  if (actualLive && !actualLive.ok) throw new Error(`Machine ${input.machineId} did not become actually live: ${actualLive.error ?? actualLive.stderr ?? 'timeout'}`);

  const endedAt = nowIso();
  return {
    ok: true,
    mode: input.mode,
    ...(actualLive ? { contract: 'actual-live' } : {}),
    started_at: startedAt,
    ended_at: endedAt,
    ready_at: endedAt,
    duration_ms: elapsedMs(startedAtMs),
    exec_ready: compactUsabilityResult(execReady),
    cloud_init: compactUsabilityResult(cloudInit),
    daemon_health: daemonHealth ? compactUsabilityResult(daemonHealth) : null,
    actual_live: actualLive ? compactUsabilityResult(actualLive) : null,
    file_api_ready: actualLive ? true : undefined,
    command_api_ready: actualLive ? true : undefined,
    managed_daemon: managedDaemon,
    managed_daemon_state: 'ready',
    repaired_managed_daemon: repairedManagedDaemon,
    warnings: cloudInit.ok ? [] : [`cloud-init did not report clean completion: ${cloudInit.error ?? cloudInit.stderr ?? cloudInit.stdout ?? 'unknown'}`],
    steps,
  };
}

function p50(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

function warmPoolRowUsableLatencyMs(row: PrismaMachine) {
  const meta = jsonRecord(row.metadata);
  const usability = jsonRecord(meta.usability);
  const warmPool = jsonRecord(meta.warm_pool);
  const claimUsability = jsonRecord(warmPool.claim_usability);
  const primeTelemetry = jsonRecord(warmPool.prime_telemetry);
  for (const value of [claimUsability.duration_ms, usability.duration_ms, primeTelemetry.duration_ms]) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const creationTelemetry = jsonRecord(meta.creation_telemetry);
  const spans = Array.isArray(creationTelemetry.spans) ? creationTelemetry.spans : [];
  const usableSpans = spans.flatMap((span) => {
    const s = jsonRecord(span);
    return typeof s.name === 'string' && s.name.startsWith('usable:') ? [Number(s.duration_ms)] : [];
  }).filter((value) => Number.isFinite(value) && value > 0);
  return p50(usableSpans as number[]);
}

async function fastestWarmPoolPlacementHint(spec: WarmPoolSpec, preferredClusterId?: string | null) {
  if (!loadConfigSafeDatabaseConfigured()) return null;
  const rows = await getPrisma().machine.findMany({
    where: {
      region: spec.region,
      type: spec.type,
      sourceType: spec.sourceType,
      sourceId: spec.sourceId,
      status: { not: 'deleted' },
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  }).catch(() => []);
  const samples = new Map<string, { clusterId: string; memberName: string; values: number[] }>();
  for (const row of rows) {
    if (!row.incusMemberName) continue;
    const resources = machineResourceKey(row.resources);
    if (resources.vcpu !== spec.resources.vcpu || resources.memory_gb !== spec.resources.memory_gb || resources.disk_gb !== spec.resources.disk_gb) continue;
    if (preferredClusterId && row.incusClusterId !== preferredClusterId) continue;
    const value = warmPoolRowUsableLatencyMs(row);
    if (!value) continue;
    const key = `${row.incusClusterId}:${row.incusMemberName}`;
    const group = samples.get(key) ?? { clusterId: row.incusClusterId, memberName: row.incusMemberName, values: [] as number[] };
    group.values.push(value);
    samples.set(key, group);
  }
  const ranked = [...samples.values()]
    .map((sample) => ({ ...sample, p50_ms: p50(sample.values), samples: sample.values.length }))
    .filter((sample): sample is { clusterId: string; memberName: string; values: number[]; p50_ms: number; samples: number } => sample.p50_ms !== null)
    .sort((a, b) => a.p50_ms - b.p50_ms || b.samples - a.samples);
  const best = ranked[0];
  return best ? { cluster_id: best.clusterId, member_name: best.memberName, p50_ms: best.p50_ms, samples: best.samples, source: 'warm-pool-usable-latency' } : null;
}

async function balancedWarmPoolPlacementHint(config: AppConfig, spec: WarmPoolSpec, preferredClusterId?: string | null) {
  if (!config.databaseConfigured) return null;
  const clusters = config.clusters.filter((cluster) => cluster.region === spec.region && (!preferredClusterId || cluster.id === preferredClusterId));
  const candidates: Array<{ cluster_id: string; member_name: string; pool_count: number }> = [];
  for (const cluster of clusters) {
    const client = clientFor(cluster);
    const members = await client.listClusterMembers().catch(() => []);
    const online = members.filter((member) => member.status === 'Online');
    const hostState = await hostSchedulabilityByMember(cluster.id, online.map((member) => member.server_name)).catch(() => new Map());
    const rows = await getPrisma().machine.findMany({
      where: {
        accountId: spec.accountId ?? WARM_POOL_ACCOUNT_ID,
        status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] },
        incusClusterId: cluster.id,
        region: spec.region,
        type: spec.type,
        sourceType: spec.sourceType,
        sourceId: spec.sourceId,
      },
    }).catch(() => []);
    const matching = rows.filter((row) => {
      if (!matchesWarmPoolSpec(row, spec)) return false;
      const warm = jsonRecord(jsonRecord(row.metadata).warm_pool);
      return warm.policy_id === spec.policyId && normalizeWarmPoolMode(warm.mode) === normalizeWarmPoolMode(spec.mode);
    });
    for (const member of online) {
      const host = hostState.get(member.server_name);
      if (host && !host.schedulable) continue;
      candidates.push({
        cluster_id: cluster.id,
        member_name: member.server_name,
        pool_count: matching.filter((row) => row.incusMemberName === member.server_name).length,
      });
    }
  }
  const best = candidates.sort((a, b) => a.pool_count - b.pool_count || a.member_name.localeCompare(b.member_name))[0];
  return best ? { ...best, source: 'warm-pool-balanced-spread' } : null;
}

async function activeWarmPoolPoliciesForSpec(accountId: string, spec: WarmPoolSpec) {
  const policies = await activeWarmPoolPoliciesForSource(accountId, spec);
  return policies.filter((policy) => {
    const resources = machineResourceKey(policy.resources);
    return resources.vcpu === spec.resources.vcpu
      && resources.memory_gb === spec.resources.memory_gb
      && resources.disk_gb === spec.resources.disk_gb;
  });
}

async function activeWarmPoolPoliciesForSource(accountId: string, spec: WarmPoolSpec) {
  return getPrisma().warmPoolPolicy.findMany({
    where: {
      accountId,
      status: 'active',
      region: spec.region,
      type: spec.type,
      sourceType: spec.sourceType,
      sourceId: spec.sourceId,
      target: { gt: 0 },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

function serializeWarmPoolPolicy(policy: PrismaWarmPoolPolicy, poolRows: PrismaMachine[] = []) {
  const spec = warmPoolSpecFromPolicy(policy);
  const mode = normalizeWarmPoolMode(policy.billingMode);
  const matchingRows = poolRows.filter((row) => {
    const warm = jsonRecord(jsonRecord(row.metadata).warm_pool);
    return matchesWarmPoolSpec(row, spec) && warm.policy_id === policy.id && normalizeWarmPoolMode(warm.mode) === mode;
  });
  const ready = matchingRows.filter((row) => row.status === WARM_POOL_STATUS).length;
  const claiming = matchingRows.filter((row) => row.status === WARM_POOL_CLAIMING_STATUS).length;
  return {
    id: policy.id,
    account_id: policy.accountId,
    name: policy.name,
    status: policy.status,
    mode,
    pool_mode: mode === WARM_POOL_RUNNING_MODE ? 'running' : 'stopped',
    region: policy.region,
    type: policy.type,
    source: { type: policy.sourceType, id: policy.sourceId },
    resources: spec.resources,
    target: policy.target,
    ready,
    claiming,
    billing: warmPoolEstimate(spec.resources, policy.target, matchingRows, mode),
    metadata: policy.metadata,
    created_at: policy.createdAt.toISOString(),
    updated_at: policy.updatedAt.toISOString(),
  };
}

function warmPoolSpecLockKey(spec: WarmPoolSpec) {
  return `${spec.accountId ?? WARM_POOL_ACCOUNT_ID}:${spec.policyId ?? 'legacy'}:${normalizeWarmPoolMode(spec.mode)}:${spec.key}`;
}

function prismaMachineFromRaw(row: Record<string, any>): PrismaMachine {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    region: String(row.region),
    type: String(row.type),
    status: String(row.status),
    sourceType: String(row.source_type),
    sourceId: row.source_id === null || row.source_id === undefined ? null : String(row.source_id),
    incusClusterId: String(row.incus_cluster_id),
    incusProject: String(row.incus_project),
    incusInstanceName: String(row.incus_instance_name),
    incusMemberName: row.incus_member_name === null || row.incus_member_name === undefined ? null : String(row.incus_member_name),
    resources: row.resources,
    metadata: row.metadata,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

async function reserveWarmPoolCandidateAtomic(input: {
  prisma: ReturnType<typeof getPrisma>;
  accountId: string;
  spec: WarmPoolSpec;
  policies: PrismaWarmPoolPolicy[];
  preferredModes: WarmPoolMode[];
}) {
  const policyIds = input.policies.map((policy) => policy.id);
  if (!policyIds.length) return null;
  const resourcesJson = JSON.stringify(input.spec.resources);
  const modes = input.preferredModes;
  const claimedAt = new Date().toISOString();
  const rows = await input.prisma.$queryRawUnsafe<Record<string, any>[]>(`
    UPDATE v2_core.machines
    SET status = $1,
        metadata = jsonb_set(
          metadata,
          '{warm_pool}',
          COALESCE(metadata->'warm_pool', '{}'::jsonb) || jsonb_build_object('claimed_at', $2::text, 'claimed_by', $3::text),
          true
        ),
        updated_at = now()
    WHERE id = (
      SELECT id
      FROM v2_core.machines
      WHERE account_id = $3
        AND status = $4
        AND region = $5
        AND type = $6
        AND source_type = $7
        AND source_id = $8
        AND resources = $9::jsonb
        AND metadata->'warm_pool'->>'policy_id' = ANY($10::text[])
        AND metadata->'warm_pool'->>'mode' = ANY($11::text[])
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `,
    WARM_POOL_CLAIMING_STATUS,
    claimedAt,
    input.accountId,
    WARM_POOL_STATUS,
    input.spec.region,
    input.spec.type,
    input.spec.sourceType,
    input.spec.sourceId,
    resourcesJson,
    policyIds,
    modes,
  );
  return rows[0] ? prismaMachineFromRaw(rows[0]) : null;
}

async function validateWarmPoolPolicyInput(_config: AppConfig, input: WarmPoolPolicyInput, _accountId: string): Promise<WarmPoolPolicyValidation> {
  const source = warmPoolSourceIdentity(input.source);
  if (!source) return { error: { status: 400, body: { error: true as const, message: 'Pool policies currently support image sources only' } } };
  if (source.sourceType === 'image') {
    return { source };
  }
  return { error: { status: 400, body: { error: true as const, message: 'Pool policies currently support image sources only' } } };
}

async function claimWarmPoolMachine(config: AppConfig, spec: WarmPoolSpec, input: CreateMachineInput, displayName: string, accountId: string, strategy: MachineStartStrategy, telemetry?: MachineCreationTelemetry) {
  if (!config.databaseConfigured) return null;
  if (spec.type !== 'container') return null;
  const preferredModes = warmPoolModesForStartStrategy(strategy);
  if (!preferredModes.length) return null;
  const prisma = getPrisma();
  const span = <T>(name: string, fn: () => Promise<T>, details?: Record<string, unknown>) => (
    telemetry ? withTelemetrySpan(telemetry, name, fn, details) : fn()
  );
  const policies = (await span('warm pool: load active policies', () => activeWarmPoolPoliciesForSource(accountId, spec), { source_key: spec.key, requested_resources: spec.resources, strategy, preferred_modes: preferredModes })).filter((policy) => preferredModes.includes(normalizeWarmPoolMode(policy.billingMode)));
  if (!policies.length) return null;
  const policiesById = new Map(policies.map((policy) => [policy.id, policy]));
  const policyIds = new Set(policies.map((policy) => policy.id));
  const atomicCandidate = await span('warm pool: reserve atomic candidate row', () => reserveWarmPoolCandidateAtomic({ prisma, accountId, spec, policies, preferredModes }), { policy_count: policies.length, preferred_modes: preferredModes });
  const usingAtomicCandidates = Boolean(atomicCandidate);
  const candidateLimit = atomicCandidate ? 1 : Math.min(
    WARM_POOL_POLICY_TARGET_MAX,
    Math.max(100, policies.reduce((sum, policy) => sum + policy.target, 0)),
  );
  const candidates = atomicCandidate ? [atomicCandidate] : await span('warm pool: load template candidates', () => prisma.machine.findMany({
    where: {
      accountId,
      status: WARM_POOL_STATUS,
      region: spec.region,
      type: spec.type,
      sourceType: spec.sourceType,
      sourceId: spec.sourceId,
    },
    orderBy: { updatedAt: 'asc' },
    take: candidateLimit,
  }), { policy_count: policies.length, candidate_limit: candidateLimit, flexible_template_match: true });

  const rankedCandidates = [...candidates].sort((a, b) => {
    const aWarm = jsonRecord(jsonRecord(a.metadata).warm_pool);
    const bWarm = jsonRecord(jsonRecord(b.metadata).warm_pool);
    const aPolicy = policiesById.get(String(aWarm.policy_id ?? ''));
    const bPolicy = policiesById.get(String(bWarm.policy_id ?? ''));
    const aModeRank = preferredModes.indexOf(normalizeWarmPoolMode(aWarm.mode ?? aPolicy?.billingMode));
    const bModeRank = preferredModes.indexOf(normalizeWarmPoolMode(bWarm.mode ?? bPolicy?.billingMode));
    const aResources = machineResourceKey(a.resources);
    const bResources = machineResourceKey(b.resources);
    const aResizeScore = warmPoolResizeScore(aResources, spec.resources);
    const bResizeScore = warmPoolResizeScore(bResources, spec.resources);
    const aPrimed = aWarm.primed === true ? 0 : 1;
    const bPrimed = bWarm.primed === true ? 0 : 1;
    const aLatency = warmPoolRowUsableLatencyMs(a) ?? Number.POSITIVE_INFINITY;
    const bLatency = warmPoolRowUsableLatencyMs(b) ?? Number.POSITIVE_INFINITY;
    return aModeRank - bModeRank || aResizeScore - bResizeScore || aPrimed - bPrimed || aLatency - bLatency || a.updatedAt.getTime() - b.updatedAt.getTime();
  });

  const attemptedCandidateIds = new Set<string>();
  for (let candidateIndex = 0; candidateIndex < rankedCandidates.length; candidateIndex += 1) {
    const candidate = rankedCandidates[candidateIndex];
    attemptedCandidateIds.add(candidate.id);
    if (!matchesWarmPoolSourceSpec(candidate, spec)) continue;
    const poolMeta = jsonRecord(jsonRecord(candidate.metadata).warm_pool);
    const policyId = typeof poolMeta.policy_id === 'string' ? poolMeta.policy_id : null;
    if (!policyId || !policyIds.has(policyId)) continue;
    const policy = policiesById.get(policyId);
    if (!policy) continue;
    const refillSpec = warmPoolSpecFromPolicy(policy);
    const poolMode = normalizeWarmPoolMode(poolMeta.mode ?? policy.billingMode);
    const candidateResources = machineResourceKey(candidate.resources);
    const resizeNeeded = !resourcesEqual(candidateResources, spec.resources);
    if (candidate.status !== WARM_POOL_CLAIMING_STATUS) {
      const claimed = await span('warm pool: reserve candidate row', () => prisma.machine.updateMany({
        where: { id: candidate.id, status: WARM_POOL_STATUS, accountId },
        data: {
          status: WARM_POOL_CLAIMING_STATUS,
          metadata: {
            ...jsonRecord(candidate.metadata),
            warm_pool: { ...poolMeta, claimed_at: new Date().toISOString(), claimed_by: accountId },
          } as Prisma.InputJsonValue,
        },
      }), { candidate_id: candidate.id, policy_id: policyId });
      if (claimed.count !== 1) continue;
    }

    const cluster = clusterById(config, candidate.incusClusterId);
    if (!cluster) {
      await prisma.machine.update({ where: { id: candidate.id }, data: { status: WARM_POOL_STATUS } }).catch(() => undefined);
      continue;
    }
    const client = clientFor(cluster);
    let startedForClaim = false;
    let stopOnClaimFailure = false;
    let resizeAttempted = false;
    try {
      const previousMeta = jsonRecord(candidate.metadata);
      let resourceOperation: Record<string, unknown> = { synced: true, mode: poolMode === WARM_POOL_RUNNING_MODE ? 'warm-pool-running-takeover' : 'warm-pool-stopped-started', at: new Date().toISOString(), resources: input.resources };
      let isolationCheck = previousMeta.isolation_check ?? null;
      if (resizeNeeded) {
        resizeAttempted = true;
        const resized = await span('warm pool: resize template slot', () => applyResourceConfig(client, candidate.incusInstanceName, cluster, input.resources, {
          machineId: candidate.id,
          displayName,
          machineType: 'container',
          accountId,
        }), {
          candidate_id: candidate.id,
          from_resources: candidateResources,
          to_resources: input.resources,
          policy_id: policyId,
        });
        isolationCheck = resized;
        resourceOperation = {
          synced: true,
          mode: poolMode === WARM_POOL_RUNNING_MODE ? 'warm-pool-running-template-resize-before-takeover' : 'warm-pool-template-resize-before-start',
          at: new Date().toISOString(),
          from_resources: candidateResources,
          resources: input.resources,
          config_operation: resized.config_operation,
          restarted_for_device_patch: resized.restarted_for_device_patch,
        };
      }
      let started: Awaited<ReturnType<typeof startCreatedMachine>> | { operation: null; noop: true } = { operation: null, noop: true };
      let usability: Awaited<ReturnType<typeof ensureMachineUsable>> | Record<string, unknown>;
      let observed: IncusInstance | null = null;
      if (poolMode === WARM_POOL_RUNNING_MODE) {
        observed = await span('warm pool: verify running template slot', () => client.getInstance(candidate.incusInstanceName), { candidate_id: candidate.id, member_name: candidate.incusMemberName });
        if (observed.status?.toLowerCase() !== 'running') {
          started = await span('warm pool: recover running template slot start', () => startCreatedMachine(client, candidate.incusInstanceName), { candidate_id: candidate.id, observed_status: observed.status ?? null });
          startedForClaim = true;
          observed = await client.getInstance(candidate.incusInstanceName).catch(() => observed);
        }
        if (!observed || observed.status?.toLowerCase() !== 'running') throw new Error(`Running pool slot ${candidate.id} is not Running; observed ${observed?.status ?? 'unknown'}`);
        usability = {
          ok: true,
          duration_ms: 0,
          ready_at: new Date().toISOString(),
          mode: 'warm-pool-running-claim',
          reused_live_pool_slot: true,
          repaired_managed_daemon: false,
          source: 'running-pool-validated-at-prime',
        };
      } else {
        startedForClaim = true;
        stopOnClaimFailure = true;
        started = await span('warm pool: incus start stopped instance', () => warmPoolStoppedStartLimiter.run(() => startCreatedMachineInstrumented({
          client,
          name: candidate.incusInstanceName,
          telemetry,
          spanPrefix: 'warm pool: incus start stopped instance',
          details: { candidate_id: candidate.id, member_name: candidate.incusMemberName, start_limiter: warmPoolStoppedStartLimiter.stats() },
        })), { candidate_id: candidate.id, member_name: candidate.incusMemberName, start_concurrency_limit: WARM_POOL_STOPPED_START_CONCURRENCY });
        const previousDaemon = jsonRecord(previousMeta.managed_daemon);
        const autostartValidated = previousMeta.managed_daemon_state === 'ready'
          && previousDaemon.autostart === true
          && previousDaemon.ok === true
          && poolMeta.second_boot_validated === true;
        if (autostartValidated) {
          usability = {
            ok: true,
            duration_ms: 0,
            ready_at: new Date().toISOString(),
            mode: 'warm-pool-stopped-claim',
            reused_stopped_pool_slot: true,
            reused_daemon_autostart: true,
            repaired_managed_daemon: false,
            source: 'stopped-pool-daemon-autostart-validated-at-prime',
          };
        } else {
          usability = await ensureMachineUsable({
            config,
            client,
            instanceName: candidate.incusInstanceName,
            machineId: candidate.id,
            mode: 'warm-pool-claim',
            telemetry,
            installManagedDaemon: false,
            repairManagedDaemon: true,
            waitForCloudInit: false,
            actualLiveProbe: true,
            execTimeoutMs: 5_000,
            daemonHealthTimeoutMs: 5_000,
          });
        }
      }
      const machine = await span('warm pool: persist claimed machine row', () => prisma.machine.update({
        where: { id: candidate.id },
        data: {
          accountId,
          name: displayName,
          status: 'Running',
          sourceType: 'template',
          sourceId: input.template_id,
          resources: input.resources,
          metadata: {
            ...previousMeta,
            display_name: displayName,
            incus_hostname: candidate.incusInstanceName,
            env: input.env ?? {},
            labels: input.labels ?? {},
            lifecycle: input.lifecycle ?? {},
            last_used_at: new Date().toISOString(),
            warm_pool: {
              ...jsonRecord(previousMeta.warm_pool),
              claimed_at: new Date().toISOString(),
              claimed_by: accountId,
              policy_id: policyId,
              source_key: spec.key,
              mode: poolMode,
              pool_mode: poolMode === WARM_POOL_RUNNING_MODE ? 'running' : 'stopped',
              runtime_state: 'claimed_running',
              template_resources: candidateResources,
              requested_resources: input.resources,
              resized_on_claim: resizeNeeded,
              running_takeover: poolMode === WARM_POOL_RUNNING_MODE,
              start_strategy: strategy,
              claim_usability: {
                ok: usability.ok === true,
                duration_ms: typeof usability.duration_ms === 'number' ? usability.duration_ms : 0,
                ready_at: typeof usability.ready_at === 'string' ? usability.ready_at : new Date().toISOString(),
                repaired_managed_daemon: usability.repaired_managed_daemon === true,
              },
            },
            source_template: {
              id: input.template_id,
              image_alias: spec.sourceId,
              requested_resources: input.resources,
              start_strategy: strategy,
              template_resources: candidateResources,
              from_pool: true,
            },
            resource_operation: resourceOperation,
            isolation_check: isolationCheck,
            config_operation: resizeNeeded ? resourceOperation.config_operation ?? null : null,
            config_patch_async: { queued_at: new Date().toISOString(), mode: 'warm-pool-claim' },
            start_operation: started.operation,
            start_noop: started.noop,
            usability,
            managed_daemon: (usability as Record<string, unknown>).managed_daemon ?? previousMeta.managed_daemon ?? (usability as Record<string, unknown>).daemon_health,
            managed_daemon_state: 'ready',
            managed_daemon_checked_at: typeof usability.ready_at === 'string' ? usability.ready_at : new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      }), { candidate_id: candidate.id });
      void client.updateInstanceConfig(candidate.incusInstanceName, {
        'user.justavps.machine_id': candidate.id,
        'user.justavps.machine_name': displayName,
        'user.justavps.display_name': displayName,
        'user.justavps.hostname': candidate.incusInstanceName,
        'user.justavps.account_id': accountId,
      }).catch((error) => console.warn(`[v2-api] async warm pool metadata patch failed for ${candidate.id}:`, error instanceof Error ? error.message : String(error)));
      return { machine, cluster, client, observed, isolation: isolationCheck, startOperation: started.operation, startNoop: started.noop, policyId, refillSpec, resizedOnClaim: resizeNeeded, runningTakeover: poolMode === WARM_POOL_RUNNING_MODE };
    } catch (error) {
      if (startedForClaim && stopOnClaimFailure) {
        await client.stopInstance(candidate.incusInstanceName).catch((stopError) => {
          if (!isLifecycleNoop(stopError, 'stop')) console.warn(`[v2-api] failed to stop warm pool claim failure ${candidate.id}:`, stopError instanceof Error ? stopError.message : String(stopError));
        });
      }
      if (resizeAttempted) {
        await client.deleteInstance(candidate.incusInstanceName, { force: true }).catch(() => undefined);
        await prisma.machine.update({
          where: { id: candidate.id },
          data: { status: 'deleted', metadata: { ...jsonRecord(candidate.metadata), warm_pool_last_claim_error: error instanceof Error ? error.message : String(error), warm_pool_resized_claim_deleted_at: new Date().toISOString() } as Prisma.InputJsonValue },
        }).catch(() => undefined);
        void ensureWarmPoolForSpec(config, refillSpec).catch((refillError) => console.warn('[v2-api] async warm pool refill after resize-claim failure failed:', refillError instanceof Error ? refillError.message : String(refillError)));
        continue;
      }
      await prisma.machine.update({
        where: { id: candidate.id },
        data: { status: WARM_POOL_STATUS, metadata: { ...jsonRecord(candidate.metadata), warm_pool_last_claim_error: error instanceof Error ? error.message : String(error) } as Prisma.InputJsonValue },
      }).catch(() => undefined);
      if (usingAtomicCandidates && rankedCandidates.length < Math.min(10, Math.max(2, policies.reduce((sum, policy) => sum + policy.target, 0)))) {
        const nextCandidate = await span('warm pool: reserve retry candidate row', () => reserveWarmPoolCandidateAtomic({ prisma, accountId, spec, policies, preferredModes }), { previous_candidate_id: candidate.id });
        if (nextCandidate && !attemptedCandidateIds.has(nextCandidate.id)) rankedCandidates.push(nextCandidate);
      }
    }
  }
  return null;
}

async function selectPlacement(config: AppConfig, input: {
  region: SupportedRegion;
  resources: { vcpu: number; memory_gb: number; disk_gb: number };
  targetClusterId?: string | null;
  preferredClusterId?: string | null;
  preferredMemberName?: string | null;
}) {
  const clusterId = input.targetClusterId ?? input.preferredClusterId ?? null;
  let candidates = clusterId ? config.clusters.filter((cluster) => cluster.id === clusterId) : config.clusters.filter((cluster) => cluster.region === input.region);
  if (clusterId && candidates.length === 0) throw new BadRequestError(`Cluster ${clusterId} is not configured`);
  candidates = candidates.filter((cluster) => cluster.region === input.region);
  if (candidates.length === 0) throw new ConflictError(`No Incus cluster configured for region ${input.region}`);

  const attempts = await Promise.all(candidates.map(async (cluster) => {
    const client = clientFor(cluster);
    try {
      const [members, machineRows] = await Promise.all([
        client.listClusterMembers(),
        config.databaseConfigured
          ? getPrisma().machine.findMany({ where: { incusClusterId: cluster.id, status: { not: 'deleted' } } }).catch(() => [])
          : Promise.resolve([]),
      ]);
      const liveInstances = config.databaseConfigured ? [] : await client.listInstances();
      const online = members.filter((member) => member.status === 'Online');
      const hostState = await hostSchedulabilityByMember(cluster.id, online.map((member) => member.server_name));
      const sku = clusterSku(cluster);
      const policy = schedulerPolicy();
      const memberScores = online.map((member) => {
        const host = hostState.get(member.server_name);
        const hostAllowsScheduling = host ? host.schedulable : true;
        const placedMachines = machineRows.filter((machine) => machine.incusMemberName === member.server_name);
        const allocatedMachines = placedMachines.filter((machine) => {
          if (!isWarmPoolStatus(machine.status)) return true;
          const warm = jsonRecord(jsonRecord(machine.metadata).warm_pool);
          return machine.status === WARM_POOL_CLAIMING_STATUS || normalizeWarmPoolMode(warm.mode) === WARM_POOL_RUNNING_MODE;
        });
        const placedInstances = liveInstances.filter((instance) => instance.location === member.server_name);
        const placedCount = config.databaseConfigured ? allocatedMachines.length : placedInstances.length;
        const allocated = (config.databaseConfigured ? allocatedMachines : placedInstances).reduce((acc, item) => {
          const r = config.databaseConfigured
            ? persistedResources((item as PrismaMachine).resources, null)
            : instanceAllocatedResources(item as IncusInstance, sku.ramGb);
          acc.vcpu += r.vcpu ?? 0;
          acc.memory_gb += r.memory_gb ?? 0;
          acc.disk_gb += r.disk_gb ?? 0;
          return acc;
        }, { vcpu: 0, memory_gb: 0, disk_gb: 0 });
        const capacity = { vcpu: sku.vcpus, memory_gb: sku.ramGb, disk_gb: sku.usableStorageGb };
        const sellable = sellableCapacity(capacity, policy);
        const reserve = policy.targetFill;
        const remaining = {
          vcpu: sellable.vcpu * reserve - allocated.vcpu,
          memory_gb: sellable.memory_gb * reserve - allocated.memory_gb,
          disk_gb: sellable.disk_gb * reserve - allocated.disk_gb,
        };
        const fits = hostAllowsScheduling
          && remaining.vcpu >= input.resources.vcpu
          && remaining.memory_gb >= input.resources.memory_gb
          && remaining.disk_gb >= input.resources.disk_gb;
        const preferredBoost = input.preferredMemberName === member.server_name ? 10_000 : 0;
        const score = preferredBoost + Math.min(
          remaining.vcpu / Math.max(input.resources.vcpu, 1),
          remaining.memory_gb / Math.max(input.resources.memory_gb, 1),
          remaining.disk_gb / Math.max(input.resources.disk_gb, 1),
        ) - (placedCount * 0.01);
        return { member, host, capacity, sellable_capacity: sellable, policy, allocated, remaining, fits, score, placed_instances: placedCount };
      }).sort((a, b) => b.score - a.score);
      return { cluster, client, members, instances: liveInstances, memberScores, best: memberScores.find((score) => score.fits) ?? null, error: null as string | null };
    } catch (error) {
      return { cluster, client, members: [], instances: [], memberScores: [], best: null, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const selected = attempts
    .filter((attempt) => attempt.best)
    .sort((a, b) => (b.best?.score ?? -Infinity) - (a.best?.score ?? -Infinity))[0];
  if (!selected?.best) {
    throw new ConflictError(`No schedulable Incus member in region ${input.region} has enough capacity for ${input.resources.vcpu} vCPU / ${input.resources.memory_gb}GB RAM / ${input.resources.disk_gb}GB disk`);
  }
  return {
    cluster: selected.cluster,
    client: selected.client,
    member: selected.best.member,
    placement: {
      region: input.region,
      cluster_id: selected.cluster.id,
      member_name: selected.best.member.server_name,
      target_fill: selected.best.policy.targetFill,
      overcommit: selected.best.policy.overcommit,
      requested: input.resources,
      physical_capacity: selected.best.capacity,
      sellable_capacity: selected.best.sellable_capacity,
      allocated_before: selected.best.allocated,
      remaining_before: selected.best.remaining,
      placed_instances_before: selected.best.placed_instances,
      host: selected.best.host ?? { known: false, schedulable: true, lifecycle_state: 'unknown' },
    },
  };
}

async function validateFleetNodeOrder(config: AppConfig, input: NodeOrderInput) {
  if (!config.hetznerRobot) throw new BadRequestError('Hetzner Robot credentials not configured');
  const region = input.region ?? regionFromHetznerLocation(input.location);
  const target = await pickNodeTargetCluster(config, { region, requestedClusterId: input.target_cluster_id ?? null });
  const products = await loadRobotProducts(config, input.location);
  const product = products.find((item) => item.product.id === input.product_id || item.product.name === input.product_id) ?? null;
  if (!product) throw new ConflictError(`Hetzner product ${input.product_id} is not orderable at ${input.location} for this account/API user`);
  const quote = buildProcurementQuote({
    vendor: 'hetzner_robot',
    product_id: input.product_id,
    location: input.location,
    region,
    quantity: 1,
    addons: input.addons ?? [],
  }, product);
  const robot = new HetznerRobotClient(config.hetznerRobot);
  const dryRun = await robot.placeOrder({
    productId: input.product_id,
    location: input.location,
    dist: input.dist,
    authorizedKeyFingerprints: input.ssh_key_fingerprints,
    addons: input.addons,
    test: true,
  });
  return { region, target, product, quote, dry_run: dryRun };
}

async function buildFleetTopology(config: AppConfig, options: { sync: boolean }) {
  const machineRows = config.databaseConfigured
    ? await getPrisma().machine.findMany({ where: customerVisibleMachineWhere() }).catch(() => [])
    : [];
  const hostRows = config.databaseConfigured
    ? await getPrisma().host.findMany({ where: { lifecycleState: { not: 'terminated' } } }).catch(() => [])
    : [];

  const clusterViews = await Promise.all(config.clusters.map(async (cluster) => {
    try {
      const observed = await observeCluster(cluster);
      if (options.sync && config.databaseConfigured) await syncIncusObservation(getPrisma(), cluster, observed);
      const sku = clusterSku(cluster);
      const policy = schedulerPolicy();
      const hosts = observed.members.map((member) => {
        const host = hostRows.find((row) => row.incusClusterId === cluster.id && row.incusMemberName === member.server_name) ?? null;
        const instances = observed.instances.filter((instance) => instance.location === member.server_name);
        const productMachines = machineRows.filter((machine) => machine.incusClusterId === cluster.id && machine.incusMemberName === member.server_name);
        const allocated = instances.reduce((acc, instance) => {
          const r = instanceAllocatedResources(instance, sku.ramGb);
          acc.vcpu += r.vcpu;
          acc.memory_gb += r.memory_gb;
          acc.disk_gb += r.disk_gb;
          return acc;
        }, { vcpu: 0, memory_gb: 0, disk_gb: 0 });
        const capacity = { vcpu: sku.vcpus, memory_gb: sku.ramGb, disk_gb: sku.usableStorageGb };
        const sellable = sellableCapacity(capacity, policy);
        const schedulingTargetFill = policy.targetFill;
        const schedulableCapacity = {
          vcpu: sellable.vcpu * schedulingTargetFill,
          memory_gb: sellable.memory_gb * schedulingTargetFill,
          disk_gb: sellable.disk_gb * schedulingTargetFill,
        };
        const remaining = {
          vcpu: Math.max(0, schedulableCapacity.vcpu - allocated.vcpu),
          memory_gb: Math.max(0, schedulableCapacity.memory_gb - allocated.memory_gb),
          disk_gb: Math.max(0, schedulableCapacity.disk_gb - allocated.disk_gb),
        };
        return {
          name: member.server_name,
          url: member.url,
          links: incusWebLinks(member.url || cluster.endpoint),
          status: member.status,
          roles: member.roles ?? [],
          schedulable: member.status === 'Online' && (!host || (host.schedulable && host.lifecycleState === 'online')),
          lifecycle_state: host?.lifecycleState ?? 'unknown',
          host,
          physical_capacity: capacity,
          sellable_capacity: sellable,
          capacity: sellable,
          schedulable_capacity: schedulableCapacity,
          allocated,
          remaining,
          overcommit: policy.overcommit,
          scheduling_target_fill: schedulingTargetFill,
          fill_pct: {
            vcpu: sellable.vcpu ? (allocated.vcpu / sellable.vcpu) * 100 : null,
            memory: sellable.memory_gb ? (allocated.memory_gb / sellable.memory_gb) * 100 : null,
            disk: sellable.disk_gb ? (allocated.disk_gb / sellable.disk_gb) * 100 : null,
          },
          physical_fill_pct: {
            vcpu: capacity.vcpu ? (allocated.vcpu / capacity.vcpu) * 100 : null,
            memory: capacity.memory_gb ? (allocated.memory_gb / capacity.memory_gb) * 100 : null,
            disk: capacity.disk_gb ? (allocated.disk_gb / capacity.disk_gb) * 100 : null,
          },
          machines: productMachines.map((machine) => ({
            id: machine.id,
            name: machine.name,
            status: machine.status,
            type: machine.type,
            resources: machine.resources,
            incus_instance_name: machine.incusInstanceName,
          })),
          observed_instances: instances.map((instance) => ({ name: instance.name, status: instance.status, type: instance.type })),
        };
      });
      return {
        ...publicCluster(cluster),
        status: 'reachable',
        sku: sku.id,
        members_online: observed.members.filter((member) => member.status === 'Online').length,
        members_total: observed.members.length,
        machines_total: machineRows.filter((machine) => machine.incusClusterId === cluster.id).length,
        observed_instances_total: observed.instances.length,
        utilization: {
          scheduling: {
            model: 'allocated_resources_not_live_cpu',
            target_fill: policy.targetFill,
            overcommit: policy.overcommit,
            physical_capacity: hosts.reduce((acc, host) => ({ vcpu: acc.vcpu + host.physical_capacity.vcpu, memory_gb: acc.memory_gb + host.physical_capacity.memory_gb, disk_gb: acc.disk_gb + host.physical_capacity.disk_gb }), { vcpu: 0, memory_gb: 0, disk_gb: 0 }),
            capacity: hosts.reduce((acc, host) => ({ vcpu: acc.vcpu + host.sellable_capacity.vcpu, memory_gb: acc.memory_gb + host.sellable_capacity.memory_gb, disk_gb: acc.disk_gb + host.sellable_capacity.disk_gb }), { vcpu: 0, memory_gb: 0, disk_gb: 0 }),
            allocated: hosts.reduce((acc, host) => ({ vcpu: acc.vcpu + host.allocated.vcpu, memory_gb: acc.memory_gb + host.allocated.memory_gb, disk_gb: acc.disk_gb + host.allocated.disk_gb }), { vcpu: 0, memory_gb: 0, disk_gb: 0 }),
            remaining: hosts.reduce((acc, host) => ({ vcpu: acc.vcpu + host.remaining.vcpu, memory_gb: acc.memory_gb + host.remaining.memory_gb, disk_gb: acc.disk_gb + host.remaining.disk_gb }), { vcpu: 0, memory_gb: 0, disk_gb: 0 }),
          },
          runtime: {
            model: 'live_pressure_signal_only_not_primary_placement',
            source: 'future_incus_metrics_or_node_agent_samples',
          },
          finance: {
            model: 'cost_and_revenue_ledgers',
            source: '/admin/economics and /admin/pnl',
          },
        },
        hosts,
        observed: { server: observed.server },
      };
    } catch (error) {
      return {
        ...publicCluster(cluster),
        status: 'unreachable',
        error: error instanceof Error ? error.message : String(error),
        sku: clusterSku(cluster).id,
        members_online: 0,
        members_total: 0,
        machines_total: machineRows.filter((machine) => machine.incusClusterId === cluster.id).length,
        observed_instances_total: 0,
        hosts: [],
      };
    }
  }));

  const regions = SUPPORTED_REGIONS.map((region) => {
    const clusters = clusterViews.filter((cluster) => cluster.region === region);
    const inventoryHosts = hostRows.filter((host) => host.region === region).length;
    const hostCount = clusters.reduce((sum, cluster) => sum + cluster.hosts.length, 0);
    const onlineHosts = clusters.reduce((sum, cluster) => sum + cluster.members_online, 0);
    const machineCount = clusters.reduce((sum, cluster) => sum + cluster.machines_total, 0);
    const scheduling = clusters.reduce((acc, cluster) => {
      const scheduling = 'utilization' in cluster ? cluster.utilization.scheduling : null;
      if (!scheduling) return acc;
      acc.physical_capacity.vcpu += scheduling.physical_capacity.vcpu;
      acc.physical_capacity.memory_gb += scheduling.physical_capacity.memory_gb;
      acc.physical_capacity.disk_gb += scheduling.physical_capacity.disk_gb;
      acc.capacity.vcpu += scheduling.capacity.vcpu;
      acc.capacity.memory_gb += scheduling.capacity.memory_gb;
      acc.capacity.disk_gb += scheduling.capacity.disk_gb;
      acc.allocated.vcpu += scheduling.allocated.vcpu;
      acc.allocated.memory_gb += scheduling.allocated.memory_gb;
      acc.allocated.disk_gb += scheduling.allocated.disk_gb;
      acc.remaining.vcpu += scheduling.remaining.vcpu;
      acc.remaining.memory_gb += scheduling.remaining.memory_gb;
      acc.remaining.disk_gb += scheduling.remaining.disk_gb;
      return acc;
    }, { physical_capacity: { vcpu: 0, memory_gb: 0, disk_gb: 0 }, capacity: { vcpu: 0, memory_gb: 0, disk_gb: 0 }, allocated: { vcpu: 0, memory_gb: 0, disk_gb: 0 }, remaining: { vcpu: 0, memory_gb: 0, disk_gb: 0 } });
    return {
      code: region,
      active: true,
      clusters,
      summary: {
        clusters: clusters.length,
        hosts: hostCount,
        inventory_hosts: inventoryHosts,
        capacity_hosts: onlineHosts,
        pending_hosts: Math.max(0, inventoryHosts - onlineHosts),
        online_hosts: onlineHosts,
        machines: machineCount,
        scheduling,
      },
    };
  });
  return {
    regions,
    utilization_model: {
      scheduling: `Placement uses allocated/requested capacity. vCPU is cloud-style overcommitted at ${schedulerPolicy().overcommit.vcpu}:1, RAM/disk stay conservative, and sellable capacity is capped at ${(schedulerPolicy().targetFill * 100).toFixed(0)}% target fill. Actual current CPU usage does not create sellable headroom.`,
      runtime: 'Live CPU/RAM/IO pressure is an ops/autoscale signal only and can bias/drain hosts, but it is not the primary placement capacity.',
      finance: 'Finance uses cost and revenue ledgers, separate from runtime pressure and scheduling reservations.',
      provisioning: 'A bought host is not capacity until Incus reports the cluster member Online and the host lifecycle is online+schedulable.',
    },
    provisioning_model: ['requested', 'ordered', 'delivered', 'provisioning_blocked', 'bootstrapping', 'joining', 'online', 'cordoned', 'draining', 'terminated'],
    summary: {
      regions: regions.length,
      clusters: clusterViews.length,
      hosts: hostRows.length,
      inventory_hosts: hostRows.length,
      capacity_hosts: regions.reduce((sum, region) => sum + region.summary.capacity_hosts, 0),
      pending_hosts: Math.max(0, hostRows.length - regions.reduce((sum, region) => sum + region.summary.capacity_hosts, 0)),
      online_hosts: regions.reduce((sum, region) => sum + region.summary.online_hosts, 0),
      machines: regions.reduce((sum, region) => sum + region.summary.machines, 0),
    },
    synced: options.sync,
    checked_at: new Date().toISOString(),
  };
}

function inventoryHostView(config: AppConfig, host: Host) {
  const configuredCluster = host.incusClusterId ? findCluster(config, host.incusClusterId) : null;
  const hasMember = Boolean(host.incusClusterId && host.incusMemberName);
  const incusVerifiedOnline = Boolean(configuredCluster && hasMember && host.status === 'incus_member_online');
  const metadata = jsonRecord(host.metadata);
  const provisioningBlocker = jsonRecord(metadata.provisioning_blocker);
  const blockerMessage = typeof provisioningBlocker.message === 'string' && provisioningBlocker.message.trim()
    ? provisioningBlocker.message.trim()
    : null;
  const rawLifecycleState = host.lifecycleState;
  const activeWorkflowStates = new Set(['requested', 'ordered', 'bootstrapping', 'joining', 'draining', 'cordoned']);

  let lifecycleState = rawLifecycleState;
  let fleetIssue: string | null = null;
  let capacityState = 'not_capacity';

  if (incusVerifiedOnline) {
    lifecycleState = rawLifecycleState === 'cordoned' || rawLifecycleState === 'draining' ? rawLifecycleState : 'online';
    capacityState = lifecycleState === 'online' && host.schedulable ? 'schedulable_capacity' : lifecycleState;
  } else if (blockerMessage) {
    lifecycleState = 'provisioning_blocked';
    capacityState = 'blocked';
    fleetIssue = blockerMessage;
  } else if (hasMember && !configuredCluster) {
    lifecycleState = 'stale_cluster';
    fleetIssue = `Host references Incus cluster "${host.incusClusterId}" but that cluster is not configured in this v2-api process.`;
  } else if (hasMember) {
    lifecycleState = 'member_unverified';
    fleetIssue = 'Host has Incus member metadata, but current Incus discovery did not verify it as an Online member.';
  } else if (host.status === 'cancelled') {
    lifecycleState = 'terminated';
    capacityState = 'terminated';
  } else if (activeWorkflowStates.has(rawLifecycleState) && rawLifecycleState !== 'online') {
    lifecycleState = rawLifecycleState;
    capacityState = rawLifecycleState;
  } else if (host.status === 'robot_ready') {
    lifecycleState = 'delivered';
    fleetIssue = 'Hetzner host is delivered but has not joined a configured Incus cluster yet.';
  } else {
    lifecycleState = rawLifecycleState === 'online' ? 'inventory_only' : rawLifecycleState;
    fleetIssue = 'Host is inventory only until Incus reports it as an Online cluster member.';
  }

  const bootstrapAddress = host.publicIpv4 ?? host.publicIpv6 ?? null;
  return {
    ...host,
    rawLifecycleState,
    lifecycleState,
    schedulable: incusVerifiedOnline && lifecycleState === 'online' && host.schedulable,
    capacityState,
    fleetIssue,
    clusterConfigured: Boolean(configuredCluster),
    bootstrapAddress,
    bootstrapAddressFamily: host.publicIpv4 ? 'ipv4' : host.publicIpv6 ? 'ipv6' : null,
    bootstrapConnectivity: {
      ipv4_required: false,
      ipv6_supported_if_runner_can_ssh_to_address: true,
      note: 'Incus can join over IPv6 if the runner and cluster endpoint are IPv6-reachable; IPv4 is easier operationally but not strictly required.',
    },
  };
}

function incusWebLinks(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return {
      ui_url: `${url.origin}/ui/`,
      api_url: `${url.origin}/1.0`,
    };
  } catch {
    return { ui_url: null, api_url: null };
  }
}

async function pickOnlineMember(client: IncusClient, preferredName?: string | null) {
  const members = await client.listClusterMembers();
  if (preferredName) return members.find((member) => member.server_name === preferredName && member.status === 'Online') ?? null;
  return members.find((member) => member.status === 'Online') ?? null;
}

function generatedMachineId() {
  return randomUUID();
}

function displayMachineName(inputName: string | undefined, machineId: string) {
  const trimmed = inputName?.trim();
  return trimmed || machineId;
}

function generatedResourceName(prefix: string) {
  return `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 18)}`;
}

function lowestProductPrice(product: HetznerRobotProduct | null, location: string) {
  const prices = product?.product.prices ?? [];
  const preferred = prices.find((price) => price.location.toLowerCase() === location.toLowerCase()) ?? prices[0] ?? null;
  return preferred?.price ?? null;
}

function productLocations(product: HetznerRobotProduct | null) {
  return product?.product.location ?? [];
}

function jsonRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanV2DirectProxySync(value: unknown) {
  const proxySync = jsonRecord(value);
  if (proxySync.mode !== 'v2-api-direct') return proxySync;
  const { origin_host: _originHost, ...clean } = proxySync;
  void _originHost;
  return clean;
}

function toolboxBaseUrl(machine: Awaited<ReturnType<typeof loadProductMachine>>) {
  if (!machine) return null;
  const metadata = jsonRecord(machine.metadata);
  const baseUrl = metadata.toolbox_base_url;
  return typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : null;
}

function toolboxTargetUrl(baseUrl: string, path: string) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const relative = path.startsWith('/') ? path.slice(1) : path;
  return new URL(relative, base).toString();
}

function toolboxRoutes(machineId: string, baseUrl: string | null) {
  const encodedId = encodeURIComponent(machineId);
  return {
    configured: Boolean(baseUrl),
    base_url: baseUrl,
    terminal_url: baseUrl ? toolboxTargetUrl(baseUrl, '_terminal') : null,
    opencode_url: baseUrl ?? null,
    health_path: `/machines/${encodedId}/toolbox-health`,
    services_path: `/machines/${encodedId}/toolbox-services`,
    command_path: `/machines/${encodedId}/toolbox-command`,
    proxy_prefix: `/machines/${encodedId}/toolbox/`,
  };
}

function machineProxySlug(machineId: string) {
  return proxySlugForMachineId(machineId);
}

function machineProxyUrls(config: AppConfig, machineId: string) {
  return proxyUrls(config, machineProxySlug(machineId));
}

function proxyTokenDescriptors(machine: Awaited<ReturnType<typeof loadProductMachine>>): ProxyTokenDescriptor[] {
  const raw = jsonRecord(machine?.metadata).proxy_tokens;
  return Array.isArray(raw) ? raw.filter((item): item is ProxyTokenDescriptor => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')) : [];
}

function activeProxyTokenDescriptors(machine: Awaited<ReturnType<typeof loadProductMachine>>) {
  const now = Date.now();
  return proxyTokenDescriptors(machine).filter((token) => !token.revoked_at && new Date(token.expires_at).getTime() > now);
}

function publicProxyToken(token: ProxyTokenDescriptor, include?: { rawToken?: string; proxyUrl?: string }) {
  return {
    id: token.id,
    ...(include?.rawToken ? { token: include.rawToken } : {}),
    token_prefix: token.token_prefix,
    label: token.label,
    machine_id: token.machine_id,
    machine_slug: token.machine_slug,
    ports: token.ports,
    expires_at: token.expires_at,
    proxy_url: include?.proxyUrl,
    created_at: token.created_at,
  };
}

function normalizeProxyPorts(ports: number[] | null | undefined) {
  if (!ports?.length) return null;
  return Array.from(new Set(ports)).sort((a, b) => a - b);
}

type SshTokenDescriptor = {
  id: string;
  token_sha256: string;
  token_prefix: string;
  label: string | null;
  machine_id: string;
  expires_at: string;
  revoked_at?: string | null;
  target_host?: string | null;
  target_port?: number;
  ssh_user?: string;
  created_at: string;
};

function sshTokenDescriptors(machine: Awaited<ReturnType<typeof loadProductMachine>>): SshTokenDescriptor[] {
  const raw = jsonRecord(machine?.metadata).ssh_tokens;
  return Array.isArray(raw) ? raw.filter((item): item is SshTokenDescriptor => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')) : [];
}

function activeSshTokenDescriptors(machine: Awaited<ReturnType<typeof loadProductMachine>>) {
  const now = Date.now();
  return sshTokenDescriptors(machine).filter((token) => !token.revoked_at && new Date(token.expires_at).getTime() > now);
}

function sshCommand(config: AppConfig, token: string) {
  return `ssh -o HostKeyAlias=${sshHostKeyAlias(config)} -o StrictHostKeyChecking=accept-new -p ${config.sshGatewayPort} ${token}@${config.sshGatewayHost}`;
}

function sshConfigSnippet(config: AppConfig, token: string, machineId: string) {
  return `Host justavps-${machineId}\n  HostName ${config.sshGatewayHost}\n  Port ${config.sshGatewayPort}\n  User ${token}\n  HostKeyAlias ${sshHostKeyAlias(config)}\n  StrictHostKeyChecking accept-new\n`;
}

function sshHostKeyAlias(config: AppConfig) {
  return `justavps-v2-ssh-${config.sshGatewayHost}-${config.sshGatewayPort}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function publicSshToken(config: AppConfig, descriptor: SshTokenDescriptor, rawToken?: string) {
  return {
    id: descriptor.id,
    ...(rawToken ? { token: rawToken, ssh_command: sshCommand(config, rawToken), ssh_config: sshConfigSnippet(config, rawToken, descriptor.machine_id) } : {}),
    token_prefix: descriptor.token_prefix,
    label: descriptor.label,
    machine_id: descriptor.machine_id,
    expires_at: descriptor.expires_at,
    target: { host: descriptor.target_host ?? null, port: descriptor.target_port ?? 22, user: descriptor.ssh_user ?? 'user' },
    created_at: descriptor.created_at,
  };
}

function findActiveSshToken(config: AppConfig, rawToken: string) {
  if (!config.databaseConfigured) return null;
  const hash = sha256Hex(rawToken);
  return getPrisma().machine.findMany({ where: customerVisibleMachineWhere() }).then((machines) => {
    for (const machine of machines) {
      const token = activeSshTokenDescriptors(machine).find((entry) => entry.token_sha256 === hash);
      if (token) return { machine, token };
    }
    return null;
  });
}

function proxyUrlForToken(config: AppConfig, token: Pick<ProxyTokenDescriptor, 'machine_slug' | 'ports'>, rawToken?: string) {
  const urls = proxyUrls(config, token.machine_slug);
  const firstPort = token.ports?.[0];
  const baseUrl = firstPort && firstPort !== 80
    ? urls.port_template.replace('{port}', String(firstPort))
    : urls.proxy;
  if (!rawToken) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set('__proxy_token', rawToken);
  return url.toString();
}

const PROXY_TOKEN_COOKIE = '__justavps_v2_pt';
const PROXY_ADMIN_COOKIE = '__justavps_v2_admin';
const PROXY_HOST_RE = /^(\d+)--([a-z0-9][a-z0-9-]*)\.localhost$/i;
const PROXY_PATH_RE = /^\/proxy\/(\d+)--([a-z0-9][a-z0-9-]*)(?:\/(.*))?$/i;
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authentication',
  'proxy-authorization', 'te', 'trailer', 'trailers', 'transfer-encoding',
  'upgrade', 'host', 'content-length',
]);

function parseCookieHeader(header: string | undefined, name: string) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('=') || '');
  }
  return null;
}

function stripProxyCookies(header: string | null) {
  if (!header) return '';
  return header.split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${PROXY_TOKEN_COOKIE}=`) && !part.startsWith(`${PROXY_ADMIN_COOKIE}=`))
    .join('; ');
}

function parseApiProxyRequest(request: Request) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || url.host).split(':')[0]?.toLowerCase() || '';
  const hostMatch = host.match(PROXY_HOST_RE);
  if (hostMatch) {
    return { port: Number(hostMatch[1]), machineId: hostMatch[2], path: url.pathname, search: url.search, hostBased: true };
  }
  const pathMatch = url.pathname.match(PROXY_PATH_RE);
  if (pathMatch) {
    return { port: Number(pathMatch[1]), machineId: pathMatch[2], path: `/${pathMatch[3] ?? ''}`, search: url.search, hostBased: false };
  }
  return null;
}

function proxyAuthToken(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get('__proxy_token')
    || request.headers.get('x-proxy-token')
    || request.headers.get('x-justavps-proxy-token')
    || parseCookieHeader(request.headers.get('cookie') ?? undefined, PROXY_TOKEN_COOKIE);
}

function proxyAdminToken(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

function proxyAdminSecret(config: AppConfig) {
  return config.adminToken?.split(',').map((item) => item.trim()).filter(Boolean)[0] ?? '';
}

function signProxyAdminSession(config: AppConfig, machineId: string, port: number) {
  const secret = proxyAdminSecret(config);
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ machine_id: machineId, port, exp: Date.now() + 4 * 60 * 60 * 1000 })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyProxyAdminSession(config: AppConfig, request: Request, machineId: string, port: number) {
  const secret = proxyAdminSecret(config);
  if (!secret) return false;
  const cookie = parseCookieHeader(request.headers.get('cookie') ?? undefined, PROXY_ADMIN_COOKIE);
  if (!cookie) return false;
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { machine_id?: string; port?: number; exp?: number };
    return data.machine_id === machineId && data.port === port && typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function cleanProxySearch(search: string) {
  const params = new URLSearchParams(search);
  params.delete('__proxy_token');
  const next = params.toString();
  return next ? `?${next}` : '';
}

function proxyTargetPath(port: number, path: string, search: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const cleanedSearch = cleanProxySearch(search);
  if (port === 80) return `${normalizedPath}${cleanedSearch}`;
  return `/_port/${port}${normalizedPath === '/' ? '' : normalizedPath}${cleanedSearch}`;
}

function proxyResponseHeaders(headers: Headers) {
  const clean = new Headers();
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) clean.set(key, value);
  });
  return clean;
}

function proxyRequestHeaders(request: Request, machineId: string, port: number) {
  const clean = proxyResponseHeaders(request.headers);
  clean.delete('authorization');
  clean.delete('x-proxy-token');
  clean.delete('x-justavps-proxy-token');
  const cookies = stripProxyCookies(request.headers.get('cookie'));
  if (cookies) clean.set('Cookie', cookies);
  else clean.delete('Cookie');
  clean.set('X-JustAVPS-V2-Sandbox-Id', machineId);
  clean.set('X-JustAVPS-V2-Sandbox-Slug', machineProxySlug(machineId));
  clean.set('X-JustAVPS-V2-Target-Port', String(port));
  return clean;
}

function proxiedClientHeaders(request: Request) {
  const headers: string[] = [];
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    if (lower === 'authorization' || lower === 'cookie' || lower === 'x-proxy-token' || lower === 'x-justavps-proxy-token') return;
    headers.push(key, value);
  });
  return headers;
}

function parseCurlHttpResponse(raw: string) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const split = normalized.indexOf('\n\n');
  if (split < 0) return { status: 502, headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' }), body: raw };
  const headerText = normalized.slice(0, split);
  const body = normalized.slice(split + 2);
  const lines = headerText.split('\n');
  const statusMatch = lines[0]?.match(/^HTTP\/\S+\s+(\d+)/i);
  const status = statusMatch ? Number(statusMatch[1]) : 502;
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    headers.append(key, line.slice(idx + 1).trim());
  }
  return { status, headers, body };
}

function hasReadyManagedDaemon(machine: Awaited<ReturnType<typeof loadProductMachine>>) {
  const meta = jsonRecord(machine?.metadata);
  const daemon = jsonRecord(meta.managed_daemon);
  return meta.managed_daemon_state === 'ready' || daemon.ok === true;
}

async function proxyViaIncusExec(resolved: NonNullable<Awaited<ReturnType<typeof machineClient>>>, request: Request, port: number, path: string, search: string, viaDaemon: boolean) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Non-GET proxying requires the managed toolbox daemon; this image does not have one configured yet.', { status: 502 });
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (viaDaemon && port === 80 && normalizedPath === '/daemon/health') {
    const result = await resolved.client.exec(resolved.machine.incusInstanceName, {
      command: ['/usr/local/bin/justavps-daemon', '--health-check', '--api-port', '7777'],
      timeoutMs: 10_000,
    });
    if (result.exit_code !== 0) {
      return new Response(`Daemon health is not reachable inside the sandbox. exit=${result.exit_code}\n${result.stderr || result.stdout}`, { status: 502 });
    }
    return new Response(request.method === 'HEAD' ? null : result.stdout, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const target = viaDaemon
    ? (port === 80
      ? `http://127.0.0.1${normalizedPath}${cleanProxySearch(search)}`
      : `http://127.0.0.1/_port/${port}${normalizedPath === '/' ? '' : normalizedPath}${cleanProxySearch(search)}`)
    : `http://127.0.0.1:${port}${normalizedPath}${cleanProxySearch(search)}`;
  const command = ['curl', '-sS', '-i', '--max-time', '25'];
  if (request.method === 'HEAD') command.push('--head');
  const clientHeaders = proxiedClientHeaders(request);
  for (let i = 0; i < clientHeaders.length; i += 2) command.push('-H', `${clientHeaders[i]}: ${clientHeaders[i + 1]}`);
  command.push(target);
  const result = await resolved.client.exec(resolved.machine.incusInstanceName, { command, timeoutMs: 35_000 });
  if (result.exit_code !== 0) {
    return new Response(`Port ${port} is not reachable inside the sandbox. curl exit=${result.exit_code}\n${result.stderr || result.stdout}`, { status: 502 });
  }
  const parsed = parseCurlHttpResponse(result.stdout);
  return new Response(request.method === 'HEAD' ? null : parsed.body, { status: parsed.status, headers: parsed.headers });
}

function validProxyToken(machine: Awaited<ReturnType<typeof loadProductMachine>>, rawToken: string | null, port: number) {
  if (!machine || !rawToken) return null;
  const hash = sha256Hex(rawToken);
  const now = Date.now();
  return activeProxyTokenDescriptors(machine).find((token) => token.token_sha256 === hash
    && new Date(token.expires_at).getTime() > now
    && (!token.ports || token.ports.includes(port))) ?? null;
}

function validProxyAccess(config: AppConfig, machine: Awaited<ReturnType<typeof loadProductMachine>>, request: Request, port: number) {
  const token = validProxyToken(machine, proxyAuthToken(request), port);
  if (token) return { ok: true as const, source: 'proxy-token' as const };
  const adminHeaderToken = proxyAdminToken(request);
  if (adminHeaderToken && !adminGuard(config, `Bearer ${adminHeaderToken}`)) return { ok: true as const, source: 'admin-header' as const };
  if (machine?.id && verifyProxyAdminSession(config, request, machine.id, port)) return { ok: true as const, source: 'admin-cookie' as const };
  return { ok: false as const };
}

function htmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function proxyAuthAction(parsed: NonNullable<ReturnType<typeof parseApiProxyRequest>>, redirect: string) {
  const action = parsed.hostBased
    ? '/_justavps_proxy_auth'
    : `/proxy/${parsed.port}--${parsed.machineId}/_justavps_proxy_auth`;
  return `${action}?redirect=${encodeURIComponent(redirect)}`;
}

function proxyLoginPage(parsed: NonNullable<ReturnType<typeof parseApiProxyRequest>>, message = '') {
  const redirect = `${parsed.path}${parsed.search}` || '/';
  const action = proxyAuthAction(parsed, redirect);
  return new Response(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox access required</title>
<style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#09090b;color:#fafafa;display:grid;place-items:center;min-height:100vh;margin:0}.card{width:min(480px,calc(100vw - 32px));background:#18181b;border:1px solid #27272a;border-radius:18px;padding:24px;box-shadow:0 24px 80px #0008}h1{font-size:22px;margin:0 0 8px}p{color:#a1a1aa;line-height:1.5}.msg{color:#fca5a5}label{display:block;font-size:13px;color:#d4d4d8;margin:16px 0 6px}input{width:100%;box-sizing:border-box;background:#09090b;color:#fafafa;border:1px solid #3f3f46;border-radius:10px;padding:12px}button{margin-top:18px;width:100%;border:0;border-radius:10px;padding:12px;background:#2563eb;color:white;font-weight:700;cursor:pointer}.hint{font-size:12px;color:#71717a}</style></head>
<body><main class="card"><h1>Sandbox access required</h1><p>Port <b>${parsed.port}</b> on sandbox <code>${htmlEscape(parsed.machineId)}</code> needs a proxy token or V2 admin token.</p>${message ? `<p class="msg">${htmlEscape(message)}</p>` : ''}
<form method="post" action="${htmlEscape(action)}"><label>Proxy token</label><input name="proxy_token" placeholder="pt_..." autocomplete="off"><p class="hint">Use a share token for this machine/port.</p><label>Or V2 admin token</label><input name="admin_token" type="password" placeholder="local-e2e-token" autocomplete="current-password"><button type="submit">Continue</button></form></main></body></html>`, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readProxyAuthForm(request: Request) {
  const text = await request.text();
  const params = new URLSearchParams(text);
  return { proxyToken: params.get('proxy_token')?.trim() || '', adminToken: params.get('admin_token')?.trim() || '' };
}

async function handleProxyAuthSubmission(config: AppConfig, request: Request, parsed: NonNullable<ReturnType<typeof parseApiProxyRequest>>, machine: Awaited<ReturnType<typeof loadProductMachine>>) {
  if (request.method !== 'POST') return proxyLoginPage(parsed);
  const form = await readProxyAuthForm(request);
  const redirectUrl = new URL(request.url).searchParams.get('redirect') || '/';
  const headers = new Headers({ Location: redirectUrl, 'Cache-Control': 'no-store' });
  if (form.proxyToken && validProxyToken(machine, form.proxyToken, parsed.port)) {
    headers.append('Set-Cookie', `${PROXY_TOKEN_COOKIE}=${encodeURIComponent(form.proxyToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`);
    return new Response(null, { status: 302, headers });
  }
  if (form.adminToken && !adminGuard(config, `Bearer ${form.adminToken}`)) {
    const session = machine?.id ? signProxyAdminSession(config, machine.id, parsed.port) : null;
    if (session) {
      headers.append('Set-Cookie', `${PROXY_ADMIN_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`);
      return new Response(null, { status: 302, headers });
    }
  }
  return proxyLoginPage(parsed, 'That token was not accepted for this machine and port.');
}

async function handleApiProxyRequest(config: AppConfig, request: Request) {
  const parsed = parseApiProxyRequest(request);
  if (!parsed) return null;
  if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
    return new Response('Invalid proxy port', { status: 400 });
  }
  const resolved = await machineClient(config, parsed.machineId);
  if (!resolved) return new Response('Sandbox not found', { status: 404 });
  if (parsed.path === '/_justavps_proxy_auth') return handleProxyAuthSubmission(config, request, parsed, resolved.machine);
  const access = validProxyAccess(config, resolved.machine, request, parsed.port);
  if (!access.ok) {
    const accept = request.headers.get('accept') ?? '';
    if (request.method === 'GET' && accept.includes('text/html')) return proxyLoginPage(parsed);
    return new Response('Proxy token required or not allowed for this port', { status: 401 });
  }

  const baseUrl = toolboxBaseUrl(resolved.machine);
  if (!baseUrl) {
    const response = await proxyViaIncusExec(resolved, request, parsed.port, parsed.path, parsed.search, hasReadyManagedDaemon(resolved.machine));
    response.headers.set('X-JustAVPS-Proxy-Mode', hasReadyManagedDaemon(resolved.machine) ? 'guest-daemon-via-incus-exec' : 'incus-exec-fallback');
    if (new URL(request.url).searchParams.has('__proxy_token')) {
      response.headers.append('Set-Cookie', `${PROXY_TOKEN_COOKIE}=${encodeURIComponent(proxyAuthToken(request) ?? '')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`);
    }
    return response;
  }

  const target = toolboxTargetUrl(baseUrl, proxyTargetPath(parsed.port, parsed.path, parsed.search));
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const upstream = await fetch(target, {
    method: request.method,
    headers: proxyRequestHeaders(request, resolved.machine.id, parsed.port),
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  }).catch((error) => error instanceof Error ? error : new Error(String(error)));
  if (upstream instanceof Error) {
    return new Response(`Sandbox port ${parsed.port} is not reachable: ${upstream.message}`, { status: 502 });
  }

  const headers = proxyResponseHeaders(upstream.headers);
  if (new URL(request.url).searchParams.has('__proxy_token')) {
    headers.append('Set-Cookie', `${PROXY_TOKEN_COOKIE}=${encodeURIComponent(proxyAuthToken(request) ?? '')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`);
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

async function callToolboxJson(baseUrl: string, path: string, init: RequestInit = {}) {
  const response = await fetch(toolboxTargetUrl(baseUrl, path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  } else {
    data = {};
  }
  return { status: response.status, data };
}

async function loadRobotProducts(config: AppConfig, location?: string) {
  if (!config.hetznerRobot) return [];
  return new HetznerRobotClient(config.hetznerRobot).listServerProducts({ location });
}

function buildProcurementQuote(input: z.infer<typeof procurementQuoteSchema>, product: HetznerRobotProduct | null) {
  const price = lowestProductPrice(product, input.location);
  const monthlyNet = price?.net ? Number(price.net) : null;
  return {
    vendor: input.vendor,
    product_id: input.product_id,
    product_name: product?.product.name ?? input.product_id,
    host_class: (product?.product.name ?? input.product_id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    region: input.region,
    location: input.location,
    quantity: input.quantity,
    addons: input.addons,
    orderable_locations: productLocations(product),
    unit_price: price,
    estimated_monthly_net: monthlyNet === null ? null : monthlyNet * input.quantity,
    execution: {
      supported: false,
      reason: 'Real Hetzner Robot ordering is intentionally blocked until an operator explicitly wires and approves live purchase execution.',
      required_confirm: 'ORDER REAL HOSTS',
    },
  };
}

function buildOrderPlan(procurement: { id: string; vendor: string; productId: string; hostClass: string; region: string; location: string; request: unknown }) {
  return {
    procurement_id: procurement.id,
    vendor: procurement.vendor,
    product_id: procurement.productId,
    host_class: procurement.hostClass,
    region: procurement.region,
    location: procurement.location,
    request: jsonRecord(procurement.request),
    execution: {
      supported: false,
      reason: 'Live Hetzner Robot ordering is intentionally blocked until purchase execution is wired and the operator explicitly confirms a real order.',
      required_confirm: 'ORDER REAL HOSTS',
    },
    steps: [
      'Submit Hetzner Robot order for the approved product and location',
      'Record provider transaction/order identifier',
      'Poll Robot inventory until the new server appears with public networking',
      'Create or link the v2_core.host inventory row',
      'Keep the host unschedulable until Incus reports it as an Online cluster member',
    ],
  };
}

function buildBootstrapPlan(input: z.infer<typeof bootstrapPlanSchema>, host?: { id: string; publicIpv4: string | null; incusClusterId: string | null; incusMemberName: string | null } | null) {
  return {
    mode: input.mode,
    cluster_id: input.cluster_id,
    host_id: input.host_id ?? host?.id ?? null,
    provider_server_number: input.provider_server_number ?? null,
    target_ip: host?.publicIpv4 ?? null,
    current_cluster_id: host?.incusClusterId ?? null,
    current_member_name: host?.incusMemberName ?? null,
    execution: {
      supported: false,
      reason: 'Host wipe/reimage/bootstrap is intentionally blocked until live IncusOS install automation is approved for the exact host.',
      required_confirm: 'BOOTSTRAP REAL HOST',
    },
    steps: [
      'Validate Hetzner Robot host ownership and current inventory record',
      'Enable rescue/install environment or IncusOS installer for the selected host',
      'Install IncusOS as the target node OS',
      'Trust/join the configured Incus cluster',
      'Verify cluster member is Online in Incus',
      'Sync Incus observation into v2_incus cache',
      'Mark host schedulable only after Incus reports Online',
    ],
  };
}

async function resolveCreateInstanceSource(config: AppConfig, input: SourceResolveInput, cluster: IncusClusterConfig): Promise<
  | { source: CreateInstanceSource; sourceId: string | null; preferredMemberName?: string | null; image?: IncusImage | null; justavpsReady?: boolean }
  | { error: { status: 404 | 409 | 501; body: { error: true; message: string } } }
> {
  if (input.source.type === 'image') {
    const image = await findIncusImageByAliasOrFingerprint(clientFor(cluster), input.source.image_id).catch(() => null);
    return { source: { type: 'image', image: input.source.image_id }, sourceId: input.source.image_id, image, justavpsReady: imageIsJustavpsReady(image) };
  }
  if (input.source.type === 'backup') {
    return { error: { status: 501, body: { error: true, message: 'Backup sources require Incus backup import plumbing and are not implemented yet' } } };
  }

  if (config.databaseConfigured) {
    const prisma = getPrisma();
    const snapshot = await prisma.snapshot.findUnique({ where: { id: input.source.snapshot_id } })
      ?? await prisma.snapshot.findFirst({ where: { incusSnapshotName: input.source.snapshot_id }, orderBy: { createdAt: 'desc' } });

    if (snapshot) {
      const sourceMachine = await prisma.machine.findUnique({ where: { id: snapshot.machineId } });
      if (!sourceMachine) return { error: { status: 404, body: { error: true, message: 'Snapshot source machine not found' } } };
      if (sourceMachine.incusClusterId !== cluster.id) return { error: { status: 409, body: { error: true, message: 'Snapshot source is in a different Incus cluster' } } };
      if (sourceMachine.type !== input.type) return { error: { status: 409, body: { error: true, message: 'Snapshot source type does not match requested machine type' } } };
      return {
        source: { type: 'snapshot', source: `${sourceMachine.incusInstanceName}/${snapshot.incusSnapshotName}` },
        sourceId: snapshot.id,
        preferredMemberName: sourceMachine.incusMemberName,
      };
    }
  }

  if (!input.source.snapshot_id.includes('/')) return { error: { status: 404, body: { error: true, message: 'Snapshot not found' } } };
  return { source: { type: 'snapshot', source: input.source.snapshot_id }, sourceId: input.source.snapshot_id };
}

type BackupResolution =
  | { sourceMachine: NonNullable<Awaited<ReturnType<typeof loadProductMachine>>>; backupName: string; productBackupId: string | null }
  | { error: { status: 404 | 409; body: { error: true; message: string } } };

async function resolveBackupForSource(config: AppConfig, backupId: string): Promise<BackupResolution> {
  // Accept three identifier shapes:
  //   1. v2_core.backup row id (cuid)        -> look up machineId + incusBackupName
  //   2. "<machineId>/<backupName>" pair      -> split + load machine
  //   3. plain "<backupName>" (db only)        -> findFirst on incusBackupName
  let sourceMachineId: string | undefined;
  let backupName: string | undefined;
  let productBackupId: string | null = null;

  if (config.databaseConfigured) {
    const prisma = getPrisma();
    const row = await prisma.backup.findUnique({ where: { id: backupId } })
      ?? await prisma.backup.findFirst({ where: { incusBackupName: backupId }, orderBy: { createdAt: 'desc' } });
    if (row) {
      sourceMachineId = row.machineId;
      backupName = row.incusBackupName ?? undefined;
      productBackupId = row.id;
    }
  }
  if ((!sourceMachineId || !backupName) && backupId.includes('/')) {
    const slash = backupId.indexOf('/');
    sourceMachineId = backupId.slice(0, slash);
    backupName = backupId.slice(slash + 1);
  }
  if (!sourceMachineId || !backupName) {
    return { error: { status: 404, body: { error: true, message: 'Backup not found' } } };
  }
  const sourceMachine = await loadProductMachine(config, sourceMachineId);
  if (!sourceMachine) return { error: { status: 404, body: { error: true, message: 'Backup source machine not found' } } };
  return { sourceMachine, backupName, productBackupId };
}

async function applyResourceConfig(
  client: IncusClient,
  instanceName: string,
  cluster: IncusClusterConfig,
  resources: { vcpu: number; memory_gb: number; disk_gb: number },
  productMeta: { machineId: string; displayName: string; machineType: 'container' | 'vm'; accountId?: string | null },
): Promise<ReturnType<typeof validateMachineIsolation> & { config_operation: IncusOperation | Record<string, unknown> | null; restarted_for_device_patch: boolean }> {
  // Re-apply hardened security defaults on the import path: a tarball carries
  // the source instance's config, and we don't want a less-locked-down source
  // to weaken the imported clone.
  const config: Record<string, string> = {
    ...hardenedSecurityConfig(productMeta.machineType),
    'limits.cpu': String(resources.vcpu),
    'limits.memory': `${resources.memory_gb}GiB`,
    'user.justavps.machine_id': productMeta.machineId,
    'user.justavps.machine_name': productMeta.displayName,
    'user.justavps.display_name': productMeta.displayName,
    'user.justavps.hostname': instanceName,
      ...(productMeta.accountId ? { 'user.justavps.account_id': productMeta.accountId } : {}),
  };
  const observed = await client.getInstance(instanceName).catch(() => null);
  const currentRoot = rootDiskDevice(observed);
  let root: Record<string, string> | null = null;
  if (currentRoot) root = { ...currentRoot, type: 'disk', path: '/', size: `${resources.disk_gb}GiB` };
  else if (cluster.rootPool) root = { type: 'disk', pool: cluster.rootPool, path: '/', size: `${resources.disk_gb}GiB` };
  if (!root) throw new Error(`Could not determine root disk device for ${instanceName}; refusing to create machine without an enforced disk quota`);
  const devices: Record<string, Record<string, string>> = { root };
  if (productMeta.machineType === 'container') {
    const currentNic = nicDevice(observed);
    if (currentNic) {
      devices.eth0 = {
        ...currentNic,
        type: 'nic',
        name: currentNic.name ?? 'eth0',
        'security.mac_filtering': 'true',
        'security.ipv4_filtering': 'true',
        'security.ipv6_filtering': 'false',
      };
    }
    devices.justavps_shm = {
      type: 'disk',
      source: 'tmpfs:',
      path: '/dev/shm',
      size: `${shmTmpfsMiB(resources.memory_gb)}MiB`,
      'initial.mode': '1777',
      'initial.uid': '0',
      'initial.gid': '0',
    };
    const currentDevices = observedInstance(observed)?.devices ?? {};
    const daemonDevice = currentDevices.justavps_daemon;
    if (daemonDevice?.type === 'disk') devices.justavps_daemon = daemonDevice;
  }
  let configOperation: IncusOperation | Record<string, unknown> | null = null;
  let restartedForDevicePatch = false;
  try {
    configOperation = await client.updateInstanceConfig(instanceName, config, devices);
  } catch (error) {
    const message = error instanceof IncusApiError ? error.body : error instanceof Error ? error.message : String(error);
    const requiresStop = productMeta.machineType === 'container'
      && /device cannot be added when instance is running|cannot be added when instance is running|cannot update device.*running/i.test(message);
    if (!requiresStop) throw error;
    await client.stopInstance(instanceName).catch((stopError) => {
      if (!isLifecycleNoop(stopError, 'stop')) throw stopError;
    });
    configOperation = await client.updateInstanceConfig(instanceName, config, devices);
    await startCreatedMachine(client, instanceName);
    restartedForDevicePatch = true;
  }
  const patched = await client.getInstance(instanceName);
  const isolation = validateMachineIsolation({
    incus: patched,
    machineId: productMeta.machineId,
    incusHostname: instanceName,
    displayName: productMeta.displayName,
    machineType: productMeta.machineType,
    resources,
    accountId: productMeta.accountId,
  });
  if (!isolation.ok) {
    throw new Error(`Machine isolation validation failed after config patch: ${isolation.failures.join(', ')}`);
  }
  return { ...isolation, config_operation: configOperation, restarted_for_device_patch: restartedForDevicePatch };
}

function routeError(error: unknown) {
  if (error instanceof BadRequestError) return { status: error.status, body: { error: true, message: error.message, status: error.status } };
  if (error instanceof ConflictError) return { status: error.status, body: { error: true, message: error.message, status: error.status } };
  if (error instanceof z.ZodError) return { status: 400, body: { error: true, message: 'Invalid request', issues: error.issues } };
  if (error instanceof IncusApiError) return { status: 502, body: { error: true, message: error.message, incus_status: error.statusCode, incus_body: error.body } };
  if (error instanceof HetznerRobotApiError) {
    const operatorStatus = error.statusCode >= 400 && error.statusCode < 500 ? 409 : 502;
    return {
      status: operatorStatus,
      body: {
        error: true,
        message: `Hetzner Robot rejected the request: ${error.robotMessage ?? 'unknown Robot API error'}`,
        vendor: 'hetzner_robot',
        vendor_status: error.statusCode,
        vendor_body: error.body,
        action_required: error.statusCode === 412
          ? 'Open Hetzner Robot web interface for this product/location/account, or choose a different SKU/location/SSH key. The API preflight failed before any live charge.'
          : 'Review the Hetzner Robot response and retry with corrected order parameters.',
      },
    };
  }
  // Log generic 500s so they show up in the dev log instead of vanishing silently.
  console.error('[v2-api] unhandled route error:', error instanceof Error ? error.stack || error.message : String(error));
  return { status: 500, body: { error: true, message: error instanceof Error ? error.message : String(error) } };
}

// `app.openapi(route, handler)` insists the handler's return type EXACTLY
// match each response schema's TypeScript output. Our handlers return Prisma
// rows, raw Incus envelopes, and other passthrough shapes that are wider than
// any practical schema; rather than scatter `as never` on every return, the
// converted handlers are cast wholesale via `oapi(handler)` below. The runtime
// dispatch is unchanged — this is purely a typing escape hatch.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OapiHandler = (c: any) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const oapi = <H extends OapiHandler>(handler: H): any => handler;

function isLifecycleNoop(error: unknown, action: 'start' | 'stop' | 'reboot') {
  const message = error instanceof IncusApiError
    ? error.body.toLowerCase()
    : error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (action === 'start' && message.includes('already running')) || (action === 'stop' && message.includes('already stopped'));
}

async function startCreatedMachine(client: IncusClient, name: string): Promise<{ operation: IncusOperation | Record<string, unknown>; noop: boolean }> {
  try {
    return { operation: await client.startInstance(name), noop: false };
  } catch (error) {
    if (!isLifecycleNoop(error, 'start')) throw error;
    return { operation: { noop: true, action: 'start' }, noop: true };
  }
}

async function startCreatedMachineInstrumented(input: {
  client: IncusClient;
  name: string;
  telemetry?: MachineCreationTelemetry;
  spanPrefix: string;
  details?: Record<string, unknown>;
}): Promise<{ operation: IncusOperation | Record<string, unknown>; noop: boolean }> {
  if (!input.telemetry) return startCreatedMachine(input.client, input.name);
  let operationPath = '';
  try {
    operationPath = await withTelemetrySpan(
      input.telemetry,
      `${input.spanPrefix}: request state=start`,
      () => input.client.requestInstanceStateChange(input.name, 'start'),
      input.details,
    );
  } catch (error) {
    if (!isLifecycleNoop(error, 'start')) throw error;
    return { operation: { noop: true, action: 'start' }, noop: true };
  }
  const operation = await withTelemetrySpan(
    input.telemetry,
    `${input.spanPrefix}: wait operation`,
    () => input.client.waitForOperation(operationPath),
    { ...(input.details ?? {}), operation: operationPath },
  );
  return { operation, noop: false };
}

async function stopCreatedMachine(client: IncusClient, name: string): Promise<{ operation: IncusOperation | Record<string, unknown>; noop: boolean }> {
  try {
    return { operation: await client.stopInstance(name), noop: false };
  } catch (error) {
    if (!isLifecycleNoop(error, 'stop')) throw error;
    return { operation: { noop: true, action: 'stop' }, noop: true };
  }
}

async function ensureCreatedMachineRunning(client: IncusClient, name: string, initialObserved?: IncusInstance | null): Promise<{
  observed: IncusInstance | null;
  startOperation: IncusOperation | Record<string, unknown> | null;
  startNoop: boolean;
}> {
  let observed = initialObserved ?? await client.getInstance(name).catch(() => null);
  if (observed?.status?.toLowerCase() === 'running') {
    return { observed, startOperation: null, startNoop: true };
  }

  const started = await startCreatedMachine(client, name);
  observed = await client.getInstance(name).catch(() => null);
  if (observed?.status?.toLowerCase() !== 'running') {
    throw new Error(`Created machine ${name} did not reach Running state after start; observed ${observed?.status ?? 'unknown'}`);
  }
  return { observed, startOperation: started.operation, startNoop: started.noop };
}

async function enforceCreatedMachineResources(input: {
  client: IncusClient;
  cluster: IncusClusterConfig;
  instanceName: string;
  resources: { vcpu: number; memory_gb: number; disk_gb: number };
  machineId: string;
  displayName: string;
  machineType: 'container' | 'vm';
  accountId?: string | null;
}) {
  const observed = await input.client.getInstance(input.instanceName);
  const fastIsolation = validateMachineIsolation({
    incus: observed,
    machineId: input.machineId,
    incusHostname: input.instanceName,
    displayName: input.displayName,
    machineType: input.machineType,
    resources: input.resources,
    accountId: input.accountId,
  });
  if (fastIsolation.ok) {
    return {
      observed,
      isolation: {
        ...fastIsolation,
        config_operation: null,
        restarted_for_device_patch: false,
        fast_path: true,
      },
    };
  }

  const isolation = await applyResourceConfig(input.client, input.instanceName, input.cluster, input.resources, {
    machineId: input.machineId,
    displayName: input.displayName,
    machineType: input.machineType,
    accountId: input.accountId,
  });
  return { observed: await input.client.getInstance(input.instanceName), isolation };
}

async function createWarmPoolMachine(config: AppConfig, spec: WarmPoolSpec) {
  if (!config.databaseConfigured) throw new Error('Database not configured');
  if (spec.type !== 'container') throw new Error(CONTAINERS_ONLY_MESSAGE);
  if (spec.sourceType !== 'image') throw new Error('Pool priming is image-only; snapshot-backed pools are disabled');
  const poolMode = normalizeWarmPoolMode(spec.mode);
  let preferredClusterId: string | null = null;
  let preferredMemberName: string | null = null;
  const balancedHint = await balancedWarmPoolPlacementHint(config, spec, preferredClusterId);
  if (balancedHint && (!preferredClusterId || balancedHint.cluster_id === preferredClusterId)) {
    preferredClusterId = balancedHint.cluster_id;
    preferredMemberName = balancedHint.member_name;
  }
  const placement = await selectPlacement(config, { region: spec.region as SupportedRegion, resources: spec.resources, preferredClusterId, preferredMemberName });
  const { cluster, client, member } = placement;
  const sourceInput: CreateMachineInput = {
    region: spec.region as SupportedRegion,
    type: 'container',
    template_id: spec.sourceId,
    start_strategy: 'cold',
    resources: spec.resources,
    source: { type: 'image', image_id: spec.sourceId },
  };
  const resolvedSource = await resolveCreateInstanceSource(config, sourceInput, cluster);
  if ('error' in resolvedSource) throw new Error(resolvedSource.error.body.message);

  const machineId = generatedMachineId();
  const poolAccountId = spec.accountId ?? WARM_POOL_ACCOUNT_ID;
  const displayName = machineId;
  let operation: IncusOperation | Record<string, unknown> | null = null;
  let observed: IncusInstance | null = null;
  let isolationCheck: ReturnType<typeof validateMachineIsolation> | null = null;
  let startOperation: IncusOperation | Record<string, unknown> | null = null;
  let stopOperation: IncusOperation | Record<string, unknown> | null = null;
  let secondStartOperation: IncusOperation | Record<string, unknown> | null = null;
  let secondStopOperation: IncusOperation | Record<string, unknown> | null = null;
  let startNoop = false;
  let stopNoop = false;
  let secondStartNoop = false;
  let secondStopNoop = false;
  let primeUsability: Awaited<ReturnType<typeof ensureMachineUsable>> | null = null;
  let secondBootUsability: Awaited<ReturnType<typeof ensureMachineUsable>> | null = null;
  let storageUsage: ReturnType<typeof storageUsageAttribution> | null = null;
  try {
    operation = await client.createInstance({
      name: machineId,
      machineType: spec.type as 'container' | 'vm',
      source: resolvedSource.source,
      targetMember: member.server_name,
      resources: { vcpu: spec.resources.vcpu, memoryGb: spec.resources.memory_gb, diskGb: spec.resources.disk_gb },
      start: false,
      machineId,
      displayName,
      accountId: poolAccountId,
      platformDaemon: platformDaemonMount(config),
    });
    const enforced = await enforceCreatedMachineResources({
      client,
      cluster,
      instanceName: machineId,
      resources: spec.resources,
      machineId,
      displayName,
      machineType: spec.type as 'container' | 'vm',
      accountId: poolAccountId,
    });
    isolationCheck = enforced.isolation;
    observed = enforced.observed;
    const started = await startCreatedMachine(client, machineId);
    startOperation = started.operation;
    startNoop = started.noop;
    primeUsability = await ensureMachineUsable({
      config,
      client,
      instanceName: machineId,
      machineId,
      mode: 'warm-pool-prime',
      installManagedDaemon: true,
      repairManagedDaemon: false,
      waitForCloudInit: resolvedSource.justavpsReady === true ? false : undefined,
      actualLiveProbe: resolvedSource.justavpsReady === true,
      managedDaemonStepName: resolvedSource.justavpsReady === true ? 'activate injected managed daemon' : undefined,
      execTimeoutMs: resolvedSource.justavpsReady === true ? 90_000 : 120_000,
      cloudInitTimeoutMs: resolvedSource.justavpsReady === true ? 0 : 180_000,
      daemonHealthTimeoutMs: resolvedSource.justavpsReady === true ? 10_000 : 60_000,
    });
    const stopped = await stopCreatedMachine(client, machineId);
    stopOperation = stopped.operation;
    stopNoop = stopped.noop;
    observed = await client.getInstance(machineId).catch(() => observed);
    if (observed?.status && observed.status.toLowerCase() !== 'stopped') {
      throw new Error(`Primed warm pool machine ${machineId} did not stop cleanly; observed ${observed.status}`);
    }
    const secondStarted = await startCreatedMachine(client, machineId);
    secondStartOperation = secondStarted.operation;
    secondStartNoop = secondStarted.noop;
    secondBootUsability = await ensureMachineUsable({
      config,
      client,
      instanceName: machineId,
      machineId,
      mode: 'warm-pool-prime-second-boot',
      installManagedDaemon: false,
      repairManagedDaemon: true,
      waitForCloudInit: false,
      actualLiveProbe: true,
      execTimeoutMs: 120_000,
      daemonHealthTimeoutMs: 5_000,
    });
    if (poolMode === WARM_POOL_STOPPED_MODE) {
      const secondStopped = await stopCreatedMachine(client, machineId);
      secondStopOperation = secondStopped.operation;
      secondStopNoop = secondStopped.noop;
      observed = await client.getInstance(machineId).catch(() => observed);
      if (observed?.status && observed.status.toLowerCase() !== 'stopped') {
        throw new Error(`Second-boot-validated pool machine ${machineId} did not stop cleanly; observed ${observed.status}`);
      }
    } else {
      observed = await client.getInstance(machineId).catch(() => observed);
      if (observed?.status && observed.status.toLowerCase() !== 'running') {
        throw new Error(`Running pool machine ${machineId} did not stay running after validation; observed ${observed.status}`);
      }
    }
    storageUsage = await measureInstanceStorageUsage({
      client,
      cluster,
      instanceName: machineId,
      memberName: observed?.location ?? member.server_name,
      machineType: spec.type as 'container' | 'vm',
      diskLimitGb: spec.resources.disk_gb,
      allowExecFallback: false,
    });
    if (storageUsage.estimated) {
      throw new Error(`Pool machine ${machineId} storage usage was not exactly measurable: ${storageUsage.error ?? 'unknown measurement error'}`);
    }
  } catch (error) {
    await client.deleteInstance(machineId, { force: true }).catch(() => undefined);
    throw error;
  }

  return getPrisma().machine.create({
    data: {
      id: machineId,
      accountId: poolAccountId,
      name: displayName,
      region: spec.region,
      type: spec.type,
      status: WARM_POOL_STATUS,
      sourceType: spec.sourceType,
      sourceId: spec.sourceId,
      incusClusterId: cluster.id,
      incusProject: cluster.project,
      incusInstanceName: machineId,
      incusMemberName: observed?.location ?? member.server_name,
      resources: spec.resources,
      metadata: {
        warm_pool: {
          key: spec.key,
          mode: poolMode,
          pool_mode: poolMode === WARM_POOL_RUNNING_MODE ? 'running' : 'stopped',
          runtime_state: poolMode === WARM_POOL_RUNNING_MODE ? 'running' : 'stopped',
          primed: true,
          primed_at: primeUsability?.ready_at ?? new Date().toISOString(),
          prime_usability_ms: primeUsability?.duration_ms ?? null,
          prime_telemetry: primeUsability,
          second_boot_validated: true,
          second_boot_validated_at: secondBootUsability?.ready_at ?? new Date().toISOString(),
          second_boot_usability_ms: secondBootUsability?.duration_ms ?? null,
          second_boot_telemetry: secondBootUsability,
          policy_id: spec.policyId ?? null,
          owner_account_id: poolAccountId,
          ready_at: new Date().toISOString(),
          storage_usage: storageUsage,
          ...(spec.policyId ? {} : { target: warmPoolTarget() }),
          billing: storageUsage ? warmPoolEstimateFromStorageUsages(spec.resources, 1, [storageUsage], 1, poolMode) : warmPoolEstimate(spec.resources, 1, [], poolMode),
        },
        incus_operation: operation,
        start_operation: startOperation,
        start_noop: startNoop,
        stop_operation: stopOperation,
        stop_noop: stopNoop,
        second_start_operation: secondStartOperation,
        second_start_noop: secondStartNoop,
        second_stop_operation: secondStopOperation,
        second_stop_noop: secondStopNoop,
        isolation_check: isolationCheck,
        scheduler_placement: placement.placement,
        scheduler_placement_hint: balancedHint,
        usability: secondBootUsability ?? primeUsability,
        managed_daemon: secondBootUsability?.managed_daemon ?? secondBootUsability?.daemon_health ?? primeUsability?.managed_daemon ?? primeUsability?.daemon_health ?? null,
        managed_daemon_state: secondBootUsability?.managed_daemon_state ?? primeUsability?.managed_daemon_state ?? 'ready',
        managed_daemon_checked_at: secondBootUsability?.ready_at ?? primeUsability?.ready_at ?? new Date().toISOString(),
        display_name: displayName,
        incus_hostname: machineId,
      } as Prisma.InputJsonValue,
    },
  });
}

async function refreshWarmPoolStorageMeasurements(config: AppConfig, rows: PrismaMachine[], opts: { force?: boolean } = {}) {
  if (!config.databaseConfigured || rows.length === 0) return rows;
  const prisma = getPrisma();
  const refreshed: PrismaMachine[] = [];
  for (const row of rows) {
    if (!opts.force && storedWarmPoolStorageUsageRecord(row)) {
      refreshed.push(row);
      continue;
    }
    if (!isWarmPoolStatus(row.status)) {
      refreshed.push(row);
      continue;
    }
    const resources = machineResourceKey(row.resources);
    const cluster = clusterById(config, row.incusClusterId);
    let storageUsage: ReturnType<typeof storageUsageAttribution>;
    if (!cluster) {
      storageUsage = storageUsageAttribution({
        bytes: 0,
        source: 'unmeasured',
        diskLimitGb: resources.disk_gb,
        estimated: true,
        error: `cluster ${row.incusClusterId} is not configured`,
      });
    } else {
      storageUsage = await measureInstanceStorageUsage({
        client: clientFor(cluster),
        cluster,
        instanceName: row.incusInstanceName,
        memberName: row.incusMemberName,
        machineType: row.type === 'vm' ? 'vm' : 'container',
        diskLimitGb: resources.disk_gb,
        allowExecFallback: false,
      });
    }
    const metadata = jsonRecord(row.metadata);
    const warm = jsonRecord(metadata.warm_pool);
    const poolMode = normalizeWarmPoolMode(warm.mode);
    const updated = await prisma.machine.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...metadata,
          warm_pool: {
            ...warm,
            storage_usage: storageUsage,
            storage_usage_checked_at: storageUsage.measured_at,
            billing: warmPoolEstimateFromStorageUsages(resources, 1, [storageUsage], 1, poolMode),
          },
        } as Prisma.InputJsonValue,
      },
    });
    refreshed.push(updated);
  }
  return refreshed;
}

async function prepareAndPublishJustavpsImage(config: AppConfig, input: {
  cluster: IncusClusterConfig;
  source: CreateInstanceSource;
  imageType: 'container' | 'vm';
  alias: string;
  description: string;
  properties: Record<string, string>;
  public: boolean;
  accountId: string;
  baseResources?: { vcpu?: number | null; memory_gb?: number | null; disk_gb?: number | null };
  preferredMemberName?: string | null;
}) {
  const resources = imagePreparationResources(input.baseResources);
  const placement = await selectPlacement(config, {
    region: input.cluster.region as SupportedRegion,
    resources,
    targetClusterId: input.cluster.id,
    preferredMemberName: input.preferredMemberName,
  });
  const { client, member } = placement;
  const tempName = generatedMachineId();
  const displayName = `image-prep-${input.alias}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80);
  let createOperation: IncusOperation | Record<string, unknown> | null = null;
  let firstStart: Awaited<ReturnType<typeof startCreatedMachine>> | null = null;
  let firstStop: Awaited<ReturnType<typeof stopCreatedMachine>> | null = null;
  let secondStart: Awaited<ReturnType<typeof startCreatedMachine>> | null = null;
  let secondStop: Awaited<ReturnType<typeof stopCreatedMachine>> | null = null;
  try {
    createOperation = await client.createInstance({
      name: tempName,
      machineType: input.imageType,
      source: input.source,
      targetMember: member.server_name,
      resources: { vcpu: resources.vcpu, memoryGb: resources.memory_gb, diskGb: resources.disk_gb },
      start: false,
      machineId: tempName,
      displayName,
      accountId: input.accountId,
    });
    await enforceCreatedMachineResources({
      client,
      cluster: input.cluster,
      instanceName: tempName,
      resources,
      machineId: tempName,
      displayName,
      machineType: input.imageType,
      accountId: input.accountId,
    });
    firstStart = await startCreatedMachine(client, tempName);
    const firstUsability = await ensureMachineUsable({
      config,
      client,
      instanceName: tempName,
      machineId: tempName,
      mode: 'image-bake',
      installManagedDaemon: true,
      repairManagedDaemon: false,
      waitForCloudInit: false,
      actualLiveProbe: true,
      managedDaemonStepName: 'activate injected managed daemon',
      execTimeoutMs: 120_000,
      cloudInitTimeoutMs: 0,
      daemonHealthTimeoutMs: 10_000,
    });
    const firstDaemon = jsonRecord(firstUsability.managed_daemon);
    if (firstDaemon.daemon_source !== 'injected-mount' && firstDaemon.daemon_source !== 'injected-push') {
      throw new Error(`Machine Template preparation expected runtime daemon injection, got ${String(firstDaemon.daemon_source ?? 'none')}`);
    }
    const initialBake = {
      ok: true,
      baked_at: new Date().toISOString(),
      daemon_url: config.daemonDownloadUrl,
      daemon_source: 'runtime-injection',
      install: { exit_code: 0, stdout: 'JUSTAVPS_DAEMON_BAKE_SKIPPED_RUNTIME_INJECTION', stderr: '' },
      version: firstDaemon.version as string | undefined,
    };
    const firstCleanup = await cleanupInjectedManagedDaemon({ config, client, instanceName: tempName, removeBinary: true });
    if (firstCleanup.exit_code !== 0) throw new Error(firstCleanup.stderr || firstCleanup.stdout || 'failed to clean injected daemon after first verification');
    firstStop = await stopCreatedMachine(client, tempName);

    secondStart = await startCreatedMachine(client, tempName);
    const secondBootUsability = await ensureMachineUsable({
      config,
      client,
      instanceName: tempName,
      machineId: tempName,
      mode: 'image-bake',
      installManagedDaemon: true,
      repairManagedDaemon: false,
      waitForCloudInit: false,
      actualLiveProbe: true,
      managedDaemonStepName: 'activate injected managed daemon',
      execTimeoutMs: 120_000,
      daemonHealthTimeoutMs: 10_000,
    });
    const secondDaemon = jsonRecord(secondBootUsability.managed_daemon);
    if (secondDaemon.daemon_source !== 'injected-mount' && secondDaemon.daemon_source !== 'injected-push') {
      throw new Error(`Machine Template second-boot verification expected runtime daemon injection, got ${String(secondDaemon.daemon_source ?? 'none')}`);
    }
    const finalCleanup = await cleanupInjectedManagedDaemon({ config, client, instanceName: tempName, removeBinary: true });
    if (finalCleanup.exit_code !== 0) throw new Error(finalCleanup.stderr || finalCleanup.stdout || 'failed to clean injected daemon after second-boot validation');
    const finalBake = {
      ok: true,
      baked_at: new Date().toISOString(),
      daemon_url: config.daemonDownloadUrl,
      daemon_source: 'runtime-injection',
      install: { exit_code: 0, stdout: finalCleanup.stdout || 'JUSTAVPS_DAEMON_IMAGE_CLEANED_RUNTIME_INJECTION', stderr: finalCleanup.stderr },
      version: secondDaemon.version as string | undefined,
    };
    secondStop = await stopCreatedMachine(client, tempName);

    const operation = await client.createImageFromInstance({
      instanceName: tempName,
      aliases: [{ name: input.alias, description: input.description }],
      properties: {
        ...input.properties,
        'justavps.daemon_baked': 'false',
        'justavps.daemon_runtime_injected': 'true',
        'justavps.daemon_first_boot_verified': String(firstUsability.ok),
        'justavps.daemon_second_boot_verified': String(secondBootUsability.ok),
        'justavps.daemon_bake_strategy': 'runtime-injection-second-boot-validation',
        'justavps.image_type': input.imageType === 'vm' ? 'virtual-machine' : 'container',
      },
      public: input.public,
    });

    await client.deleteInstance(tempName, { force: true }).catch(() => undefined);
    return {
      operation,
      temp_instance: tempName,
      create_operation: createOperation,
      first_start: firstStart,
      first_stop: firstStop,
      second_start: secondStart,
      second_stop: secondStop,
      first_usability: firstUsability,
      initial_bake: initialBake,
      second_boot_usability: secondBootUsability,
      final_bake: finalBake,
      placement: placement.placement,
      resources,
    };
  } catch (error) {
    await client.deleteInstance(tempName, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function createPreparedMachineTemplate(config: AppConfig, input: z.infer<typeof createMachineTemplateSchema>, accountId: string) {
  if (!config.databaseConfigured) throw new BadRequestError('Database not configured');
  if (input.type !== 'container') throw new BadRequestError(CONTAINERS_ONLY_MESSAGE);
  const prisma = getPrisma();
  const slug = templateSlug(input.slug ?? input.name);
  const existing = await prisma.machineTemplate.findUnique({ where: { accountId_slug: { accountId, slug } } }).catch(() => null);
  if (existing && existing.status !== 'deleted') throw new ConflictError(`Machine Template slug ${slug} already exists for account ${accountId}`);
  const alias = slug.startsWith('tpl-') || slug.startsWith('justavps-') ? slug : `tpl-${slug}`;
  const commonProperties = {
    'justavps.machine_template_slug': slug,
    'justavps.machine_template_name': input.name,
    'justavps.machine_template_default_vcpu': String(input.default_resources.vcpu),
    'justavps.machine_template_default_memory_gb': String(input.default_resources.memory_gb),
    'justavps.machine_template_default_disk_gb': String(input.default_resources.disk_gb),
  };

  let cluster: IncusClusterConfig | null = null;
  let prepared: Awaited<ReturnType<typeof prepareAndPublishJustavpsImage>>;
  let rawOperation: IncusOperation | Record<string, unknown> | null = null;
  let importedBackupInstance: string | null = null;
  let sourceKind = input.source.type;
  let sourceRef: string | null = null;
  let sourceMachineId: string | null = null;
  let sourceSnapshotId: string | null = null;

  try {
    if (input.source.type === 'docker') {
      cluster = pickCluster(config, input.region) ?? null;
      if (!cluster) throw new ConflictError(`No Incus cluster configured for region ${input.region}`);
      const server = input.source.server ?? 'https://docker.io';
      const rawAlias = generatedResourceName('imgraw');
      rawOperation = await clientFor(cluster).createImageFromOci({
        server,
        ociRef: input.source.ref,
        imageType: 'container',
        aliases: [{ name: rawAlias, description: `Temporary raw JustAVPS Template ${rawAlias} (OCI: ${input.source.ref})` }],
        properties: { ...commonProperties, 'justavps.source': 'docker', 'justavps.docker_ref': input.source.ref, 'justavps.docker_server': server, 'justavps.raw_for': alias },
        public: false,
      });
      sourceRef = `${server}:${input.source.ref}`;
      prepared = await prepareAndPublishJustavpsImage(config, {
        cluster,
        source: { type: 'image', image: rawAlias },
        imageType: 'container',
        alias,
        description: `JustAVPS Machine Template ${input.name} (OCI: ${input.source.ref})`,
        properties: { ...commonProperties, ...(input.metadata ? Object.fromEntries(Object.entries(input.metadata).map(([k, v]) => [`justavps.meta.${k}`, String(v)])) : {}), 'justavps.source': 'docker', 'justavps.docker_ref': input.source.ref, 'justavps.docker_server': server },
        public: input.visibility === 'catalog',
        accountId,
        baseResources: input.default_resources,
      });
      await clientFor(cluster).deleteImage(rawAlias).catch(() => undefined);
    } else if (input.source.type === 'simplestreams') {
      cluster = pickCluster(config, input.region) ?? null;
      if (!cluster) throw new ConflictError(`No Incus cluster configured for region ${input.region}`);
      const server = input.source.server ?? 'https://images.linuxcontainers.org';
      const rawAlias = generatedResourceName('imgraw');
      rawOperation = await clientFor(cluster).createImageFromSimplestreams({
        server,
        alias: input.source.ref,
        imageType: 'container',
        aliases: [{ name: rawAlias, description: `Temporary raw JustAVPS Template ${rawAlias} (simplestreams: ${input.source.ref})` }],
        properties: { ...commonProperties, 'justavps.source': 'simplestreams', 'justavps.simplestreams_ref': input.source.ref, 'justavps.simplestreams_server': server, 'justavps.raw_for': alias },
        public: false,
      });
      sourceRef = `${server}:${input.source.ref}`;
      prepared = await prepareAndPublishJustavpsImage(config, {
        cluster,
        source: { type: 'image', image: rawAlias },
        imageType: 'container',
        alias,
        description: `JustAVPS Machine Template ${input.name} (simplestreams: ${input.source.ref})`,
        properties: { ...commonProperties, 'justavps.source': 'simplestreams', 'justavps.simplestreams_ref': input.source.ref, 'justavps.simplestreams_server': server },
        public: input.visibility === 'catalog',
        accountId,
        baseResources: input.default_resources,
      });
      await clientFor(cluster).deleteImage(rawAlias).catch(() => undefined);
    } else if (input.source.type === 'image') {
      cluster = pickCluster(config, input.region) ?? null;
      if (!cluster) throw new ConflictError(`No Incus cluster configured for region ${input.region}`);
      sourceRef = input.source.image_id;
      prepared = await prepareAndPublishJustavpsImage(config, {
        cluster,
        source: { type: 'image', image: input.source.image_id },
        imageType: 'container',
        alias,
        description: `JustAVPS Machine Template ${input.name}`,
        properties: { ...commonProperties, 'justavps.source': 'image', 'justavps.source_image_id': input.source.image_id },
        public: input.visibility === 'catalog',
        accountId,
        baseResources: input.default_resources,
      });
    } else if (input.source.type === 'machine' || input.source.type === 'snapshot') {
      const resolved = await machineClient(config, input.source.machine_id);
      if (!resolved) throw new BadRequestError('Source machine not found');
      if (resolved.machine.type !== 'container') throw new BadRequestError(CONTAINERS_ONLY_MESSAGE);
      cluster = resolved.cluster;
      sourceMachineId = resolved.machine.id;
      let snapshotName: string | null = null;
      if (input.source.type === 'snapshot') {
        const snapshot = config.databaseConfigured
          ? await prisma.snapshot.findUnique({ where: { id: input.source.snapshot_id } })
            ?? await prisma.snapshot.findFirst({ where: { machineId: resolved.machine.id, incusSnapshotName: input.source.snapshot_id }, orderBy: { createdAt: 'desc' } })
          : null;
        snapshotName = snapshot?.incusSnapshotName ?? input.source.snapshot_id;
        sourceSnapshotId = snapshot?.id ?? input.source.snapshot_id;
      }
      sourceRef = snapshotName ? `${resolved.machine.id}/${snapshotName}` : resolved.machine.id;
      prepared = await prepareAndPublishJustavpsImage(config, {
        cluster,
        source: { type: 'snapshot', source: snapshotName ? `${resolved.machine.incusInstanceName}/${snapshotName}` : resolved.machine.incusInstanceName },
        imageType: 'container',
        alias,
        description: `JustAVPS Machine Template ${input.name}`,
        properties: { ...commonProperties, 'justavps.source': input.source.type, 'justavps.source_machine_id': resolved.machine.id, ...(snapshotName ? { 'justavps.source_snapshot': snapshotName } : {}) },
        public: input.visibility === 'catalog',
        accountId,
        baseResources: input.default_resources,
        preferredMemberName: resolved.machine.incusMemberName,
      });
    } else {
      const backupId = `${input.source.machine_id}/${input.source.backup_id}`;
      const backup = await resolveBackupForSource(config, backupId);
      if ('error' in backup) throw new BadRequestError(backup.error.body.message);
      const backupCluster = clusterById(config, backup.sourceMachine.incusClusterId);
      if (!backupCluster) throw new BadRequestError(`Backup source cluster ${backup.sourceMachine.incusClusterId} is not configured`);
      cluster = backupCluster;
      const client = clientFor(cluster);
      importedBackupInstance = generatedMachineId();
      const tarball = await client.exportBackup(backup.sourceMachine.incusInstanceName, backup.backupName);
      rawOperation = await client.importInstanceFromTarball({ tarball, targetName: importedBackupInstance, targetMember: backup.sourceMachine.incusMemberName ?? undefined });
      sourceMachineId = backup.sourceMachine.id;
      sourceRef = `${backup.sourceMachine.id}/${backup.backupName}`;
      prepared = await prepareAndPublishJustavpsImage(config, {
        cluster,
        source: { type: 'snapshot', source: importedBackupInstance },
        imageType: 'container',
        alias,
        description: `JustAVPS Machine Template ${input.name}`,
        properties: { ...commonProperties, 'justavps.source': 'backup', 'justavps.source_machine_id': backup.sourceMachine.id, 'justavps.source_backup': backup.backupName },
        public: input.visibility === 'catalog',
        accountId,
        baseResources: input.default_resources,
        preferredMemberName: backup.sourceMachine.incusMemberName,
      });
      await client.deleteInstance(importedBackupInstance, { force: true }).catch(() => undefined);
      importedBackupInstance = null;
    }

    const image = await findIncusImageByAliasOrFingerprint(clientFor(cluster), alias).catch(() => null);
    const storage = imageMeasuredStorage(image);
    const now = new Date();
    const row = await prisma.machineTemplate.create({
      data: {
        accountId,
        name: input.name,
        slug,
        status: 'active',
        visibility: input.visibility,
        region: cluster.region,
        type: 'container',
        incusClusterId: cluster.id,
        incusProject: cluster.project,
        incusAlias: alias,
        incusFingerprint: image?.fingerprint ?? alias,
        defaultResources: input.default_resources,
        sourceKind,
        sourceRef,
        measuredBytes: storage.metered_bytes ? BigInt(storage.metered_bytes) : null,
        billableGib: storage.billable_gib,
        preparedAt: now,
        verifiedAt: now,
        metadata: {
          ...(input.metadata ?? {}),
          source_machine_id: sourceMachineId,
          source_snapshot_id: sourceSnapshotId,
          raw_operation: rawOperation,
          justavps_preparation: prepared,
          image_properties: image?.properties ?? {},
          storage,
        } as Prisma.InputJsonValue,
      },
    });
    return { row, image };
  } catch (error) {
    if (cluster) await clientFor(cluster).deleteImage(alias).catch(() => undefined);
    if (cluster && importedBackupInstance) await clientFor(cluster).deleteInstance(importedBackupInstance, { force: true }).catch(() => undefined);
    throw error;
  }
}

let warmPoolSpecEnsurePromises = new Map<string, Promise<Awaited<ReturnType<typeof ensureWarmPoolForSpecNow>>>>();

async function ensureWarmPoolForSpec(config: AppConfig, spec: WarmPoolSpec) {
  const lockKey = warmPoolSpecLockKey(spec);
  const existing = warmPoolSpecEnsurePromises.get(lockKey);
  if (existing) return existing;
  const promise = ensureWarmPoolForSpecNow(config, spec).finally(() => warmPoolSpecEnsurePromises.delete(lockKey));
  warmPoolSpecEnsurePromises.set(lockKey, promise);
  return promise;
}

async function ensureWarmPoolForSpecNow(config: AppConfig, spec: WarmPoolSpec) {
  if (!config.databaseConfigured) return { key: spec.key, target: 0, ready: 0, creating: 0, created: 0, skipped: 'database not configured' };
  if (spec.type !== 'container') return { key: spec.key, target: 0, ready: 0, creating: 0, created: 0, skipped: 'VM pools disabled; containers only' };
  if (spec.sourceType !== 'image') return { key: spec.key, target: 0, ready: 0, creating: 0, created: 0, skipped: 'snapshot-backed pools disabled; image pools only' };
  const policy = spec.policyId ? await getPrisma().warmPoolPolicy.findUnique({ where: { id: spec.policyId } }) : null;
  const poolMode = normalizeWarmPoolMode(spec.mode ?? policy?.billingMode);
  const target = spec.policyId ? (policy?.status === 'active' ? policy.target : 0) : warmPoolTarget();
  if (!target) return { key: spec.key, target, ready: 0, creating: 0, created: 0 };
  const poolAccountId = spec.accountId ?? WARM_POOL_ACCOUNT_ID;
  const staleClaimCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  await getPrisma().$executeRawUnsafe(
    `UPDATE v2_core.machines
     SET status = $1,
         metadata = metadata || jsonb_build_object('warm_pool_stale_claim_reset_at', $2::text),
         updated_at = now()
     WHERE account_id = $3
       AND status = $4
       AND region = $5
       AND type = $6
       AND source_type = $7
       AND source_id = $8
       AND metadata->'warm_pool'->>'policy_id' = $9
       AND metadata->'warm_pool'->>'mode' = $10
       AND COALESCE(metadata->'warm_pool'->>'claimed_at', '') < $11`,
    WARM_POOL_STATUS,
    new Date().toISOString(),
    poolAccountId,
    WARM_POOL_CLAIMING_STATUS,
    spec.region,
    spec.type,
    spec.sourceType,
    spec.sourceId,
    spec.policyId ?? '',
    poolMode,
    staleClaimCutoff,
  ).catch(() => undefined);
  const rows = await getPrisma().machine.findMany({
    where: {
      accountId: poolAccountId,
      status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] },
      region: spec.region,
      type: spec.type,
      sourceType: spec.sourceType,
      sourceId: spec.sourceId,
    },
  });
  const matching = rows.filter((row) => {
    if (!matchesWarmPoolSpec(row, spec)) return false;
    const warm = jsonRecord(jsonRecord(row.metadata).warm_pool);
    const policyId = warm.policy_id;
    const rowMode = normalizeWarmPoolMode(warm.mode);
    return rowMode === poolMode && (spec.policyId ? policyId === spec.policyId : !policyId);
  });
  await refreshWarmPoolStorageMeasurements(config, matching.filter((row) => !storedWarmPoolStorageUsageRecord(row)));
  const ready = matching.filter((row) => row.status === WARM_POOL_STATUS).length;
  const creating = matching.length - ready;
  const missing = Math.max(0, target - matching.length);
  let created = 0;
  for (let i = 0; i < missing; i += 1) {
    await createWarmPoolMachine(config, spec);
    created += 1;
  }
  return { key: spec.key, target, ready, creating, created };
}

async function drainWarmPoolPolicy(config: AppConfig, policy: PrismaWarmPoolPolicy) {
  if (!config.databaseConfigured) return { drained: 0, errors: [] as string[] };
  const spec = warmPoolSpecFromPolicy(policy);
  const inFlight = warmPoolSpecEnsurePromises.get(warmPoolSpecLockKey(spec));
  if (inFlight) await inFlight.catch(() => undefined);
  const rows = await getPrisma().machine.findMany({
    where: {
      accountId: policy.accountId,
      status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] },
      region: policy.region,
      type: policy.type,
      sourceType: policy.sourceType,
      sourceId: policy.sourceId,
    },
  });
  let drained = 0;
  const errors: string[] = [];
  for (const row of rows.filter((item) => jsonRecord(jsonRecord(item.metadata).warm_pool).policy_id === policy.id)) {
    const cluster = clusterById(config, row.incusClusterId);
    try {
      if (cluster) await clientFor(cluster).deleteInstance(row.incusInstanceName, { force: true }).catch(() => undefined);
      await getPrisma().machine.update({ where: { id: row.id }, data: { status: 'deleted' } });
      drained += 1;
    } catch (error) {
      errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { drained, errors };
}

async function drainWarmPoolPolicySurplus(config: AppConfig, policy: PrismaWarmPoolPolicy) {
  if (!config.databaseConfigured || policy.target <= 0) return { drained: 0, errors: [] as string[] };
  const spec = warmPoolSpecFromPolicy(policy);
  const inFlight = warmPoolSpecEnsurePromises.get(warmPoolSpecLockKey(spec));
  if (inFlight) await inFlight.catch(() => undefined);
  const rows = await getPrisma().machine.findMany({
    where: {
      accountId: policy.accountId,
      status: WARM_POOL_STATUS,
      region: policy.region,
      type: policy.type,
      sourceType: policy.sourceType,
      sourceId: policy.sourceId,
    },
    orderBy: [{ updatedAt: 'asc' }],
  });
  const matching = rows.filter((item) => jsonRecord(jsonRecord(item.metadata).warm_pool).policy_id === policy.id && matchesWarmPoolSpec(item, spec));
  const surplus = Math.max(0, matching.length - policy.target);
  let drained = 0;
  const errors: string[] = [];
  for (const row of matching.slice(0, surplus)) {
    const cluster = clusterById(config, row.incusClusterId);
    try {
      if (cluster) await clientFor(cluster).deleteInstance(row.incusInstanceName, { force: true }).catch(() => undefined);
      await getPrisma().machine.update({ where: { id: row.id }, data: { status: 'deleted' } });
      drained += 1;
    } catch (error) {
      errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { drained, errors };
}

let warmPoolRefillPromise: ReturnType<typeof refillWarmPoolNow> | null = null;

async function refillWarmPoolNow(config: AppConfig) {
  const results: Awaited<ReturnType<typeof ensureWarmPoolForSpec>>[] = [];
  if (!config.databaseConfigured) return { ok: true as const, results };
  const policies = await getPrisma().warmPoolPolicy.findMany({
    where: { status: 'active', target: { gt: 0 }, sourceType: 'image', type: 'container' },
    orderBy: { updatedAt: 'asc' },
  });
  for (const policy of policies) {
    results.push(await ensureWarmPoolForSpec(config, warmPoolSpecFromPolicy(policy)));
  }
  return { ok: true as const, results };
}

async function refillWarmPool(config: AppConfig) {
  if (warmPoolRefillPromise) return warmPoolRefillPromise;
  warmPoolRefillPromise = refillWarmPoolNow(config).finally(() => {
    warmPoolRefillPromise = null;
  });
  return warmPoolRefillPromise;
}

let warmPoolMaintainerStarted = false;

function startWarmPoolMaintainer(config: AppConfig) {
  if (warmPoolMaintainerStarted || !warmPoolMaintainerEnabled() || !config.databaseConfigured) return;
  warmPoolMaintainerStarted = true;
  const run = () => void refillWarmPool(config).catch((error) => console.warn('[v2-api] warm pool refill failed:', error instanceof Error ? error.message : String(error)));
  run();
  setInterval(run, Math.max(30_000, Number.parseInt(process.env.V2_WARM_POOL_INTERVAL_MS ?? '120000', 10) || 120_000));
}

function adminGuard(config: AppConfig, authorization: string | undefined) {
  if (!config.adminToken) return null;
  const allowedTokens = config.adminToken.split(',').map((token) => token.trim()).filter(Boolean);
  return allowedTokens.some((token) => authorization === `Bearer ${token}`) ? null : { error: true, message: 'Unauthorized' };
}

function timingSafeStringEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function telemetryQuery(c: { req: { query: (name: string) => string | undefined } }) {
  const limitRaw = c.req.query('limit');
  return {
    from: c.req.query('from') ?? c.req.query('cursor') ?? undefined,
    to: c.req.query('to') ?? undefined,
    limit: limitRaw ? Number.parseInt(limitRaw, 10) : undefined,
  };
}

async function telemetryIngestGuard(config: AppConfig, authorization: string | undefined, machineId: string, payload: Record<string, unknown>, headerToken?: string) {
  if (!adminGuard(config, authorization)) return null;
  if (config.telemetry.ingestToken && headerToken && timingSafeStringEqual(headerToken, config.telemetry.ingestToken)) return null;

  const machineToken = typeof payload.machine_token === 'string' ? payload.machine_token : '';
  if (machineToken && config.databaseConfigured) {
    const machine = await getPrisma().machine.findUnique({ where: { id: machineId } }).catch(() => null);
    const managed = machine?.metadata && typeof machine.metadata === 'object' && !Array.isArray(machine.metadata)
      ? (machine.metadata as Record<string, unknown>).managed_daemon
      : null;
    const tokenSha = managed && typeof managed === 'object' && !Array.isArray(managed)
      ? (managed as Record<string, unknown>).token_sha256
      : null;
    if (typeof tokenSha === 'string' && timingSafeStringEqual(sha256Hex(machineToken), tokenSha)) return null;
  }

  return { error: true, message: 'Unauthorized' };
}

type ObservedInstance = IncusInstance & {
  expanded_config?: Record<string, string>;
  expanded_devices?: Record<string, Record<string, string>>;
  project?: string;
};

function observedInstance(value: unknown): ObservedInstance | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ObservedInstance : null;
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.ceil(value);
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : undefined;
}

function sizeToGiB(value: unknown): number | undefined {
  if (typeof value === 'number') return positiveNumber(value);
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgtp]?i?b?)?$/i);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = (match[2] || 'gib').toLowerCase();
  if (unit.startsWith('k')) return Math.ceil(amount / 1024 / 1024);
  if (unit.startsWith('m')) return Math.ceil(amount / 1024);
  if (unit.startsWith('g') || unit === 'b' || unit === '') return Math.ceil(amount);
  if (unit.startsWith('t')) return Math.ceil(amount * 1024);
  if (unit.startsWith('p')) return Math.ceil(amount * 1024 * 1024);
  return undefined;
}

function resourcesFromIncus(incus: unknown) {
  const observed = observedInstance(incus);
  if (!observed) return {};
  const config = { ...(observed.expanded_config ?? {}), ...(observed.config ?? {}) };
  const devices = { ...(observed.expanded_devices ?? {}), ...(observed.devices ?? {}) };
  const root = devices.root ?? Object.values(devices).find((device) => device?.type === 'disk' && device?.path === '/');
  const resources: Record<string, number> = {};
  const vcpu = positiveNumber(config['limits.cpu']);
  const memory = sizeToGiB(config['limits.memory']);
  const disk = sizeToGiB(root?.size);
  if (vcpu) resources.vcpu = vcpu;
  if (memory) resources.memory_gb = memory;
  if (disk) resources.disk_gb = disk;
  return resources;
}

function mergeResources(productResources: unknown, incus: unknown) {
  return { ...jsonRecord(productResources), ...resourcesFromIncus(incus) };
}

function rootDiskDevice(incus: unknown): Record<string, string> | null {
  const observed = observedInstance(incus);
  if (!observed) return null;
  const devices = { ...(observed.expanded_devices ?? {}), ...(observed.devices ?? {}) };
  return devices.root ?? Object.values(devices).find((device) => device?.type === 'disk' && device?.path === '/') ?? null;
}

function nicDevice(incus: unknown): Record<string, string> | null {
  const observed = observedInstance(incus);
  if (!observed) return null;
  const devices = { ...(observed.expanded_devices ?? {}), ...(observed.devices ?? {}) };
  return devices.eth0 ?? Object.values(devices).find((device) => device?.type === 'nic') ?? null;
}

function shmTmpfsMiB(memoryGb: number) {
  return Math.max(64, Math.min(1024, memoryGb * 512));
}

function platformDaemonMount(config: AppConfig) {
  return config.daemonMountSource
    ? { source: config.daemonMountSource, path: config.daemonGuestPath || '/usr/local/bin/justavps-daemon', readonly: true }
    : null;
}

function persistedResources(productResources: unknown, incus: unknown) {
  return { ...jsonRecord(productResources), ...resourcesFromIncus(incus) } as { vcpu?: number; memory_gb?: number; disk_gb?: number };
}

function machineKind(value: string): 'container' | 'vm' {
  return value === 'vm' ? 'vm' : 'container';
}

function splitCsv(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function validateMachineIsolation(input: {
  incus: IncusInstance | null;
  machineId: string;
  incusHostname?: string;
  displayName: string;
  machineType: 'container' | 'vm';
  resources: { vcpu: number; memory_gb: number; disk_gb: number };
  accountId?: string | null;
}) {
  const observed = observedInstance(input.incus);
  const config = { ...(observed?.expanded_config ?? {}), ...(observed?.config ?? {}) };
  const root = rootDiskDevice(observed);
  const expectedConfig: Record<string, string> = {
    ...hardenedSecurityConfig(input.machineType),
    'limits.cpu': String(input.resources.vcpu),
    'limits.memory': `${input.resources.memory_gb}GiB`,
    'user.justavps.machine_id': input.machineId,
    'user.justavps.machine_name': input.displayName,
    'user.justavps.display_name': input.displayName,
    'user.justavps.hostname': input.incusHostname ?? input.machineId,
    ...(input.accountId ? { 'user.justavps.account_id': input.accountId } : {}),
  };
  const checks: Record<string, boolean> = {
    observed: Boolean(observed),
    'root.type': root?.type === 'disk',
    'root.path': root?.path === '/',
    'root.pool': Boolean(root?.pool),
    'root.size': root?.size === `${input.resources.disk_gb}GiB`,
  };

  for (const [key, expected] of Object.entries(expectedConfig)) {
    if (key === 'security.syscalls.deny') {
      const observedDeny = new Set(splitCsv(config[key]));
      checks[key] = splitCsv(expected).every((entry) => observedDeny.has(entry));
    } else if (expected === '') {
      checks[key] = !config[key];
    } else {
      checks[key] = config[key] === expected;
    }
  }
  if (input.machineType === 'container') {
    const devices = { ...(observed?.expanded_devices ?? {}), ...(observed?.devices ?? {}) };
    const shm = devices.justavps_shm;
    const eth0 = devices.eth0 ?? Object.values(devices).find((device) => device?.type === 'nic');
    checks['raw.idmap.absent'] = !config['raw.idmap'];
    checks['raw.lxc.absent'] = !config['raw.lxc'];
    checks['raw.apparmor.absent'] = !config['raw.apparmor'];
    checks['raw.seccomp.absent'] = !config['raw.seccomp'];
    checks['justavps_shm.type'] = shm?.type === 'disk';
    checks['justavps_shm.source'] = shm?.source === 'tmpfs:';
    checks['justavps_shm.path'] = shm?.path === '/dev/shm';
    checks['justavps_shm.size'] = shm?.size === `${shmTmpfsMiB(input.resources.memory_gb)}MiB`;
    checks['eth0.security.mac_filtering'] = eth0?.['security.mac_filtering'] === 'true';
    checks['eth0.security.ipv4_filtering'] = eth0?.['security.ipv4_filtering'] === 'true';
    checks['eth0.security.ipv6_filtering.disabled'] = !eth0?.['security.ipv6_filtering'] || eth0?.['security.ipv6_filtering'] === 'false';
  }

  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return {
    ok: failures.length === 0,
    checked_at: new Date().toISOString(),
    failures,
    checks,
    expected_resources: input.resources,
    observed_resources: resourcesFromIncus(observed),
    observed_root: root,
  };
}

function exactBytes(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function findIncusImageByAliasOrFingerprint(client: IncusClient, imageId: string) {
  const images = await client.listImages();
  return images.find((image) => image.fingerprint === imageId || image.aliases?.some((alias) => alias.name === imageId)) ?? null;
}

function imageIsJustavpsReady(image: IncusImage | null | undefined) {
  const props = image?.properties ?? {};
  return (props['justavps.daemon_baked'] === 'true' || props['justavps.daemon_runtime_injected'] === 'true')
    && props['justavps.daemon_second_boot_verified'] === 'true';
}

function templateSlug(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || generatedResourceName('tpl');
}

function decimalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resourceShape(value: unknown, fallback: ResourceShape = DEFAULT_TEMPLATE_RESOURCES): ResourceShape {
  const resources = jsonRecord(value);
  const vcpu = Number(resources.vcpu);
  const memoryGb = Number(resources.memory_gb);
  const diskGb = Number(resources.disk_gb);
  return {
    vcpu: Number.isFinite(vcpu) && vcpu > 0 ? Math.round(vcpu) : fallback.vcpu,
    memory_gb: Number.isFinite(memoryGb) && memoryGb > 0 ? Math.round(memoryGb) : fallback.memory_gb,
    disk_gb: Number.isFinite(diskGb) && diskGb > 0 ? Math.round(diskGb) : fallback.disk_gb,
  };
}

function imageMeasuredStorage(image: IncusImage | null | undefined) {
  const bytes = exactBytes(image?.size);
  const billableGib = bytes ? Number((bytes / 1024 ** 3).toFixed(9)) : null;
  return {
    metered_bytes: bytes ?? null,
    billable_gib: billableGib,
    source: bytes ? 'incus-image-size' : 'unknown',
    estimated: true,
    note: 'Template image size is an estimate; exact usage is finalized centrally in Billing API v2 after priming.',
  };
}

type ResolvedMachineTemplate = {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  status: string;
  visibility: string;
  region: SupportedRegion;
  type: 'container';
  incusClusterId: string;
  incusProject: string;
  incusAlias: string;
  incusFingerprint: string;
  defaultResources: ResourceShape;
  sourceKind: string;
  sourceRef: string | null;
  measuredBytes: bigint | number | null;
  billableGib: unknown;
  preparedAt: Date | null;
  verifiedAt: Date | null;
  metadata: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  image?: IncusImage | null;
  virtual?: boolean;
};

async function findImageForTemplate(config: AppConfig, template: Pick<ResolvedMachineTemplate, 'incusClusterId' | 'incusAlias' | 'incusFingerprint'>) {
  const cluster = findCluster(config, template.incusClusterId) ?? config.clusters[0] ?? null;
  if (!cluster) return null;
  return findIncusImageByAliasOrFingerprint(clientFor(cluster), template.incusAlias).catch(async () => (
    template.incusFingerprint ? findIncusImageByAliasOrFingerprint(clientFor(cluster), template.incusFingerprint).catch(() => null) : null
  ));
}

async function ensureCatalogMachineTemplates(config: AppConfig) {
  if (!config.databaseConfigured) return;
  const prisma = getPrisma();
  for (const template of TEMPLATES) {
    const cluster = config.clusters.find((candidate) => candidate.region === 'eu') ?? config.clusters[0] ?? null;
    if (!cluster) continue;
    const image = await findIncusImageByAliasOrFingerprint(clientFor(cluster), template.id).catch(() => null);
    const ready = imageIsJustavpsReady(image);
    const storage = imageMeasuredStorage(image);
    await prisma.machineTemplate.upsert({
      where: { incusClusterId_incusProject_incusAlias: { incusClusterId: cluster.id, incusProject: cluster.project, incusAlias: template.id } },
      create: {
        accountId: 'system',
        name: template.name,
        slug: template.id,
        status: ready ? 'active' : 'preparing',
        visibility: 'catalog',
        region: cluster.region,
        type: 'container',
        incusClusterId: cluster.id,
        incusProject: cluster.project,
        incusAlias: template.id,
        incusFingerprint: image?.fingerprint ?? template.id,
        defaultResources: DEFAULT_TEMPLATE_RESOURCES,
        sourceKind: 'catalog',
        sourceRef: template.id,
        measuredBytes: storage.metered_bytes ? BigInt(storage.metered_bytes) : null,
        billableGib: storage.billable_gib,
        preparedAt: ready ? new Date() : null,
        verifiedAt: ready ? new Date() : null,
        metadata: { description: template.description, image_properties: image?.properties ?? {}, storage } as Prisma.InputJsonValue,
      },
      update: {
        name: template.name,
        status: ready ? 'active' : 'preparing',
        visibility: 'catalog',
        incusFingerprint: image?.fingerprint ?? template.id,
        measuredBytes: storage.metered_bytes ? BigInt(storage.metered_bytes) : null,
        billableGib: storage.billable_gib,
        preparedAt: ready ? new Date() : null,
        verifiedAt: ready ? new Date() : null,
        metadata: { description: template.description, image_properties: image?.properties ?? {}, storage } as Prisma.InputJsonValue,
      },
    }).catch((error) => console.warn(`[v2-api] catalog machine template seed failed for ${template.id}:`, error instanceof Error ? error.message : String(error)));
  }
}

async function virtualCatalogMachineTemplate(config: AppConfig, ref: string): Promise<ResolvedMachineTemplate | null> {
  const catalog = TEMPLATES.find((template) => template.id === ref || template.name === ref);
  if (!catalog) return null;
  const cluster = config.clusters.find((candidate) => candidate.region === 'eu') ?? config.clusters[0] ?? null;
  if (!cluster) return null;
  const image = await findIncusImageByAliasOrFingerprint(clientFor(cluster), catalog.id).catch(() => null);
  if (!image) return null;
  return {
    id: catalog.id,
    accountId: 'system',
    name: catalog.name,
    slug: catalog.id,
    status: imageIsJustavpsReady(image) ? 'active' : 'preparing',
    visibility: 'catalog',
    region: cluster.region as SupportedRegion,
    type: 'container',
    incusClusterId: cluster.id,
    incusProject: cluster.project,
    incusAlias: catalog.id,
    incusFingerprint: image.fingerprint ?? catalog.id,
    defaultResources: DEFAULT_TEMPLATE_RESOURCES,
    sourceKind: 'catalog',
    sourceRef: catalog.id,
    measuredBytes: image.size ? BigInt(image.size) : null,
    billableGib: imageMeasuredStorage(image).billable_gib,
    preparedAt: null,
    verifiedAt: null,
    metadata: { description: catalog.description, storage: imageMeasuredStorage(image), image_properties: image.properties ?? {} },
    image,
    virtual: true,
  };
}

async function resolveMachineTemplate(config: AppConfig, accountId: string, ref: string, opts: { hydrateImage?: boolean; ensureCatalog?: boolean } = {}): Promise<ResolvedMachineTemplate | null> {
  const hydrateImage = opts.hydrateImage !== false;
  if (config.databaseConfigured) {
    if (opts.ensureCatalog !== false) await ensureCatalogMachineTemplates(config);
    const rows = await getPrisma().machineTemplate.findMany({
      where: {
        status: { not: 'deleted' },
        OR: [
          { id: ref },
          { slug: ref },
          { incusAlias: ref },
        ],
      },
      orderBy: [{ accountId: 'desc' }, { updatedAt: 'desc' }],
    }).catch(() => []);
    const row = rows.find((item) => item.accountId === accountId || item.visibility === 'catalog' || item.accountId === 'system') ?? null;
    if (row) {
      const image = hydrateImage ? await findImageForTemplate(config, row).catch(() => null) : null;
      return { ...row, region: row.region as SupportedRegion, type: 'container', defaultResources: resourceShape(row.defaultResources), image };
    }
  }
  return virtualCatalogMachineTemplate(config, ref);
}

type TemplatePoolPolicies = {
  stopped: PrismaWarmPoolPolicy | null;
  running: PrismaWarmPoolPolicy | null;
  all: PrismaWarmPoolPolicy[];
};

async function poolPoliciesForTemplate(config: AppConfig, template: ResolvedMachineTemplate, accountId: string): Promise<TemplatePoolPolicies> {
  if (!config.databaseConfigured) return { stopped: null, running: null, all: [] };
  const rows = await getPrisma().warmPoolPolicy.findMany({
    where: {
      accountId,
      status: { not: 'deleted' },
      region: template.region,
      type: template.type,
      sourceType: 'image',
      sourceId: template.incusAlias,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const all = rows.filter((policy) => resourcesEqual(machineResourceKey(policy.resources), template.defaultResources));
  return {
    stopped: all.find((policy) => normalizeWarmPoolMode(policy.billingMode) === WARM_POOL_STOPPED_MODE) ?? null,
    running: all.find((policy) => normalizeWarmPoolMode(policy.billingMode) === WARM_POOL_RUNNING_MODE) ?? null,
    all,
  };
}

async function poolPolicyForTemplate(config: AppConfig, template: ResolvedMachineTemplate, accountId: string, mode: WarmPoolMode = WARM_POOL_STOPPED_MODE) {
  const policies = await poolPoliciesForTemplate(config, template, accountId);
  return mode === WARM_POOL_RUNNING_MODE ? policies.running : policies.stopped;
}

async function serializeMachineTemplate(config: AppConfig, template: ResolvedMachineTemplate, accountId: string, poolRows: PrismaMachine[] = []) {
  const image = template.image ?? await findImageForTemplate(config, template).catch(() => null);
  const properties = image?.properties ?? jsonRecord(jsonRecord(template.metadata).image_properties);
  const storage = template.measuredBytes || template.billableGib
    ? {
      metered_bytes: template.measuredBytes === null ? null : Number(template.measuredBytes),
      billable_gib: decimalNumber(template.billableGib),
      source: 'machine-template',
      estimated: true,
    }
    : imageMeasuredStorage(image);
  const policies = await poolPoliciesForTemplate(config, template, accountId).catch(() => ({ stopped: null, running: null, all: [] as PrismaWarmPoolPolicy[] }));
  const stoppedPool = policies.stopped ? serializeWarmPoolPolicy(policies.stopped, poolRows) : null;
  const runningPool = policies.running ? serializeWarmPoolPolicy(policies.running, poolRows) : null;
  return {
    id: template.id,
    account_id: template.accountId,
    name: template.name,
    slug: template.slug,
    status: template.status,
    visibility: template.visibility,
    region: template.region,
    type: template.type,
    default_resources: template.defaultResources,
    source: { type: template.sourceKind, ref: template.sourceRef },
    image: {
      alias: template.incusAlias,
      fingerprint: image?.fingerprint ?? template.incusFingerprint,
      cluster_id: template.incusClusterId,
      project: template.incusProject,
      size: image?.size ?? null,
      aliases: image?.aliases ?? [],
      properties,
    },
    readiness: {
      ready: template.status === 'active' && imageIsJustavpsReady({ properties } as IncusImage),
      daemon_baked: properties['justavps.daemon_baked'] === 'true',
      daemon_runtime_injected: properties['justavps.daemon_runtime_injected'] === 'true',
      daemon_first_boot_verified: properties['justavps.daemon_first_boot_verified'] === 'true',
      daemon_second_boot_verified: properties['justavps.daemon_second_boot_verified'] === 'true',
      prepared_at: template.preparedAt?.toISOString?.() ?? null,
      verified_at: template.verifiedAt?.toISOString?.() ?? null,
    },
    storage,
    pool: stoppedPool ?? runningPool,
    pools: {
      stopped: stoppedPool,
      running: runningPool,
    },
    metadata: template.metadata,
    created_at: template.createdAt?.toISOString?.() ?? null,
    updated_at: template.updatedAt?.toISOString?.() ?? null,
  };
}

function serializeObservedMachine(config: AppConfig, cluster: IncusClusterConfig, instance: IncusInstance) {
  const id = instance.config?.['user.justavps.machine_id'];
  if (!isMachineUuid(id)) return null;
  const urls = machineProxyUrls(config, id);
  const displayName = instance.config?.['user.justavps.machine_name']
    ?? instance.config?.['user.justavps.display_name']
    ?? instance.name;
  return {
    id,
    slug: machineProxySlug(id),
    name: displayName,
    region: cluster.region,
    type: instance.type === 'virtual-machine' ? 'vm' : 'container',
    status: instance.status,
    location: instance.location ?? null,
    cluster: publicCluster(cluster),
    incus: {
      cluster_id: cluster.id,
      project: cluster.project,
      instance_name: instance.name,
      member_name: instance.location ?? null,
      observed: instance,
    },
    resources: resourcesFromIncus(instance),
    urls,
    metadata: {},
  };
}

async function loadProductMachine(config: AppConfig, id: string) {
  const machineId = requireMachineUuid(id);
  if (config.databaseConfigured) {
    const machine = await getPrisma().machine.findUnique({ where: { id: machineId } });
    if (machine && !isWarmPoolStatus(machine.status)) return machine;
  }
  for (const cluster of config.clusters) {
    const instances = await clientFor(cluster).listInstances();
    const instance = instances.find((item) => item.config?.['user.justavps.machine_id'] === machineId);
    if (instance) {
      return {
        id: machineId,
        accountId: 'system',
        name: instance.config?.['user.justavps.machine_name']
          ?? instance.config?.['user.justavps.display_name']
          ?? instance.name,
        region: cluster.region,
        type: instance.type === 'virtual-machine' ? 'vm' : 'container',
        status: instance.status,
        sourceType: 'unknown',
        sourceId: null,
        incusClusterId: cluster.id,
        incusProject: cluster.project,
        incusInstanceName: instance.name,
        incusMemberName: instance.location ?? null,
        resources: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }
  return null;
}

async function adoptLegacyObservedMachine(
  config: AppConfig,
  cluster: IncusClusterConfig,
  client: IncusClient,
  instance: IncusInstance,
) {
  const legacyId = instance.config?.['user.justavps.machine_id'];
  if (!legacyId || isMachineUuid(legacyId)) return null;

  const displayName = instance.config?.['user.justavps.machine_name']
    ?? instance.config?.['user.justavps.display_name']
    ?? legacyId;
  const accountId = instance.config?.['user.justavps.account_id'] ?? 'system';
  const targetId = generatedMachineId();
  const baseMeta = {
    legacy_adoption: {
      previous_machine_id: legacyId,
      previous_incus_instance_name: instance.name,
      adopted_at: new Date().toISOString(),
      reason: 'V2 sandbox UUID became the only public CRUD identity',
    },
  };

  const prisma = config.databaseConfigured ? getPrisma() : null;
  const existing = prisma
    ? await prisma.machine.findFirst({
      where: {
        OR: [
          { id: legacyId },
          { incusClusterId: cluster.id, incusProject: cluster.project, incusInstanceName: instance.name },
        ],
      },
    })
    : null;

  const adopted = prisma
    ? await prisma.$transaction(async (tx) => {
      if (existing) {
        const nextMeta = { ...jsonRecord(existing.metadata), ...baseMeta } as Prisma.InputJsonValue;
        if (isMachineUuid(existing.id)) {
          return tx.machine.update({
            where: { id: existing.id },
            data: { name: displayName, status: instance.status, metadata: nextMeta },
          });
        }
        await Promise.all([
          tx.snapshot.updateMany({ where: { machineId: existing.id }, data: { machineId: targetId } }),
          tx.backup.updateMany({ where: { machineId: existing.id }, data: { machineId: targetId } }),
          tx.image.updateMany({ where: { sourceMachineId: existing.id }, data: { sourceMachineId: targetId } }),
          tx.sandboxUsageSession.updateMany({ where: { machineId: existing.id }, data: { machineId: targetId } }),
          tx.revenueLedgerEntry.updateMany({ where: { machineId: existing.id }, data: { machineId: targetId } }),
        ]);
        return tx.machine.update({
          where: { id: existing.id },
          data: { id: targetId, name: displayName, status: instance.status, metadata: nextMeta },
        });
      }

      return tx.machine.create({
        data: {
          id: targetId,
          accountId,
          name: displayName,
          region: cluster.region,
          type: instance.type === 'virtual-machine' ? 'vm' : 'container',
          status: instance.status,
          sourceType: 'unknown',
          sourceId: null,
          incusClusterId: cluster.id,
          incusProject: cluster.project,
          incusInstanceName: instance.name,
          incusMemberName: instance.location ?? null,
          resources: resourcesFromIncus(instance),
          metadata: baseMeta as Prisma.InputJsonValue,
        },
      });
    })
    : null;

  const adoptedId = adopted?.id ?? targetId;
  await client.updateInstanceConfig(instance.name, {
    'user.justavps.machine_id': adoptedId,
    'user.justavps.machine_name': displayName,
    'user.justavps.display_name': displayName,
    'user.justavps.hostname': adoptedId,
    'user.justavps.legacy_machine_id': legacyId,
  }).catch((error) => {
    console.warn(`[v2-api] failed to write adopted UUID to Incus instance ${instance.name}:`, error instanceof Error ? error.message : String(error));
  });

  if (adopted) {
    const resolved = { machine: adopted, cluster, client };
    const proxySync = await syncResolvedMachineProxy(config, resolved, { ...instance, config: { ...(instance.config ?? {}), 'user.justavps.machine_id': adopted.id } }).catch((error) => ({
      synced: false as const,
      reason: error instanceof Error ? error.message : String(error),
    }));
    await getPrisma().machine.update({
      where: { id: adopted.id },
      data: { metadata: { ...jsonRecord(adopted.metadata), proxy_sync: proxySync } as Prisma.InputJsonValue },
    }).catch(() => undefined);
  }

  return { id: adoptedId, machine: adopted };
}

export async function machineClient(config: AppConfig, id: string) {
  const machine = await loadProductMachine(config, id);
  if (!machine) return null;
  const cluster = findCluster(config, machine.incusClusterId);
  if (!cluster) throw new Error(`Configured Incus cluster ${machine.incusClusterId} not found`);
  return { machine, cluster, client: clientFor(cluster) };
}

async function recordResolvedMachineBillingObservation(
  config: AppConfig,
  resolved: { machine: Pick<PrismaMachine, 'id' | 'accountId' | 'status' | 'resources' | 'incusInstanceName' | 'incusMemberName'>; cluster: IncusClusterConfig },
  observed: IncusInstance | null | undefined,
  source: string,
  observedAt = new Date(),
  statusOverride?: string,
) {
  if (!config.databaseConfigured) return null;
  const resources = persistedResources(resolved.machine.resources, observed);
  return recordBillingRuntimeObservation(getPrisma(), {
    machineId: resolved.machine.id,
    accountId: resolved.machine.accountId,
    status: statusOverride ?? observed?.status ?? resolved.machine.status,
    resources: {
      vcpu: Number(resources.vcpu ?? 0),
      ramGb: Number(resources.memory_gb ?? 0),
      storageGb: Number(resources.disk_gb ?? 0),
    },
    observedAt,
    source,
    metadata: {
      cluster_id: resolved.cluster.id,
      project: resolved.cluster.project,
      incus_instance_name: resolved.machine.incusInstanceName,
      member_name: observed?.location ?? resolved.machine.incusMemberName ?? null,
    },
  }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
}

async function syncResolvedMachineProxy(config: AppConfig, resolved: NonNullable<Awaited<ReturnType<typeof machineClient>>>, observed?: IncusInstance | null) {
  const slug = machineProxySlug(resolved.machine.id);
  const memberName = observed?.location ?? resolved.machine.incusMemberName;
  void memberName; void config;
  return { slug, urls: proxyUrls(config, slug), synced: true as const, mode: 'v2-api-direct' };
}

async function ensureResolvedManagedDaemon(config: AppConfig, resolved: NonNullable<Awaited<ReturnType<typeof machineClient>>>, options: { verifyPort?: number | null } = {}) {
  const daemon = await ensureManagedDaemon({
    config,
    client: resolved.client,
    instanceName: resolved.machine.incusInstanceName,
    machineId: resolved.machine.id,
    verifyPort: options.verifyPort ?? null,
  });

  if (!config.databaseConfigured) return { daemon, machine: resolved.machine };

  const current = await getPrisma().machine.findUnique({ where: { id: resolved.machine.id } }).catch(() => null);
  const metadata = {
    ...jsonRecord((current ?? resolved.machine).metadata),
    managed_daemon: daemon,
    managed_daemon_state: daemon.ok ? 'ready' : 'failed',
    managed_daemon_checked_at: daemon.ensured_at,
  };
  const updated = await getPrisma().machine.update({
    where: { id: resolved.machine.id },
    data: { metadata: metadata as Prisma.InputJsonValue },
  }).catch(() => resolved.machine);
  return { daemon, machine: updated };
}

async function queueResolvedManagedDaemonEnsure(config: AppConfig, resolved: NonNullable<Awaited<ReturnType<typeof machineClient>>>, options: { verifyPort?: number | null } = {}) {
  if (config.databaseConfigured) await markManagedDaemonQueued(resolved.machine.id).catch(() => undefined);
  void ensureResolvedManagedDaemon(config, resolved, options).catch((error) => {
    console.warn(`[v2-api] async managed daemon ensure failed for ${resolved.machine.id}:`, error instanceof Error ? error.message : String(error));
  });
}

type ResolvedMachine = NonNullable<Awaited<ReturnType<typeof machineClient>>>;

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 3600_000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86400_000);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

type AccountRole = typeof ACCOUNT_ROLES[number];
type AccountType = typeof ACCOUNT_TYPES[number];
type AccountWithMembership = { account: PrismaAccount; membership: PrismaAccountMembership };

function slugifyAccount(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'account';
}

async function createUniqueAccountSlug(base: string, excludeAccountId?: string | null) {
  const normalized = slugifyAccount(base);
  const prisma = getPrisma();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = attempt === 0 ? normalized : `${normalized}-${randomBytes(3).toString('hex')}`;
    const existing = await prisma.account.findUnique({ where: { slug: candidate }, select: { id: true } }).catch(() => null);
    if (!existing || existing.id === excludeAccountId) return candidate;
  }
  return `${normalized}-${randomBytes(6).toString('hex')}`;
}

function safeAccountRole(value: string | undefined | null): AccountRole {
  return ACCOUNT_ROLES.includes(value as AccountRole) ? value as AccountRole : 'member';
}

function safeAccountType(value: string | undefined | null): AccountType {
  return ACCOUNT_TYPES.includes(value as AccountType) ? value as AccountType : 'personal';
}

function canManageMembers(role?: string | null) {
  return role === 'owner' || role === 'admin';
}

function canManageBilling(role?: string | null) {
  return role === 'owner' || role === 'admin';
}

function isAccountOwner(role?: string | null) {
  return role === 'owner';
}

function isAccountAdmin(role?: string | null) {
  return role === 'owner' || role === 'admin';
}

async function ensureMembership(accountId: string, userId: string, role: AccountRole, createdByUserId?: string | null) {
  const prisma = getPrisma();
  const existing = await prisma.accountMembership.findUnique({
    where: { accountId_userId: { accountId, userId } },
  });

  if (existing) {
    if (existing.role !== role) {
      return prisma.accountMembership.update({
        where: { id: existing.id },
        data: { role },
      });
    }
    return existing;
  }

  return prisma.accountMembership.create({
    data: { accountId, userId, role, createdByUserId: createdByUserId ?? null },
  });
}

async function ensureSystemAccount() {
  const prisma = getPrisma();
  return prisma.account.upsert({
    where: { id: 'system' },
    create: { id: 'system', type: 'organization', name: 'System', slug: 'system' },
    update: {},
  });
}

async function ensureSystemUser() {
  const prisma = getPrisma();
  const email = 'admin@justavps.local';
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'JustAVPS Admin', isAdmin: true, defaultAccountId: 'system' },
    update: { isAdmin: true },
  });
  await ensureSystemAccount();
  await ensureMembership('system', user.id, 'owner', user.id);
  return user;
}

async function ensureUserByEmail(input: { email: string; name?: string | null; isAdmin?: boolean }) {
  const prisma = getPrisma();
  const email = normalizeEmail(input.email);
  return prisma.user.upsert({
    where: { email },
    create: { email, name: input.name?.trim() || null, isAdmin: input.isAdmin ?? false },
    update: { ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...(input.isAdmin === true ? { isAdmin: true } : {}) },
  });
}

async function ensurePersonalAccountForUser(user: Pick<PrismaUser, 'id' | 'email' | 'name' | 'stripeCustomerId' | 'defaultAccountId'>) {
  const prisma = getPrisma();
  const existing = await prisma.account.findUnique({ where: { personalForUserId: user.id } });
  if (existing) {
    await ensureMembership(existing.id, user.id, 'owner');
    if (!user.defaultAccountId) {
      await prisma.user.update({ where: { id: user.id }, data: { defaultAccountId: existing.id } });
    }
    if (!existing.stripeCustomerId && user.stripeCustomerId) {
      return prisma.account.update({ where: { id: existing.id }, data: { stripeCustomerId: user.stripeCustomerId } });
    }
    return existing;
  }

  const slugBase = user.email.split('@')[0] || user.name || 'personal';
  const account = await prisma.account.create({
    data: {
      type: 'personal',
      name: user.name?.trim() || user.email,
      slug: await createUniqueAccountSlug(slugBase),
      personalForUserId: user.id,
      billingEmail: user.email,
      stripeCustomerId: user.stripeCustomerId ?? null,
    },
  });
  await ensureMembership(account.id, user.id, 'owner');
  await prisma.user.update({ where: { id: user.id }, data: { defaultAccountId: account.id } });
  return account;
}

async function ensureUserAccountGraph(user: Pick<PrismaUser, 'id' | 'email' | 'name' | 'stripeCustomerId' | 'defaultAccountId'>) {
  return ensurePersonalAccountForUser(user);
}

async function getUserMemberships(userId: string): Promise<AccountWithMembership[]> {
  const rows = await getPrisma().accountMembership.findMany({
    where: { userId, account: { deletedAt: null } },
    include: { account: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((membership) => ({ account: membership.account, membership }));
}

async function resolveAccountForUser(user: PrismaUser, requestedAccountId?: string | null) {
  await ensureUserAccountGraph(user);
  const memberships = await getUserMemberships(user.id);
  if (memberships.length === 0) throw new Error('User has no account memberships');

  const pick = (accountId?: string | null) => accountId ? memberships.find((row) => row.account.id === accountId) : undefined;
  let resolved = pick(requestedAccountId) || pick(user.defaultAccountId);
  if (!resolved) resolved = memberships.find((row) => row.account.type === 'personal') || memberships[0];
  if (!user.defaultAccountId || user.defaultAccountId !== resolved.account.id) {
    await getPrisma().user.update({ where: { id: user.id }, data: { defaultAccountId: resolved.account.id } });
  }
  return { active: resolved, memberships };
}

async function userHasAccountAccess(userId: string, accountId: string) {
  return getPrisma().accountMembership.findUnique({ where: { accountId_userId: { accountId, userId } } });
}

async function createOrganizationAccount(params: { ownerUserId: string; ownerEmail: string; name: string }) {
  const account = await getPrisma().account.create({
    data: {
      type: 'organization',
      name: params.name.trim(),
      slug: await createUniqueAccountSlug(params.name),
      billingEmail: params.ownerEmail,
    },
  });
  await ensureMembership(account.id, params.ownerUserId, 'owner', params.ownerUserId);
  return account;
}

async function renameOrganizationAccount(params: { accountId: string; name: string }) {
  const account = await getPrisma().account.findFirst({ where: { id: params.accountId, type: 'organization', deletedAt: null } });
  if (!account) return null;
  return getPrisma().account.update({
    where: { id: account.id },
    data: { name: params.name.trim(), slug: await createUniqueAccountSlug(params.name, account.id) },
  });
}

async function deleteOrganizationAccount(accountId: string) {
  const prisma = getPrisma();
  const [machine, image, template, snapshot, backup, warmPool] = await Promise.all([
    prisma.machine.findFirst({ where: { accountId, status: { not: 'deleted' } }, select: { id: true } }),
    prisma.image.findFirst({ where: { accountId }, select: { id: true } }),
    prisma.machineTemplate.findFirst({ where: { accountId, status: { notIn: ['deleted', 'archived'] } }, select: { id: true } }).catch(() => null),
    prisma.snapshot.findFirst({ where: { accountId }, select: { id: true } }).catch(() => null),
    prisma.backup.findFirst({ where: { accountId }, select: { id: true } }).catch(() => null),
    prisma.warmPoolPolicy.findFirst({ where: { accountId, status: { not: 'deleted' } }, select: { id: true } }).catch(() => null),
  ]);

  if (machine) throw new Error('Delete all machines before deleting this organization');
  if (template) throw new Error('Delete all machine templates before deleting this organization');
  if (warmPool) throw new Error('Delete all template/warm pools before deleting this organization');
  if (image) throw new Error('Delete all images before deleting this organization');
  if (snapshot) throw new Error('Delete all snapshots before deleting this organization');
  if (backup) throw new Error('Delete all backups before deleting this organization');

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.accountInvitation.updateMany({
      where: { accountId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.accountMembership.deleteMany({ where: { accountId } });
    await tx.machineBackupPolicy.deleteMany({ where: { accountId } });
    await tx.account.update({ where: { id: accountId }, data: { deletedAt: now } });
  });
}

async function createAccountInvitation(params: { accountId: string; email: string; role: AccountRole; invitedByUserId: string }) {
  const email = normalizeEmail(params.email);
  const prisma = getPrisma();
  await prisma.accountInvitation.updateMany({
    where: { accountId: params.accountId, email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const rawToken = randomBytes(32).toString('hex');
  const invitation = await prisma.accountInvitation.create({
    data: {
      accountId: params.accountId,
      email,
      role: params.role,
      tokenSha256: sha256Hex(rawToken),
      invitedByUserId: params.invitedByUserId,
      expiresAt: addDays(new Date(), 7),
    },
  });
  return { invitation, rawToken, reused: false };
}

async function getInvitationByToken(token: string) {
  return getPrisma().accountInvitation.findUnique({ where: { tokenSha256: sha256Hex(token) } });
}

async function redeemAccountInvitation(params: { token: string; userId: string; userEmail: string }) {
  const invitation = await getInvitationByToken(params.token);
  if (!invitation) throw new Error('Invitation not found');
  if (invitation.revokedAt) throw new Error('Invitation has been revoked');
  if (invitation.acceptedAt) throw new Error('Invitation has already been accepted');
  if (invitation.expiresAt < new Date()) throw new Error('Invitation has expired');
  if (invitation.email !== normalizeEmail(params.userEmail)) throw new Error('Signed-in email does not match invitation email');

  const membership = await ensureMembership(invitation.accountId, params.userId, safeAccountRole(invitation.role), invitation.invitedByUserId);
  await getPrisma().accountInvitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date(), acceptedByUserId: params.userId },
  });
  return { invitation, membership };
}

async function acceptInvitationById(params: { invitationId: string; userId: string; userEmail: string }) {
  const invitation = await getPrisma().accountInvitation.findUnique({ where: { id: params.invitationId } });
  if (!invitation) throw new Error('Invitation not found');
  if (invitation.revokedAt) throw new Error('Invitation has been revoked');
  if (invitation.acceptedAt) throw new Error('Invitation has already been accepted');
  if (invitation.expiresAt < new Date()) throw new Error('Invitation has expired');
  if (invitation.email !== normalizeEmail(params.userEmail)) throw new Error('Signed-in email does not match invitation email');

  const membership = await ensureMembership(invitation.accountId, params.userId, safeAccountRole(invitation.role), invitation.invitedByUserId);
  await getPrisma().accountInvitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date(), acceptedByUserId: params.userId },
  });
  return { invitation, membership };
}

async function listActiveInvitationsForAccount(accountId: string) {
  return getPrisma().accountInvitation.findMany({
    where: { accountId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

async function listPendingInvitationsForEmail(email: string) {
  const now = new Date();
  const rows = await getPrisma().accountInvitation.findMany({
    where: { email: normalizeEmail(email), acceptedAt: null, revokedAt: null, expiresAt: { gt: now }, account: { deletedAt: null } },
    include: { account: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((invitation) => ({ invitation, account: invitation.account }));
}

async function revokeInvitation(accountId: string, invitationId: string) {
  const existing = await getPrisma().accountInvitation.findFirst({ where: { id: invitationId, accountId } });
  if (!existing) return null;
  return getPrisma().accountInvitation.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
}

async function listMembersForAccount(accountId: string) {
  return getPrisma().accountMembership.findMany({
    where: { accountId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function updateMembershipRole(accountId: string, membershipId: string, role: AccountRole) {
  const existing = await getPrisma().accountMembership.findFirst({ where: { id: membershipId, accountId } });
  if (!existing) return null;
  if (existing.role === 'owner' && role !== 'owner') {
    const owners = await getPrisma().accountMembership.count({ where: { accountId, role: 'owner' } });
    if (owners <= 1) throw new Error('An account must keep at least one owner');
  }
  return getPrisma().accountMembership.update({ where: { id: existing.id }, data: { role } });
}

async function removeMembership(accountId: string, membershipId: string) {
  const existing = await getPrisma().accountMembership.findFirst({ where: { id: membershipId, accountId } });
  if (!existing) return null;
  if (existing.role === 'owner') {
    const owners = await getPrisma().accountMembership.count({ where: { accountId, role: 'owner' } });
    if (owners <= 1) throw new Error('An account must keep at least one owner');
  }
  await getPrisma().accountMembership.delete({ where: { id: existing.id } });
  return existing;
}

async function getPrimaryOwnerUserForAccount(accountId: string) {
  const row = await getPrisma().accountMembership.findFirst({
    where: { accountId, role: 'owner' },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  return row?.user ?? null;
}

async function resolveActorUserIdForAccount(accountId: string) {
  const owner = await getPrimaryOwnerUserForAccount(accountId);
  if (owner) return owner.id;
  const system = await ensureSystemUser();
  return system.id;
}

async function countActiveMachines(accountId: string) {
  return getPrisma().machine.count({ where: { accountId, status: { notIn: ['deleted', WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } });
}

async function countActiveImages(accountId: string) {
  const prisma = getPrisma();
  const [images, templates] = await Promise.all([
    prisma.image.count({ where: { accountId } }).catch(() => 0),
    prisma.machineTemplate.count({ where: { accountId, status: { notIn: ['deleted', 'archived'] } } }).catch(() => 0),
  ]);
  return images + templates;
}

async function getAccountLimits(accountId: string, userId?: string | null, isAdmin = false) {
  if (isAdmin) return { maxMachines: Number.MAX_SAFE_INTEGER, maxImages: Number.MAX_SAFE_INTEGER };
  const or: Prisma.AccountLimitWhereInput[] = [{ accountId }];
  if (userId) or.push({ userId });
  const row = await getPrisma().accountLimit.findFirst({ where: { OR: or } });
  return { maxMachines: row?.maxMachines ?? 5, maxImages: row?.maxImages ?? 10 };
}

async function currentUserFromRequest(c: { req: { header: (name: string) => string | undefined } }) {
  const prisma = getPrisma();
  const userId = c.req.header('x-user-id')?.trim();
  const email = c.req.header('x-user-email')?.trim();
  const name = c.req.header('x-user-name')?.trim();
  if (userId) return prisma.user.findUnique({ where: { id: userId } });
  if (email) return ensureUserByEmail({ email, name });
  return null;
}

async function resolveRequestAccountContext(c: { req: { header: (name: string) => string | undefined } }) {
  const user = await currentUserFromRequest(c);
  if (!user) throw new BadRequestError('Pass x-user-id or x-user-email to resolve V1-style account context');
  const requestedAccountId = c.req.header('x-account-id')?.trim() || null;
  const resolved = await resolveAccountForUser(user, requestedAccountId);
  return { user, ...resolved };
}

function serializeMembershipSummary(row: AccountWithMembership) {
  return {
    id: row.membership.id,
    role: safeAccountRole(row.membership.role),
    account: {
      id: row.account.id,
      name: row.account.name,
      slug: row.account.slug,
      type: safeAccountType(row.account.type),
      created_at: row.account.createdAt.toISOString(),
    },
  };
}

async function activeAccountProfile(input: { user: PrismaUser; active: AccountWithMembership }) {
  const account = input.active.account;
  const role = safeAccountRole(input.active.membership.role);
  const machineCount = await countActiveMachines(account.id);
  return {
    id: account.id,
    slug: account.slug,
    type: safeAccountType(account.type),
    name: account.name,
    role,
    email: input.user.email,
    user_id: input.user.id,
    user_name: input.user.name,
    has_password: Boolean(input.user.passwordHash),
    is_admin: input.user.isAdmin,
    can_manage_billing: canManageBilling(role),
    can_manage_members: canManageMembers(role),
    machines_count: machineCount,
    stripe_customer_id: account.stripeCustomerId ?? null,
    created_at: account.createdAt.toISOString(),
  };
}

function serializeBackupPolicy(policy: PrismaMachineBackupPolicy | null | undefined, machine: PrismaMachine) {
  return {
    id: policy?.id ?? null,
    account_id: policy?.accountId ?? machine.accountId,
    machine_id: machine.id,
    enabled: policy?.enabled ?? false,
    cadence: AUTO_BACKUP_POLICY.cadence,
    interval_hours: AUTO_BACKUP_POLICY.intervalHours,
    retention_days: AUTO_BACKUP_POLICY.retentionDays,
    retention_count: AUTO_BACKUP_POLICY.retentionCount,
    last_backup_at: policy?.lastBackupAt?.toISOString() ?? null,
    next_backup_at: policy?.nextBackupAt?.toISOString() ?? null,
    status: policy?.status ?? 'active',
    policy_label: 'Daily automatic backup, retain 7 days / 7 recovery points',
  };
}

async function loadBackupPolicy(machine: PrismaMachine) {
  if (!loadConfigSafeDatabaseConfigured()) return null;
  return getPrisma().machineBackupPolicy.findUnique({ where: { machineId: machine.id } }).catch(() => null);
}

async function upsertBackupPolicy(machine: PrismaMachine, enabled: boolean) {
  const now = new Date();
  await ensureSystemAccount().catch(() => undefined);
  const existing = await getPrisma().machineBackupPolicy.findUnique({ where: { machineId: machine.id } }).catch(() => null);
  const nextBackupAt = enabled
    ? existing?.nextBackupAt ?? (existing?.lastBackupAt ? addHours(existing.lastBackupAt, AUTO_BACKUP_POLICY.intervalHours) : now)
    : null;
  return getPrisma().machineBackupPolicy.upsert({
    where: { machineId: machine.id },
    create: {
      accountId: machine.accountId,
      machineId: machine.id,
      enabled,
      cadence: AUTO_BACKUP_POLICY.cadence,
      intervalHours: AUTO_BACKUP_POLICY.intervalHours,
      retentionDays: AUTO_BACKUP_POLICY.retentionDays,
      retentionCount: AUTO_BACKUP_POLICY.retentionCount,
      nextBackupAt,
      metadata: { policy: 'daily-7d' } as Prisma.InputJsonValue,
    },
    update: {
      accountId: machine.accountId,
      enabled,
      cadence: AUTO_BACKUP_POLICY.cadence,
      intervalHours: AUTO_BACKUP_POLICY.intervalHours,
      retentionDays: AUTO_BACKUP_POLICY.retentionDays,
      retentionCount: AUTO_BACKUP_POLICY.retentionCount,
      nextBackupAt,
      status: 'active',
    },
  });
}

function autoBackupName(machineId: string, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1z').toLowerCase();
  return `auto-${machineId.replaceAll('-', '').slice(0, 10)}-${stamp}`.slice(0, 80);
}

async function createBackupArtifact(config: AppConfig, resolved: ResolvedMachine, input: {
  name?: string;
  instanceOnly?: boolean;
  optimizedStorage?: boolean;
  expiresAt?: string | null;
  trigger: 'manual' | 'auto';
  policyId?: string | null;
}) {
  const name = input.name ?? (input.trigger === 'auto' ? autoBackupName(resolved.machine.id) : generatedResourceName('backup'));
  const instanceOnly = input.instanceOnly ?? false;
  const optimizedStorage = input.optimizedStorage ?? true;
  const operation = await resolved.client.createBackup(resolved.machine.incusInstanceName, name, {
    instanceOnly,
    optimizedStorage,
    expiresAt: input.expiresAt,
  });
  const restoreSnapshotName = `bk-snap-${name}`;
  await resolved.client.createSnapshot(resolved.machine.incusInstanceName, restoreSnapshotName, { stateful: false, expiresAt: input.expiresAt }).catch(() => undefined);
  let backup = null;
  if (config.databaseConfigured) {
    const expiresAtDate = input.expiresAt ? new Date(input.expiresAt) : null;
    backup = await getPrisma().backup.create({
      data: {
        accountId: resolved.machine.accountId,
        machineId: resolved.machine.id,
        status: 'ready',
        incusBackupName: name,
        retentionPolicy: {
          trigger: input.trigger,
          policy_id: input.policyId ?? null,
          retention_days: input.trigger === 'auto' ? AUTO_BACKUP_POLICY.retentionDays : null,
          retention_count: input.trigger === 'auto' ? AUTO_BACKUP_POLICY.retentionCount : null,
          expires_at: expiresAtDate?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
        metadata: {
          incus_operation: operation,
          restore_snapshot: restoreSnapshotName,
          instance_only: instanceOnly,
          optimized_storage: optimizedStorage,
          trigger: input.trigger,
          auto_backup_policy_id: input.policyId ?? null,
          expires_at: expiresAtDate?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  }
  const publicBackup = backup
    ? {
      ...backup,
      name,
      incus_backup_name: name,
      restore_snapshot: restoreSnapshotName,
      trigger: input.trigger,
      expires_at: input.expiresAt ?? null,
    }
    : { id: name, name, incus_backup_name: name, restore_snapshot: restoreSnapshotName, trigger: input.trigger, expires_at: input.expiresAt ?? null };
  return { backup: publicBackup, operation, restoreSnapshotName };
}

async function deleteBackupArtifacts(resolved: ResolvedMachine, backupName: string) {
  const operation = await resolved.client.deleteBackup(resolved.machine.incusInstanceName, backupName);
  await resolved.client.deleteSnapshot(resolved.machine.incusInstanceName, `bk-snap-${backupName}`).catch(() => undefined);
  if (loadConfigSafeDatabaseConfigured()) await getPrisma().backup.deleteMany({ where: { machineId: resolved.machine.id, incusBackupName: backupName } });
  return operation;
}

async function restoreSnapshotAndResume(resolved: ResolvedMachine, snapshotName: string, input: { stateful?: boolean } = {}) {
  const instanceName = resolved.machine.incusInstanceName;
  const before = await resolved.client.getInstance(instanceName).catch(() => null);
  const wasRunning = before?.status?.toLowerCase() === 'running';
  const restoreOp = await resolved.client.restoreSnapshot(instanceName, snapshotName, input);
  let after = await resolved.client.getInstance(instanceName).catch(() => null);
  let startOperation: IncusOperation | Record<string, unknown> | null = null;
  let startNoop = false;
  if (wasRunning && after?.status?.toLowerCase() !== 'running') {
    const started = await startCreatedMachine(resolved.client, instanceName);
    startOperation = started.operation;
    startNoop = started.noop;
    after = await resolved.client.getInstance(instanceName).catch(() => after);
  }
  return { restoreOp, startOperation, startNoop, wasRunning, beforeStatus: before?.status ?? null, after };
}

function backupRowExpiresAt(row: { retentionPolicy?: unknown; metadata?: unknown } | null | undefined) {
  const retention = jsonRecord(row?.retentionPolicy);
  const metadata = jsonRecord(row?.metadata);
  const value = typeof retention.expires_at === 'string' ? retention.expires_at : typeof metadata.expires_at === 'string' ? metadata.expires_at : null;
  return value;
}

function backupRowTrigger(row: { retentionPolicy?: unknown; metadata?: unknown } | null | undefined) {
  const retention = jsonRecord(row?.retentionPolicy);
  const metadata = jsonRecord(row?.metadata);
  return typeof retention.trigger === 'string' ? retention.trigger : typeof metadata.trigger === 'string' ? metadata.trigger : 'manual';
}

function publicBackupName(value: unknown) {
  const r = jsonRecord(value);
  const name = r.incusBackupName ?? r.incus_backup_name ?? r.name;
  return typeof name === 'string' && name ? name : 'backup';
}

async function pruneAutoBackupsForMachine(resolved: ResolvedMachine, policy: PrismaMachineBackupPolicy) {
  if (!loadConfigSafeDatabaseConfigured()) return { pruned: [] as string[], errors: [] as Array<{ name: string; error: string }> };
  const prisma = getPrisma();
  const now = new Date();
  const rows = await prisma.backup.findMany({
    where: { machineId: resolved.machine.id },
    orderBy: { createdAt: 'desc' },
  });
  const autoRows = rows.filter((row) => backupRowTrigger(row) === 'auto');
  const keepIds = new Set(autoRows.slice(0, policy.retentionCount).map((row) => row.id));
  const expired = autoRows.filter((row) => {
    const expiresAt = backupRowExpiresAt(row);
    return expiresAt ? Date.parse(expiresAt) <= now.getTime() : false;
  });
  const overCount = autoRows.filter((row) => !keepIds.has(row.id));
  const toDelete = new Map<string, typeof autoRows[number]>();
  for (const row of [...expired, ...overCount]) {
    if (row.incusBackupName) toDelete.set(row.incusBackupName, row);
  }
  const pruned: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  for (const [name] of toDelete) {
    try {
      await deleteBackupArtifacts(resolved, name);
      pruned.push(name);
    } catch (error) {
      errors.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { pruned, errors };
}

export async function runDueAutoBackups(config: AppConfig) {
  const result = { scanned: 0, created: [] as Array<{ machine_id: string; backup_name: string }>, pruned: [] as Array<{ machine_id: string; backup_names: string[] }>, errors: [] as Array<{ machine_id?: string; error: string }> };
  if (!config.databaseConfigured) return result;
  const prisma = getPrisma();
  const now = new Date();
  const policies = await prisma.machineBackupPolicy.findMany({
    where: { enabled: true, status: 'active', OR: [{ nextBackupAt: null }, { nextBackupAt: { lte: now } }] },
    orderBy: { nextBackupAt: 'asc' },
  });
  result.scanned = policies.length;
  for (const policy of policies) {
    try {
      const machine = await prisma.machine.findUnique({ where: { id: policy.machineId } });
      if (!machine || machine.status === 'deleted') {
        await prisma.machineBackupPolicy.update({ where: { id: policy.id }, data: { enabled: false, status: 'machine_missing', metadata: { ...jsonRecord(policy.metadata), disabled_reason: 'machine_missing', disabled_at: nowIso() } as Prisma.InputJsonValue } }).catch(() => undefined);
        continue;
      }
      const resolved = await machineClient(config, machine.id);
      if (!resolved) throw new Error('Machine not found');
      const expiresAt = addDays(now, AUTO_BACKUP_POLICY.retentionDays).toISOString();
      const created = await createBackupArtifact(config, resolved, {
        name: autoBackupName(machine.id, now),
        instanceOnly: false,
        optimizedStorage: true,
        expiresAt,
        trigger: 'auto',
        policyId: policy.id,
      });
      const backupName = publicBackupName(created.backup);
      await prisma.machineBackupPolicy.update({
        where: { id: policy.id },
        data: {
          accountId: machine.accountId,
          lastBackupAt: now,
          nextBackupAt: addHours(now, AUTO_BACKUP_POLICY.intervalHours),
          metadata: { ...jsonRecord(policy.metadata), last_backup_name: backupName, last_backup_at: now.toISOString() } as Prisma.InputJsonValue,
        },
      });
      const pruned = await pruneAutoBackupsForMachine(resolved, policy);
      result.created.push({ machine_id: machine.id, backup_name: backupName });
      if (pruned.pruned.length) result.pruned.push({ machine_id: machine.id, backup_names: pruned.pruned });
      for (const error of pruned.errors) result.errors.push({ machine_id: machine.id, error: `${error.name}: ${error.error}` });
    } catch (error) {
      result.errors.push({ machine_id: policy.machineId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

function serializeMachine(config: AppConfig, machine: Awaited<ReturnType<typeof loadProductMachine>>, incus?: unknown) {
  if (!machine) return null;
  const observed = observedInstance(incus);
  const slug = machineProxySlug(machine.id);
  const urls = proxyUrls(config, slug);
  return {
    id: machine.id,
    slug,
    account_id: machine.accountId,
    name: isWarmPoolInventoryRow(machine) ? warmPoolInventoryDisplayName(machine.id) : machine.name,
    region: machine.region,
    type: machine.type,
    status: isWarmPoolInventoryRow(machine) ? (isWarmPoolStatus(machine.status) ? machine.status : WARM_POOL_STATUS) : observed?.status ?? machine.status,
    source: { type: machine.sourceType, id: machine.sourceId },
    incus: {
      cluster_id: machine.incusClusterId,
      project: machine.incusProject,
      instance_name: machine.incusInstanceName,
      member_name: observed?.location ?? machine.incusMemberName,
      observed: observed ?? incus ?? null,
    },
    resources: mergeResources(machine.resources, observed ?? incus),
    urls,
    metadata: machine.metadata,
    created_at: machine.createdAt.toISOString(),
    updated_at: machine.updatedAt.toISOString(),
  };
}

export function createApp(config: AppConfig) {
  // OpenAPIHono extends Hono — all `app.get/post/...` calls keep working, and
  // routes registered via `app.openapi(createRoute(...))` automatically show
  // up in the generated /docs spec.
  const app = new OpenAPIHono();

  app.use('*', async (c, next) => {
    if (c.req.path.length > 1 && c.req.path.endsWith('/') && !c.req.path.startsWith('/admin-ui/')) {
      const url = new URL(c.req.url);
      url.pathname = url.pathname.replace(/\/+$/, '');
      return app.fetch(new Request(url, c.req.raw));
    }

    const origin = c.req.header('origin');
    const allowedOrigin = origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) ? origin : null;
    if (allowedOrigin) {
      c.header('Access-Control-Allow-Origin', allowedOrigin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', c.req.header('access-control-request-headers') || 'Authorization, Content-Type, X-JustAVPS-Request-Id');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Expose-Headers', 'X-JustAVPS-Request-Id');
      c.header('Access-Control-Max-Age', '600');
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    return next();
  });

  app.use('*', async (c, next) => {
    const proxied = await handleApiProxyRequest(config, c.req.raw);
    if (proxied) return proxied;
    return next();
  });

  app.use('/admin/*', async (c, next) => {
    const error = adminGuard(config, c.req.header('authorization'));
    if (error) return c.json(error, 401);
    return next();
  });

  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.path.startsWith('/admin/') && !c.req.path.startsWith('/internal/telemetry/')) {
      const error = adminGuard(config, c.req.header('authorization'));
      if (error) return c.json(error, 401);
    }
    return next();
  });

  // ─── OpenAPI-spec'd routes (visible in /docs) ──────────────────────────
  // Each route registered here is auto-emitted into the OpenAPI document,
  // which the SDK pipeline consumes. Plain `app.get/post(...)` calls below
  // still work but are NOT in the spec — convert them as their schemas
  // mature.

  app.openapi(
    createRoute({
      method: 'get',
      path: '/health',
      tags: ['System'],
      summary: 'Liveness + configuration probe',
      description: 'Returns service identity plus which subsystems (database, Incus clusters, Hetzner Robot) have credentials wired up. Safe to poll without auth.',
      responses: {
        200: { description: 'Service is up', content: { 'application/json': { schema: HealthResponseSchema } } },
      },
    }),
    (c) => c.json({
      status: 'ok' as const,
      service: 'justavps-v2-api' as const,
      database_configured: config.databaseConfigured,
      incus_clusters_configured: config.clusters.length,
      hetzner_robot_configured: Boolean(config.hetznerRobot),
      telemetry: {
        enabled: config.telemetry.enabled,
        driver: config.telemetry.driver,
        ingest_reachable_from_sandbox: config.telemetry.ingestReachableFromSandbox,
        warnings: config.telemetry.warnings,
      },
    }),
  );

  app.post('/machines/:id/isolation/ensure', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const before = await resolved.client.getInstance(resolved.machine.incusInstanceName);
      const current = persistedResources(resolved.machine.resources, before);
      const desired = {
        vcpu: current.vcpu ?? 1,
        memory_gb: current.memory_gb ?? 1,
        disk_gb: current.disk_gb ?? 10,
      };
      const isolation = await applyResourceConfig(resolved.client, resolved.machine.incusInstanceName, resolved.cluster, desired, {
        machineId: resolved.machine.id,
        displayName: resolved.machine.name,
        machineType: machineKind(resolved.machine.type),
        accountId: resolved.machine.accountId,
      });
      const incus = await resolved.client.getInstance(resolved.machine.incusInstanceName);
      if (config.databaseConfigured) {
        const previousMetadata = jsonRecord(resolved.machine.metadata);
        await getPrisma().machine.update({
          where: { id: resolved.machine.id },
          data: {
            resources: persistedResources(desired, incus),
            metadata: {
              ...previousMetadata,
              ...(previousMetadata.proxy_sync ? { proxy_sync: cleanV2DirectProxySync(previousMetadata.proxy_sync) } : {}),
              isolation_check: isolation,
              isolation_repaired_at: isolation.checked_at,
            } as Prisma.InputJsonValue,
          },
        }).catch(() => undefined);
      }
      const refreshed = await loadProductMachine(config, resolved.machine.id) ?? resolved.machine;
      return c.json({ ok: isolation.ok, isolation, machine: serializeMachine(config, refreshed, incus) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/regions',
      tags: ['System'],
      summary: 'List available regions',
      description: 'Public scheduling regions. V2 intentionally exposes only EU and US; clusters/hosts fan out underneath each region.',
      responses: {
        200: { description: 'Regions list', content: { 'application/json': { schema: RegionsResponseSchema } } },
      },
    }),
    (c) => c.json({ regions: [...SUPPORTED_REGIONS] }),
  );

  app.get('/', (c) => c.redirect('/admin-ui/'));
  registerAdminUi(app);
  registerBillingV2Routes(app, config);
  startWarmPoolMaintainer(config);

  // One-shot sweep for debug + integration tests; the periodic sweeper is
  // kicked off from `index.ts` so the test harness can opt in.
  app.post('/admin/lifecycle/sweep', async (c) => {
    try {
      const result = await sweepOnce(config, clientFor);
      return c.json(result);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/backups/sweep', async (c) => {
    try {
      const result = await runDueAutoBackups(config);
      return c.json(result);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  const accountRouteGuard = async (c: any, next: () => Promise<void>) => {
    const error = adminGuard(config, c.req.header('authorization'));
    if (error) return c.json(error, 401);
    return next();
  };

  app.use('/account', accountRouteGuard);
  app.use('/account/*', accountRouteGuard);

  app.get('/account', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      return c.json(await activeAccountProfile(context));
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/account', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (!canManageMembers(context.active.membership.role)) return c.json({ error: true, message: 'Only account owners/admins can rename organizations', status: 403 }, 403);
      if (context.active.account.type !== 'organization') return c.json({ error: true, message: 'Only organization accounts can be renamed', status: 403 }, 403);
      const input = z.object({ name: z.string().trim().min(2).max(120) }).parse(await c.req.json());
      const account = await renameOrganizationAccount({ accountId: context.active.account.id, name: input.name });
      if (!account) return c.json({ error: true, message: 'Organization not found', status: 404 }, 404);
      return c.json(await activeAccountProfile({ user: context.user, active: { account, membership: context.active.membership } }));
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/account', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (context.active.account.type !== 'organization') return c.json({ error: true, message: 'Only organization accounts can be deleted', status: 400 }, 400);
      if (!isAccountOwner(context.active.membership.role)) return c.json({ error: true, message: 'Only organization owners can delete this organization', status: 403 }, 403);
      await deleteOrganizationAccount(context.active.account.id);
      const refreshedUser = await getPrisma().user.findUnique({ where: { id: context.user.id } });
      if (!refreshedUser) return c.json({ error: true, message: 'User not found', status: 404 }, 404);
      const resolved = await resolveAccountForUser(refreshedUser);
      return c.json({ ok: true, account_id: resolved.active.account.id });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/account/me', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      return c.json({
        user: {
          id: context.user.id,
          email: context.user.email,
          name: context.user.name,
          has_password: Boolean(context.user.passwordHash),
          is_admin: context.user.isAdmin,
          default_account_id: context.user.defaultAccountId ?? context.active.account.id,
        },
        active_account: {
          id: context.active.account.id,
          name: context.active.account.name,
          slug: context.active.account.slug,
          type: safeAccountType(context.active.account.type),
          role: safeAccountRole(context.active.membership.role),
        },
        memberships: context.memberships.map(serializeMembershipSummary),
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/account/memberships', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      return c.json({ memberships: context.memberships.map(serializeMembershipSummary) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/account/switch', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const user = await currentUserFromRequest(c);
      if (!user) return c.json({ error: true, message: 'Pass x-user-id or x-user-email to switch accounts', status: 400 }, 400);
      await ensureUserAccountGraph(user);
      const input = z.object({ account_id: z.string().min(1) }).parse(await c.req.json());
      const membership = await userHasAccountAccess(user.id, input.account_id);
      if (!membership) return c.json({ error: true, message: 'Account access denied', status: 403 }, 403);
      await getPrisma().user.update({ where: { id: user.id }, data: { defaultAccountId: input.account_id } });
      return c.json({ ok: true, account_id: input.account_id });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/account/organizations', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const user = await currentUserFromRequest(c);
      if (!user) return c.json({ error: true, message: 'Pass x-user-id or x-user-email to create an organization', status: 400 }, 400);
      await ensureUserAccountGraph(user);
      const input = z.object({ name: z.string().trim().min(2).max(120) }).parse(await c.req.json());
      const account = await createOrganizationAccount({ ownerUserId: user.id, ownerEmail: user.email, name: input.name });
      await getPrisma().user.update({ where: { id: user.id }, data: { defaultAccountId: account.id } });
      return c.json({ id: account.id, name: account.name, slug: account.slug }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/account/usage', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      const machines = await getPrisma().machine.findMany({ where: { accountId: context.active.account.id, status: { notIn: ['deleted', WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } }, orderBy: { createdAt: 'desc' } });
      return c.json({ current_period: { machines: machines.map((machine) => ({ id: machine.id, slug: machineProxySlug(machine.id), server_type: machine.type, status: machine.status })), total_machines: machines.length, billing_statement: `/admin/billing/v2/accounts/${encodeURIComponent(context.active.account.id)}/statement` } });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/account/limits', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      const [limits, machineCount, imageCount] = await Promise.all([
        getAccountLimits(context.active.account.id, context.user.id, context.user.isAdmin),
        countActiveMachines(context.active.account.id),
        countActiveImages(context.active.account.id),
      ]);
      return c.json({ limits: { max_machines: limits.maxMachines, max_images: limits.maxImages }, usage: { machines: machineCount, images: imageCount } });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/account/members', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      const members = await listMembersForAccount(context.active.account.id);
      return c.json({ members: members.map((member) => ({ id: member.id, role: safeAccountRole(member.role), user: { id: member.user.id, email: member.user.email, name: member.user.name, created_at: member.user.createdAt.toISOString() }, created_at: member.createdAt.toISOString() })) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/account/members/:membershipId', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (!canManageMembers(context.active.membership.role)) return c.json({ error: true, message: 'Only account owners/admins can manage members', status: 403 }, 403);
      if (context.active.account.type !== 'organization') return c.json({ error: true, message: 'Member roles can only be managed on organization accounts', status: 400 }, 400);
      const input = z.object({ role: z.enum(ACCOUNT_ROLES) }).parse(await c.req.json());
      const updated = await updateMembershipRole(context.active.account.id, c.req.param('membershipId'), input.role);
      if (!updated) return c.json({ error: true, message: 'Member not found', status: 404 }, 404);
      return c.json({ ok: true });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/account/members/me', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (context.active.account.type !== 'organization') return c.json({ error: true, message: 'You can only leave organization accounts', status: 400 }, 400);
      const membership = await userHasAccountAccess(context.user.id, context.active.account.id);
      if (!membership) return c.json({ error: true, message: 'Membership not found', status: 404 }, 404);
      await removeMembership(context.active.account.id, membership.id);
      const refreshedUser = await getPrisma().user.findUnique({ where: { id: context.user.id } });
      if (!refreshedUser) return c.json({ error: true, message: 'User not found', status: 404 }, 404);
      const resolved = await resolveAccountForUser(refreshedUser);
      return c.json({ ok: true, account_id: resolved.active.account.id });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/account/members/:membershipId', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (!canManageMembers(context.active.membership.role)) return c.json({ error: true, message: 'Only account owners/admins can manage members', status: 403 }, 403);
      if (context.active.account.type !== 'organization') return c.json({ error: true, message: 'Members can only be removed from organization accounts', status: 400 }, 400);
      const removed = await removeMembership(context.active.account.id, c.req.param('membershipId'));
      if (!removed) return c.json({ error: true, message: 'Member not found', status: 404 }, 404);
      return c.body(null, 204);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/account/invitations', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (!canManageMembers(context.active.membership.role)) return c.json({ error: true, message: 'Only account owners/admins can manage members', status: 403 }, 403);
      if (context.active.account.type !== 'organization') return c.json({ invitations: [] });
      const invitations = await listActiveInvitationsForAccount(context.active.account.id);
      return c.json({ invitations: invitations.map((invite) => ({ id: invite.id, email: invite.email, role: safeAccountRole(invite.role), expires_at: invite.expiresAt.toISOString(), created_at: invite.createdAt.toISOString() })) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/account/invitations', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (!canManageMembers(context.active.membership.role)) return c.json({ error: true, message: 'Only account owners/admins can manage members', status: 403 }, 403);
      if (context.active.account.type !== 'organization') return c.json({ error: true, message: 'Invitations are only available on organization accounts', status: 400 }, 400);
      const input = z.object({ email: z.string().email(), role: z.enum(ACCOUNT_ROLES).default('member') }).parse(await c.req.json());
      const normalizedEmail = normalizeEmail(input.email);
      const existingMember = await getPrisma().accountMembership.findFirst({ where: { accountId: context.active.account.id, user: { email: normalizedEmail } } });
      if (existingMember) return c.json({ error: true, message: 'That user is already a member of this account', status: 409 }, 409);
      const { invitation } = await createAccountInvitation({ accountId: context.active.account.id, email: normalizedEmail, role: input.role, invitedByUserId: context.user.id });
      return c.json({ id: invitation.id, email: invitation.email, role: safeAccountRole(invitation.role), expires_at: invitation.expiresAt.toISOString() }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/account/invitations/redeem', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const user = await currentUserFromRequest(c);
      if (!user) return c.json({ error: true, message: 'Pass x-user-id or x-user-email to redeem an invitation', status: 400 }, 400);
      await ensureUserAccountGraph(user);
      const input = z.object({ token: z.string().min(1) }).parse(await c.req.json());
      const { invitation } = await redeemAccountInvitation({ token: input.token, userId: user.id, userEmail: user.email });
      await getPrisma().user.update({ where: { id: user.id }, data: { defaultAccountId: invitation.accountId } });
      return c.json({ ok: true, account_id: invitation.accountId, redirect_to: '/machines?invite=accepted' });
    } catch (error) {
      return c.json({ error: true, message: error instanceof Error ? error.message : 'Failed to redeem invitation', status: 400 }, 400);
    }
  });

  app.delete('/account/invitations/:invitationId', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const context = await resolveRequestAccountContext(c);
      if (!canManageMembers(context.active.membership.role)) return c.json({ error: true, message: 'Only account owners/admins can manage members', status: 403 }, 403);
      if (context.active.account.type !== 'organization') return c.json({ error: true, message: 'Invitations are only available on organization accounts', status: 400 }, 400);
      const revoked = await revokeInvitation(context.active.account.id, c.req.param('invitationId'));
      if (!revoked) return c.json({ error: true, message: 'Invitation not found', status: 404 }, 404);
      return c.body(null, 204);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/account/me/invitations', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const user = await currentUserFromRequest(c);
      if (!user) return c.json({ error: true, message: 'Pass x-user-id or x-user-email to list invitations', status: 400 }, 400);
      const rows = await listPendingInvitationsForEmail(user.email);
      return c.json({ invitations: rows.map((row) => ({ id: row.invitation.id, role: safeAccountRole(row.invitation.role), account_name: row.account.name, account_type: safeAccountType(row.account.type), expires_at: row.invitation.expiresAt.toISOString(), created_at: row.invitation.createdAt.toISOString() })) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/account/me/invitations/:invitationId/accept', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const user = await currentUserFromRequest(c);
      if (!user) return c.json({ error: true, message: 'Pass x-user-id or x-user-email to accept an invitation', status: 400 }, 400);
      await ensureUserAccountGraph(user);
      const { invitation } = await acceptInvitationById({ invitationId: c.req.param('invitationId'), userId: user.id, userEmail: user.email });
      return c.json({ ok: true, account_id: invitation.accountId });
    } catch (error) {
      return c.json({ error: true, message: error instanceof Error ? error.message : 'Failed to accept invitation', status: 400 }, 400);
    }
  });

  app.post('/account/me/invitations/:invitationId/decline', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const user = await currentUserFromRequest(c);
      if (!user) return c.json({ error: true, message: 'Pass x-user-id or x-user-email to decline an invitation', status: 400 }, 400);
      const rows = await listPendingInvitationsForEmail(user.email);
      const match = rows.find((row) => row.invitation.id === c.req.param('invitationId'));
      if (!match) return c.json({ error: true, message: 'Invitation not found', status: 404 }, 404);
      await revokeInvitation(match.invitation.accountId, match.invitation.id);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: true, message: error instanceof Error ? error.message : 'Failed to decline invitation', status: 400 }, 400);
    }
  });

  app.get('/admin/users', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ users: [] });
      const users = await getPrisma().user.findMany({ orderBy: [{ createdAt: 'desc' }], take: 500 });
      return c.json({
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          email_verified: user.emailVerified?.toISOString() ?? null,
          default_account_id: user.defaultAccountId,
          is_admin: user.isAdmin,
          created_at: user.createdAt.toISOString(),
          updated_at: user.updatedAt.toISOString(),
        })),
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/users', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = createUserSchema.parse(await c.req.json());
      const user = await ensureUserByEmail({ email: input.email, name: input.name, isAdmin: input.is_admin });
      const personalAccount = await ensureUserAccountGraph(user);
      const refreshed = await getPrisma().user.findUnique({ where: { id: user.id } }) ?? user;
      return c.json({ user: {
        id: refreshed.id,
        email: refreshed.email,
        name: refreshed.name,
        is_admin: refreshed.isAdmin,
        default_account_id: refreshed.defaultAccountId ?? personalAccount.id,
        personal_account_id: personalAccount.id,
        created_at: refreshed.createdAt.toISOString(),
      } }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/accounts', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ accounts: [] });
      const prisma = getPrisma();
      await ensureSystemAccount().catch(() => undefined);
      const includeDeleted = c.req.query('include_deleted') === 'true';
      const accounts = await prisma.account.findMany({
        where: includeDeleted ? undefined : { deletedAt: null },
        include: {
          memberships: { include: { user: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
          invitations: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
      const accountIds = accounts.map((account) => account.id);
      const machines = accountIds.length ? await prisma.machine.findMany({ where: { accountId: { in: accountIds }, status: { notIn: ['deleted', WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } }) : [];
      const policies = accountIds.length ? await prisma.machineBackupPolicy.findMany({ where: { accountId: { in: accountIds } } }) : [];
      const machineByAccount = new Map<string, PrismaMachine[]>();
      for (const machine of machines) {
        const rows = machineByAccount.get(machine.accountId) ?? [];
        rows.push(machine);
        machineByAccount.set(machine.accountId, rows);
      }
      const policyByAccount = new Map<string, PrismaMachineBackupPolicy[]>();
      for (const policy of policies) {
        const rows = policyByAccount.get(policy.accountId) ?? [];
        rows.push(policy);
        policyByAccount.set(policy.accountId, rows);
      }
      return c.json({
        accounts: accounts.map((account) => {
          const accountMachines = machineByAccount.get(account.id) ?? [];
          const accountPolicies = policyByAccount.get(account.id) ?? [];
          return {
            id: account.id,
            type: account.type,
            name: account.name,
            slug: account.slug,
            personal_for_user_id: account.personalForUserId,
            billing_email: account.billingEmail,
            stripe_customer_id: account.stripeCustomerId,
            created_at: account.createdAt.toISOString(),
            updated_at: account.updatedAt.toISOString(),
            deleted_at: account.deletedAt?.toISOString() ?? null,
            members: account.memberships.map((member) => ({
              id: member.id,
              role: safeAccountRole(member.role),
              user_id: member.userId,
              email: member.user.email,
              name: member.user.name,
              is_admin: member.user.isAdmin,
              created_at: member.createdAt.toISOString(),
            })),
            invitations: account.invitations.map((invite) => ({
              id: invite.id,
              email: invite.email,
              role: safeAccountRole(invite.role),
              expires_at: invite.expiresAt.toISOString(),
              accepted_at: invite.acceptedAt?.toISOString() ?? null,
              revoked_at: invite.revokedAt?.toISOString() ?? null,
              created_at: invite.createdAt.toISOString(),
            })),
            counts: {
              members: account.memberships.length,
              machines: accountMachines.length,
              auto_backup_policies: accountPolicies.length,
              auto_backup_enabled: accountPolicies.filter((policy) => policy.enabled).length,
            },
          };
        }),
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/accounts', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = createAccountSchema.parse(await c.req.json());
      const prisma = getPrisma();
      const owner = input.owner_user_id
        ? await prisma.user.findUnique({ where: { id: input.owner_user_id } })
        : input.owner_email
          ? await ensureUserByEmail({ email: input.owner_email, name: input.owner_name })
          : null;
      if (input.owner_user_id && !owner) return c.json({ error: true, message: 'owner_user_id not found' }, 404);
      if (input.type === 'personal') {
        if (!owner) return c.json({ error: true, message: 'Personal accounts are auto-provisioned for a real owner; pass owner_user_id or owner_email' }, 400);
        const account = await ensureUserAccountGraph(owner);
        return c.json({ account: { id: account.id, type: account.type, name: account.name, slug: account.slug, billing_email: account.billingEmail, personal_for_user_id: account.personalForUserId } }, 201);
      }
      if (!owner) return c.json({ error: true, message: 'Organization accounts must have an owner; pass owner_user_id or owner_email' }, 400);
      await ensureUserAccountGraph(owner);
      let account = await createOrganizationAccount({ ownerUserId: owner.id, ownerEmail: owner.email, name: input.name });
      if (input.slug) {
        const slug = await createUniqueAccountSlug(input.slug, account.id);
        account = await prisma.account.update({ where: { id: account.id }, data: { slug } });
      }
      if (input.billing_email !== undefined) account = await prisma.account.update({ where: { id: account.id }, data: { billingEmail: input.billing_email } });
      await prisma.user.update({ where: { id: owner.id }, data: { defaultAccountId: account.id } });
      return c.json({ account: { id: account.id, type: account.type, name: account.name, slug: account.slug, billing_email: account.billingEmail } }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/accounts/:id', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const account = await getPrisma().account.findUnique({
        where: { id: c.req.param('id') },
        include: { memberships: { include: { user: true } }, invitations: { orderBy: { createdAt: 'desc' } } },
      });
      if (!account) return c.json({ error: true, message: 'Account not found' }, 404);
      return c.json({ account });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/admin/accounts/:id', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = patchAccountSchema.parse(await c.req.json());
      const existing = await getPrisma().account.findUnique({ where: { id: c.req.param('id') } });
      if (!existing) return c.json({ error: true, message: 'Account not found' }, 404);
      const account = await getPrisma().account.update({
        where: { id: c.req.param('id') },
        data: {
          ...(input.type && input.type !== existing.type ? { type: input.type } : {}),
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.slug ? { slug: await createUniqueAccountSlug(input.slug, existing.id) } : {}),
          ...(input.billing_email !== undefined ? { billingEmail: input.billing_email } : {}),
          ...(input.stripe_customer_id !== undefined ? { stripeCustomerId: input.stripe_customer_id } : {}),
          ...(input.deleted !== undefined ? { deletedAt: input.deleted ? new Date() : null } : {}),
        },
      });
      return c.json({ account: { id: account.id, type: account.type, name: account.name, slug: account.slug, billing_email: account.billingEmail, deleted_at: account.deletedAt?.toISOString() ?? null } });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/accounts/:id/members', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = accountMemberSchema.parse(await c.req.json());
      const prisma = getPrisma();
      const account = await prisma.account.findUnique({ where: { id: c.req.param('id') } });
      if (!account) return c.json({ error: true, message: 'Account not found' }, 404);
      if (account.type !== 'organization') return c.json({ error: true, message: 'Members can only be managed on organization accounts; personal accounts only have their owner', status: 400 }, 400);
      const user = input.user_id
        ? await prisma.user.findUnique({ where: { id: input.user_id } })
        : input.email
          ? await ensureUserByEmail({ email: input.email, name: input.name })
          : null;
      if (!user) return c.json({ error: true, message: 'Pass user_id or email for the member' }, 400);
      await ensureUserAccountGraph(user);
      const member = await ensureMembership(account.id, user.id, input.role);
      if (!user.defaultAccountId) await prisma.user.update({ where: { id: user.id }, data: { defaultAccountId: account.id } });
      return c.json({ member: { id: member.id, account_id: member.accountId, user_id: user.id, email: user.email, name: user.name, role: member.role } }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/admin/accounts/:id/members/:memberId', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = patchAccountMemberSchema.parse(await c.req.json());
      const member = await updateMembershipRole(c.req.param('id'), c.req.param('memberId'), input.role);
      if (!member) return c.json({ error: true, message: 'Member not found', status: 404 }, 404);
      return c.json({ member: { id: member.id, account_id: member.accountId, user_id: member.userId, role: member.role } });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/admin/accounts/:id/members/:memberId', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const removed = await removeMembership(c.req.param('id'), c.req.param('memberId'));
      if (!removed) return c.json({ error: true, message: 'Member not found', status: 404 }, 404);
      return c.json({ ok: true });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/accounts/:id/invitations', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = accountInvitationSchema.parse(await c.req.json());
      const prisma = getPrisma();
      const account = await prisma.account.findUnique({ where: { id: c.req.param('id') } });
      if (!account) return c.json({ error: true, message: 'Account not found' }, 404);
      if (account.type !== 'organization') return c.json({ error: true, message: 'Invitations are only available on organization accounts', status: 400 }, 400);
      const normalizedEmail = normalizeEmail(input.email);
      const existingMember = await prisma.accountMembership.findFirst({ where: { accountId: account.id, user: { email: normalizedEmail } } });
      if (existingMember) return c.json({ error: true, message: 'That user is already a member of this account', status: 409 }, 409);
      const invitedByUserId = await resolveActorUserIdForAccount(account.id);
      const { invitation: invite, rawToken: token } = await createAccountInvitation({ accountId: account.id, email: normalizedEmail, role: input.role, invitedByUserId });
      return c.json({ invitation: { id: invite.id, account_id: invite.accountId, email: invite.email, role: invite.role, token, expires_at: invite.expiresAt.toISOString(), created_at: invite.createdAt.toISOString() } }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/admin/accounts/:id/invitations/:inviteId/revoke', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const invite = await revokeInvitation(c.req.param('id'), c.req.param('inviteId'));
      if (!invite) return c.json({ error: true, message: 'Invitation not found', status: 404 }, 404);
      return c.json({ invitation: { id: invite.id, revoked_at: invite.revokedAt?.toISOString() ?? null } });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // ─── Node provisioning: bring new hosts into a cluster ─────────────
  // Operator flow: POST a run row → background worker (or one-shot drive
  // via /drive endpoint) executes SSH-driven bootstrap → join token mint
  // → cluster join → membership verification.
  app.post('/admin/nodes/runs', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const body = (await c.req.json()) as {
        cluster_id: string;
        source: 'byo' | 'hetzner-buy';
        target_os?: 'ubuntu-incus' | 'incus-os';
        ssh_host?: string;
        ssh_user?: string;
        ssh_port?: number;
        hetzner_server_number?: number;
        metadata?: Record<string, unknown>;
      };
      if (!body.cluster_id) return c.json({ error: true, message: 'cluster_id required' }, 400);
      if (!body.source) return c.json({ error: true, message: 'source required (byo | hetzner-buy)' }, 400);
      if (body.source === 'byo' && !body.ssh_host) return c.json({ error: true, message: 'ssh_host required for byo source' }, 400);
      const run = await getPrisma().nodeProvisioningRun.create({
        data: {
          clusterId: body.cluster_id,
          source: body.source,
          targetOs: body.target_os ?? 'ubuntu-incus',
          sshHost: body.ssh_host ?? null,
          sshUser: body.ssh_user ?? 'root',
          sshPort: body.ssh_port ?? 22,
          hetznerServerNumber: body.hetzner_server_number ?? null,
          metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
          status: 'pending',
        },
      });
      return c.json({ run }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/nodes/runs', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ runs: [] });
      const runs = await getPrisma().nodeProvisioningRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return c.json({ runs });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/nodes/runs/:id', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const run = await getPrisma().nodeProvisioningRun.findUnique({ where: { id: c.req.param('id') } });
      if (!run) return c.json({ error: true, message: 'Run not found' }, 404);
      return c.json({ run });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/nodes/runs/:id/drive', async (c) => {
    // Manual one-shot drive — bypasses the background worker. Useful for
    // ops debugging and integration tests.
    try {
      const id = c.req.param('id');
      driveRun(config, id).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[nodeProvisioning] manual drive of ${id} failed`, e instanceof Error ? e.stack : e);
      });
      return c.json({ ok: true, scheduled: id });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/nodes/runs/:id/retry', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      const existing = await getPrisma().nodeProvisioningRun.findUnique({ where: { id } });
      if (!existing) return c.json({ error: true, message: 'Run not found' }, 404);
      // Reset failed steps + status so the runner picks it up again. Steps
      // already in `succeeded` are kept and will be skipped by runStep().
      const steps = Array.isArray(existing.steps) ? (existing.steps as unknown as Step[]) : [];
      const cleaned = steps.map((s) => (s.status === 'failed' ? { ...s, status: 'pending' as const, error: undefined } : s));
      await getPrisma().nodeProvisioningRun.update({
        where: { id },
        data: {
          status: 'pending',
          currentStep: null,
          lastError: null,
          endedAt: null,
          steps: cleaned as unknown as Prisma.InputJsonValue,
        },
      });
      return c.json({ ok: true, retried: id });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/nodes/runs/:id/cancel', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      await getPrisma().nodeProvisioningRun.update({
        where: { id },
        data: { status: 'cancelled', endedAt: new Date() },
      });
      return c.json({ ok: true, cancelled: id });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/vendors/hetzner/products', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const products = await new HetznerRobotClient(config.hetznerRobot).listServerProducts({
        location: c.req.query('location') || undefined,
      });
      return c.json({ products });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/vendors/hetzner/servers', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const servers = await new HetznerRobotClient(config.hetznerRobot).listServers();
      return c.json({ servers: servers.map(mapHetznerServer), raw_count: servers.length });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/vendors/hetzner/sync', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const robot = new HetznerRobotClient(config.hetznerRobot);
      const pendingOrders = await getPrisma().procurement.findMany({
        where: { providerTransactionId: { not: null }, hostId: null, status: 'ordered' },
        take: 100,
      });
      for (const procurement of pendingOrders) {
        try {
          const tx = await robot.getOrderTransaction(procurement.providerTransactionId!);
          await getPrisma().procurement.update({
            where: { id: procurement.id },
            data: {
              result: {
                ...jsonRecord(procurement.result),
                transaction: tx.transaction,
                transaction_refreshed_at: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
        } catch { /* transaction may not be visible yet; inventory sync still proceeds */ }
      }
      const servers = await robot.listServers();
      const hosts = await syncHetznerServers(getPrisma(), servers);
      return c.json({ synced: hosts.length, hosts });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/procurements', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ procurements: [], persisted: false });
      const procurements = await getPrisma().procurement.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
      return c.json({ procurements, persisted: true });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/procurements/quote', async (c) => {
    try {
      const input = procurementQuoteSchema.parse(await c.req.json());
      const products = await loadRobotProducts(config, input.location);
      const product = products.find((item) => item.product.id === input.product_id || item.product.name === input.product_id) ?? null;
      return c.json({ quote: buildProcurementQuote(input, product), product_found: Boolean(product) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/procurements', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = createProcurementSchema.parse(await c.req.json());
      const products = await loadRobotProducts(config, input.location);
      const product = products.find((item) => item.product.id === input.product_id || item.product.name === input.product_id) ?? null;
      const quote = buildProcurementQuote(input, product);

      if (input.execute) {
        return c.json({ error: true, message: 'Live host ordering is blocked by policy', quote, required_confirm: 'ORDER REAL HOSTS' }, input.confirm === 'ORDER REAL HOSTS' ? 501 : 409);
      }

      const procurements = [];
      for (let index = 0; index < input.quantity; index += 1) {
        procurements.push(await getPrisma().procurement.create({
          data: {
            vendor: input.vendor,
            productId: input.product_id,
            hostClass: quote.host_class,
            region: input.region,
            location: input.location,
            status: 'planned',
            request: { ...input, execute: false, index } as Prisma.InputJsonValue,
            result: { quote } as Prisma.InputJsonValue,
          },
        }));
      }
      return c.json({ procurements, quote, execution: 'dry_run_planned' }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/procurements/:id/approve', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = procurementActionSchema.parse(await c.req.json().catch(() => ({})));
      const existing = await getPrisma().procurement.findUnique({ where: { id: c.req.param('id') } });
      if (!existing) return c.json({ error: true, message: 'Procurement not found' }, 404);
      const procurement = await getPrisma().procurement.update({
        where: { id: c.req.param('id') },
        data: {
          status: 'approved',
          result: {
            ...jsonRecord(existing.result),
            approval: { approved_at: new Date().toISOString(), note: input.note ?? null },
          } as Prisma.InputJsonValue,
        },
      });
      return c.json({ procurement });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/admin/procurements/:id', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      // Hard delete — only meant for terminal-state rows (cancelled / failed)
      // that the operator wants to sweep out of the audit table. Anything in
      // an active state stays; we 409 to avoid losing in-flight ordering work.
      const existing = await getPrisma().procurement.findUnique({ where: { id: c.req.param('id') } });
      if (!existing) return c.json({ error: true, message: 'Procurement not found' }, 404);
      const status = String(existing.status ?? '').toLowerCase();
      if (status !== 'cancelled' && status !== 'failed') {
        return c.json({ error: true, message: `Refusing to delete procurement in status "${existing.status}". Cancel it first.` }, 409);
      }
      await getPrisma().procurement.delete({ where: { id: c.req.param('id') } });
      return c.json({ ok: true, deleted: existing.id });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/procurements/:id/cancel', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = procurementActionSchema.parse(await c.req.json().catch(() => ({})));
      const existing = await getPrisma().procurement.findUnique({ where: { id: c.req.param('id') } });
      if (!existing) return c.json({ error: true, message: 'Procurement not found' }, 404);
      const procurement = await getPrisma().procurement.update({
        where: { id: c.req.param('id') },
        data: {
          status: 'cancelled',
          error: input.note ?? null,
          result: {
            ...jsonRecord(existing.result),
            cancellation: { cancelled_at: new Date().toISOString(), note: input.note ?? null },
          } as Prisma.InputJsonValue,
        },
      });
      return c.json({ procurement });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Direct, no-workflow order. The operator passes the magic confirm
  // phrase + product + location + ssh-key fingerprint and we hit Hetzner
  // Robot's transactions endpoint. Test mode (test=true) is the default
  // via a separate /admin/orders/dry-run endpoint; this one places real
  // orders and bills the account.
  // One-shot fleet node buy: replaces the (quote → approve → plan order →
  // place → manual target-cluster → bootstrap) dance with one operator
  // confirmation. If target_cluster_id is omitted, v2-api auto-selects a
  // reachable cluster in the requested region with the fewest members and
  // under the 100-node Incus cluster cap.
  // Flow:
  //   1. Create a Procurement row (status=quoted)
  //   2. Auto-approve (status=approved)
  //   3. If confirm matches, fire Hetzner Robot placeOrder(test=false)
  //      and persist provider_transaction_id
  //   4. Persist the selected target_cluster_id so the handoff worker
  //      auto-joins the new host once delivered.
  // Returns the final procurement row + Hetzner transaction.
  app.post('/admin/orders/validate', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = nodeOrderSchema.omit({ confirm: true, note: true }).parse(await c.req.json());
      const validated = await validateFleetNodeOrder(config, input);
      return c.json({
        ok: true,
        charge: false,
        dry_run: validated.dry_run,
        quote: validated.quote,
        target_cluster: publicCluster(validated.target.cluster),
        target_cluster_selection: validated.target.selection,
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/orders/buy', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const body = nodeOrderSchema.parse(await c.req.json());
      if (body.confirm !== 'ORDER REAL HOSTS') {
        return c.json({
          error: true,
          message: 'Live order requires confirm: "ORDER REAL HOSTS"',
          required_confirm: 'ORDER REAL HOSTS',
        }, 409);
      }

      // Robot dry-run first. If Robot returns 412/precondition/etc., this route
      // returns a structured 409 and NEVER attempts the live charge.
      const validated = await validateFleetNodeOrder(config, body);
      const robot = new HetznerRobotClient(config.hetznerRobot);
      const procurement = await getPrisma().procurement.create({
        data: {
          vendor: 'hetzner_robot',
          productId: body.product_id,
          hostClass: `dedicated-server-${body.product_id.toLowerCase()}`,
          region: validated.region,
          location: body.location,
          status: 'order_validated',
          request: {
            product_id: body.product_id,
            location: body.location,
            region: validated.region,
            addons: body.addons ?? [],
            dist: body.dist,
            authorized_key_fingerprints: body.ssh_key_fingerprints ?? [],
            target_cluster_id: validated.target.cluster.id,
            target_cluster_selection: validated.target.selection,
            via: 'fleet-one-click-buy',
          } as Prisma.InputJsonValue,
          result: {
            quote: validated.quote,
            dry_run: validated.dry_run,
            target_cluster_id: validated.target.cluster.id,
            target_cluster_selection: validated.target.selection,
            validated_at: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      let orderResult: Awaited<ReturnType<typeof robot.placeOrder>>;
      try {
        orderResult = await robot.placeOrder({
          productId: body.product_id,
          location: body.location,
          dist: body.dist,
          authorizedKeyFingerprints: body.ssh_key_fingerprints,
          addons: body.addons,
          test: false,
        });
      } catch (error) {
        await getPrisma().procurement.update({
          where: { id: procurement.id },
          data: {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            result: {
              ...jsonRecord(procurement.result),
              live_order_failed_at: new Date().toISOString(),
              live_order_error: error instanceof HetznerRobotApiError
                ? { vendor_status: error.statusCode, vendor_body: error.body, message: error.robotMessage ?? error.message }
                : { message: error instanceof Error ? error.message : String(error) },
            } as Prisma.InputJsonValue,
          },
        }).catch(() => undefined);
        throw error;
      }

      const updated = await getPrisma().procurement.update({
        where: { id: procurement.id },
        data: {
          status: 'ordered',
          providerTransactionId: String(orderResult.transaction.id),
          result: {
            ...jsonRecord(procurement.result),
            transaction: orderResult.transaction,
            ordered_at: new Date().toISOString(),
            note: body.note ?? null,
            target_cluster_id: validated.target.cluster.id,
            target_cluster_selection: validated.target.selection,
          } as Prisma.InputJsonValue,
        },
      });
      return c.json({ procurement: updated, transaction: orderResult.transaction, target_cluster: publicCluster(validated.target.cluster), target_cluster_selection: validated.target.selection }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/orders/place', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const body = (await c.req.json()) as {
        product_id: string;
        location: string;
        dist?: string;
        authorized_key_fingerprints?: string[];
        addons?: string[];
        test?: boolean;
        confirm?: string;
      };
      if (!body.product_id || !body.location) return c.json({ error: true, message: 'product_id and location required' }, 400);
      // Money gate: real orders require the literal confirm phrase. Test
      // mode (Hetzner-side dry run) is allowed without the phrase because
      // it doesn't charge. Either path returns the Hetzner transaction.
      if (!body.test && body.confirm !== 'ORDER REAL HOSTS') {
        return c.json({ error: true, message: 'Live order requires confirm: "ORDER REAL HOSTS"', required_confirm: 'ORDER REAL HOSTS' }, 409);
      }
      const client = new HetznerRobotClient(config.hetznerRobot);
      const result = await client.placeOrder({
        productId: body.product_id,
        location: body.location,
        dist: body.dist,
        authorizedKeyFingerprints: body.authorized_key_fingerprints,
        addons: body.addons,
        test: body.test,
      });
      return c.json({ ok: true, transaction: result.transaction, dry_run: !!body.test });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/orders/transactions/:id', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const client = new HetznerRobotClient(config.hetznerRobot);
      const r = await client.getOrderTransaction(c.req.param('id'));
      return c.json(r);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/orders/ssh-keys', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const client = new HetznerRobotClient(config.hetznerRobot);
      const r = await client.listSshKeys();
      return c.json({ keys: r });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/orders/rescue/:server_number', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const body = (await c.req.json().catch(() => ({}))) as { authorized_key_fingerprints?: string[] };
      const client = new HetznerRobotClient(config.hetznerRobot);
      const r = await client.setRescueMode(Number(c.req.param('server_number')), {
        arch: 64,
        authorizedKeyFingerprints: body.authorized_key_fingerprints,
      });
      return c.json(r);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/orders/reset/:server_number', async (c) => {
    try {
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const body = (await c.req.json().catch(() => ({}))) as { type?: 'sw' | 'hw' | 'man' };
      const client = new HetznerRobotClient(config.hetznerRobot);
      const r = await client.resetServer(Number(c.req.param('server_number')), body.type ?? 'hw');
      return c.json(r);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/procurements/:id/order', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = procurementOrderSchema.parse(await c.req.json().catch(() => ({})));
      const procurement = await getPrisma().procurement.findUnique({ where: { id: c.req.param('id') } });
      if (!procurement) return c.json({ error: true, message: 'Procurement not found' }, 404);

      const plan = buildOrderPlan(procurement);

      // Real-order path: requires execute=true AND the exact confirm phrase.
      // Live-fires Hetzner Robot, persists provider_transaction_id, marks
      // procurement `ordered`. The 409 below is the safety gate when
      // execute=true is sent without the confirm.
      if (input.execute) {
        if (input.confirm !== 'ORDER REAL HOSTS') {
          return c.json({
            error: true,
            message: 'Live order requires confirm: "ORDER REAL HOSTS"',
            required_confirm: 'ORDER REAL HOSTS',
            procurement, plan,
          }, 409);
        }
        if (!config.hetznerRobot) {
          return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
        }
        if (procurement.status !== 'approved') {
          return c.json({ error: true, message: `Procurement must be approved (currently ${procurement.status})` }, 409);
        }
        const robot = new HetznerRobotClient(config.hetznerRobot);
        // Order params: input body overrides procurement.request — operator
        // can supply ssh keys / dist / addons at order time without re-creating
        // the procurement.
        const procReq = (procurement.request as Record<string, unknown> | null) ?? {};
        const orderResult = await robot.placeOrder({
          productId: procurement.productId,
          location: procurement.location,
          dist: input.dist ?? (procReq.dist as string | undefined),
          authorizedKeyFingerprints: input.ssh_key_fingerprints ?? (procReq.authorized_key_fingerprints as string[] | undefined),
          addons: input.addons ?? (procReq.addons as string[] | undefined),
          test: false,
        });
        const txId = String(orderResult.transaction.id);
        const updated = await getPrisma().procurement.update({
          where: { id: procurement.id },
          data: {
            status: 'ordered',
            providerTransactionId: txId,
            result: {
              ...jsonRecord(procurement.result),
              order_plan: plan,
              order_note: input.note ?? null,
              transaction: orderResult.transaction,
              ordered_at: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        return c.json({ procurement: updated, transaction: orderResult.transaction });
      }

      // Plan-only (default) — persists the planned order without firing Hetzner.
      const updated = await getPrisma().procurement.update({
        where: { id: procurement.id },
        data: {
          status: 'order_planned',
          result: {
            ...jsonRecord(procurement.result),
            order_plan: plan,
            order_note: input.note ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      return c.json({ procurement: updated, plan });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/procurements/:id/bootstrap-plan', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = bootstrapPlanSchema.parse(await c.req.json());
      if (!findCluster(config, input.cluster_id)) return c.json({ error: true, message: 'Cluster not found' }, 404);
      const procurement = await getPrisma().procurement.findUnique({ where: { id: c.req.param('id') } });
      if (!procurement) return c.json({ error: true, message: 'Procurement not found' }, 404);
      const host = input.host_id
        ? await getPrisma().host.findUnique({ where: { id: input.host_id } })
        : input.provider_server_number
          ? await getPrisma().host.findFirst({ where: { vendor: 'hetzner_robot', providerServerNumber: input.provider_server_number } })
          : null;
      if ((input.host_id || input.provider_server_number) && !host) return c.json({ error: true, message: 'Host not found' }, 404);
      const plan = buildBootstrapPlan(input, host);
      const updated = await getPrisma().procurement.update({
        where: { id: procurement.id },
        data: {
          status: input.execute ? 'bootstrap_blocked' : 'bootstrap_planned',
          hostId: host?.id ?? procurement.hostId,
          result: { ...jsonRecord(procurement.result), bootstrap_plan: plan } as Prisma.InputJsonValue,
        },
      });
      if (input.execute) return c.json({ error: true, message: 'Live host bootstrap is blocked by policy', procurement: updated, plan }, input.confirm === 'BOOTSTRAP REAL HOST' ? 501 : 409);
      return c.json({ procurement: updated, plan });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/hosts/inventory', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ hosts: [], persisted: false });
      const hosts = await getPrisma().host.findMany({ orderBy: [{ vendor: 'asc' }, { providerServerNumber: 'asc' }] });
      return c.json({ hosts: hosts.map((host) => inventoryHostView(config, host)), persisted: true });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/clusters', async (c) => {
    try {
      const clusters = await Promise.all(config.clusters.map(async (cluster) => {
        const observed = await observeCluster(cluster);
        return { ...publicCluster(cluster), observed };
      }));
      return c.json({ clusters });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/clusters/:id/sync', async (c) => {
    try {
      const cluster = config.clusters.find((item) => item.id === c.req.param('id'));
      if (!cluster) return c.json({ error: true, message: 'Cluster not found' }, 404);
      return c.json({ cluster: publicCluster(cluster), observed: await observeCluster(cluster) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/clusters/:id/sync', async (c) => {
    try {
      const cluster = config.clusters.find((item) => item.id === c.req.param('id'));
      if (!cluster) return c.json({ error: true, message: 'Cluster not found' }, 404);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const observed = await observeCluster(cluster);
      const synced = await syncIncusObservation(getPrisma(), cluster, observed);
      return c.json({ cluster: publicCluster(cluster), synced });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Per-cluster + fleet economics: cost, capacity, fill %, binding
  // constraint, and per-resource unit prices at 80% fill. Single source
  // of truth for "are we full / should we provision more / what does this
  // sandbox actually cost." Live read of Incus state — not persisted yet,
  // so this is an instantaneous snapshot, not a timeseries.
  app.get('/admin/economics', async (c) => {
    try {
      const targetFill = Number(c.req.query('target_fill') || 0.8);
      const perCluster = await Promise.all(config.clusters.map(async (cluster) => {
        try {
          const client = clientFor(cluster);
          const [members, instances] = await Promise.all([
            client.listClusterMembers().catch(() => [] as Awaited<ReturnType<typeof client.listClusterMembers>>),
            client.listInstances().catch(() => [] as Awaited<ReturnType<typeof client.listInstances>>),
          ]);
          return computeClusterEconomics(cluster, members, instances);
        } catch (error) {
          return {
            cluster_id: cluster.id,
            cluster_name: cluster.name,
            region: cluster.region,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as ReturnType<typeof computeClusterEconomics>;
        }
      }));
      const fleet = perCluster.reduce((acc, c) => {
        if (!('monthly_cost_eur' in c) || c.monthly_cost_eur === null) return acc;
        acc.total_monthly_cost_eur += c.monthly_cost_eur ?? 0;
        acc.total_capacity.vcpus += c.capacity?.vcpus ?? 0;
        acc.total_capacity.ram_gb += c.capacity?.ram_gb ?? 0;
        acc.total_capacity.storage_gb += c.capacity?.storage_gb ?? 0;
        acc.total_allocated.vcpus += c.allocated?.vcpus ?? 0;
        acc.total_allocated.ram_gb += c.allocated?.ram_gb ?? 0;
        acc.total_allocated.storage_gb += c.allocated?.storage_gb ?? 0;
        acc.total_active_instances += c.active_instances ?? 0;
        return acc;
      }, {
        total_monthly_cost_eur: 0,
        total_capacity: { vcpus: 0, ram_gb: 0, storage_gb: 0 },
        total_allocated: { vcpus: 0, ram_gb: 0, storage_gb: 0 },
        total_active_instances: 0,
        target_fill: targetFill,
      });
      return c.json({ clusters: perCluster, fleet });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // SKU catalog with €/vCPU·month, €/GB-RAM·month, €/GB-storage·month at
  // a chosen target fill rate. Operator-facing — used to pick which SKU
  // to order next based on which resource is currently binding.
  app.get('/admin/economics/skus', async (c) => {
    const targetFill = Number(c.req.query('target_fill') || 0.8);
    const skus = Object.values(SKU_CATALOG).map((sku) => ({
      ...sku,
      effective_unit_costs_at_target_fill: unitCostsAtFill(sku, targetFill),
    }));
    return c.json({
      target_fill: targetFill,
      default_sku: DEFAULT_SKU_ID,
      default_big_sku: DEFAULT_BIG_SKU_ID,
      skus,
    });
  });

  // PnL roll-up — sums cost_ledger_entries and revenue_ledger_entries
  // across the requested window, breaking out by host (cost) and customer
  // / machine (revenue). Default window: last 30 days.
  app.get('/admin/pnl', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const now = Date.now();
      const fromMs = c.req.query('from') ? Date.parse(c.req.query('from')!) : now - 30 * 86400 * 1000;
      const toMs = c.req.query('to') ? Date.parse(c.req.query('to')!) : now;
      const fromDate = new Date(fromMs);
      const toDate = new Date(toMs);
      const prisma = getPrisma();
      const [costRows, revenueRows] = await Promise.all([
        prisma.costLedgerEntry.findMany({
          where: { tsFrom: { gte: fromDate, lte: toDate } },
          select: { hostId: true, tsFrom: true, tsTo: true, microEur: true },
        }),
        prisma.revenueLedgerEntry.findMany({
          where: { tsFrom: { gte: fromDate, lte: toDate } },
          select: { customerId: true, machineId: true, tsFrom: true, tsTo: true, microEur: true },
        }),
      ]);
      const costs: CostEntry[] = costRows.map((r) => ({
        hostId: r.hostId, tsFrom: r.tsFrom, tsTo: r.tsTo, microEur: r.microEur,
      }));
      const revenues: RevenueEntry[] = revenueRows.map((r) => ({
        customerId: r.customerId, machineId: r.machineId ?? '', tsFrom: r.tsFrom, tsTo: r.tsTo, microEur: r.microEur,
      }));
      const rollup = rollupPnL(costs, revenues);
      // Convert BigInts to strings for JSON serialization (BigInts don't
      // serialize natively).
      return c.json({
        window: { from: fromDate.toISOString(), to: toDate.toISOString() },
        total_cost_eur: Number(rollup.total_cost_micro_eur) / 1e6,
        total_revenue_eur: Number(rollup.total_revenue_micro_eur) / 1e6,
        margin_eur: Number(rollup.margin_micro_eur) / 1e6,
        margin_pct: rollup.margin_pct,
        by_host: rollup.by_host.map((h) => ({ host_id: h.host_id, cost_eur: Number(h.cost_micro_eur) / 1e6 })),
        by_customer: rollup.by_customer.map((cu) => ({ customer_id: cu.customer_id, revenue_eur: Number(cu.revenue_micro_eur) / 1e6 })),
        by_machine: rollup.by_machine.map((m) => ({ machine_id: m.machine_id, revenue_eur: Number(m.revenue_micro_eur) / 1e6 })),
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // PnL timeseries — daily cost / revenue / margin over the requested
  // window. Used by the PnL page to render a line chart.
  app.get('/admin/pnl/timeseries', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const now = Date.now();
      const days = Math.max(1, Math.min(365, Number(c.req.query('days') || 30)));
      const from = new Date(now - days * 86400 * 1000);
      const to = new Date(now);
      const prisma = getPrisma();
      const [costRows, revRows] = await Promise.all([
        prisma.costLedgerEntry.findMany({
          where: { tsFrom: { gte: from, lte: to } },
          select: { tsFrom: true, microEur: true },
        }),
        prisma.revenueLedgerEntry.findMany({
          where: { tsFrom: { gte: from, lte: to } },
          select: { tsFrom: true, microEur: true },
        }),
      ]);
      const costBuckets = bucketDaily(
        costRows.map((r) => ({ ts: r.tsFrom, microEur: r.microEur } as LedgerRow)),
        from, to,
      );
      const revBuckets = bucketDaily(
        revRows.map((r) => ({ ts: r.tsFrom, microEur: r.microEur } as LedgerRow)),
        from, to,
      );
      // Zip side by side, compute margin per day.
      const series = costBuckets.map((c, i) => {
        const cost = c.microEur;
        const rev = revBuckets[i]?.microEur ?? 0n;
        return {
          ts: c.tsFrom.toISOString(),
          cost_eur: Number(cost) / 1e6,
          revenue_eur: Number(rev) / 1e6,
          margin_eur: Number(rev - cost) / 1e6,
        };
      });
      return c.json({ window_days: days, series });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Cluster utilization timeseries — per-resource fill % over the
  // requested window. Used by Economics page line chart.
  app.get('/admin/economics/history', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const clusterId = c.req.query('cluster_id');
      if (!clusterId) return c.json({ error: true, message: 'cluster_id required' }, 400);
      const cluster = config.clusters.find((cl) => cl.id === clusterId);
      if (!cluster) return c.json({ error: true, message: 'Cluster not found' }, 404);
      const hours = Math.max(1, Math.min(24 * 7, Number(c.req.query('hours') || 24)));
      const from = new Date(Date.now() - hours * 3600 * 1000);
      const prisma = getPrisma();
      const [hosts, samples] = await Promise.all([
        prisma.host.findMany({ where: { incusClusterId: clusterId, lifecycleState: { not: 'terminated' } } }),
        prisma.nodeUtilizationSample.findMany({ where: { ts: { gte: from } }, orderBy: { ts: 'asc' } }),
      ]);
      const hostIds = new Set(hosts.map((h) => h.id));
      const skuName = cluster.defaultMemberSku ?? DEFAULT_SKU_ID;
      const sku = SKU_CATALOG[skuName];
      const totalCapacity = sku ? {
        vcpus: sku.vcpus * hosts.length,
        ramGb: sku.ramGb * hosts.length,
        storageGb: sku.usableStorageGb * hosts.length,
      } : { vcpus: 0, ramGb: 0, storageGb: 0 };
      const filtered: SamplePoint[] = samples
        .filter((s) => hostIds.has(s.hostId))
        .map((s) => ({ ts: s.ts, hostId: s.hostId, vcpuUsed: s.vcpuUsed, ramGbUsed: s.ramGbUsed, storageGbUsed: s.storageGbUsed }));
      const series = fillSamplesToFillSeries(filtered, totalCapacity);
      return c.json({
        cluster_id: clusterId,
        hours,
        capacity: totalCapacity,
        series: series.map((p) => ({ ts: p.ts.toISOString(), vcpu_pct: p.vcpuPct, ram_pct: p.ramPct, storage_pct: p.storagePct })),
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Forecast: linear regression over recent NodeUtilizationSample rows
  // for one cluster. Returns the projected ETA at which the binding
  // resource hits 80%/90%/100% fill.
  app.get('/admin/forecast', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const clusterId = c.req.query('cluster_id');
      if (!clusterId) return c.json({ error: true, message: 'cluster_id required' }, 400);
      const cluster = config.clusters.find((cl) => cl.id === clusterId);
      if (!cluster) return c.json({ error: true, message: 'Cluster not found' }, 404);

      // Pull last 7 days of utilization samples, joined to host SKU for
      // capacity computation.
      const since = new Date(Date.now() - 7 * 86400 * 1000);
      const prisma = getPrisma();
      const samples = await prisma.nodeUtilizationSample.findMany({
        where: { ts: { gte: since } },
        orderBy: { ts: 'asc' },
      });
      // Aggregate per-cluster: sum used resources across hosts in that cluster
      // at each timestamp. We need host → cluster mapping. For simplicity,
      // aggregate from current cluster members + their recorded SKU.
      const hosts = await prisma.host.findMany({
        where: { incusClusterId: clusterId, lifecycleState: { not: 'terminated' } },
      });
      const hostIds = new Set(hosts.map((h) => h.id));
      const clusterSamples = samples.filter((s) => hostIds.has(s.hostId));
      const skuName = cluster.defaultMemberSku ?? DEFAULT_SKU_ID;
      const sku = SKU_CATALOG[skuName];
      const totalCapacity = sku ? {
        vcpu: sku.vcpus * hosts.length,
        ram: sku.ramGb * hosts.length,
        storage: sku.usableStorageGb * hosts.length,
      } : null;

      // Group samples by ts, sum within each timestamp.
      const byTs = new Map<number, { vcpu: number; ram: number; storage: number }>();
      for (const s of clusterSamples) {
        const key = s.ts.getTime();
        const cur = byTs.get(key) ?? { vcpu: 0, ram: 0, storage: 0 };
        cur.vcpu += s.vcpuUsed;
        cur.ram += s.ramGbUsed;
        cur.storage += s.storageGbUsed;
        byTs.set(key, cur);
      }
      const fillSamples: FillSample[] = totalCapacity ? Array.from(byTs).map(([key, used]) => ({
        ts: new Date(key),
        vcpuPct: totalCapacity.vcpu > 0 ? (used.vcpu / totalCapacity.vcpu) * 100 : 0,
        ramPct: totalCapacity.ram > 0 ? (used.ram / totalCapacity.ram) * 100 : 0,
        storagePct: totalCapacity.storage > 0 ? (used.storage / totalCapacity.storage) * 100 : 0,
      })).sort((a, b) => a.ts.getTime() - b.ts.getTime()) : [];

      const forecasts = (['vcpu', 'ram', 'storage'] as const).map((binding) => ({
        resource: binding,
        eta_80: forecastExhaustion(fillSamples, { binding, targetPct: 80 }),
        eta_90: forecastExhaustion(fillSamples, { binding, targetPct: 90 }),
        eta_100: forecastExhaustion(fillSamples, { binding, targetPct: 100 }),
      }));

      return c.json({
        cluster_id: clusterId,
        sample_count: fillSamples.length,
        forecasts: forecasts.map((f) => ({
          resource: f.resource,
          eta_80: f.eta_80.etaMs ? new Date(f.eta_80.etaMs).toISOString() : null,
          eta_90: f.eta_90.etaMs ? new Date(f.eta_90.etaMs).toISOString() : null,
          eta_100: f.eta_100.etaMs ? new Date(f.eta_100.etaMs).toISOString() : null,
          slope_pct_per_hour: f.eta_80.slopePctPerHour,
        })),
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Autoscale proposal queue. The proposer worker writes pending proposals;
  // the operator approves/rejects via the endpoints below. Approved
  // add-node proposals fire /admin/clusters/:id/add-member; approved
  // drain-node proposals fire (a future) drain endpoint.
  app.get('/admin/proposals', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ proposals: [] });
      const status = c.req.query('status');
      const proposals = await getPrisma().scalingProposal.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return c.json({ proposals });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/proposals', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const body = (await c.req.json()) as {
        kind: 'add-node' | 'drain-node' | 'terminate-node';
        cluster_id: string;
        host_id?: string;
        proposed_sku?: string;
        rationale: string;
        cost_impact_eur_mo: number;
        ttl_minutes?: number;
        metadata?: Record<string, unknown>;
      };
      if (!body.kind || !body.cluster_id || !body.rationale) {
        return c.json({ error: true, message: 'kind, cluster_id, rationale required' }, 400);
      }
      const expiresAt = new Date(Date.now() + (body.ttl_minutes ?? 1440) * 60 * 1000);
      const proposal = await getPrisma().scalingProposal.create({
        data: {
          kind: body.kind,
          clusterId: body.cluster_id,
          hostId: body.host_id ?? null,
          proposedSku: body.proposed_sku ?? null,
          rationale: body.rationale,
          costImpactEurMo: body.cost_impact_eur_mo,
          status: 'pending',
          expiresAt,
          metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      return c.json({ proposal }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/proposals/:id/approve', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      const approver = c.req.header('X-Operator') || 'admin-token';
      const proposal = await getPrisma().scalingProposal.findUnique({ where: { id } });
      if (!proposal) return c.json({ error: true, message: 'Proposal not found' }, 404);
      if (proposal.status !== 'pending') {
        return c.json({ error: true, message: `Proposal is already ${proposal.status}` }, 409);
      }
      if (proposal.expiresAt.getTime() < Date.now()) {
        await getPrisma().scalingProposal.update({
          where: { id },
          data: { status: 'expired' },
        });
        return c.json({ error: true, message: 'Proposal has expired' }, 409);
      }
      const updated = await getPrisma().scalingProposal.update({
        where: { id },
        data: { status: 'approved', approvedBy: approver, approvedAt: new Date() },
      });
      return c.json({ proposal: updated });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/proposals/:id/reject', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      const approver = c.req.header('X-Operator') || 'admin-token';
      const proposal = await getPrisma().scalingProposal.findUnique({ where: { id } });
      if (!proposal) return c.json({ error: true, message: 'Proposal not found' }, 404);
      const updated = await getPrisma().scalingProposal.update({
        where: { id },
        data: { status: 'rejected', approvedBy: approver, approvedAt: new Date() },
      });
      return c.json({ proposal: updated });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // ─── Node lifecycle ops: cordon / uncordon / drain / terminate ─────
  // All four mutate Host.lifecycleState through the state machine and
  // (for drain/terminate) drive the corresponding Incus + Hetzner ops.
  // The state-machine validation in applyTransition() rejects illegal
  // transitions so we don't accidentally drain a not-yet-online host.

  // Cordon: stop scheduling new sandboxes. Existing sandboxes keep running.
  // Reversible via /uncordon.
  app.post('/admin/nodes/:id/cordon', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      const host = await getPrisma().host.findUnique({ where: { id } });
      if (!host) return c.json({ error: true, message: 'Host not found' }, 404);
      const next = applyTransition(host.lifecycleState as NodeLifecycleState, 'cordoned');
      const updated = await getPrisma().host.update({
        where: { id }, data: { lifecycleState: next, schedulable: false },
      });
      return c.json({ host: updated });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Uncordon: re-enable scheduling. Only valid from cordoned → online.
  app.post('/admin/nodes/:id/uncordon', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      const host = await getPrisma().host.findUnique({ where: { id } });
      if (!host) return c.json({ error: true, message: 'Host not found' }, 404);
      const next = applyTransition(host.lifecycleState as NodeLifecycleState, 'online');
      const updated = await getPrisma().host.update({
        where: { id }, data: { lifecycleState: next, schedulable: true },
      });
      return c.json({ host: updated });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Drain: stop scheduling AND evacuate running instances away. We drive
  // Incus's `cluster evacuate` op, which moves each instance to another
  // member that has capacity. Async — evacuation can take minutes.
  app.post('/admin/nodes/:id/drain', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      const host = await getPrisma().host.findUnique({ where: { id } });
      if (!host) return c.json({ error: true, message: 'Host not found' }, 404);
      if (!host.incusClusterId || !host.incusMemberName) {
        return c.json({ error: true, message: 'Host is not a registered cluster member' }, 422);
      }
      const cluster = config.clusters.find((cl) => cl.id === host.incusClusterId);
      if (!cluster) return c.json({ error: true, message: 'Cluster not loaded in v2-api config' }, 422);

      // 1. State transition online → draining (rejects if invalid).
      const draining = applyTransition(host.lifecycleState as NodeLifecycleState, 'draining');
      await getPrisma().host.update({
        where: { id }, data: { lifecycleState: draining, schedulable: false, drainedAt: new Date() },
      });

      // 2. Trigger Incus evacuation. Best-effort: log and continue if Incus
      // refuses (e.g. only one member). Operator can retry later.
      try {
        const client = clientFor(cluster);
        await client.evacuateClusterMember(host.incusMemberName);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[drain] evacuate failed for ${host.incusMemberName}: ${e instanceof Error ? e.message : e}`);
      }

      return c.json({
        host: await getPrisma().host.findUnique({ where: { id } }),
        message: 'Drain initiated. Poll the host for lifecycle_state=cordoned once evacuation completes.',
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Terminate: final state. Removes the Incus member, marks the row
  // terminated, and OPTIONALLY schedules Hetzner cancellation.
  //   confirm: "TERMINATE NODE"  — required for any termination
  //   confirm_hetzner_cancel: "CANCEL HETZNER SERVER <server_number>"  — required to actually cancel billing
  // The two-step confirm exists because Hetzner cancellation is hard to undo
  // (you can withdraw it before the cancellation date — see
  // POST /admin/nodes/:id/withdraw-hetzner-cancellation).
  app.post('/admin/nodes/:id/terminate', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const body = (await c.req.json().catch(() => ({}))) as {
        confirm?: string;
        confirm_hetzner_cancel?: string;
        skip_hetzner_cancel?: boolean;
        cancellation_reason?: string;
      };
      if (body.confirm !== 'TERMINATE NODE') {
        return c.json({ error: true, message: 'Pass {"confirm":"TERMINATE NODE"} to terminate. Stops scheduling and removes the Incus member.' }, 409);
      }
      const id = c.req.param('id');
      const host = await getPrisma().host.findUnique({ where: { id } });
      if (!host) return c.json({ error: true, message: 'Host not found' }, 404);
      const next = applyTransition(host.lifecycleState as NodeLifecycleState, 'terminated');

      // 1. Remove from Incus cluster (best-effort — host may already be gone).
      if (host.incusClusterId && host.incusMemberName) {
        const cluster = config.clusters.find((cl) => cl.id === host.incusClusterId);
        if (cluster) {
          try {
            await clientFor(cluster).removeClusterMember(host.incusMemberName);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`[terminate] remove member failed: ${e instanceof Error ? e.message : e}`);
          }
        }
      }

      // 2. Hetzner cancellation: gated on a *separate* confirm phrase that
      // includes the server number — operator can't fat-finger the wrong host.
      let hetznerCancellation: { ok: boolean; cancellation_date?: string | null; error?: string } | null = null;
      if (!body.skip_hetzner_cancel && config.hetznerRobot && host.providerServerNumber) {
        const expectedConfirm = `CANCEL HETZNER SERVER ${host.providerServerNumber}`;
        if (body.confirm_hetzner_cancel === expectedConfirm) {
          try {
            const robot = new HetznerRobotClient(config.hetznerRobot);
            const result = await robot.cancelServer(Number(host.providerServerNumber), {
              cancellation_date: 'now',
              reason: body.cancellation_reason ?? 'Decommissioned via JustAVPS V2',
            });
            hetznerCancellation = { ok: true, cancellation_date: result.cancellation.cancellation_date };
            // eslint-disable-next-line no-console
            console.log(`[terminate] hetzner cancellation scheduled for #${host.providerServerNumber}: ${result.cancellation.cancellation_date}`);
          } catch (e) {
            hetznerCancellation = { ok: false, error: e instanceof Error ? e.message : String(e) };
            // eslint-disable-next-line no-console
            console.warn(`[terminate] hetzner cancel failed: ${hetznerCancellation.error}`);
          }
        } else {
          hetznerCancellation = {
            ok: false,
            error: `Hetzner cancellation NOT performed. Pass {"confirm_hetzner_cancel":"${expectedConfirm}"} to schedule it. Operator must do it manually in Robot otherwise.`,
          };
        }
      }

      const updated = await getPrisma().host.update({
        where: { id },
        data: { lifecycleState: next, schedulable: false, terminatedAt: new Date() },
      });
      return c.json({ host: updated, hetzner_cancellation: hetznerCancellation });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Withdraw a previously-scheduled Hetzner cancellation. Operator escape
  // hatch in case terminate was triggered in error.
  app.post('/admin/nodes/:id/withdraw-hetzner-cancellation', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
      const id = c.req.param('id');
      const host = await getPrisma().host.findUnique({ where: { id } });
      if (!host || !host.providerServerNumber) return c.json({ error: true, message: 'Host or server number not found' }, 404);
      const robot = new HetznerRobotClient(config.hetznerRobot);
      const result = await robot.withdrawCancellation(Number(host.providerServerNumber));
      return c.json({ result });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // Set the target cluster a host should auto-join (the handoff worker
  // picks it up). One-shot: handoff is automatic from here onward
  // (subject to lifecycle_state being eligible).
  app.post('/admin/nodes/:id/target-cluster', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const body = (await c.req.json()) as { cluster_id: string | null };
      const id = c.req.param('id');
      const host = await getPrisma().host.findUnique({ where: { id } });
      if (!host) return c.json({ error: true, message: 'Host not found' }, 404);
      if (body.cluster_id && !findCluster(config, body.cluster_id)) {
        return c.json({ error: true, message: `Cluster ${body.cluster_id} not configured` }, 404);
      }
      const meta = jsonRecord(host.metadata);
      if (body.cluster_id) {
        meta.target_cluster_id = body.cluster_id;
      } else {
        delete meta.target_cluster_id;
      }
      const updated = await getPrisma().host.update({
        where: { id },
        data: { metadata: meta as Prisma.InputJsonValue },
      });
      return c.json({ host: updated });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // ─── Cluster CRUD (dynamic registry) ────────────────────────────────
  // Operators can register clusters at runtime without an INCUS_CLUSTERS_JSON
  // restart. The full IncusClusterConfig (certs, SKU, channel, root pool,
  // etc.) is stored in v2_incus.clusters.config (JSONB). On register we
  // also push into the in-memory config.clusters so subsequent requests
  // see it without a restart.
  const persistAndRegister = async (raw: Record<string, unknown>): Promise<IncusClusterConfig> => {
    const normalized = normalizeClusterConfig(raw);
    await getPrisma().incusCluster.upsert({
      where: { id: normalized.id },
      create: {
        id: normalized.id,
        name: normalized.name,
        region: normalized.region,
        endpoint: normalized.endpoint,
        project: normalized.project,
        // Persist the original raw input (paths, not inline PEMs) so future
        // hydration re-reads files. Storing inline PEMs would bloat the row.
        config: raw as Prisma.InputJsonValue,
      },
      update: {
        name: normalized.name,
        region: normalized.region,
        endpoint: normalized.endpoint,
        project: normalized.project,
        config: raw as Prisma.InputJsonValue,
      },
    });
    // Mutate the in-memory clusters list — replace existing entry with the
    // same id, or append. This is single-process; multi-process deployments
    // need each instance to re-hydrate from DB on its own clock.
    const idx = config.clusters.findIndex((c) => c.id === normalized.id);
    if (idx >= 0) config.clusters[idx] = normalized;
    else config.clusters.push(normalized);
    return normalized;
  };

  app.post('/admin/clusters', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const body = (await c.req.json()) as Record<string, unknown>;
      if (!body.endpoint || !body.id) {
        return c.json({ error: true, message: 'id and endpoint required' }, 400);
      }
      const created = await persistAndRegister(body);
      return c.json({ cluster: publicCluster(created) }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/admin/clusters/:id', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      const existing = await getPrisma().incusCluster.findUnique({ where: { id } });
      if (!existing) return c.json({ error: true, message: 'Cluster not found' }, 404);
      const patch = (await c.req.json()) as Record<string, unknown>;
      const merged = { ...(existing.config as Record<string, unknown>), ...patch, id };
      const updated = await persistAndRegister(merged);
      return c.json({ cluster: publicCluster(updated) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/admin/clusters/:id', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const id = c.req.param('id');
      // Don't allow deleting clusters that came from env — delete row,
      // remove from in-memory list. Idempotent.
      await getPrisma().incusCluster.delete({ where: { id } }).catch(() => undefined);
      const idx = config.clusters.findIndex((cl) => cl.id === id);
      if (idx >= 0) config.clusters.splice(idx, 1);
      return c.json({ ok: true });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // ─── Region CRUD ────────────────────────────────────────────────────
  app.get('/admin/regions', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ regions: [] });
      const regions = await getPrisma().region.findMany({ orderBy: { code: 'asc' } });
      return c.json({ regions });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/regions', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const body = (await c.req.json()) as {
        code: string; provider_code: string; vendor?: string;
        display_name: string; default_sku: string; metadata?: Record<string, unknown>;
      };
      if (!body.code || !body.provider_code || !body.display_name || !body.default_sku) {
        return c.json({ error: true, message: 'code, provider_code, display_name, default_sku required' }, 400);
      }
      const region = await getPrisma().region.create({
        data: {
          code: body.code, providerCode: body.provider_code,
          vendor: body.vendor ?? 'hetzner',
          displayName: body.display_name, defaultSku: body.default_sku,
          metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      return c.json({ region }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/admin/regions/:code', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      await getPrisma().region.delete({ where: { code: c.req.param('code') } });
      return c.json({ ok: true });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // SKU recommender — gives the operator a "what to order next" answer
  // based on current fleet size + most-binding constraint across clusters.
  app.get('/admin/economics/recommend', async (c) => {
    try {
      let fleetHostCount = 0;
      let worstBinding: 'vcpus' | 'ram' | 'storage' | null = null;
      let worstFill = -1;
      for (const cluster of config.clusters) {
        try {
          const client = clientFor(cluster);
          const [members, instances] = await Promise.all([client.listClusterMembers(), client.listInstances()]);
          fleetHostCount += members.length;
          const econ = computeClusterEconomics(cluster, members, instances);
          if (econ.binding_constraint && econ.fill_pct) {
            const fill = econ.fill_pct[econ.binding_constraint === 'vcpus' ? 'vcpus' : econ.binding_constraint] ?? 0;
            if (fill > worstFill) {
              worstFill = fill;
              worstBinding = econ.binding_constraint;
            }
          }
        } catch { /* skip unreachable cluster */ }
      }
      const rec = recommendNextSku({
        fleetHostCount,
        bindingConstraint: worstBinding,
        preferConsolidation: c.req.query('prefer_consolidation') === 'true',
      });
      return c.json({
        fleet_host_count: fleetHostCount,
        worst_binding: worstBinding,
        worst_fill_pct: worstFill < 0 ? null : worstFill,
        recommendation: rec,
      });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // 1-click: add a member to a cluster. Two modes:
  //   • BYO ssh_host       — host already in Hetzner Rescue (or fresh Ubuntu).
  //   • hetzner_server_number — runner looks up the server's primary IP via
  //     Robot, optionally arms Rescue + reset, then drives the bootstrap.
  // Either way we create a NodeProvisioningRun and the background worker
  // executes the 7-step state machine (probe-ssh → bootstrap → wipe →
  // mint-token → join → verify) using cluster-aware defaults
  // (incusChannel, rootPool, storageSource, caCert).
  app.post('/admin/clusters/:id/add-member', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const cluster = config.clusters.find((item) => item.id === c.req.param('id'));
      if (!cluster) return c.json({ error: true, message: 'Cluster not found' }, 404);
      const body = (await c.req.json().catch(() => ({}))) as {
        ssh_host?: string;
        ssh_user?: string;
        ssh_port?: number;
        hetzner_server_number?: number;
        from_rescue?: boolean;        // true ⇒ run installimage first
        arm_rescue?: boolean;         // true ⇒ set rescue + hw reset before probe
        ssh_key_fingerprints?: string[]; // for arm_rescue
        member_name?: string;
        metadata?: Record<string, unknown>;
      };
      let sshHost = body.ssh_host?.trim() || null;
      const serverNumber = body.hetzner_server_number ?? null;

      // If only a server number is provided, resolve the primary IP via Robot.
      if (!sshHost && serverNumber !== null) {
        if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
        const robot = new HetznerRobotClient(config.hetznerRobot);
        const all = await robot.listServers();
        const match = all.find((s) => s.server.server_number === serverNumber);
        if (!match) return c.json({ error: true, message: `Hetzner server ${serverNumber} not found in account` }, 404);
        sshHost = match.server.server_ip || (match.server.ip ?? [])[0] || null;
        if (!sshHost) return c.json({ error: true, message: `Server ${serverNumber} has no IPv4; pass ssh_host explicitly (IPv6)` }, 422);
      }

      if (!sshHost) return c.json({ error: true, message: 'ssh_host or hetzner_server_number required' }, 400);

      // Optional: arm Rescue + hw reset so the runner finds a clean rescue env.
      // The runner's rescue-installimage step assumes we're already in rescue.
      if (body.arm_rescue && serverNumber !== null) {
        if (!config.hetznerRobot) return c.json({ error: true, message: 'Hetzner Robot credentials not configured' }, 400);
        const robot = new HetznerRobotClient(config.hetznerRobot);
        await robot.setRescueMode(serverNumber, { authorizedKeyFingerprints: body.ssh_key_fingerprints ?? [] });
        await robot.resetServer(serverNumber, 'hw');
      }

      const run = await getPrisma().nodeProvisioningRun.create({
        data: {
          clusterId: cluster.id,
          source: serverNumber !== null ? 'hetzner-buy' : 'byo',
          targetOs: 'ubuntu-incus',
          sshHost,
          sshUser: body.ssh_user ?? 'root',
          sshPort: body.ssh_port ?? 22,
          hetznerServerNumber: serverNumber,
          metadata: ({
            ...(body.metadata ?? {}),
            ...(body.from_rescue !== undefined ? { from_rescue: body.from_rescue } : {}),
            ...(body.member_name ? { member_name: body.member_name } : {}),
          }) as Prisma.InputJsonValue,
          status: 'pending',
        },
      });

      return c.json({
        run,
        cluster: publicCluster(cluster),
        status_url: `/admin/nodes/runs/${run.id}`,
      }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/hosts', async (c) => {
    try {
      const hosts = (await Promise.all(config.clusters.map(async (cluster) => {
        const members = await clientFor(cluster).listClusterMembers();
        return members.map((member) => ({
          cluster: publicCluster(cluster),
          name: member.server_name,
          url: member.url,
          status: member.status,
          roles: member.roles ?? [],
          schedulable: member.status === 'Online',
          links: incusWebLinks(member.url || cluster.endpoint),
        }));
      }))).flat();
      return c.json({ hosts });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/fleet', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      return c.json(await buildFleetTopology(config, { sync: false }));
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/admin/fleet/sync', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      return c.json(await buildFleetTopology(config, { sync: true }));
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/telemetry/creations', async (c) => {
    const authError = adminGuard(config, c.req.header('authorization'));
    if (authError) return c.json(authError, 401);
    return c.json({ machine_creations: listMachineCreationTelemetry() });
  });

  app.get('/admin/telemetry/creations/:id', async (c) => {
    const authError = adminGuard(config, c.req.header('authorization'));
    if (authError) return c.json(authError, 401);
    const trace = getMachineCreationTelemetry(c.req.param('id'));
    if (!trace) return c.json({ error: true, message: 'Machine creation trace not found' }, 404);
    return c.json({ trace });
  });

  app.get('/admin/telemetry/overview', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const overview = await getTelemetryStore(config).overview(telemetryQuery(c));
      return c.json(overview);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/telemetry/machines/:id/latest', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const latest = await getTelemetryStore(config).latest(c.req.param('id'));
      return c.json({ latest, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/telemetry/machines/:id/metrics', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const metrics = await getTelemetryStore(config).metrics(c.req.param('id'), telemetryQuery(c));
      return c.json({ metrics, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/telemetry/machines/:id/logs', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const logs = await getTelemetryStore(config).logs(c.req.param('id'), {
        ...telemetryQuery(c),
        direction: c.req.query('direction') === 'forward' ? 'forward' : 'backward',
        level: c.req.query('level'),
        source: c.req.query('source'),
        search: c.req.query('search'),
      });
      return c.json({ logs, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/telemetry/machines/:id/traces', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const traces = await getTelemetryStore(config).traces(c.req.param('id'), { ...telemetryQuery(c), operation: c.req.query('operation') });
      return c.json({ traces, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/telemetry/machines/:id/events', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const events = await getTelemetryStore(config).events(c.req.param('id'), telemetryQuery(c));
      return c.json({ events, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/internal/telemetry/machines/:id/metrics', async (c) => {
    try {
      const machineId = c.req.param('id');
      const payload = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const authError = await telemetryIngestGuard(config, c.req.header('authorization'), machineId, payload, c.req.header('x-justavps-telemetry-token'));
      if (authError) return c.json(authError, 401);
      const rows = metricSamplesFromPayload(machineId, payload);
      const inserted = await getTelemetryStore(config).insertMetrics(rows);
      if (inserted > 0) {
        await getTelemetryStore(config).insertEvents([{ machine_id: machineId, account_id: typeof payload.account_id === 'string' ? payload.account_id : undefined, type: 'sandbox.telemetry.metrics', category: 'telemetry', body: `ingested ${inserted} metric samples` }]).catch(() => 0);
      }
      return c.json({ ok: true, inserted, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/internal/telemetry/machines/:id/logs', async (c) => {
    try {
      const machineId = c.req.param('id');
      const payload = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const authError = await telemetryIngestGuard(config, c.req.header('authorization'), machineId, payload, c.req.header('x-justavps-telemetry-token'));
      if (authError) return c.json(authError, 401);
      const rows = logEntriesFromPayload(machineId, payload);
      const inserted = await getTelemetryStore(config).insertLogs(rows);
      return c.json({ ok: true, inserted, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/internal/telemetry/machines/:id/traces', async (c) => {
    try {
      const machineId = c.req.param('id');
      const payload = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const authError = await telemetryIngestGuard(config, c.req.header('authorization'), machineId, payload, c.req.header('x-justavps-telemetry-token'));
      if (authError) return c.json(authError, 401);
      const rows = traceSpansFromPayload(machineId, payload);
      const inserted = await getTelemetryStore(config).insertTraces(rows);
      return c.json({ ok: true, inserted, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/internal/telemetry/machines/:id/events', async (c) => {
    try {
      const machineId = c.req.param('id');
      const payload = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const authError = await telemetryIngestGuard(config, c.req.header('authorization'), machineId, payload, c.req.header('x-justavps-telemetry-token'));
      if (authError) return c.json(authError, 401);
      const rows = eventEntriesFromPayload(machineId, payload);
      const inserted = await getTelemetryStore(config).insertEvents(rows);
      return c.json({ ok: true, inserted, store: getTelemetryStore(config).info() });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machine-templates', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const accountId = c.req.header('x-account-id') || 'system';
      if (!config.databaseConfigured) {
        const templates = await Promise.all(TEMPLATES.map((template) => virtualCatalogMachineTemplate(config, template.id)));
        return c.json({ templates: templates.filter(Boolean) });
      }
      await ensureCatalogMachineTemplates(config);
      const [rows, poolRows] = await Promise.all([
        getPrisma().machineTemplate.findMany({
          where: {
            status: { not: 'deleted' },
            OR: [{ accountId }, { accountId: 'system', visibility: 'catalog' }, { visibility: 'catalog' }],
          },
          orderBy: [{ visibility: 'asc' }, { updatedAt: 'desc' }],
        }),
        getPrisma().machine.findMany({ where: { status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } }),
      ]);
      const measuredPoolRows = await refreshWarmPoolStorageMeasurements(config, poolRows);
      const templates = await Promise.all(rows.map((row) => serializeMachineTemplate(config, { ...row, region: row.region as SupportedRegion, type: 'container', defaultResources: resourceShape(row.defaultResources) }, accountId, measuredPoolRows)));
      return c.json({ templates });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machine-templates', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const input = createMachineTemplateSchema.parse(await c.req.json());
      const created = await createPreparedMachineTemplate(config, input, accountId);
      const template = await serializeMachineTemplate(config, { ...created.row, region: created.row.region as SupportedRegion, type: 'container', defaultResources: resourceShape(created.row.defaultResources), image: created.image }, accountId);
      return c.json({ template }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machine-templates/:id', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const accountId = c.req.header('x-account-id') || 'system';
      const template = await resolveMachineTemplate(config, accountId, c.req.param('id'));
      if (!template) return c.json({ error: true, message: 'Machine Template not found' }, 404);
      const poolRows = config.databaseConfigured ? await refreshWarmPoolStorageMeasurements(config, await getPrisma().machine.findMany({ where: { status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } })) : [];
      return c.json({ template: await serializeMachineTemplate(config, template, accountId, poolRows) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/machine-templates/:id', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const template = await resolveMachineTemplate(config, accountId, c.req.param('id'));
      if (!template || template.virtual) return c.json({ error: true, message: 'Machine Template not found' }, 404);
      if (template.accountId !== accountId && template.accountId !== 'system') return c.json({ error: true, message: 'Machine Template not found' }, 404);
      const patch = patchMachineTemplateSchema.parse(await c.req.json());
      if (patch.default_resources && !resourcesEqual(patch.default_resources, template.defaultResources)) {
        const policies = await poolPoliciesForTemplate(config, template, accountId);
        if (policies.all.some((policy) => policy.target > 0)) return c.json({ error: true, message: 'Drain/delete all Template Pools before changing default size' }, 409);
      }
      const row = await getPrisma().machineTemplate.update({
        where: { id: template.id },
        data: {
          ...(patch.name ? { name: patch.name } : {}),
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.visibility ? { visibility: patch.visibility } : {}),
          ...(patch.default_resources ? { defaultResources: patch.default_resources } : {}),
          ...(patch.metadata ? { metadata: { ...jsonRecord(template.metadata), ...patch.metadata } as Prisma.InputJsonValue } : {}),
        },
      });
      return c.json({ template: await serializeMachineTemplate(config, { ...row, region: row.region as SupportedRegion, type: 'container', defaultResources: resourceShape(row.defaultResources) }, accountId) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/machine-templates/:id', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const template = await resolveMachineTemplate(config, accountId, c.req.param('id'));
      if (!template || template.virtual) return c.json({ error: true, message: 'Machine Template not found' }, 404);
      const policies = await poolPoliciesForTemplate(config, template, accountId);
      for (const policy of policies.all) {
        if (policy.status !== 'deleted') await drainWarmPoolPolicy(config, policy).catch(() => undefined);
        await getPrisma().warmPoolPolicy.update({ where: { id: policy.id }, data: { status: 'deleted', target: 0 } }).catch(() => undefined);
      }
      const row = await getPrisma().machineTemplate.update({ where: { id: template.id }, data: { status: 'deleted', metadata: { ...jsonRecord(template.metadata), deleted_at: new Date().toISOString() } as Prisma.InputJsonValue } });
      return c.json({ template: row });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machine-templates/:id/pool', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const accountId = c.req.header('x-account-id') || 'system';
      const template = await resolveMachineTemplate(config, accountId, c.req.param('id'));
      if (!template) return c.json({ error: true, message: 'Machine Template not found' }, 404);
      const policies = await poolPoliciesForTemplate(config, template, accountId);
      const poolRows = config.databaseConfigured ? await refreshWarmPoolStorageMeasurements(config, await getPrisma().machine.findMany({ where: { accountId, status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } })) : [];
      const stopped = policies.stopped ? serializeWarmPoolPolicy(policies.stopped, poolRows) : null;
      const running = policies.running ? serializeWarmPoolPolicy(policies.running, poolRows) : null;
      return c.json({ pool: stopped ?? running, pools: { stopped, running } });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.put('/machine-templates/:id/pool', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const template = await resolveMachineTemplate(config, accountId, c.req.param('id'));
      if (!template) return c.json({ error: true, message: 'Machine Template not found' }, 404);
      const input = templatePoolConfigSchema.parse(await c.req.json());
      const mode = normalizeWarmPoolMode(input.mode);
      const modeKey = warmPoolModeKey(mode);
      const existing = await poolPolicyForTemplate(config, template, accountId, mode);
      const metadata = { template_id: template.id, template_slug: template.slug, pool_mode: modeKey, billing: warmPoolEstimate(template.defaultResources, input.target, [], mode) } as Prisma.InputJsonValue;
      const policy = existing
        ? await getPrisma().warmPoolPolicy.update({
          where: { id: existing.id },
          data: { name: `${template.name} ${modeKey === 'running' ? 'Running Hot' : 'Stopped'} Pool`, status: input.status ?? existing.status, target: input.target, billingMode: mode, resources: template.defaultResources, metadata },
        })
        : await getPrisma().warmPoolPolicy.create({
          data: {
            accountId,
            name: `${template.name} ${modeKey === 'running' ? 'Running Hot' : 'Stopped'} Pool`,
            status: input.status ?? 'active',
            region: template.region,
            type: template.type,
            sourceType: 'image',
            sourceId: template.incusAlias,
            target: input.target,
            resources: template.defaultResources,
            billingMode: mode,
            metadata,
          },
        });
      if (policy.status === 'active' && policy.target > 0) void ensureWarmPoolForSpec(config, warmPoolSpecFromPolicy(policy)).catch((error) => console.warn(`[v2-api] template pool ${policy.id} refill failed:`, error instanceof Error ? error.message : String(error)));
      if (policy.status !== 'active' || policy.target === 0) void drainWarmPoolPolicy(config, policy).catch((error) => console.warn(`[v2-api] template pool ${policy.id} drain failed:`, error instanceof Error ? error.message : String(error)));
      const poolRows = await refreshWarmPoolStorageMeasurements(config, await getPrisma().machine.findMany({ where: { accountId, status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } }));
      const policies = await poolPoliciesForTemplate(config, template, accountId);
      const stopped = policies.stopped ? serializeWarmPoolPolicy(policies.stopped, poolRows) : null;
      const running = policies.running ? serializeWarmPoolPolicy(policies.running, poolRows) : null;
      return c.json({ pool: serializeWarmPoolPolicy(policy, poolRows), pools: { stopped, running } });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machine-templates/:id/pool/refill', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const template = await resolveMachineTemplate(config, accountId, c.req.param('id'));
      if (!template) return c.json({ error: true, message: 'Machine Template not found' }, 404);
      const mode = normalizeWarmPoolMode(c.req.query('mode'));
      const policy = await poolPolicyForTemplate(config, template, accountId, mode);
      if (!policy) return c.json({ error: true, message: 'Template Pool is not configured' }, 404);
      const result = await ensureWarmPoolForSpec(config, warmPoolSpecFromPolicy(policy));
      return c.json(result);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/machine-templates/:id/pool', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const template = await resolveMachineTemplate(config, accountId, c.req.param('id'));
      if (!template) return c.json({ error: true, message: 'Machine Template not found' }, 404);
      const mode = normalizeWarmPoolMode(c.req.query('mode'));
      const policy = await poolPolicyForTemplate(config, template, accountId, mode);
      if (!policy) return c.json({ ok: true, noop: true });
      const disabled = await getPrisma().warmPoolPolicy.update({ where: { id: policy.id }, data: { status: 'deleted', target: 0, metadata: { ...jsonRecord(policy.metadata), deleted_at: new Date().toISOString() } as Prisma.InputJsonValue } });
      const drain = await drainWarmPoolPolicy(config, disabled);
      return c.json({ ok: true, pool: serializeWarmPoolPolicy(disabled), drain });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/warm-pool-policies', async (c) => {
    const authError = adminGuard(config, c.req.header('authorization'));
    if (authError) return c.json(authError, 401);
    if (!config.databaseConfigured) return c.json({ policies: [] });
    const accountId = c.req.header('x-account-id') || 'system';
    const [policies, poolRows] = await Promise.all([
      getPrisma().warmPoolPolicy.findMany({ where: { accountId, status: { not: 'deleted' } }, orderBy: { updatedAt: 'desc' } }),
      getPrisma().machine.findMany({ where: { accountId, status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } }),
    ]);
    const measuredPoolRows = await refreshWarmPoolStorageMeasurements(config, poolRows);
    return c.json({ policies: policies.map((policy) => serializeWarmPoolPolicy(policy, measuredPoolRows)) });
  });

  app.post('/warm-pool-policies', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const input = warmPoolPolicySchema.parse(await c.req.json());
      const validated = await validateWarmPoolPolicyInput(config, input, accountId);
      if ('error' in validated) return c.json(validated.error.body, validated.error.status as never);
      const source = validated.source;
      const mode = normalizeWarmPoolMode(input.mode ?? input.billing_mode);
      const policy = await getPrisma().warmPoolPolicy.create({
        data: {
          accountId,
          name: input.name ?? `Warm ${input.type} pool`,
          status: 'active',
          region: input.region,
          type: input.type,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          target: input.target,
          resources: input.resources,
          billingMode: mode,
          metadata: { ...(input.metadata ?? {}), billing: warmPoolEstimate(input.resources, input.target, [], mode) } as Prisma.InputJsonValue,
        },
      });
      void ensureWarmPoolForSpec(config, warmPoolSpecFromPolicy(policy)).catch((error) => console.warn(`[v2-api] warm pool policy ${policy.id} initial refill failed:`, error instanceof Error ? error.message : String(error)));
      return c.json({ policy: serializeWarmPoolPolicy(policy) }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/warm-pool-policies/:id', async (c) => {
    const authError = adminGuard(config, c.req.header('authorization'));
    if (authError) return c.json(authError, 401);
    if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
    const accountId = c.req.header('x-account-id') || 'system';
    const policy = await getPrisma().warmPoolPolicy.findFirst({ where: { id: c.req.param('id'), accountId, status: { not: 'deleted' } } });
    if (!policy) return c.json({ error: true, message: 'Warm pool policy not found' }, 404);
    const poolRows = await refreshWarmPoolStorageMeasurements(config, await getPrisma().machine.findMany({ where: { accountId, status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } }));
    return c.json({ policy: serializeWarmPoolPolicy(policy, poolRows) });
  });

  app.patch('/warm-pool-policies/:id', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const existing = await getPrisma().warmPoolPolicy.findFirst({ where: { id: c.req.param('id'), accountId, status: { not: 'deleted' } } });
      if (!existing) return c.json({ error: true, message: 'Warm pool policy not found' }, 404);
      const patch = patchWarmPoolPolicySchema.parse(await c.req.json());
      if (existing.type !== 'container' && !patch.type) {
        return c.json({ error: true, message: 'VM pools are disabled; delete this policy or update it to container' }, 400);
      }
      if (existing.sourceType !== 'image' && !patch.source) {
        return c.json({ error: true, message: 'Snapshot-backed pools are disabled; delete this policy or update it to an image source' }, 400);
      }
      const existingSource = { type: 'image' as const, image_id: existing.sourceId };
      const mergedInput: WarmPoolPolicyInput = {
        name: patch.name ?? existing.name,
        region: patch.region ?? existing.region as SupportedRegion,
        type: patch.type ?? 'container',
        mode: patch.mode ?? patch.billing_mode ?? normalizeWarmPoolMode(existing.billingMode),
        billing_mode: patch.billing_mode ?? patch.mode ?? normalizeWarmPoolMode(existing.billingMode),
        resources: patch.resources ?? machineResourceKey(existing.resources),
        source: patch.source ?? existingSource,
        target: patch.target ?? existing.target,
        metadata: patch.metadata ?? jsonRecord(existing.metadata),
      };
      const validated = await validateWarmPoolPolicyInput(config, mergedInput, accountId);
      if ('error' in validated) return c.json(validated.error.body, validated.error.status as never);
      const source = validated.source;
      const nextMode = normalizeWarmPoolMode(mergedInput.mode ?? mergedInput.billing_mode);
      const existingResources = machineResourceKey(existing.resources);
      const stalePoolDefinition = existing.region !== mergedInput.region
        || existing.type !== mergedInput.type
        || existing.sourceType !== source.sourceType
        || existing.sourceId !== source.sourceId
        || !resourcesEqual(existingResources, mergedInput.resources)
        || normalizeWarmPoolMode(existing.billingMode) !== nextMode;
      if (stalePoolDefinition) await drainWarmPoolPolicy(config, existing).catch((error) => console.warn(`[v2-api] warm pool policy ${existing.id} stale-row drain failed:`, error instanceof Error ? error.message : String(error)));
      const updated = await getPrisma().warmPoolPolicy.update({
        where: { id: existing.id },
        data: {
          name: mergedInput.name ?? existing.name,
          status: patch.status ?? existing.status,
          region: mergedInput.region,
          type: mergedInput.type,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          target: mergedInput.target,
          resources: mergedInput.resources,
          billingMode: nextMode,
          metadata: { ...jsonRecord(mergedInput.metadata), billing: warmPoolEstimate(mergedInput.resources, mergedInput.target, [], nextMode) } as Prisma.InputJsonValue,
        },
      });
      if (updated.status === 'active' && updated.target > 0) {
        if (!stalePoolDefinition) {
          await drainWarmPoolPolicySurplus(config, updated).catch((error) => console.warn(`[v2-api] warm pool policy ${updated.id} surplus drain failed:`, error instanceof Error ? error.message : String(error)));
        }
        await ensureWarmPoolForSpec(config, warmPoolSpecFromPolicy(updated));
      }
      if (updated.status === 'paused' || updated.target === 0) {
        await drainWarmPoolPolicy(config, updated);
      }
      const poolRows = await refreshWarmPoolStorageMeasurements(config, await getPrisma().machine.findMany({ where: { accountId, status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } }));
      return c.json({ policy: serializeWarmPoolPolicy(updated, poolRows) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/warm-pool-policies/:id/refill', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const policy = await getPrisma().warmPoolPolicy.findFirst({ where: { id: c.req.param('id'), accountId, status: { not: 'deleted' } } });
      if (!policy) return c.json({ error: true, message: 'Warm pool policy not found' }, 404);
      const result = await ensureWarmPoolForSpec(config, warmPoolSpecFromPolicy(policy));
      const rows = await getPrisma().machine.findMany({ where: { accountId, status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } } });
      await refreshWarmPoolStorageMeasurements(config, rows);
      return c.json(result);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/warm-pool-policies/:id', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const accountId = c.req.header('x-account-id') || 'system';
      const existing = await getPrisma().warmPoolPolicy.findFirst({ where: { id: c.req.param('id'), accountId, status: { not: 'deleted' } } });
      if (!existing) return c.json({ error: true, message: 'Warm pool policy not found' }, 404);
      const disabled = await getPrisma().warmPoolPolicy.update({ where: { id: existing.id }, data: { status: 'deleted', target: 0, metadata: { ...jsonRecord(existing.metadata), deleted_at: new Date().toISOString() } as Prisma.InputJsonValue } });
      const drained = await drainWarmPoolPolicy(config, disabled);
      const policy = await getPrisma().warmPoolPolicy.update({ where: { id: existing.id }, data: { metadata: { ...jsonRecord(disabled.metadata), drain: drained } as Prisma.InputJsonValue } });
      return c.json({ policy: serializeWarmPoolPolicy(policy), drain: drained });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/admin/warm-pool', async (c) => {
    const authError = adminGuard(config, c.req.header('authorization'));
    if (authError) return c.json(authError, 401);
    if (!config.databaseConfigured) return c.json({ enabled: warmPoolMaintainerEnabled(), target: warmPoolTarget(), machines: [], groups: [] });
    const [rows, policies] = await Promise.all([
      getPrisma().machine.findMany({
        where: { status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } },
        orderBy: [{ accountId: 'asc' }, { region: 'asc' }, { type: 'asc' }, { sourceId: 'asc' }, { updatedAt: 'asc' }],
      }),
      getPrisma().warmPoolPolicy.findMany({ where: { status: { not: 'deleted' } }, orderBy: { updatedAt: 'desc' } }),
    ]);
    const measuredRows = await refreshWarmPoolStorageMeasurements(config, rows);
    const groups = new Map<string, { key: string; account_id: string; policy_id: string | null; ready: number; claiming: number; total: number; machines: string[] }>();
    for (const row of measuredRows) {
      const resources = machineResourceKey(row.resources);
      const poolMeta = jsonRecord(jsonRecord(row.metadata).warm_pool);
      const policyId = typeof poolMeta.policy_id === 'string' ? poolMeta.policy_id : null;
      const key = warmPoolKey({ region: row.region, type: row.type, sourceType: row.sourceType, sourceId: row.sourceId ?? 'unknown', resources });
      const groupKey = `${row.accountId}:${policyId ?? 'legacy'}:${key}`;
      const group = groups.get(groupKey) ?? { key, account_id: row.accountId, policy_id: policyId, ready: 0, claiming: 0, total: 0, machines: [] };
      group.total += 1;
      if (row.status === WARM_POOL_STATUS) group.ready += 1;
      if (row.status === WARM_POOL_CLAIMING_STATUS) group.claiming += 1;
      group.machines.push(row.id);
      groups.set(groupKey, group);
    }
    return c.json({
      enabled: warmPoolMaintainerEnabled(),
      legacy_target: warmPoolTarget(),
      policies: policies.map((policy) => serializeWarmPoolPolicy(policy, measuredRows)),
      groups: [...groups.values()],
      machines: measuredRows.map((row) => ({
        id: row.id,
        account_id: row.accountId,
        status: row.status,
        region: row.region,
        type: row.type,
        source_type: row.sourceType,
        source_id: row.sourceId,
        resources: row.resources,
        cluster_id: row.incusClusterId,
        member_name: row.incusMemberName,
        policy_id: jsonRecord(jsonRecord(row.metadata).warm_pool).policy_id ?? null,
        warm_pool: jsonRecord(jsonRecord(row.metadata).warm_pool),
        storage_usage: jsonRecord(jsonRecord(jsonRecord(row.metadata).warm_pool).storage_usage),
        usability: jsonRecord(jsonRecord(row.metadata).usability),
        managed_daemon_state: jsonRecord(row.metadata).managed_daemon_state ?? null,
        updated_at: row.updatedAt.toISOString(),
      })),
    });
  });

  app.post('/admin/warm-pool/refill', async (c) => {
    const authError = adminGuard(config, c.req.header('authorization'));
    if (authError) return c.json(authError, 401);
    if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
    return c.json(await refillWarmPool(config));
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/images',
      tags: ['Images'],
      summary: 'List image catalog',
      description: 'Aggregated across every configured Incus cluster. Each entry carries its aliases, fingerprint, type, size, and JustAVPS-tagged properties (e.g. `justavps.source=docker`).',
      responses: {
        200: { description: 'Image list', content: { 'application/json': { schema: ImageListResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const images = (await Promise.all(config.clusters.map(async (cluster) => {
          const observed = await clientFor(cluster).listImages();
          return observed.map((image) => ({
            id: image.fingerprint,
            cluster: publicCluster(cluster),
            aliases: image.aliases ?? [],
            fingerprint: image.fingerprint,
            architecture: image.architecture ?? null,
            type: image.type ?? null,
            public: image.public ?? false,
            size: image.size ?? null,
            properties: image.properties ?? {},
            uploaded_at: image.uploaded_at ?? null,
          }));
        }))).flat();
        return c.json({ images });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/machines',
      tags: ['Machines'],
      summary: 'List machines',
      description: 'Live observation across every configured Incus cluster. Each entry pairs the Prisma identifier (when present) with the raw Incus instance for debugging.',
      responses: {
        200: { description: 'Machine list', content: { 'application/json': { schema: MachineListResponseSchema } } },
        500: { description: 'Server error', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const statusFilters = String(c.req.query('status') ?? '')
          .split(',')
          .map((value: string) => value.trim().toLowerCase())
          .filter(Boolean);
        const includePool = ['1', 'true', 'yes', 'on'].includes((c.req.query('include_pool') ?? '').toLowerCase())
          || statusFilters.some((status) => status === 'pool' || isWarmPoolStatus(status));
        const typeFilter = c.req.query('type')?.trim().toLowerCase() || null;
        const searchFilter = c.req.query('q')?.trim().toLowerCase() || null;
        const machines: Array<any> = (await Promise.all(config.clusters.map(async (cluster) => {
          const client = clientFor(cluster);
          const observed = await client.listInstances();
          const normalizedObserved = await Promise.all(observed.map(async (instance) => {
            const currentId = instance.config?.['user.justavps.machine_id'] ?? null;
            if (currentId && !isMachineUuid(currentId)) {
              const adopted = await adoptLegacyObservedMachine(config, cluster, client, instance);
              if (adopted) {
                return {
                  ...instance,
                  config: {
                    ...(instance.config ?? {}),
                    'user.justavps.machine_id': adopted.id,
                    'user.justavps.machine_name': adopted.machine?.name ?? instance.config?.['user.justavps.machine_name'] ?? currentId,
                    'user.justavps.display_name': adopted.machine?.name ?? instance.config?.['user.justavps.display_name'] ?? currentId,
                  },
                };
              }
            }
            return instance;
          }));
          const productIds = normalizedObserved
            .map((instance) => instance.config?.['user.justavps.machine_id'] ?? null)
            .filter((id): id is string => isMachineUuid(id));
          const productRows = config.databaseConfigured && productIds.length
            ? await getPrisma().machine.findMany({ where: { id: { in: productIds } } })
            : [];
          const hiddenProductIds = new Set(includePool ? [] : productRows.filter((machine) => isWarmPoolInventoryRow(machine)).map((machine) => machine.id));
          const productById = new Map(productRows.filter((machine) => includePool || !isWarmPoolInventoryRow(machine)).map((machine) => [machine.id, machine]));
          return normalizedObserved.flatMap((instance) => {
            const id = instance.config?.['user.justavps.machine_id'] ?? null;
            if (!isMachineUuid(id)) return [];
            if (hiddenProductIds.has(id)) return [];
            const productMachine = productById.get(id);
            if (!productMachine) {
              const serializedObserved = serializeObservedMachine(config, cluster, instance);
              return serializedObserved ? [serializedObserved] : [];
            }
            const serialized = serializeMachine(config, productMachine, instance) ?? serializeObservedMachine(config, cluster, instance);
            if (!serialized) return [];
            return [{
              ...serialized,
              status: isWarmPoolInventoryRow(productMachine) ? (isWarmPoolStatus(productMachine.status) ? productMachine.status : WARM_POOL_STATUS) : serialized.status,
              cluster: publicCluster(cluster),
              location: instance.location ?? null,
            }];
          });
        }))).flat();
        if (includePool && config.databaseConfigured) {
          const existingIds = new Set(machines.map((machine) => machine.id));
          const poolRows = await getPrisma().machine.findMany({
            where: { status: { in: [WARM_POOL_STATUS, WARM_POOL_CLAIMING_STATUS] } },
            orderBy: [{ updatedAt: 'asc' }],
          });
          for (const row of poolRows) {
            if (existingIds.has(row.id)) continue;
            const serialized = serializeMachine(config, row);
            if (!serialized) continue;
            machines.push(serialized);
            existingIds.add(row.id);
          }
        }
        const filtered = machines.filter((machine) => {
          const status = machine.status?.toLowerCase() ?? '';
          if (statusFilters.length && !statusFilters.some((filter) => (filter === 'pool' ? isWarmPoolStatus(status) : status === filter))) return false;
          if (typeFilter && machine.type?.toLowerCase() !== typeFilter) return false;
          if (searchFilter) {
            const haystack = [
              machine.id,
              machine.name,
              machine.type,
              machine.status,
              machine.region,
              machine.location,
              machine.incus?.cluster_id,
              machine.incus?.member_name,
              machine.incus?.instance_name,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(searchFilter)) return false;
          }
          return true;
        });
        return c.json({ machines: filtered });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/machines/{id}',
      tags: ['Machines'],
      summary: 'Get a single machine',
      request: { params: MachineParamsSchema },
      responses: {
        200: { description: 'Machine detail', content: { 'application/json': { schema: MachineEnvelopeSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const incus = await resolved.client.getInstance(resolved.machine.incusInstanceName);
        return c.json({ machine: serializeMachine(config, resolved.machine, incus) });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.get('/machines/:id/backup-policy', async (c) => {
    try {
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      if (!config.databaseConfigured) return c.json({ policy: serializeBackupPolicy(null, resolved.machine) });
      const policy = await loadBackupPolicy(resolved.machine);
      return c.json({ policy: serializeBackupPolicy(policy, resolved.machine) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.patch('/machines/:id/backup-policy', async (c) => {
    try {
      const input = patchBackupPolicySchema.parse(await c.req.json());
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const policy = await upsertBackupPolicy(resolved.machine, input.enabled);
      return c.json({ policy: serializeBackupPolicy(policy, resolved.machine) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/machines/{id}/daemon/ensure',
      tags: ['Sandbox'],
      summary: 'Install or repair the managed guest daemon',
      description: 'Idempotently installs, enables, starts, and health-checks justavps-daemon inside the machine. This is the real guest-local port/toolbox path; Incus exec remains only a fallback.',
      request: {
        params: MachineParamsSchema,
        body: { required: false, content: { 'application/json': { schema: ensureDaemonBodySchema } } },
      },
      responses: {
        200: { description: 'Daemon ensured or failure captured', content: { 'application/json': { schema: ensureDaemonResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const authError = adminGuard(config, c.req.header('authorization'));
        if (authError) return c.json(authError, 401);
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const input = c.req.header('content-type')?.includes('application/json')
          ? ensureDaemonBodySchema.parse(await c.req.json().catch(() => undefined))
          : undefined;
        const ensured = await ensureResolvedManagedDaemon(config, resolved, { verifyPort: typeof input?.verify_port === 'number' ? input.verify_port : null });
        return c.json({ ok: ensured.daemon.ok, daemon: ensured.daemon, machine: serializeMachine(config, ensured.machine) });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/proxy-tokens',
      tags: ['Proxy Tokens'],
      summary: 'List active proxy tokens',
      description: 'Returns non-revoked, non-expired V2 API proxy tokens. Optionally filter by machine_id.',
      request: { query: proxyTokenQuerySchema },
      responses: {
        200: { description: 'Active proxy tokens', content: { 'application/json': { schema: proxyTokenListResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const authError = adminGuard(config, c.req.header('authorization'));
        if (authError) return c.json(authError, 401);
        if (!config.databaseConfigured) return c.json({ proxy_tokens: [] });

        const machineId = c.req.query('machine_id')?.trim();
        const machines = machineId
          ? await getPrisma().machine.findMany({ where: { id: machineId } })
          : await getPrisma().machine.findMany({ where: customerVisibleMachineWhere() });

        const proxyTokens = machines
          .flatMap((machine) => activeProxyTokenDescriptors(machine))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map((token) => publicProxyToken(token));
        return c.json({ proxy_tokens: proxyTokens });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/proxy-tokens',
      tags: ['Proxy Tokens'],
      summary: 'Create a proxy token',
      description: 'Creates a short-lived V2 API proxy token for sharing HTTP access to a machine. The full token/share URL is returned once.',
      request: { body: { required: true, content: { 'application/json': { schema: createProxyTokenSchema } } } },
      responses: {
        201: { description: 'Created proxy token', content: { 'application/json': { schema: proxyTokenPublicSchema } } },
        400: { description: 'Bad request', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Machine not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        502: { description: 'Proxy route preparation failed', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const authError = adminGuard(config, c.req.header('authorization'));
        if (authError) return c.json(authError, 401);
        if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);

        const input = createProxyTokenSchema.parse(await c.req.json());
        const resolved = await machineClient(config, input.machine_id);
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);

        const observed = await resolved.client.getInstance(resolved.machine.incusInstanceName).catch(() => null);
        const machineSync = await syncResolvedMachineProxy(config, resolved, observed).catch((error) => ({
          synced: false as const,
          reason: error instanceof Error ? error.message : String(error),
        }));
        if (!machineSync.synced) {
          return c.json({ error: true, message: `Failed to prepare machine proxy routing: ${machineSync.reason ?? 'not synced'}` }, 502);
        }

        const expiresInSeconds = input.expires_in_seconds ?? 3600;
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        const ports = normalizeProxyPorts(input.ports);
        const { token, sha256, prefix } = generateProxyToken();
        const descriptor: ProxyTokenDescriptor = {
          id: randomUUID(),
          token_sha256: sha256,
          token_prefix: prefix,
          label: input.label?.trim() || null,
          machine_id: resolved.machine.id,
          machine_slug: machineProxySlug(resolved.machine.id),
          ports,
          expires_at: expiresAt,
          revoked_at: null,
          created_at: new Date().toISOString(),
        };

        const previousMeta = jsonRecord(resolved.machine.metadata);
        const nextTokens = [...proxyTokenDescriptors(resolved.machine), descriptor];
        await getPrisma().machine.update({
          where: { id: resolved.machine.id },
          data: {
            metadata: {
              ...previousMeta,
              proxy_tokens: nextTokens,
              proxy_sync: machineSync,
              last_proxy_token_sync: { synced: true, mode: 'v2-api-direct', at: new Date().toISOString() },
            } as Prisma.InputJsonValue,
          },
        });

        return c.json(publicProxyToken(descriptor, {
          rawToken: token,
          proxyUrl: proxyUrlForToken(config, descriptor, token),
        }), 201);
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/proxy-tokens/{id}',
      tags: ['Proxy Tokens'],
      summary: 'Revoke a proxy token',
      description: 'Revokes a V2 API proxy token.',
      request: { params: proxyTokenParamsSchema },
      responses: {
        204: { description: 'Proxy token revoked' },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Proxy token not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const authError = adminGuard(config, c.req.header('authorization'));
        if (authError) return c.json(authError, 401);
        if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);

        const tokenId = c.req.param('id');
        const machines = await getPrisma().machine.findMany();
        const owner = machines.map((machine) => ({ machine, tokens: proxyTokenDescriptors(machine) }))
          .find((entry) => entry.tokens.some((token) => token.id === tokenId));
        if (!owner) return c.json({ error: true, message: 'Proxy token not found' }, 404);

        const revokedAt = new Date().toISOString();
        const nextTokens = owner.tokens.map((item) => item.id === tokenId ? { ...item, revoked_at: revokedAt } : item);
        await getPrisma().machine.update({
          where: { id: owner.machine.id },
          data: { metadata: { ...jsonRecord(owner.machine.metadata), proxy_tokens: nextTokens, last_proxy_token_delete: { synced: true, mode: 'v2-api-direct', at: revokedAt } } as Prisma.InputJsonValue },
        });
        return c.body(null, 204);
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/ssh-tokens',
      tags: ['SSH'],
      summary: 'List active SSH gateway tokens',
      request: { query: proxyTokenQuerySchema },
      responses: {
        200: { description: 'Active SSH tokens', content: { 'application/json': { schema: sshTokenListResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const authError = adminGuard(config, c.req.header('authorization'));
        if (authError) return c.json(authError, 401);
        if (!config.sshGatewayEnabled) return c.json({ error: true, message: 'SSH gateway feature is disabled' }, 404);
        if (!config.databaseConfigured) return c.json({ ssh_tokens: [] });
        const machineId = c.req.query('machine_id')?.trim();
        const machines = machineId
          ? await getPrisma().machine.findMany({ where: { id: machineId } })
          : await getPrisma().machine.findMany({ where: customerVisibleMachineWhere() });
        const tokens = machines.flatMap((machine) => activeSshTokenDescriptors(machine))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map((token) => publicSshToken(config, token));
        return c.json({ ssh_tokens: tokens });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/ssh-tokens',
      tags: ['SSH'],
      summary: 'Create an SSH gateway token',
      description: 'Installs/repairs guest sshd for gateway access, stores a short-lived token, and returns an ssh command/config snippet. The SSH gateway uses the token as the SSH username.',
      request: { body: { required: true, content: { 'application/json': { schema: createSshTokenSchema } } } },
      responses: {
        201: { description: 'Created SSH token', content: { 'application/json': { schema: sshTokenPublicSchema } } },
        400: { description: 'Bad request', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Machine not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        409: { description: 'SSH gateway not configured', content: { 'application/json': { schema: ErrorResponseSchema } } },
        502: { description: 'Guest SSH setup failed', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const authError = adminGuard(config, c.req.header('authorization'));
        if (authError) return c.json(authError, 401);
        if (!config.sshGatewayEnabled) return c.json({ error: true, message: 'SSH gateway feature is disabled' }, 404);
        if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
        if (!config.sshGatewayPublicKey) return c.json({ error: true, message: 'V2_SSH_GATEWAY_PUBLIC_KEY is not configured' }, 409);

        const input = createSshTokenSchema.parse(await c.req.json());
        const resolved = await machineClient(config, input.machine_id);
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);

        const sshAccess = await ensureGuestSshAccess({ config, client: resolved.client, instanceName: resolved.machine.incusInstanceName });
        if (!sshAccess.ok || !sshAccess.target_host) {
          const metadata = mergeSshMetadata(resolved.machine.metadata, sshAccess);
          await getPrisma().machine.update({ where: { id: resolved.machine.id }, data: { metadata } }).catch(() => undefined);
          return c.json({ error: true, message: sshAccess.error ?? 'Guest SSH setup failed' }, 502);
        }

        const expiresInSeconds = input.expires_in_seconds ?? 3600;
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        const { token, sha256, prefix } = generateProxyToken();
        const sshToken = `st_${token.slice(3)}`;
        const descriptor: SshTokenDescriptor = {
          id: randomUUID(),
          token_sha256: sha256Hex(sshToken),
          token_prefix: `${sshToken.slice(0, 10)}…`,
          label: input.label?.trim() || null,
          machine_id: resolved.machine.id,
          expires_at: expiresAt,
          revoked_at: null,
          target_host: sshAccess.target_host,
          target_port: sshAccess.target_port,
          ssh_user: sshAccess.user,
          created_at: new Date().toISOString(),
        };

        const latest = await getPrisma().machine.findUnique({ where: { id: resolved.machine.id } }) ?? resolved.machine;
        const nextMeta = {
          ...jsonRecord(latest.metadata),
          ssh_access: sshAccess,
          ssh_tokens: [...sshTokenDescriptors(latest), descriptor],
        };
        await getPrisma().machine.update({ where: { id: resolved.machine.id }, data: { metadata: nextMeta as Prisma.InputJsonValue } });
        void sha256; void prefix;
        return c.json(publicSshToken(config, descriptor, sshToken), 201);
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/internal/ssh/validate',
      tags: ['SSH'],
      summary: 'Validate SSH gateway token',
      description: 'Called by the SSH gateway. Requires V2 admin/gateway bearer auth.',
      request: { query: z.object({ token: z.string().min(1) }) },
      responses: {
        200: { description: 'Validation result', content: { 'application/json': { schema: sshValidateResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const authError = adminGuard(config, c.req.header('authorization'));
        if (authError) return c.json(authError, 401);
        if (!config.sshGatewayEnabled) return c.json({ valid: false });
        const rawToken = c.req.query('token')?.trim();
        if (!rawToken) return c.json({ valid: false });
        const found = await findActiveSshToken(config, rawToken);
        if (!found) return c.json({ valid: false });

        // Refresh target IP if possible; VM/container addresses can change after restart.
        const resolved = await machineClient(config, found.machine.id);
        let targetHost = found.token.target_host ?? null;
        if (resolved) {
          const state = await resolved.client.getInstanceState(resolved.machine.incusInstanceName).catch(() => null);
          const freshHost = state?.network ? Object.values(state.network).flatMap((net) => net.addresses ?? []).find((addr) => addr.family === 'inet' && addr.address && addr.scope !== 'link' && !addr.address.startsWith('127.'))?.address : null;
          if (freshHost) targetHost = freshHost;
        }

        return c.json({
          valid: Boolean(targetHost),
          machine_id: found.machine.id,
          target_host: targetHost,
          target_port: found.token.target_port ?? 22,
          ssh_user: found.token.ssh_user ?? 'user',
          expires_at: found.token.expires_at,
        });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/machines',
      tags: ['Machines'],
      summary: 'Create a machine',
      description: 'Creates and starts a container or VM. Incus hostname/id is always a generated UUID; optional `name` is only a display/search label. `source` selects the rootfs: an image alias, a snapshot of an existing machine, or an Incus tarball backup.',
      request: { body: { required: true, content: { 'application/json': { schema: CreateMachineBodySchema } } } },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: MachineEnvelopeSchema } } },
        400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Source not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        409: { description: 'No cluster / member available, or source mismatch', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
    const telemetryId = c.req.header('x-justavps-request-id')?.trim() || randomUUID();
    const telemetry = startMachineCreationTelemetry(telemetryId, {
      request_id: telemetryId,
      account_id: c.req.header('x-account-id') || 'system',
      remote: c.req.header('x-forwarded-for') ?? null,
    });
    c.header('X-JustAVPS-Request-Id', telemetryId);
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) {
        failMachineCreationTelemetry(telemetry, authError.message ?? 'Unauthorized');
        return c.json(authError, 401);
      }

      const requestInput = await withTelemetrySpan(telemetry, 'parse request', async () => createMachineSchema.parse(await c.req.json()));
      const accountId = c.req.header('x-account-id') || 'system';
      const poolOnlyStrategy = requestInput.start_strategy === 'stopped_pool' || requestInput.start_strategy === 'running_pool';
      const template = await withTelemetrySpan(telemetry, 'resolve machine template', () => resolveMachineTemplate(config, accountId, requestInput.template_id, { hydrateImage: !poolOnlyStrategy, ensureCatalog: !poolOnlyStrategy }), { template_id: requestInput.template_id });
      if (!template) {
        failMachineCreationTelemetry(telemetry, `Machine Template ${requestInput.template_id} not found`);
        return c.json({ error: true, message: `Machine Template ${requestInput.template_id} not found` }, 404);
      }
      if (template.status !== 'active') {
        failMachineCreationTelemetry(telemetry, `Machine Template ${template.name} is not active`);
        return c.json({ error: true, message: `Machine Template ${template.name} is not active` }, 409);
      }
      const templateProps = jsonRecord(jsonRecord(template.metadata).image_properties);
      const templateReadyFromDb = imageIsJustavpsReady({ properties: templateProps } as IncusImage);
      const templateImage = template.image ?? (templateReadyFromDb ? null : await findImageForTemplate(config, template).catch(() => null));
      if (!templateReadyFromDb && !imageIsJustavpsReady(templateImage)) {
        failMachineCreationTelemetry(telemetry, `Machine Template ${template.name} is not JustAVPS-ready`);
        return c.json({ error: true, message: `Machine Template ${template.name} is not JustAVPS-ready yet` }, 409);
      }
      if (requestInput.region && requestInput.region !== template.region) {
        failMachineCreationTelemetry(telemetry, `Machine Template ${template.name} is pinned to region ${template.region}`);
        return c.json({ error: true, message: `Machine Template ${template.name} is pinned to region ${template.region}` }, 409);
      }
      const input: CreateMachineInput = {
        ...requestInput,
        region: template.region,
        resources: requestInput.resources ?? template.defaultResources,
        source: { type: 'image', image_id: template.incusAlias },
        template_id: template.id,
      };
      updateMachineCreationLabels(telemetry, {
        name: input.name ?? null,
        type: input.type,
        region: input.region,
        source_type: 'template',
        source_id: template.id,
        template_id: template.id,
        template_slug: template.slug,
        template_image_alias: template.incusAlias,
        start_strategy: input.start_strategy,
        vcpu: input.resources.vcpu,
        memory_gb: input.resources.memory_gb,
        disk_gb: input.resources.disk_gb,
      });

      const warmSpec = warmPoolSpecFromCreate(input);
      if (warmSpec && config.databaseConfigured && input.start_strategy !== 'cold') {
        const warmDisplayName = displayMachineName(input.name, generatedMachineId());
        const claimed = await withTelemetrySpan(telemetry, 'claim warm pool machine', () => claimWarmPoolMachine(config, warmSpec, input, warmDisplayName, accountId, input.start_strategy, telemetry), { source_key: warmSpec.key, start_strategy: input.start_strategy });
        if (claimed) {
          updateMachineCreationLabels(telemetry, { cluster_id: claimed.cluster.id, member_name: claimed.observed?.location ?? claimed.machine.incusMemberName ?? null, warm_pool_hit: true, warm_pool_resized_on_claim: claimed.resizedOnClaim, warm_pool_running_takeover: claimed.runningTakeover });
          let proxySync: Record<string, unknown> | null = null;
          let daemonEnsure: Record<string, unknown> | null = null;
          proxySync = await withTelemetrySpan(telemetry, 'sync proxy routes', () => syncResolvedMachineProxy(config, { machine: claimed.machine, cluster: claimed.cluster, client: claimed.client }, claimed.observed)).catch((error) => ({
            synced: false,
            reason: error instanceof Error ? error.message : String(error),
          }));
          const claimedDaemon = jsonRecord(claimed.machine.metadata).managed_daemon;
          daemonEnsure = claimedDaemon && typeof claimedDaemon === 'object' && !Array.isArray(claimedDaemon) ? claimedDaemon as Record<string, unknown> : null;
          const finalTelemetry = completeMachineCreationTelemetry(telemetry);
          await getPrisma().machine.update({
            where: { id: claimed.machine.id },
            data: { metadata: { ...jsonRecord(claimed.machine.metadata), proxy_sync: proxySync, managed_daemon: daemonEnsure, managed_daemon_state: 'ready', creation_telemetry: finalTelemetry } as Prisma.InputJsonValue },
          }).catch(() => undefined);
          const finalMachine = await getPrisma().machine.findUnique({ where: { id: claimed.machine.id } }) ?? claimed.machine;
          await recordResolvedMachineBillingObservation(config, { machine: finalMachine, cluster: claimed.cluster }, claimed.observed, 'machine_create_warm_pool_claim');
          void ensureWarmPoolForSpec(config, claimed.refillSpec).catch((error) => console.warn('[v2-api] async warm pool refill after claim failed:', error instanceof Error ? error.message : String(error)));
          return c.json({ machine: serializeMachine(config, finalMachine, claimed.observed) }, 201);
        }
        updateMachineCreationLabels(telemetry, { warm_pool_hit: false });
        if (input.start_strategy === 'running_pool' || input.start_strategy === 'stopped_pool') {
          const label = input.start_strategy === 'running_pool' ? 'Running Hot Pool' : 'Stopped Pool';
          failMachineCreationTelemetry(telemetry, `${label} slot unavailable for Machine Template ${template.name}`);
          return c.json({ error: true, message: `${label} slot unavailable for Machine Template ${template.name}. Use start_strategy=auto or cold to allow fallback.` }, 409);
        }
      }

      const placement = await withTelemetrySpan(telemetry, 'select placement', () => selectPlacement(config, {
        region: input.region,
        resources: input.resources,
        targetClusterId: input.target_cluster_id ?? null,
        preferredClusterId: template.incusClusterId,
      }));
      const { cluster, client, member } = placement;
      updateMachineCreationLabels(telemetry, { cluster_id: cluster.id, member_name: member.server_name });

      const resolvedSource = await withTelemetrySpan(telemetry, 'resolve source image/snapshot', () => resolveCreateInstanceSource(config, input, cluster));
      if ('error' in resolvedSource) {
        failMachineCreationTelemetry(telemetry, resolvedSource.error.body.message ?? 'Source resolution failed');
        return c.json(resolvedSource.error.body, resolvedSource.error.status as never);
      }
      const sourceJustavpsReady = resolvedSource.justavpsReady === true;
      updateMachineCreationLabels(telemetry, {
        source_justavps_ready: sourceJustavpsReady,
        source_image_aliases: resolvedSource.image?.aliases?.map((alias) => alias.name).join(',') ?? null,
      });

      const machineId = generatedMachineId();
      const displayName = displayMachineName(input.name, machineId);
      const incusName = machineId;
      const operation = await withTelemetrySpan(telemetry, 'create Incus instance', () => client.createInstance({
        name: incusName,
        machineType: input.type,
        source: resolvedSource.source,
        targetMember: member.server_name,
        resources: {
          vcpu: input.resources.vcpu,
          memoryGb: input.resources.memory_gb,
          diskGb: input.resources.disk_gb,
        },
        start: input.type === 'container',
        machineId,
        displayName,
        accountId: c.req.header('x-account-id') || 'system',
        platformDaemon: platformDaemonMount(config),
      }), { instance: incusName, member: member.server_name, source: input.source.type });

      let observed: IncusInstance | null = null;
      let startOperation: IncusOperation | Record<string, unknown> | null = operation;
      let startNoop = false;
      let resourceOperation: Record<string, unknown> | null = null;
      let isolationCheck: ReturnType<typeof validateMachineIsolation> | null = null;
      let usability: Awaited<ReturnType<typeof ensureMachineUsable>> | null = null;
      try {
        const enforced = await withTelemetrySpan(telemetry, 'verify isolation and resource limits', () => enforceCreatedMachineResources({
          client,
          cluster,
          instanceName: incusName,
          resources: input.resources,
          machineId,
          displayName,
          machineType: input.type,
          accountId: c.req.header('x-account-id') || 'system',
        }));
        observed = enforced.observed;
        isolationCheck = enforced.isolation;
        resourceOperation = { synced: true, mode: 'post-create-resource-enforce', at: new Date().toISOString(), resources: input.resources };
        const running = await withTelemetrySpan(telemetry, 'ensure machine running', () => ensureCreatedMachineRunning(client, incusName, observed));
        observed = running.observed;
        if (running.startOperation) startOperation = running.startOperation;
        startNoop = running.startNoop;
        usability = await ensureMachineUsable({
          config,
          client,
          instanceName: incusName,
          machineId,
          mode: 'cold-create',
          telemetry,
          installManagedDaemon: true,
          repairManagedDaemon: false,
          waitForCloudInit: sourceJustavpsReady ? false : undefined,
          actualLiveProbe: sourceJustavpsReady,
          managedDaemonStepName: sourceJustavpsReady ? 'activate injected managed daemon' : undefined,
          execTimeoutMs: sourceJustavpsReady ? 90_000 : 120_000,
          cloudInitTimeoutMs: sourceJustavpsReady ? 0 : 180_000,
          daemonHealthTimeoutMs: sourceJustavpsReady ? 10_000 : 60_000,
        });
      } catch (error) {
        await client.deleteInstance(incusName, { force: true }).catch(() => undefined);
        throw error;
      }

      let productMachine: PrismaMachine | null = null;
      let proxySync: Record<string, unknown> | null = null;
      let daemonEnsure: Record<string, unknown> | null = null;
      if (config.databaseConfigured) {
        productMachine = await withTelemetrySpan(telemetry, 'persist machine row', () => getPrisma().machine.create({
          data: {
            id: machineId,
            accountId: c.req.header('x-account-id') || 'system',
            name: displayName,
            region: input.region,
            type: input.type,
            status: observed?.status ?? 'Running',
            sourceType: 'template',
            sourceId: template.id,
            incusClusterId: cluster.id,
            incusProject: cluster.project,
            incusInstanceName: incusName,
            incusMemberName: member.server_name,
            resources: input.resources,
              metadata: {
                incus_operation: operation,
                start_operation: startOperation,
                start_noop: startNoop,
                resource_operation: resourceOperation,
                isolation_check: isolationCheck,
                scheduler_placement: placement.placement,
                display_name: displayName,
              incus_hostname: incusName,
              env: input.env ?? {},
              labels: input.labels ?? {},
              lifecycle: input.lifecycle ?? {},
              last_used_at: new Date().toISOString(),
              usability,
              managed_daemon: usability?.managed_daemon ?? usability?.daemon_health ?? null,
              managed_daemon_state: usability?.managed_daemon_state ?? 'ready',
              managed_daemon_checked_at: usability?.ready_at ?? new Date().toISOString(),
              creation_telemetry: telemetry,
              source_template: {
                id: template.id,
                slug: template.slug,
                name: template.name,
                image_alias: template.incusAlias,
                default_resources: template.defaultResources,
                requested_resources: input.resources,
                start_strategy: input.start_strategy,
                justavps_ready: sourceJustavpsReady,
                image_aliases: resolvedSource.image?.aliases ?? [],
                image_properties: resolvedSource.image?.properties ?? {},
              },
            } as Prisma.InputJsonValue,
          },
        }));
        proxySync = await withTelemetrySpan(telemetry, 'sync proxy routes', () => syncResolvedMachineProxy(config, { machine: productMachine!, cluster, client }, observed)).catch((error) => ({
          synced: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
        daemonEnsure = usability?.managed_daemon ?? usability?.daemon_health ?? null;
        const finalTelemetry = completeMachineCreationTelemetry(telemetry);
        await getPrisma().machine.update({
          where: { id: productMachine.id },
          data: { metadata: { ...jsonRecord(productMachine.metadata), proxy_sync: proxySync, managed_daemon: daemonEnsure, managed_daemon_state: 'ready', creation_telemetry: finalTelemetry } as Prisma.InputJsonValue },
        }).catch(() => undefined);
        productMachine = await getPrisma().machine.findUnique({ where: { id: productMachine.id } }) ?? productMachine;
        await recordResolvedMachineBillingObservation(config, { machine: productMachine, cluster }, observed, 'machine_create_cold');
      } else {
        completeMachineCreationTelemetry(telemetry);
      }

      if (warmSpec && config.databaseConfigured) {
        void activeWarmPoolPoliciesForSource(accountId, warmSpec)
          .then((policies) => Promise.all(policies.map((policy) => ensureWarmPoolForSpec(config, warmPoolSpecFromPolicy(policy)))))
          .catch((error) => console.warn('[v2-api] async warm pool refill after cold create failed:', error instanceof Error ? error.message : String(error)));
      }

      return c.json({
        machine: productMachine ? serializeMachine(config, productMachine, observed) : {
          id: machineId,
          name: displayName,
          type: input.type,
          region: input.region,
          status: observed?.status ?? 'Running',
          cluster: publicCluster(cluster),
          member: member.server_name,
          incus: { cluster_id: cluster.id, project: cluster.project, instance_name: incusName, member_name: observed?.location ?? member.server_name, observed },
          source: input.source,
          resources: input.resources,
          incus_operation: operation,
          start_operation: startOperation,
          start_noop: startNoop,
          resource_operation: resourceOperation,
          isolation_check: isolationCheck,
          scheduler_placement: placement.placement,
          proxy_sync: proxySync,
          managed_daemon: daemonEnsure,
        },
      }, 201);
    } catch (error) {
      failMachineCreationTelemetry(telemetry, error);
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
    }),
  );

  for (const action of ['start', 'stop', 'reboot'] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/machines/{id}/${action}`,
        tags: ['Machines'],
        summary: `${action[0].toUpperCase()}${action.slice(1)} a machine`,
        description: `Calls Incus state change \`${action}\`. \`noop=true\` means the machine was already in the target state.`,
        request: { params: MachineParamsSchema },
        responses: {
          200: { description: 'Lifecycle operation result', content: { 'application/json': { schema: LifecycleResponseSchema } } },
          404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        },
      }),
      oapi(async (c) => {
        try {
          const resolved = await machineClient(config, c.req.param('id'));
          if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
          if (isWarmPoolInventoryRow(resolved.machine)) return c.json(warmPoolMachineMutationError(), 409);
          let operation: Record<string, unknown>;
          let noop = false;
          try {
            operation = (action === 'start'
              ? await resolved.client.startInstance(resolved.machine.incusInstanceName)
              : action === 'stop'
                ? await resolved.client.stopInstance(resolved.machine.incusInstanceName)
                : await resolved.client.rebootInstance(resolved.machine.incusInstanceName)) as unknown as Record<string, unknown>;
          } catch (error) {
            if (!isLifecycleNoop(error, action)) throw error;
            noop = true;
            operation = { noop: true, action };
          }
          const observed = await resolved.client.getInstance(resolved.machine.incusInstanceName).catch(() => null);
          const lifecycleUsability = action === 'start'
            ? await ensureMachineUsable({
              config,
              client: resolved.client,
              instanceName: resolved.machine.incusInstanceName,
              machineId: resolved.machine.id,
              mode: 'machine-start',
              installManagedDaemon: false,
              repairManagedDaemon: true,
              waitForCloudInit: false,
              actualLiveProbe: true,
              execTimeoutMs: 90_000,
              daemonHealthTimeoutMs: 5_000,
            })
            : null;
          if (config.databaseConfigured) {
            const prevMeta = jsonRecord(resolved.machine.metadata);
            const proxySync = await syncResolvedMachineProxy(config, resolved, observed).catch((error) => ({
              synced: false,
              reason: error instanceof Error ? error.message : String(error),
            }));
            const daemonEnsure = lifecycleUsability
              ? lifecycleUsability.managed_daemon ?? prevMeta.managed_daemon ?? lifecycleUsability.daemon_health
              : undefined;
            const nextMeta: Record<string, unknown> = {
              ...prevMeta,
              last_lifecycle_operation: operation,
              last_observed_status: observed?.status ?? null,
              last_observed_at: new Date().toISOString(),
              proxy_sync: proxySync,
              ...(lifecycleUsability ? { usability: lifecycleUsability, managed_daemon: daemonEnsure, managed_daemon_state: 'ready', managed_daemon_checked_at: lifecycleUsability.ready_at } : {}),
            };
            // Bump last_used_at on start (for the auto-stop timer); set
            // stopped_at on stop (for the auto-archive / auto-delete timers).
            if (action === 'start') nextMeta.last_used_at = new Date().toISOString();
            if (action === 'stop') nextMeta.stopped_at = new Date().toISOString();
            await getPrisma().machine.update({
              where: { id: resolved.machine.id },
              data: { status: observed?.status ?? (action === 'stop' ? 'Stopped' : 'Running'), metadata: nextMeta as Prisma.InputJsonValue },
            }).catch(() => undefined);
            await recordResolvedMachineBillingObservation(config, resolved, observed, `machine_${action}`, new Date(), observed?.status ?? (action === 'stop' ? 'Stopped' : 'Running'));

            // Ephemeral semantics: stop → immediately delete. Fire-and-forget
            // so the user gets a fast 200; the actual delete races but is
            // invisible from the API surface (subsequent GETs just 404).
            const lifecycle = (prevMeta.lifecycle && typeof prevMeta.lifecycle === 'object') ? prevMeta.lifecycle as Record<string, unknown> : {};
            if (action === 'stop' && lifecycle.ephemeral === true) {
              resolved.client.deleteInstance(resolved.machine.incusInstanceName, { force: true }).then(async () => {
                await recordResolvedMachineBillingObservation(config, resolved, null, 'machine_stop_ephemeral_delete', new Date(), 'deleted');
                await getPrisma().machine.update({ where: { id: resolved.machine.id }, data: { status: 'deleted' } }).catch(() => undefined);
              }).catch(() => undefined);
            }
          }
          return c.json({ ok: true as const, noop, operation, status: observed?.status ?? null, machine: serializeMachine(config, resolved.machine, observed) });
        } catch (error) {
          const response = routeError(error);
          return c.json(response.body, response.status as never);
        }
      }),
    );
  }

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/machines/{id}',
      tags: ['Machines'],
      summary: 'Resize a machine in place',
      description: 'Hot-update vCPU + memory limits on a running instance via Incus PATCH. `disk_gb` raises the root device size cap (ZFS volume grows lazily). Apply takes effect immediately on container/vm cgroup; the v2_core.machine row\'s `resources` is updated to match.',
      request: {
        params: MachineParamsSchema,
        body: { required: true, content: { 'application/json': { schema: PatchMachineBodySchema } } },
      },
      responses: {
        200: { description: 'Resized', content: { 'application/json': { schema: MachineEnvelopeSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        if (isWarmPoolInventoryRow(resolved.machine)) return c.json(warmPoolMachineMutationError(), 409);
        const input = PatchMachineBodySchema.parse(await c.req.json());
        const next = input.resources ?? {};
        if (Object.keys(next).length === 0) return c.json({ error: true, message: 'No resource changes supplied' }, 400);

        const beforeIncus = await resolved.client.getInstance(resolved.machine.incusInstanceName);
        const cur = persistedResources(resolved.machine.resources, beforeIncus);
        const merged = {
          vcpu: next.vcpu ?? cur.vcpu ?? 1,
          memory_gb: next.memory_gb ?? cur.memory_gb ?? 1,
          disk_gb: next.disk_gb ?? cur.disk_gb ?? 10,
        };
        if (next.disk_gb !== undefined && cur.disk_gb !== undefined && next.disk_gb < cur.disk_gb) {
          return c.json({ error: true, message: `Disk resize cannot shrink from ${cur.disk_gb}GiB to ${next.disk_gb}GiB; create a smaller machine and migrate data if you need shrink.` }, 400);
        }

        const cluster = findCluster(config, resolved.machine.incusClusterId)!;
        const isolation = await applyResourceConfig(resolved.client, resolved.machine.incusInstanceName, cluster, merged, {
          machineId: resolved.machine.id,
          displayName: resolved.machine.name,
          machineType: machineKind(resolved.machine.type),
          accountId: resolved.machine.accountId,
        });
        const incus = await resolved.client.getInstance(resolved.machine.incusInstanceName);
        const observedResources = persistedResources(merged, incus);
        const verified = {
          vcpu: observedResources.vcpu === merged.vcpu,
          memory_gb: observedResources.memory_gb === merged.memory_gb,
          disk_gb: observedResources.disk_gb === merged.disk_gb,
        };
        const resizedAt = new Date().toISOString();
        if (config.databaseConfigured) {
          const meta = jsonRecord(resolved.machine.metadata);
          await getPrisma().machine.update({
            where: { id: resolved.machine.id },
            data: {
              resources: observedResources,
              metadata: {
                ...meta,
                last_resize: {
                  requested: next,
                  applied: observedResources,
                  previous: cur,
                  verified,
                  isolation,
                  resized_at: resizedAt,
                },
                isolation_check: isolation,
              } as Prisma.InputJsonValue,
            },
          }).catch(() => undefined);
        }
        const refreshed = await loadProductMachine(config, resolved.machine.id) ?? resolved.machine;
        await recordResolvedMachineBillingObservation(config, { machine: refreshed, cluster: resolved.cluster }, incus, 'machine_resize');
        return c.json({ machine: serializeMachine(config, refreshed, incus) });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/machines/{id}',
      tags: ['Machines'],
      summary: 'Delete a machine',
      description: 'Force-deletes the underlying Incus instance and marks the Prisma row deleted.',
      request: { params: MachineParamsSchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        if (isWarmPoolInventoryRow(resolved.machine)) return c.json(warmPoolMachineMutationError(), 409);
        const operation = await resolved.client.deleteInstance(resolved.machine.incusInstanceName, { force: true });
        const deletedAt = new Date().toISOString();
        const proxyDelete = { synced: true, mode: 'v2-api-direct', at: deletedAt };
        const proxyTokenDeletes = proxyTokenDescriptors(resolved.machine).map((token) => ({ id: token.id, synced: true, mode: 'v2-api-direct', at: deletedAt }));
        if (config.databaseConfigured) {
          await recordResolvedMachineBillingObservation(config, resolved, null, 'machine_delete', new Date(deletedAt), 'deleted');
          await getPrisma().machine.update({
            where: { id: resolved.machine.id },
            data: {
              status: 'deleted',
              metadata: {
                ...jsonRecord(resolved.machine.metadata),
                proxy_delete: proxyDelete,
                proxy_token_deletes: proxyTokenDeletes,
                proxy_tokens: proxyTokenDescriptors(resolved.machine).map((token) => ({ ...token, revoked_at: token.revoked_at ?? deletedAt })),
              } as Prisma.InputJsonValue,
            },
          }).catch(() => undefined);
        }
        return c.json({ ok: true as const, operation, proxy_delete: proxyDelete, proxy_token_deletes: proxyTokenDeletes });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/machines/{id}/snapshots',
      tags: ['Snapshots'],
      summary: 'List snapshots',
      request: { params: MachineParamsSchema },
      responses: {
        200: { description: 'Snapshot list', content: { 'application/json': { schema: SnapshotListResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const snapshots = await resolved.client.listSnapshots(resolved.machine.incusInstanceName);
        const productRows = config.databaseConfigured
          ? await getPrisma().snapshot.findMany({ where: { machineId: resolved.machine.id } }).catch(() => [])
          : [];
        const byName = new Map(productRows.map((row) => [row.incusSnapshotName, row]));
        return c.json({
          snapshots: snapshots.map((snapshot) => {
            const row = byName.get(snapshot.name);
            const measuredBytes = exactBytes(snapshot.size);
            return {
              ...snapshot,
              id: row?.id ?? snapshot.name,
              account_id: resolved.machine.accountId,
              machine_id: resolved.machine.id,
              ...(measuredBytes ? { metered_bytes: measuredBytes, billable_gib: Number((measuredBytes / BYTES_PER_GIB).toFixed(9)) } : {}),
            };
          }),
        });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/machines/{id}/snapshots',
      tags: ['Snapshots'],
      summary: 'Create a snapshot',
      request: {
        params: MachineParamsSchema,
        body: { required: false, content: { 'application/json': { schema: CreateSnapshotBodySchema } } },
      },
      responses: {
        201: { description: 'Snapshot created', content: { 'application/json': { schema: SnapshotOperationResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const input = createSnapshotSchema.parse(await c.req.json().catch(() => ({})));
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const name = input.name ?? generatedResourceName('snap');
        let temporarilyEnabledStateful = false;
        if (input.stateful) {
          if (resolved.machine.type !== 'vm') {
            return c.json({ error: true, message: 'Stateful snapshots are only supported for virtual machines on this platform. Use a disk-only snapshot for containers.' }, 400);
          }
          await resolved.client.updateInstanceConfig(resolved.machine.incusInstanceName, { 'migration.stateful': 'true' });
          temporarilyEnabledStateful = true;
        }
        let operation: IncusOperation;
        try {
          operation = await resolved.client.createSnapshot(resolved.machine.incusInstanceName, name, { stateful: input.stateful, expiresAt: input.expires_at });
        } finally {
          if (temporarilyEnabledStateful) {
            await resolved.client.updateInstanceConfig(resolved.machine.incusInstanceName, { 'migration.stateful': 'false' }).catch(() => undefined);
          }
        }
        let snapshot = null;
        if (config.databaseConfigured) {
          snapshot = await getPrisma().snapshot.create({
            data: {
              accountId: resolved.machine.accountId,
              machineId: resolved.machine.id,
              name,
              incusSnapshotName: name,
              status: 'ready',
              metadata: {
                incus_operation: operation,
                stateful: input.stateful,
                expires_at: input.expires_at ?? null,
              },
            },
          });
        }
        return c.json({ snapshot: snapshot ?? { id: name, name, incus_snapshot_name: name }, operation }, 201);
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/machines/{id}/snapshots/{name}/restore',
      tags: ['Snapshots'],
      summary: 'Restore a snapshot in place',
      request: {
        params: SnapshotBackupParamsSchema,
        body: { required: false, content: { 'application/json': { schema: RestoreBodySchema } } },
      },
      responses: {
        200: { description: 'Restored', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const input = restoreSnapshotSchema.parse(await c.req.json().catch(() => ({})));
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        let temporarilyEnabledStateful = false;
        if (input.stateful) {
          if (resolved.machine.type !== 'vm') {
            return c.json({ error: true, message: 'Stateful restore is only supported for virtual machines on this platform. Restore container snapshots disk-only.' }, 400);
          }
          await resolved.client.updateInstanceConfig(resolved.machine.incusInstanceName, { 'migration.stateful': 'true' });
          temporarilyEnabledStateful = true;
        }
        let restored: Awaited<ReturnType<typeof restoreSnapshotAndResume>>;
        try {
          restored = await restoreSnapshotAndResume(resolved, c.req.param('name'), input);
        } finally {
          if (temporarilyEnabledStateful) {
            await resolved.client.updateInstanceConfig(resolved.machine.incusInstanceName, { 'migration.stateful': 'false' }).catch(() => undefined);
          }
        }
        if (config.databaseConfigured) {
          await getPrisma().machine.update({
            where: { id: resolved.machine.id },
            data: { status: restored.after?.status ?? resolved.machine.status },
          }).catch(() => undefined);
        }
        return c.json({ ok: true as const, operation: restored.restoreOp, start_operation: restored.startOperation, start_noop: restored.startNoop, restored_running: restored.wasRunning && restored.after?.status?.toLowerCase() === 'running' });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/machines/{id}/snapshots/{name}',
      tags: ['Snapshots'],
      summary: 'Delete a snapshot',
      request: { params: SnapshotBackupParamsSchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const snapshotName = c.req.param('name');
        const operation = await resolved.client.deleteSnapshot(resolved.machine.incusInstanceName, snapshotName);
        if (config.databaseConfigured) {
          await getPrisma().snapshot.deleteMany({ where: { machineId: resolved.machine.id, incusSnapshotName: snapshotName } });
        }
        return c.json({ ok: true as const, operation });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/images',
      tags: ['Images'],
      summary: 'Create / pull an image',
      description: 'Two flavors: (a) pull from a Docker/OCI registry into the cluster catalog (`docker.ref`), or (b) publish from an existing machine (optionally from a snapshot) by passing `machine_id`.',
      request: { body: { required: true, content: { 'application/json': { schema: CreateImageBodySchema } } } },
      responses: {
        201: { description: 'Image created', content: { 'application/json': { schema: ImageOperationResponseSchema } } },
        404: { description: 'Source not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        409: { description: 'No cluster available', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
    try {
      const input = createImageSchema.parse(await c.req.json());
      const alias = input.name ?? generatedResourceName('img');

      // Branch 1: pull from a Docker/OCI registry, then publish a JustAVPS-ready
      // derivative image. The raw pull is temporary; the final image has the
      // daemon binary/unit baked in and has passed first + second boot checks.
      if (input.docker) {
        const cluster = input.cluster_id
          ? findCluster(config, input.cluster_id)
          : input.region
            ? pickCluster(config, input.region)
            : (config.clusters[0] ?? null);
        if (!cluster) return c.json({ error: true, message: 'No Incus cluster available for the requested region/cluster_id' }, 409);
        const server = input.docker.server ?? 'https://docker.io';
        const imageType = 'container' as const;
        const machineType = 'container' as const;
        const rawAlias = generatedResourceName('imgraw');
        const operation = await clientFor(cluster).createImageFromOci({
          server,
          ociRef: input.docker.ref,
          imageType,
          aliases: [{ name: rawAlias, description: `Temporary raw JustAVPS image ${rawAlias} (OCI: ${input.docker.ref})` }],
          properties: { ...input.properties, 'justavps.source': 'docker', 'justavps.docker_ref': input.docker.ref, 'justavps.docker_server': server, 'justavps.image_type': imageType, 'justavps.raw_for': alias },
          public: false,
        });
        const prepared = await prepareAndPublishJustavpsImage(config, {
          cluster,
          source: { type: 'image', image: rawAlias },
          imageType: machineType,
          alias,
          description: `JustAVPS image ${alias} (OCI: ${input.docker.ref})`,
          properties: { ...input.properties, 'justavps.source': 'docker', 'justavps.docker_ref': input.docker.ref, 'justavps.docker_server': server, 'justavps.image_type': imageType },
          public: input.public,
          accountId: c.req.header('x-account-id') || 'system',
        });
        await clientFor(cluster).deleteImage(rawAlias).catch(() => undefined);

        let image = null;
        if (config.databaseConfigured) {
          image = await getPrisma().image.create({
            data: {
              accountId: c.req.header('x-account-id') || 'system',
              visibility: input.public ? 'catalog' : 'private',
              name: alias,
              incusClusterId: cluster.id,
              incusProject: cluster.project,
              incusFingerprint: alias,
              sourceMachineId: null,
              sourceSnapshotId: null,
              metadata: { incus_operation: prepared.operation, raw_pull_operation: operation, alias, docker_ref: input.docker.ref, docker_server: server, justavps_preparation: prepared } as Prisma.InputJsonValue,
            },
          });
        }
        return c.json({ image: image ?? { id: alias, name: alias, source: 'docker', docker_ref: input.docker.ref }, operation: prepared.operation, raw_operation: operation, justavps_preparation: prepared }, 201);
      }

      // Branch 1b: pull from simplestreams (linuxcontainers.org). Same shape
      // as the OCI branch — the only differences are the protocol on the
      // Incus side and the property tag on our side.
      if (input.simplestreams) {
        const cluster = input.cluster_id
          ? findCluster(config, input.cluster_id)
          : input.region
            ? pickCluster(config, input.region)
            : (config.clusters[0] ?? null);
        if (!cluster) return c.json({ error: true, message: 'No Incus cluster available for the requested region/cluster_id' }, 409);
        const server = input.simplestreams.server ?? 'https://images.linuxcontainers.org';
        const imageType = 'container' as const;
        const machineType = 'container' as const;
        const rawAlias = generatedResourceName('imgraw');
        const operation = await clientFor(cluster).createImageFromSimplestreams({
          server,
          alias: input.simplestreams.ref,
          imageType,
          aliases: [{ name: rawAlias, description: `Temporary raw JustAVPS image ${rawAlias} (simplestreams: ${input.simplestreams.ref})` }],
          properties: { ...input.properties, 'justavps.source': 'simplestreams', 'justavps.simplestreams_ref': input.simplestreams.ref, 'justavps.simplestreams_server': server, 'justavps.image_type': imageType, 'justavps.raw_for': alias },
          public: false,
        });
        const prepared = await prepareAndPublishJustavpsImage(config, {
          cluster,
          source: { type: 'image', image: rawAlias },
          imageType: machineType,
          alias,
          description: `JustAVPS image ${alias} (simplestreams: ${input.simplestreams.ref})`,
          properties: { ...input.properties, 'justavps.source': 'simplestreams', 'justavps.simplestreams_ref': input.simplestreams.ref, 'justavps.simplestreams_server': server, 'justavps.image_type': imageType },
          public: input.public,
          accountId: c.req.header('x-account-id') || 'system',
        });
        await clientFor(cluster).deleteImage(rawAlias).catch(() => undefined);
        let image = null;
        if (config.databaseConfigured) {
          image = await getPrisma().image.create({
            data: {
              accountId: c.req.header('x-account-id') || 'system',
              visibility: input.public ? 'catalog' : 'private',
              name: alias,
              incusClusterId: cluster.id,
              incusProject: cluster.project,
              incusFingerprint: alias,
              sourceMachineId: null,
              sourceSnapshotId: null,
              metadata: { incus_operation: prepared.operation, raw_pull_operation: operation, alias, simplestreams_ref: input.simplestreams.ref, simplestreams_server: server, image_type: imageType, justavps_preparation: prepared } as Prisma.InputJsonValue,
            },
          });
        }
        return c.json({ image: image ?? { id: alias, name: alias, source: 'simplestreams', simplestreams_ref: input.simplestreams.ref }, operation: prepared.operation, raw_operation: operation, justavps_preparation: prepared }, 201);
      }

      // Branch 2: publish from an existing machine (with optional snapshot).
      const resolved = await machineClient(config, input.machine_id!);
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      if (resolved.machine.type !== 'container') return c.json({ error: true, message: CONTAINERS_ONLY_MESSAGE }, 409);
      let snapshotName = input.snapshot_id ?? null;
      let sourceSnapshotId: string | null = input.snapshot_id ?? null;
      if (snapshotName && config.databaseConfigured) {
        const snapshot = await getPrisma().snapshot.findUnique({ where: { id: snapshotName } })
          ?? await getPrisma().snapshot.findFirst({ where: { machineId: resolved.machine.id, incusSnapshotName: snapshotName }, orderBy: { createdAt: 'desc' } });
        if (snapshot) {
          snapshotName = snapshot.incusSnapshotName;
          sourceSnapshotId = snapshot.id;
        }
      }
      const machineResources = persistedResources(resolved.machine.resources, null);
      const prepared = await prepareAndPublishJustavpsImage(config, {
        cluster: resolved.cluster,
        source: { type: 'snapshot', source: snapshotName ? `${resolved.machine.incusInstanceName}/${snapshotName}` : resolved.machine.incusInstanceName },
        imageType: 'container',
        alias,
        description: `JustAVPS image ${alias}`,
        properties: input.properties,
        public: input.public,
        accountId: resolved.machine.accountId,
        baseResources: machineResources,
        preferredMemberName: resolved.machine.incusMemberName,
      });
      let image = null;
      if (config.databaseConfigured) {
        image = await getPrisma().image.create({
          data: {
            accountId: resolved.machine.accountId,
            visibility: input.public ? 'catalog' : 'private',
            name: alias,
              incusClusterId: resolved.cluster.id,
              incusProject: resolved.cluster.project,
              incusFingerprint: alias,
              sourceMachineId: resolved.machine.id,
              sourceSnapshotId,
              metadata: { incus_operation: prepared.operation, alias, justavps_preparation: prepared } as Prisma.InputJsonValue,
            },
          });
        }
      return c.json({ image: image ?? { id: alias, name: alias }, operation: prepared.operation, justavps_preparation: prepared }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
    }),
  );

  // Prewarm: pay the unpack cost on the platform's clock (background) so the
  // user's first create from this image clones from the cached ZFS dataset
  // in O(1) instead of waiting on the unpack pipeline.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/images/{id}/prewarm',
      tags: ['Images'],
      summary: 'Pre-warm the unpacked image cache',
      description: 'Creates and immediately deletes a throwaway instance from the image so the per-pool ZFS unpack cache is populated. Subsequent user creates from this image clone in O(1) (~3s) instead of doing a fresh unpack (~30s+ for large images on loopback ZFS).',
      request: { params: imageParamsSchema },
      responses: {
        200: { description: 'Cache populated', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Image / cluster not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const imageId = c.req.param('id');
        let cluster: IncusClusterConfig | null = config.clusters[0] ?? null;
        let alias = imageId;
        if (config.databaseConfigured) {
          const productImage = await getPrisma().image.findUnique({ where: { id: imageId } });
          if (productImage) {
            cluster = findCluster(config, productImage.incusClusterId) ?? null;
            alias = productImage.name || productImage.incusFingerprint;
          }
        }
        if (!cluster) return c.json({ error: true, message: 'Incus cluster not found' }, 404);
        const client = clientFor(cluster);
        const member = await pickOnlineMember(client);
        if (!member) return c.json({ error: true, message: 'No online cluster member' }, 409);
        // Tiny instance so unpack happens but we don't allocate real resources.
        // Throwaway name + force delete; the goal is the side-effect on the
        // per-pool image cache, not the instance itself.
        const tempName = `prewarm-${alias.replace(/[^a-z0-9-]/g, '-').slice(0, 30)}-${Math.random().toString(36).slice(2, 6)}`;
        const operation = await client.createInstance({
          name: tempName,
          machineType: 'container',
          source: { type: 'image', image: alias },
          targetMember: member.server_name,
          resources: { vcpu: 1, memoryGb: 1, diskGb: 1 },
        });
        await client.deleteInstance(tempName, { force: true }).catch(() => undefined);
        return c.json({ ok: true as const, operation });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/images/{id}',
      tags: ['Images'],
      summary: 'Delete an image',
      description: 'Accepts either the v2_core.image cuid or the raw Incus fingerprint/alias.',
      request: { params: imageParamsSchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Cluster not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const imageId = c.req.param('id');
        let cluster: IncusClusterConfig | null = config.clusters[0] ?? null;
        let fingerprint = imageId;
        if (config.databaseConfigured) {
          const productImage = await getPrisma().image.findUnique({ where: { id: imageId } });
          if (productImage) {
            cluster = findCluster(config, productImage.incusClusterId) ?? null;
            fingerprint = productImage.incusFingerprint;
          }
        }
        if (!cluster) return c.json({ error: true, message: 'Incus cluster not found' }, 404);
        const operation = await clientFor(cluster).deleteImage(fingerprint);
        if (config.databaseConfigured) await getPrisma().image.deleteMany({ where: { id: imageId } });
        return c.json({ ok: true as const, operation });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  // ──────────────────────────────────────────────────────────────────────
  // Templates: the curated public image catalog. The Incus image cache may
  // hold dozens of aliases from auto-pulls; templates are the user-facing
  // base images.
  // ──────────────────────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: 'get',
      path: '/templates',
      tags: ['Templates'],
      summary: 'List the curated image catalog',
      description: 'Returns the fixed template set with per-cluster cache state — `cached` is true on a cluster when the Incus image cache there has an alias matching the template id.',
      responses: {
        200: { description: 'Image catalog', content: { 'application/json': { schema: z.object({ templates: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          type: z.enum(['container', 'virtual-machine']),
          clusters: z.array(z.object({
            id: z.string(),
            cached: z.boolean(),
            fingerprint: z.string().nullable(),
            size: z.number().nullable(),
          })),
        })) }) } } },
      },
    }),
    oapi(async (c) => {
      try {
        // Map alias → { fingerprint, size } per cluster, looked up once.
        const perCluster = await Promise.all(config.clusters.map(async (cluster) => {
          const observed = await clientFor(cluster).listImages().catch(() => []);
          const aliasMap = new Map<string, { fingerprint: string; size: number | null }>();
          for (const img of observed) {
            for (const a of img.aliases ?? []) {
              if (!aliasMap.has(a.name)) aliasMap.set(a.name, { fingerprint: img.fingerprint ?? '', size: img.size ?? null });
            }
          }
          return { clusterId: cluster.id, aliasMap };
        }));

        const templates = TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          type: t.type,
          clusters: perCluster.map((pc) => {
            const hit = pc.aliasMap.get(t.id);
            return { id: pc.clusterId, cached: !!hit, fingerprint: hit?.fingerprint ?? null, size: hit?.size ?? null };
          }),
        }));
        return c.json({ templates });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  // Bulk purge of every image in every cluster whose aliases don't intersect
  // a template id. Running instances are unaffected — image deletion only
  // drops the cached rootfs blob; live instances keep their copy-on-write
  // fork. Returns counts so the UI can show what got swept.
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/templates/cache/extras',
      tags: ['Templates'],
      summary: 'Purge non-template images from every cluster cache',
      description: 'Deletes every Incus image whose aliases do not include a known template id. Running instances are not affected — they keep their copy-on-write fork.',
      responses: {
        200: { description: 'Cleaned', content: { 'application/json': { schema: z.object({
          ok: z.literal(true),
          deleted: z.number(),
          kept: z.number(),
          errors: z.array(z.object({ cluster: z.string(), fingerprint: z.string(), message: z.string() })),
        }) } } },
      },
    }),
    oapi(async (c) => {
      try {
        let deleted = 0;
        let kept = 0;
        const errors: { cluster: string; fingerprint: string; message: string }[] = [];
        for (const cluster of config.clusters) {
          const client = clientFor(cluster);
          const observed = await client.listImages().catch(() => []);
          for (const img of observed) {
            if (imageMatchesTemplate(img.aliases ?? [])) { kept += 1; continue; }
            const fp = img.fingerprint;
            if (!fp) continue;
            try {
              await client.deleteImage(fp);
              deleted += 1;
            } catch (e) {
              errors.push({ cluster: cluster.id, fingerprint: fp, message: e instanceof Error ? e.message : String(e) });
            }
          }
        }
        // Mirror in our DB if we tracked any of them.
        if (config.databaseConfigured) {
          await getPrisma().image.deleteMany({ where: { name: { notIn: Array.from(TEMPLATE_IDS) } } }).catch(() => undefined);
        }
        return c.json({ ok: true as const, deleted, kept, errors });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/machines/{id}/backups',
      tags: ['Backups'],
      summary: 'List backups',
      request: { params: MachineParamsSchema },
      responses: {
        200: { description: 'Backup list', content: { 'application/json': { schema: BackupListResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const backups = await resolved.client.listBackups(resolved.machine.incusInstanceName);
        const snapshots = await resolved.client.listSnapshots(resolved.machine.incusInstanceName).catch(() => []);
        const snapshotByName = new Map(snapshots.map((snapshot) => [snapshot.name, snapshot]));
        const productRows = config.databaseConfigured
          ? await getPrisma().backup.findMany({ where: { machineId: resolved.machine.id } }).catch(() => [])
          : [];
        const byName = new Map(productRows.map((row) => [row.incusBackupName, row]));
        return c.json({
          backups: backups.map((backup) => {
            const row = byName.get(backup.name);
            const tarballBytes = exactBytes(backup.size);
            const restoreSnapshot = snapshotByName.get(`bk-snap-${backup.name}`);
            const restoreSnapshotBytes = exactBytes(restoreSnapshot?.size);
            const meteredBytes = (tarballBytes ?? 0) + (restoreSnapshotBytes ?? 0);
            return {
              ...backup,
              id: row?.id ?? backup.name,
              account_id: resolved.machine.accountId,
              machine_id: resolved.machine.id,
              incus_backup_name: backup.name,
              trigger: backupRowTrigger(row),
              policy_id: typeof jsonRecord(row?.retentionPolicy).policy_id === 'string' ? jsonRecord(row?.retentionPolicy).policy_id : null,
              expires_at: backup.expires_at ?? backupRowExpiresAt(row),
              restore_snapshot: `bk-snap-${backup.name}`,
              ...(meteredBytes > 0 ? {
                metered_bytes: meteredBytes,
                billable_gib: Number((meteredBytes / BYTES_PER_GIB).toFixed(9)),
                storage_components: [
                  { label: 'backup tarball', metered_bytes: tarballBytes ?? 0, billable_gib: Number(((tarballBytes ?? 0) / BYTES_PER_GIB).toFixed(9)) },
                  { label: 'pinned restore snapshot', metered_bytes: restoreSnapshotBytes ?? 0, billable_gib: Number(((restoreSnapshotBytes ?? 0) / BYTES_PER_GIB).toFixed(9)) },
                ],
              } : {}),
            };
          }),
        });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/machines/{id}/backups',
      tags: ['Backups'],
      summary: 'Create a backup',
      description: 'Native Incus tarball backup. Stored alongside the instance until restored or deleted.',
      request: {
        params: MachineParamsSchema,
        body: { required: false, content: { 'application/json': { schema: CreateBackupBodySchema } } },
      },
      responses: {
        201: { description: 'Backup created', content: { 'application/json': { schema: BackupOperationResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const input = createBackupSchema.parse(await c.req.json().catch(() => ({})));
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        // Two artifacts per backup, kept in sync:
        //   • Incus snapshot — used for in-place restore (which Incus 6.23
        //     refuses to do via tarball import because volatile.* keys are
        //     immutable). The snapshot name is `bk-snap-<backup-name>` so the
        //     restore path can find it deterministically.
        //   • Incus backup tarball — used for cross-cluster restoration and
        //     long-term archival. Untouched on in-place restore.
        const created = await createBackupArtifact(config, resolved, {
          name: input.name,
          instanceOnly: input.instance_only,
          optimizedStorage: input.optimized_storage,
          expiresAt: input.expires_at,
          trigger: 'manual',
        });
        return c.json({ backup: created.backup, operation: created.operation }, 201);
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/machines/{id}/backups/{name}/restore',
      tags: ['Backups'],
      summary: 'Restore a backup in place',
      description: 'Reverts the instance to the state captured when the backup was created. Internally restores the Incus snapshot pinned at backup-time (`bk-snap-<name>`).',
      request: {
        params: SnapshotBackupParamsSchema,
        body: { required: false, content: { 'application/json': { schema: RestoreBodySchema } } },
      },
      responses: {
        200: { description: 'Restored', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const backupName = c.req.param('name');
        // In-place restore via the snapshot we pinned at backup-time. The
        // tarball still exists for archival / cross-cluster transfer; it's
        // just not the path we walk for same-instance rollback.
        const restoreSnapshotName = `bk-snap-${backupName}`;
        const restored = await restoreSnapshotAndResume(resolved, restoreSnapshotName, { stateful: false });
        if (config.databaseConfigured) {
          const existingMetadata = jsonRecord(resolved.machine.metadata);
          await getPrisma().machine.update({
            where: { id: resolved.machine.id },
            data: {
              status: restored.after?.status ?? resolved.machine.status,
              metadata: {
                ...existingMetadata,
                last_backup_restore: {
                  backup_name: backupName,
                  restored_at: new Date().toISOString(),
                  incus_operation: restored.restoreOp,
                  start_operation: restored.startOperation,
                  before_status: restored.beforeStatus,
                  after_status: restored.after?.status ?? null,
                },
              } as Prisma.InputJsonValue,
            },
          }).catch(() => undefined);
        }
        return c.json({ ok: true as const, operation: restored.restoreOp, start_operation: restored.startOperation, start_noop: restored.startNoop, restored_running: restored.wasRunning && restored.after?.status?.toLowerCase() === 'running' });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/machines/{id}/backups/{name}',
      tags: ['Backups'],
      summary: 'Delete a backup',
      request: { params: SnapshotBackupParamsSchema },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const backupName = c.req.param('name');
        const operation = await deleteBackupArtifacts(resolved, backupName);
        return c.json({ ok: true as const, operation });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  // ─── Sandbox runtime: exec + files ─────────────────────────────────
  app.openapi(
    createRoute({
      method: 'post',
      path: '/machines/{id}/exec',
      tags: ['Sandbox'],
      summary: 'Execute a command inside a sandbox',
      description: 'Runs a command via native Incus exec (no in-instance agent required). Returns stdout, stderr, and exit code once the process completes. Pass `command` as a string for shell semantics or an argv array for direct exec.',
      request: {
        params: MachineParamsSchema,
        body: { required: true, content: { 'application/json': { schema: ExecBodySchema } } },
      },
      responses: {
        200: { description: 'Command finished', content: { 'application/json': { schema: ExecResponseSchema } } },
        404: { description: 'Sandbox not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
        502: { description: 'Incus error', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const input = (await c.req.json()) as z.infer<typeof ExecBodySchema>;
        const argv = Array.isArray(input.command) ? input.command : ['/bin/sh', '-c', input.command];
        // Merge stored machine env with the per-call env. Per-call wins on
        // collision so callers can override defaults at the request boundary.
        const machineMeta = jsonRecord(resolved.machine.metadata);
        const machineEnv = (machineMeta.env && typeof machineMeta.env === 'object') ? machineMeta.env as Record<string, string> : {};
        const mergedEnv = { ...machineEnv, ...(input.env ?? {}) };
        const execStartedAt = new Date().toISOString();
        const execStartedMs = Date.now();
        const result = await resolved.client.exec(resolved.machine.incusInstanceName, {
          command: argv,
          env: mergedEnv,
          cwd: input.cwd,
          user: input.user,
          group: input.group,
          stdin: input.stdin,
          timeoutMs: input.timeout_ms,
        });
        const execDurationMs = Date.now() - execStartedMs;
        const commandLabel = argv.join(' ');
        await Promise.all([
          getTelemetryStore(config).insertTraces([{
            machine_id: resolved.machine.id,
            account_id: resolved.machine.accountId,
            operation: 'toolbox.exec',
            name: commandLabel,
            status: result.exit_code === 0 ? 'ok' : 'error',
            started_at: execStartedAt,
            ended_at: new Date().toISOString(),
            duration_ms: execDurationMs,
            attributes: { exit_code: result.exit_code, cwd: input.cwd ?? '', user: input.user ?? '', source: 'incus.exec' },
            error: result.exit_code === 0 ? '' : (result.stderr || `exit ${result.exit_code}`),
          }]),
          getTelemetryStore(config).insertLogs([
            ...(result.stdout ? [{ machine_id: resolved.machine.id, account_id: resolved.machine.accountId, severity: 'info', source: 'process.stdout', stream: 'stdout', body: result.stdout, attributes: { command: commandLabel, exit_code: result.exit_code, source: 'incus.exec' } }] : []),
            ...(result.stderr ? [{ machine_id: resolved.machine.id, account_id: resolved.machine.accountId, severity: result.exit_code === 0 ? 'warn' : 'error', source: 'process.stderr', stream: 'stderr', body: result.stderr, attributes: { command: commandLabel, exit_code: result.exit_code, source: 'incus.exec' } }] : []),
          ]),
        ]).catch(() => undefined);
        // Bump last_used_at so the lifecycle sweeper's auto-stop timer
        // restarts from now. Failure here doesn't break the response.
        if (config.databaseConfigured) {
          await getPrisma().machine.update({
            where: { id: resolved.machine.id },
            data: { metadata: { ...machineMeta, last_used_at: new Date().toISOString() } as Prisma.InputJsonValue },
          }).catch(() => undefined);
        }
        return c.json(result);
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/machines/{id}/files',
      tags: ['Sandbox'],
      summary: 'Write a file inside the sandbox',
      description: 'Creates or overwrites a file at `path`. UTF-8 by default; pass `encoding: base64` for binary payloads.',
      request: {
        params: MachineParamsSchema,
        body: { required: true, content: { 'application/json': { schema: FileWriteBodySchema } } },
      },
      responses: {
        200: { description: 'Written', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Sandbox not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const input = (await c.req.json()) as z.infer<typeof FileWriteBodySchema>;
        const buf = (input.encoding ?? 'utf8') === 'base64'
          ? Buffer.from(input.content, 'base64')
          : Buffer.from(input.content, 'utf8');
        await resolved.client.pushFile(resolved.machine.incusInstanceName, input.path, buf, {
          mode: input.mode,
          createDirs: input.create_dirs,
        });
        return c.json({ ok: true as const });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/machines/{id}/files',
      tags: ['Sandbox'],
      summary: 'Read a file or list a directory',
      description: 'When `path` points at a file, returns the contents (UTF-8 by default; binary content is base64-encoded). When `path` points at a directory, returns the entry names.',
      request: {
        params: MachineParamsSchema,
        query: z.object({ path: z.string().min(1) }),
      },
      responses: {
        200: { description: 'File contents or directory listing', content: { 'application/json': { schema: z.union([FileReadResponseSchema, FileListResponseSchema]) } } },
        404: { description: 'Path not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const path = c.req.query('path');
        if (!path) return c.json({ error: true, message: 'path query parameter is required' }, 400);
        const result = await resolved.client.pullFile(resolved.machine.incusInstanceName, path);
        if (result.type === 'directory') {
          // Directory listing — Incus returns the entry array as JSON metadata,
          // but we already fetched bytes; parse them as the listing instead.
          const entries = (() => { try { return JSON.parse(result.content.toString('utf8')) as string[]; } catch { return [] as string[]; } })();
          return c.json({ path, entries });
        }
        // Plain files: try UTF-8, fall back to base64 if non-UTF8 bytes are
        // present. This keeps simple text reads ergonomic without losing
        // binary fidelity for blobs.
        const utf8 = result.content.toString('utf8');
        const isUtf8 = !/�/.test(utf8) && Buffer.from(utf8, 'utf8').equals(result.content);
        return c.json({
          path,
          type: result.type,
          mode: result.mode,
          content: isUtf8 ? utf8 : result.content.toString('base64'),
          encoding: isUtf8 ? 'utf8' : 'base64',
        });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/machines/{id}/files',
      tags: ['Sandbox'],
      summary: 'Delete a file or directory inside the sandbox',
      request: {
        params: MachineParamsSchema,
        query: z.object({ path: z.string().min(1) }),
      },
      responses: {
        200: { description: 'Deleted', content: { 'application/json': { schema: LifecycleResponseSchema } } },
        404: { description: 'Path not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
      },
    }),
    oapi(async (c) => {
      try {
        const resolved = await machineClient(config, c.req.param('id'));
        if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
        const path = c.req.query('path');
        if (!path) return c.json({ error: true, message: 'path query parameter is required' }, 400);
        await resolved.client.deleteFile(resolved.machine.incusInstanceName, path);
        return c.json({ ok: true as const });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    }),
  );

  app.get('/machines/:id/toolbox-config', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      return c.json({ toolbox: toolboxRoutes(resolved.machine.id, toolboxBaseUrl(resolved.machine)) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.put('/machines/:id/toolbox-config', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = toolboxConfigSchema.parse(await c.req.json());
      const machine = await getPrisma().machine.findUnique({ where: { id: c.req.param('id') } });
      if (!machine) return c.json({ error: true, message: 'Machine not found' }, 404);
      const metadata = { ...jsonRecord(machine.metadata) };
      if (input.base_url === null || input.base_url === '') {
        delete metadata.toolbox_base_url;
      } else if (input.base_url !== undefined) {
        metadata.toolbox_base_url = input.base_url;
      }
      const updated = await getPrisma().machine.update({
        where: { id: machine.id },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
      return c.json({ machine: serializeMachine(config, updated), toolbox: toolboxRoutes(updated.id, toolboxBaseUrl(updated)) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machines/:id/toolbox-health', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const baseUrl = toolboxBaseUrl(resolved.machine);
      if (!baseUrl) return c.json({ error: true, message: 'Machine toolbox URL is not configured' }, 409);
      const result = await callToolboxJson(baseUrl, 'daemon/health');
      return c.json(result.data, result.status as never);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machines/:id/toolbox-services', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const baseUrl = toolboxBaseUrl(resolved.machine);
      if (!baseUrl) return c.json({ error: true, message: 'Machine toolbox URL is not configured' }, 409);
      const result = await callToolboxJson(baseUrl, 'daemon/services');
      return c.json(result.data, result.status as never);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machines/:id/toolbox-services/:service/restart', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const service = c.req.param('service');
      if (!/^[a-zA-Z0-9_.@-]+$/.test(service)) return c.json({ error: true, message: 'Invalid service name' }, 400);
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const baseUrl = toolboxBaseUrl(resolved.machine);
      if (!baseUrl) return c.json({ error: true, message: 'Machine toolbox URL is not configured' }, 409);
      const result = await callToolboxJson(baseUrl, `daemon/services/${encodeURIComponent(service)}/restart`, { method: 'POST' });
      return c.json(result.data, result.status as never);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machines/:id/toolbox-command', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const input = toolboxCommandSchema.parse(await c.req.json());
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const baseUrl = toolboxBaseUrl(resolved.machine);
      if (!baseUrl) return c.json({ error: true, message: 'Machine toolbox URL is not configured' }, 409);
      const toolboxStartedAt = new Date().toISOString();
      const toolboxStartedMs = Date.now();
      const result = await callToolboxJson(baseUrl, 'toolbox/process/execute', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const payload = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data as Record<string, unknown> : {};
      const stdout = typeof payload.stdout === 'string' ? payload.stdout : '';
      const stderr = typeof payload.stderr === 'string' ? payload.stderr : '';
      const exitCode = typeof payload.exit_code === 'number' ? payload.exit_code : result.status >= 400 ? 1 : 0;
      const commandLabel = Array.isArray(input.command) ? input.command.join(' ') : input.command;
      await Promise.all([
        getTelemetryStore(config).insertTraces([{
          machine_id: resolved.machine.id,
          account_id: resolved.machine.accountId,
          operation: 'toolbox.command',
          name: commandLabel,
          status: exitCode === 0 && result.status < 400 ? 'ok' : 'error',
          started_at: toolboxStartedAt,
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - toolboxStartedMs,
          attributes: { exit_code: exitCode, http_status: result.status, source: 'justavps-daemon' },
          error: exitCode === 0 ? '' : stderr || `exit ${exitCode}`,
        }]),
        getTelemetryStore(config).insertLogs([
          ...(stdout ? [{ machine_id: resolved.machine.id, account_id: resolved.machine.accountId, severity: 'info', source: 'process.stdout', stream: 'stdout', body: stdout, attributes: { command: commandLabel, exit_code: exitCode, source: 'justavps-daemon' } }] : []),
          ...(stderr ? [{ machine_id: resolved.machine.id, account_id: resolved.machine.accountId, severity: exitCode === 0 ? 'warn' : 'error', source: 'process.stderr', stream: 'stderr', body: stderr, attributes: { command: commandLabel, exit_code: exitCode, source: 'justavps-daemon' } }] : []),
        ]),
      ]).catch(() => undefined);
      return c.json(result.data, result.status as never);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.all('/machines/:id/toolbox/*', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const baseUrl = toolboxBaseUrl(resolved.machine);
      if (!baseUrl) return c.json({ error: true, message: 'Machine toolbox URL is not ready' }, 409);
      const sourceUrl = new URL(c.req.url);
      const tail = c.req.path.split(`/machines/${c.req.param('id')}/toolbox`)[1] || '/';
      const target = toolboxTargetUrl(baseUrl, `${tail}${sourceUrl.search}`);
      const headers = new Headers(c.req.raw.headers);
      headers.delete('host');
      headers.delete('connection');
      headers.delete('content-length');
      const response = await fetch(target, {
        method: c.req.method,
        headers,
        body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer(),
      });
      return new Response(response.body, { status: response.status, headers: response.headers });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  // ─── OpenAPI document + Scalar docs UI ─────────────────────────────────
  // /docs/openapi.json is the machine-readable spec consumed by SDK gen
  // (apps/v2-api/openapi-ts.config.ts) and any external tooling. /docs is
  // the human-readable Scalar reference.
  app.doc('/docs/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'JustAVPS V2 API',
      version: '2.0.0',
      description: 'V2 API for JustAVPS — Incus-backed compute (containers + virtual machines), backups, snapshots, image catalog, and procurement. Bearer-auth on every non-GET route via `V2_ADMIN_TOKEN` (or admin scope).',
      contact: { name: 'Kortix', url: 'https://kortix.com', email: 'support@justavps.com' },
    },
    servers: [
      { url: '/', description: 'Current host' },
      { url: 'http://localhost:4200', description: 'Local dev' },
    ],
    tags: [
      { name: 'System', description: 'Health + config introspection' },
      { name: 'Machines', description: 'Containers and virtual machines — create, lifecycle, delete' },
      { name: 'Snapshots', description: 'Point-in-time snapshots of machines' },
      { name: 'Backups', description: 'Native Incus tarball backups + restore' },
      { name: 'Images', description: 'Image catalog (custom builds + Docker pulls)' },
      { name: 'Proxy Tokens', description: 'V2 API direct HTTP access tokens and proxy routing' },
      { name: 'SSH', description: 'Short-lived SSH gateway tokens and validation' },
    ],
  });

  app.get(
    '/docs',
    Scalar({ url: '/docs/openapi.json', pageTitle: 'JustAVPS V2 API' }),
  );

  return app;
}
