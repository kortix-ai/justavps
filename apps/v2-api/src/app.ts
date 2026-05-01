import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Host, Prisma } from '@prisma/client';
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
import { getPrisma } from './db/client.js';
import { IncusApiError, IncusClient, hardenedSecurityConfig, type CreateInstanceSource } from './incus/client.js';
import type { IncusInstance, IncusOperation } from './incus/types.js';
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
import { ensureManagedDaemon, markManagedDaemonQueued } from './services/managedDaemon.js';
import { ensureGuestSshAccess, mergeSshMetadata } from './services/sshAccess.js';
import { HetznerRobotApiError, HetznerRobotClient, type HetznerRobotProduct } from './vendors/hetznerRobot.js';
import { TEMPLATES, TEMPLATE_IDS, imageMatchesTemplate } from './templates/catalog.js';
import {
  generateProxyToken,
  proxySlugForMachineId,
  proxyUrls,
  sha256Hex,
  type ProxyTokenDescriptor,
} from './proxy-routing.js';

const SUPPORTED_REGIONS = ['eu', 'us'] as const;
type SupportedRegion = typeof SUPPORTED_REGIONS[number];

const createMachineSchema = z.object({
  region: z.enum(SUPPORTED_REGIONS).default('eu'),
  type: z.enum(['container', 'vm']).default('container'),
  // Product display/search label only. Never used as the Incus hostname.
  // Incus instance names are generated UUIDs to avoid customer collisions.
  name: z.string().trim().min(1).max(80).optional(),
  resources: z.object({
    vcpu: z.number().int().min(1).max(256),
    memory_gb: z.number().int().min(1).max(2048),
    disk_gb: z.number().int().min(1).max(100_000),
  }),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('image'), image_id: z.string().min(1) }),
    z.object({ type: z.literal('snapshot'), snapshot_id: z.string().min(1) }),
    z.object({ type: z.literal('backup'), backup_id: z.string().min(1) }),
  ]),
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
});

type CreateMachineInput = z.infer<typeof createMachineSchema>;

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
        // Pull as a VM-bootable image instead of a container rootfs. Caveat:
        // most Docker Hub images don't expose VM manifests — Incus will
        // return "Image not found" for those. For VM imports prefer the
        // `simplestreams` source below, which targets the linuxcontainers
        // image server that does publish VM variants.
        as_vm: z.boolean().optional().default(false),
      })
      .optional(),
    // Simplestreams is the canonical Incus image protocol — Ubuntu / Debian
    // / Fedora / Alpine all publish here in both container and VM variants.
    // Use this when you want a VM from a public catalog.
    simplestreams: z
      .object({
        ref: z.string().min(1).max(200),
        server: z.string().url().optional(),
        as_vm: z.boolean().optional().default(false),
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
  verify_port: z.number().int().min(1).max(65535).optional(),
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
      const [members, instances] = await Promise.all([client.listClusterMembers(), client.listInstances()]);
      if (config.databaseConfigured) {
        await syncIncusObservation(getPrisma(), cluster, { server: await client.getServer(), members, images: [], instances }).catch(() => undefined);
      }
      const online = members.filter((member) => member.status === 'Online');
      const hostState = await hostSchedulabilityByMember(cluster.id, online.map((member) => member.server_name));
      const sku = clusterSku(cluster);
      const policy = schedulerPolicy();
      const memberScores = online.map((member) => {
        const host = hostState.get(member.server_name);
        const hostAllowsScheduling = host ? host.schedulable : true;
        const placed = instances.filter((instance) => instance.location === member.server_name);
        const allocated = placed.reduce((acc, instance) => {
          const r = instanceAllocatedResources(instance, sku.ramGb);
          acc.vcpu += r.vcpu;
          acc.memory_gb += r.memory_gb;
          acc.disk_gb += r.disk_gb;
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
        ) - (placed.length * 0.01);
        return { member, host, capacity, sellable_capacity: sellable, policy, allocated, remaining, fits, score, placed_instances: placed.length };
      }).sort((a, b) => b.score - a.score);
      return { cluster, client, members, instances, memberScores, best: memberScores.find((score) => score.fits) ?? null, error: null as string | null };
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
    ? await getPrisma().machine.findMany({ where: { status: { not: 'deleted' } } }).catch(() => [])
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
  return getPrisma().machine.findMany({ where: { status: { not: 'deleted' } } }).then((machines) => {
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
  const target = viaDaemon
    ? `http://127.0.0.1/_port/${port}${normalizedPath === '/' ? '' : normalizedPath}${cleanProxySearch(search)}`
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

async function resolveCreateInstanceSource(config: AppConfig, input: CreateMachineInput, cluster: IncusClusterConfig): Promise<
  | { source: CreateInstanceSource; sourceId: string | null; preferredMemberName?: string | null }
  | { error: { status: 404 | 409 | 501; body: { error: true; message: string } } }
> {
  if (input.source.type === 'image') return { source: { type: 'image', image: input.source.image_id }, sourceId: input.source.image_id };
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

async function ensureCreatedMachineRunning(client: IncusClient, name: string): Promise<{
  observed: IncusInstance | null;
  startOperation: IncusOperation | Record<string, unknown> | null;
  startNoop: boolean;
}> {
  let observed = await client.getInstance(name).catch(() => null);
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
  const isolation = await applyResourceConfig(input.client, input.instanceName, input.cluster, input.resources, {
    machineId: input.machineId,
    displayName: input.displayName,
    machineType: input.machineType,
    accountId: input.accountId,
  });
  return { observed: await input.client.getInstance(input.instanceName), isolation };
}

function adminGuard(config: AppConfig, authorization: string | undefined) {
  if (!config.adminToken) return null;
  const allowedTokens = config.adminToken.split(',').map((token) => token.trim()).filter(Boolean);
  return allowedTokens.some((token) => authorization === `Bearer ${token}`) ? null : { error: true, message: 'Unauthorized' };
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

const BILLING_SECONDS_PER_MONTH = 730 * 3600;

function storageEurPerMonth(gib: number, storageClass: 'local' | 'archive' = 'local') {
  const rate = storageClass === 'archive'
    ? DEFAULT_PRICING.storage_gb_archive_micro_eur_per_sec
    : DEFAULT_PRICING.storage_gb_local_micro_eur_per_sec;
  return (gib * rate * BILLING_SECONDS_PER_MONTH) / 1_000_000;
}

function exactBytes(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function exactArtifactCostAttribution(
  machine: NonNullable<Awaited<ReturnType<typeof loadProductMachine>>>,
  input: {
    kind: 'snapshot' | 'backup';
    bytes: number;
    note?: string;
    components?: Array<{ label: string; metered_bytes: number; billable_gib: number }>;
  },
) {
  const billableGib = input.bytes / 1024 / 1024 / 1024;
  return {
    account_id: machine.accountId,
    machine_id: machine.id,
    machine_name: machine.name,
    cluster_id: machine.incusClusterId,
    incus_project: machine.incusProject,
    kind: input.kind,
    storage_class: 'local',
    metered_bytes: input.bytes,
    billable_gib: Number(billableGib.toFixed(9)),
    estimated: false,
    eur_per_month: Number(storageEurPerMonth(billableGib, 'local').toFixed(6)),
    pricing_key: 'storage_gb_local_micro_eur_per_sec',
    pricing_micro_eur_per_sec: DEFAULT_PRICING.storage_gb_local_micro_eur_per_sec,
    note: input.note,
    components: input.components,
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
    if (machine) return machine;
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

function serializeMachine(config: AppConfig, machine: Awaited<ReturnType<typeof loadProductMachine>>, incus?: unknown) {
  if (!machine) return null;
  const observed = observedInstance(incus);
  const slug = machineProxySlug(machine.id);
  const urls = proxyUrls(config, slug);
  return {
    id: machine.id,
    slug,
    name: machine.name,
    region: machine.region,
    type: machine.type,
    status: observed?.status ?? machine.status,
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
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.path.startsWith('/admin/')) {
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
        const machines = (await Promise.all(config.clusters.map(async (cluster) => {
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
          const productById = new Map(productRows.map((machine) => [machine.id, machine]));
          return normalizedObserved.flatMap((instance) => {
            const id = instance.config?.['user.justavps.machine_id'] ?? null;
            if (!isMachineUuid(id)) return [];
            const productMachine = productById.get(id);
            if (!productMachine) {
              const serializedObserved = serializeObservedMachine(config, cluster, instance);
              return serializedObserved ? [serializedObserved] : [];
            }
            const serialized = serializeMachine(config, productMachine, instance) ?? serializeObservedMachine(config, cluster, instance);
            if (!serialized) return [];
            return [{
              ...serialized,
              cluster: publicCluster(cluster),
              location: instance.location ?? null,
            }];
          });
        }))).flat();
        return c.json({ machines });
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
        const ensured = await ensureResolvedManagedDaemon(config, resolved, { verifyPort: input?.verify_port });
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
          : await getPrisma().machine.findMany({ where: { status: { not: 'deleted' } } });

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
          : await getPrisma().machine.findMany({ where: { status: { not: 'deleted' } } });
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
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);

      const input = createMachineSchema.parse(await c.req.json());
      let backupResolvedForPlacement: BackupResolution | null = null;
      let preferredClusterId: string | null = null;
      let preferredMemberName: string | null = null;
      if (input.source.type === 'backup') {
        backupResolvedForPlacement = await resolveBackupForSource(config, input.source.backup_id);
        if ('error' in backupResolvedForPlacement) return c.json(backupResolvedForPlacement.error.body, backupResolvedForPlacement.error.status as never);
        preferredClusterId = backupResolvedForPlacement.sourceMachine.incusClusterId;
        preferredMemberName = backupResolvedForPlacement.sourceMachine.incusMemberName;
      } else if (input.source.type === 'snapshot' && config.databaseConfigured) {
        const snapshot = await getPrisma().snapshot.findUnique({ where: { id: input.source.snapshot_id } })
          ?? await getPrisma().snapshot.findFirst({ where: { incusSnapshotName: input.source.snapshot_id }, orderBy: { createdAt: 'desc' } });
        if (snapshot) {
          const sourceMachine = await getPrisma().machine.findUnique({ where: { id: snapshot.machineId } });
          preferredClusterId = sourceMachine?.incusClusterId ?? null;
          preferredMemberName = sourceMachine?.incusMemberName ?? null;
        }
      }
      const placement = await selectPlacement(config, {
        region: input.region,
        resources: input.resources,
        targetClusterId: input.target_cluster_id ?? null,
        preferredClusterId,
        preferredMemberName,
      });
      const { cluster, client, member } = placement;

      // Backup source: native Incus tarball import. Bypasses createInstance entirely.
      if (input.source.type === 'backup') {
        const backupResolved = backupResolvedForPlacement ?? await resolveBackupForSource(config, input.source.backup_id);
        if ('error' in backupResolved) return c.json(backupResolved.error.body, backupResolved.error.status as never);
        const { sourceMachine, backupName } = backupResolved;
        if (sourceMachine.incusClusterId !== cluster.id) {
          return c.json({ error: true, message: 'Backup source is in a different Incus cluster' }, 409);
        }
        if (sourceMachine.type !== input.type) {
          return c.json({ error: true, message: 'Backup source type does not match requested machine type' }, 409);
        }
        const machineId = generatedMachineId();
        const displayName = displayMachineName(input.name, machineId);
        const incusName = machineId;
        // "Create from backup" semantics. Two paths:
        //   • Same-project clone — Incus 6.23 rejects tarball import when the
        //     source instance still exists in the same project (it tries to
        //     re-set immutable `volatile.idmap.base` keys). Use native copy
        //     instead, which is point-in-time identical to the most recent
        //     state of the source. The `backup_id` becomes a marker that
        //     "this clone was associated with a backup" without requiring
        //     the tarball detour.
        //   • Cross-project / external — fall back to tarball export+import
        //     (the original implementation). This is the only path that can
        //     reconstitute an instance whose source was already deleted.
        const sameProject = sourceMachine.incusProject === cluster.project;
        let importOp: Awaited<ReturnType<typeof client.importInstanceFromTarball>>;
        let startOp: IncusOperation | Record<string, unknown> | null = null;
        let startNoop = false;
        if (sameProject) {
          importOp = await client.createInstance({
            name: incusName,
            machineType: input.type,
            source: { type: 'snapshot', source: sourceMachine.incusInstanceName },
            targetMember: member.server_name,
            resources: { vcpu: input.resources.vcpu, memoryGb: input.resources.memory_gb, diskGb: input.resources.disk_gb },
            start: false,
            machineId,
            displayName,
            accountId: c.req.header('x-account-id') || 'system',
          });
          startOp = null;
        } else {
          const tarball = await client.exportBackup(sourceMachine.incusInstanceName, backupName);
          importOp = await client.importInstanceFromTarball({
            tarball,
            targetName: incusName,
            targetMember: member.server_name,
          });
          await applyResourceConfig(client, incusName, cluster, input.resources, { machineId, displayName, machineType: input.type, accountId: c.req.header('x-account-id') || 'system' });
          try {
            const started = await startCreatedMachine(client, incusName);
            startOp = started.operation;
            startNoop = started.noop;
          } catch (error) {
            await client.deleteInstance(incusName, { force: true }).catch(() => undefined);
            throw error;
          }
        }

        let observed: IncusInstance | null = null;
        let resourceOperation: Record<string, unknown> | null = null;
        let isolationCheck: ReturnType<typeof validateMachineIsolation> | null = null;
        try {
          const enforced = await enforceCreatedMachineResources({
            client,
            cluster,
            instanceName: incusName,
            resources: input.resources,
            machineId,
            displayName,
            machineType: input.type,
            accountId: c.req.header('x-account-id') || 'system',
          });
          observed = enforced.observed;
          isolationCheck = enforced.isolation;
          resourceOperation = { synced: true, mode: 'post-create-resource-enforce', at: new Date().toISOString(), resources: input.resources };
          const running = await ensureCreatedMachineRunning(client, incusName);
          observed = running.observed;
          if (running.startOperation) startOp = running.startOperation;
          startNoop = running.startNoop;
        } catch (error) {
          await client.deleteInstance(incusName, { force: true }).catch(() => undefined);
          throw error;
        }

        let productMachine = null;
        let proxySync: Record<string, unknown> | null = null;
        let daemonEnsure: Record<string, unknown> | null = null;
        if (config.databaseConfigured) {
          productMachine = await getPrisma().machine.create({
            data: {
              id: machineId,
              accountId: c.req.header('x-account-id') || 'system',
              name: displayName,
              region: input.region,
              type: input.type,
              status: observed?.status ?? 'Running',
              sourceType: 'backup',
              sourceId: input.source.backup_id,
              incusClusterId: cluster.id,
              incusProject: cluster.project,
              incusInstanceName: incusName,
              incusMemberName: member.server_name,
              resources: input.resources,
              metadata: {
                incus_operation: importOp,
                start_operation: startOp,
                start_noop: startNoop,
                resource_operation: resourceOperation,
                isolation_check: isolationCheck,
                scheduler_placement: placement.placement,
                display_name: displayName,
                incus_hostname: incusName,
                source_backup: { source_machine_id: sourceMachine.id, backup_name: backupName },
                env: input.env ?? {},
                labels: input.labels ?? {},
                lifecycle: input.lifecycle ?? {},
                last_used_at: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
          proxySync = await syncResolvedMachineProxy(config, { machine: productMachine, cluster, client }, observed).catch((error) => ({
            synced: false,
            reason: error instanceof Error ? error.message : String(error),
          }));
          await getPrisma().machine.update({
            where: { id: productMachine.id },
            data: { metadata: { ...jsonRecord(productMachine.metadata), proxy_sync: proxySync } as Prisma.InputJsonValue },
          }).catch(() => undefined);
          await queueResolvedManagedDaemonEnsure(config, { machine: productMachine, cluster, client }, { verifyPort: null });
          daemonEnsure = { ok: false, mode: 'guest-daemon', state: 'installing', queued_at: new Date().toISOString() };
          productMachine = await getPrisma().machine.findUnique({ where: { id: productMachine.id } }) ?? productMachine;
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
            incus_operation: importOp,
            start_operation: startOp,
            start_noop: startNoop,
            proxy_sync: proxySync,
            managed_daemon: daemonEnsure,
            resource_operation: resourceOperation,
            isolation_check: isolationCheck,
            scheduler_placement: placement.placement,
          },
        }, 201);
      }

      const resolvedSource = await resolveCreateInstanceSource(config, input, cluster);
      if ('error' in resolvedSource) return c.json(resolvedSource.error.body, resolvedSource.error.status as never);

      const machineId = generatedMachineId();
      const displayName = displayMachineName(input.name, machineId);
      const incusName = machineId;
      const operation = await client.createInstance({
        name: incusName,
        machineType: input.type,
        source: resolvedSource.source,
        targetMember: member.server_name,
        resources: {
          vcpu: input.resources.vcpu,
          memoryGb: input.resources.memory_gb,
          diskGb: input.resources.disk_gb,
        },
        start: false,
        machineId,
        displayName,
        accountId: c.req.header('x-account-id') || 'system',
      });

      let observed: IncusInstance | null = null;
      let startOperation: IncusOperation | Record<string, unknown> | null = operation;
      let startNoop = false;
      let resourceOperation: Record<string, unknown> | null = null;
      let isolationCheck: ReturnType<typeof validateMachineIsolation> | null = null;
      try {
        const enforced = await enforceCreatedMachineResources({
          client,
          cluster,
          instanceName: incusName,
          resources: input.resources,
          machineId,
          displayName,
          machineType: input.type,
          accountId: c.req.header('x-account-id') || 'system',
        });
        observed = enforced.observed;
        isolationCheck = enforced.isolation;
        resourceOperation = { synced: true, mode: 'post-create-resource-enforce', at: new Date().toISOString(), resources: input.resources };
        const running = await ensureCreatedMachineRunning(client, incusName);
        observed = running.observed;
        if (running.startOperation) startOperation = running.startOperation;
        startNoop = running.startNoop;
      } catch (error) {
        await client.deleteInstance(incusName, { force: true }).catch(() => undefined);
        throw error;
      }

      let productMachine = null;
      let proxySync: Record<string, unknown> | null = null;
      let daemonEnsure: Record<string, unknown> | null = null;
      if (config.databaseConfigured) {
        productMachine = await getPrisma().machine.create({
          data: {
            id: machineId,
            accountId: c.req.header('x-account-id') || 'system',
            name: displayName,
            region: input.region,
            type: input.type,
            status: observed?.status ?? 'Running',
            sourceType: input.source.type,
            sourceId: resolvedSource.sourceId,
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
            } as Prisma.InputJsonValue,
          },
        });
        proxySync = await syncResolvedMachineProxy(config, { machine: productMachine, cluster, client }, observed).catch((error) => ({
          synced: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
        await getPrisma().machine.update({
          where: { id: productMachine.id },
          data: { metadata: { ...jsonRecord(productMachine.metadata), proxy_sync: proxySync } as Prisma.InputJsonValue },
        }).catch(() => undefined);
        await queueResolvedManagedDaemonEnsure(config, { machine: productMachine, cluster, client }, { verifyPort: null });
        daemonEnsure = { ok: false, mode: 'guest-daemon', state: 'installing', queued_at: new Date().toISOString() };
        productMachine = await getPrisma().machine.findUnique({ where: { id: productMachine.id } }) ?? productMachine;
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
          if (config.databaseConfigured) {
            const prevMeta = jsonRecord(resolved.machine.metadata);
            const proxySync = await syncResolvedMachineProxy(config, resolved, observed).catch((error) => ({
              synced: false,
              reason: error instanceof Error ? error.message : String(error),
            }));
            const daemonEnsure = action === 'start'
              ? (await queueResolvedManagedDaemonEnsure(config, resolved, { verifyPort: null }).then(() => ({ ok: false, mode: 'guest-daemon', state: 'installing', queued_at: new Date().toISOString() })).catch((error) => ({
                ok: false, error: error instanceof Error ? error.message : String(error), mode: 'guest-daemon', state: 'failed', queued_at: new Date().toISOString(),
              })))
              : undefined;
            const nextMeta: Record<string, unknown> = {
              ...prevMeta,
              last_lifecycle_operation: operation,
              last_observed_status: observed?.status ?? null,
              last_observed_at: new Date().toISOString(),
              proxy_sync: proxySync,
              ...(daemonEnsure ? { managed_daemon: daemonEnsure, managed_daemon_state: 'installing' } : {}),
            };
            // Bump last_used_at on start (for the auto-stop timer); set
            // stopped_at on stop (for the auto-archive / auto-delete timers).
            if (action === 'start') nextMeta.last_used_at = new Date().toISOString();
            if (action === 'stop') nextMeta.stopped_at = new Date().toISOString();
            await getPrisma().machine.update({
              where: { id: resolved.machine.id },
              data: { status: observed?.status ?? (action === 'stop' ? 'Stopped' : 'Running'), metadata: nextMeta as Prisma.InputJsonValue },
            }).catch(() => undefined);

            // Ephemeral semantics: stop → immediately delete. Fire-and-forget
            // so the user gets a fast 200; the actual delete races but is
            // invisible from the API surface (subsequent GETs just 404).
            const lifecycle = (prevMeta.lifecycle && typeof prevMeta.lifecycle === 'object') ? prevMeta.lifecycle as Record<string, unknown> : {};
            if (action === 'stop' && lifecycle.ephemeral === true) {
              resolved.client.deleteInstance(resolved.machine.incusInstanceName, { force: true }).then(async () => {
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
        const operation = await resolved.client.deleteInstance(resolved.machine.incusInstanceName, { force: true });
        const deletedAt = new Date().toISOString();
        const proxyDelete = { synced: true, mode: 'v2-api-direct', at: deletedAt };
        const proxyTokenDeletes = proxyTokenDescriptors(resolved.machine).map((token) => ({ id: token.id, synced: true, mode: 'v2-api-direct', at: deletedAt }));
        if (config.databaseConfigured) {
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
            const costAttribution = measuredBytes
              ? exactArtifactCostAttribution(resolved.machine, {
                kind: 'snapshot',
                bytes: measuredBytes,
                note: snapshot.name.startsWith('bk-snap-')
                  ? 'Exact Incus-reported size for this pinned local restore snapshot. Account billing should use the account ledger, not this machine view.'
                  : 'Exact Incus-reported snapshot size. Account billing should use the account ledger, not this machine view.',
              })
              : undefined;
            return {
              ...snapshot,
              id: row?.id ?? snapshot.name,
              account_id: resolved.machine.accountId,
              machine_id: resolved.machine.id,
              ...(costAttribution ? { cost_attribution: costAttribution } : {}),
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
        let operation: IncusOperation;
        try {
          operation = await resolved.client.restoreSnapshot(resolved.machine.incusInstanceName, c.req.param('name'), input);
        } finally {
          if (temporarilyEnabledStateful) {
            await resolved.client.updateInstanceConfig(resolved.machine.incusInstanceName, { 'migration.stateful': 'false' }).catch(() => undefined);
          }
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

      // Branch 1: pull from a Docker/OCI registry into a cluster's Incus image catalog.
      if (input.docker) {
        const cluster = input.cluster_id
          ? findCluster(config, input.cluster_id)
          : input.region
            ? pickCluster(config, input.region)
            : (config.clusters[0] ?? null);
        if (!cluster) return c.json({ error: true, message: 'No Incus cluster available for the requested region/cluster_id' }, 409);
        const server = input.docker.server ?? 'https://docker.io';
        const imageType = input.docker.as_vm ? 'virtual-machine' as const : 'container' as const;
        const operation = await clientFor(cluster).createImageFromOci({
          server,
          ociRef: input.docker.ref,
          imageType,
          aliases: [{ name: alias, description: `JustAVPS image ${alias} (OCI: ${input.docker.ref}${input.docker.as_vm ? ', vm' : ''})` }],
          properties: { ...input.properties, 'justavps.source': 'docker', 'justavps.docker_ref': input.docker.ref, 'justavps.docker_server': server, 'justavps.image_type': imageType },
          public: input.public,
        });

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
              metadata: { incus_operation: operation, alias, docker_ref: input.docker.ref, docker_server: server },
            },
          });
        }
        return c.json({ image: image ?? { id: alias, name: alias, source: 'docker', docker_ref: input.docker.ref }, operation }, 201);
      }

      // Branch 1b: pull from simplestreams (linuxcontainers.org). Same shape
      // as the OCI branch — the only differences are the protocol on the
      // Incus side and the property tag on our side. This is the right path
      // for VM-bootable public catalog images.
      if (input.simplestreams) {
        const cluster = input.cluster_id
          ? findCluster(config, input.cluster_id)
          : input.region
            ? pickCluster(config, input.region)
            : (config.clusters[0] ?? null);
        if (!cluster) return c.json({ error: true, message: 'No Incus cluster available for the requested region/cluster_id' }, 409);
        const server = input.simplestreams.server ?? 'https://images.linuxcontainers.org';
        const imageType = input.simplestreams.as_vm ? 'virtual-machine' as const : 'container' as const;
        const operation = await clientFor(cluster).createImageFromSimplestreams({
          server,
          alias: input.simplestreams.ref,
          imageType,
          aliases: [{ name: alias, description: `JustAVPS image ${alias} (simplestreams: ${input.simplestreams.ref}${input.simplestreams.as_vm ? ', vm' : ''})` }],
          properties: { ...input.properties, 'justavps.source': 'simplestreams', 'justavps.simplestreams_ref': input.simplestreams.ref, 'justavps.simplestreams_server': server, 'justavps.image_type': imageType },
          public: input.public,
        });
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
              metadata: { incus_operation: operation, alias, simplestreams_ref: input.simplestreams.ref, simplestreams_server: server, image_type: imageType },
            },
          });
        }
        return c.json({ image: image ?? { id: alias, name: alias, source: 'simplestreams', simplestreams_ref: input.simplestreams.ref }, operation }, 201);
      }

      // Branch 2: publish from an existing machine (with optional snapshot).
      const resolved = await machineClient(config, input.machine_id!);
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const operation = await resolved.client.createImageFromInstance({
        instanceName: resolved.machine.incusInstanceName,
        snapshotName: input.snapshot_id,
        aliases: [{ name: alias, description: `JustAVPS image ${alias}` }],
        properties: input.properties,
        public: input.public,
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
            sourceSnapshotId: input.snapshot_id ?? null,
            metadata: { incus_operation: operation, alias },
          },
        });
      }
      return c.json({ image: image ?? { id: alias, name: alias }, operation }, 201);
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
            const costAttribution = tarballBytes && restoreSnapshotBytes
              ? exactArtifactCostAttribution(resolved.machine, {
                kind: 'backup',
                bytes: tarballBytes + restoreSnapshotBytes,
                note: 'Exact Incus-reported backup tarball size plus exact Incus-reported pinned restore snapshot size. Account billing should use the account ledger, not this machine view.',
                components: [
                  { label: 'backup tarball', metered_bytes: tarballBytes, billable_gib: Number((tarballBytes / 1024 / 1024 / 1024).toFixed(9)) },
                  { label: 'pinned restore snapshot', metered_bytes: restoreSnapshotBytes, billable_gib: Number((restoreSnapshotBytes / 1024 / 1024 / 1024).toFixed(9)) },
                ],
              })
              : undefined;
            return {
              ...backup,
              id: row?.id ?? backup.name,
              account_id: resolved.machine.accountId,
              machine_id: resolved.machine.id,
              incus_backup_name: backup.name,
              restore_snapshot: `bk-snap-${backup.name}`,
              ...(costAttribution ? { cost_attribution: costAttribution } : {}),
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
        const name = input.name ?? generatedResourceName('backup');
        // Two artifacts per backup, kept in sync:
        //   • Incus snapshot — used for in-place restore (which Incus 6.23
        //     refuses to do via tarball import because volatile.* keys are
        //     immutable). The snapshot name is `bk-snap-<backup-name>` so the
        //     restore path can find it deterministically.
        //   • Incus backup tarball — used for cross-cluster restoration and
        //     long-term archival. Untouched on in-place restore.
        const operation = await resolved.client.createBackup(resolved.machine.incusInstanceName, name, {
          instanceOnly: input.instance_only,
          optimizedStorage: input.optimized_storage,
          expiresAt: input.expires_at,
        });
        const restoreSnapshotName = `bk-snap-${name}`;
        await resolved.client.createSnapshot(resolved.machine.incusInstanceName, restoreSnapshotName, { stateful: false }).catch(() => undefined);
        let backup = null;
        if (config.databaseConfigured) {
          backup = await getPrisma().backup.create({
            data: {
              accountId: resolved.machine.accountId,
              machineId: resolved.machine.id,
              status: 'ready',
              incusBackupName: name,
              metadata: {
                incus_operation: operation,
                restore_snapshot: restoreSnapshotName,
                instance_only: input.instance_only,
                optimized_storage: input.optimized_storage,
                expires_at: input.expires_at ?? null,
              },
            },
          });
        }
        return c.json({ backup: backup ?? { id: name, name, incus_backup_name: name, restore_snapshot: restoreSnapshotName }, operation }, 201);
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
        const instanceName = resolved.machine.incusInstanceName;
        // In-place restore via the snapshot we pinned at backup-time. The
        // tarball still exists for archival / cross-cluster transfer; it's
        // just not the path we walk for same-instance rollback.
        const restoreSnapshotName = `bk-snap-${backupName}`;
        const restoreOp = await resolved.client.restoreSnapshot(instanceName, restoreSnapshotName, { stateful: false });
        if (config.databaseConfigured) {
          const existingMetadata = jsonRecord(resolved.machine.metadata);
          await getPrisma().machine.update({
            where: { id: resolved.machine.id },
            data: {
              status: 'provisioned',
              metadata: {
                ...existingMetadata,
                last_backup_restore: { backup_name: backupName, restored_at: new Date().toISOString(), incus_operation: restoreOp },
              } as Prisma.InputJsonValue,
            },
          }).catch(() => undefined);
        }
        return c.json({ ok: true as const, operation: restoreOp });
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
        const operation = await resolved.client.deleteBackup(resolved.machine.incusInstanceName, backupName);
        // Drop the pinned restore snapshot too — both artifacts go together.
        await resolved.client.deleteSnapshot(resolved.machine.incusInstanceName, `bk-snap-${backupName}`).catch(() => undefined);
        if (config.databaseConfigured) await getPrisma().backup.deleteMany({ where: { machineId: resolved.machine.id, incusBackupName: backupName } });
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
        const result = await resolved.client.exec(resolved.machine.incusInstanceName, {
          command: argv,
          env: mergedEnv,
          cwd: input.cwd,
          user: input.user,
          group: input.group,
          stdin: input.stdin,
          timeoutMs: input.timeout_ms,
        });
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
      const result = await callToolboxJson(baseUrl, 'toolbox/process/execute', {
        method: 'POST',
        body: JSON.stringify(input),
      });
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
