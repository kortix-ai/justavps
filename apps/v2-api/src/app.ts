import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppConfig, IncusClusterConfig } from './config.js';
import { registerAdminUi } from './admin-ui-static.js';
import { getPrisma } from './db/client.js';
import { IncusApiError, IncusClient, type CreateInstanceSource } from './incus/client.js';
import { syncHetznerServers, mapHetznerServer } from './services/hetznerInventory.js';
import { syncIncusObservation, type IncusObservation } from './services/incusSync.js';
import { HetznerRobotClient, type HetznerRobotProduct } from './vendors/hetznerRobot.js';

const createMachineSchema = z.object({
  region: z.string().min(1).default('eu'),
  type: z.enum(['container', 'vm']).default('container'),
  name: z.string().min(1).max(63).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/).optional(),
  resources: z.object({
    vcpu: z.number().int().min(1).max(256),
    memory_gb: z.number().int().min(1).max(2048),
    disk_gb: z.number().int().min(1).max(100_000),
  }),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('image'), image_id: z.string().min(1) }),
    z.object({ type: z.literal('snapshot'), snapshot_id: z.string().min(1) }),
    z.object({ type: z.literal('backup'), backup_id: z.string().min(1) }),
    z.object({ type: z.literal('empty') }),
  ]),
});

type CreateMachineInput = z.infer<typeof createMachineSchema>;

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
    machine_id: z.string().min(1).optional(),
    snapshot_id: z.string().min(1).optional(),
    docker: z
      .object({
        ref: z.string().min(1).max(200),
        server: z.string().url().optional(),
      })
      .optional(),
    region: z.string().min(1).optional(),
    cluster_id: z.string().min(1).optional(),
    name: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_.:-]*$/).optional(),
    public: z.boolean().optional().default(false),
    properties: z.record(z.string(), z.string()).optional().default({}),
  })
  .refine((data) => Boolean(data.machine_id) !== Boolean(data.docker), {
    message: 'Provide exactly one of machine_id or docker',
    path: ['machine_id'],
  });

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

function generatedMachineName(inputName?: string) {
  return inputName ?? `jv2-${randomUUID().replaceAll('-', '').slice(0, 18)}`;
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
  if (input.source.type === 'empty') return { source: { type: 'empty' }, sourceId: null };
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

function routeError(error: unknown) {
  if (error instanceof z.ZodError) return { status: 400, body: { error: true, message: 'Invalid request', issues: error.issues } };
  if (error instanceof IncusApiError) return { status: 502, body: { error: true, message: error.message, incus_status: error.statusCode, incus_body: error.body } };
  return { status: 500, body: { error: true, message: error instanceof Error ? error.message : String(error) } };
}

function isLifecycleNoop(error: unknown, action: 'start' | 'stop' | 'reboot') {
  const message = error instanceof IncusApiError
    ? error.body.toLowerCase()
    : error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (action === 'start' && message.includes('already running')) || (action === 'stop' && message.includes('already stopped'));
}

function adminGuard(config: AppConfig, authorization: string | undefined) {
  if (!config.adminToken) return null;
  return authorization === `Bearer ${config.adminToken}` ? null : { error: true, message: 'Unauthorized' };
}

async function loadProductMachine(config: AppConfig, id: string) {
  if (config.databaseConfigured) {
    const machine = await getPrisma().machine.findUnique({ where: { id } });
    if (machine) return machine;
  }
  for (const cluster of config.clusters) {
    const instances = await clientFor(cluster).listInstances();
    const instance = instances.find((item) => item.name === id || item.config?.['user.justavps.machine_id'] === id);
    if (instance) {
      return {
        id: instance.config?.['user.justavps.machine_id'] ?? instance.name,
        accountId: 'system',
        name: instance.name,
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

async function machineClient(config: AppConfig, id: string) {
  const machine = await loadProductMachine(config, id);
  if (!machine) return null;
  const cluster = findCluster(config, machine.incusClusterId);
  if (!cluster) throw new Error(`Configured Incus cluster ${machine.incusClusterId} not found`);
  return { machine, cluster, client: clientFor(cluster) };
}

function serializeMachine(machine: Awaited<ReturnType<typeof loadProductMachine>>, incus?: unknown) {
  if (!machine) return null;
  return {
    id: machine.id,
    name: machine.name,
    region: machine.region,
    type: machine.type,
    status: machine.status,
    source: { type: machine.sourceType, id: machine.sourceId },
    incus: {
      cluster_id: machine.incusClusterId,
      project: machine.incusProject,
      instance_name: machine.incusInstanceName,
      member_name: machine.incusMemberName,
      observed: incus ?? null,
    },
    resources: machine.resources,
    metadata: machine.metadata,
    created_at: machine.createdAt.toISOString(),
    updated_at: machine.updatedAt.toISOString(),
  };
}

export function createApp(config: AppConfig) {
  const app = new Hono();

  app.use('*', async (c, next) => {
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

  app.get('/health', (c) => c.json({
    status: 'ok',
    service: 'justavps-v2-api',
    database_configured: config.databaseConfigured,
    incus_clusters_configured: config.clusters.length,
    hetzner_robot_configured: Boolean(config.hetznerRobot),
  }));

  app.get('/', (c) => c.redirect('/admin-ui/'));
  registerAdminUi(app);

  app.get('/regions', (c) => c.json({
    regions: Array.from(new Set(config.clusters.map((cluster) => cluster.region))).sort(),
  }));

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
      const servers = await new HetznerRobotClient(config.hetznerRobot).listServers();
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

  app.post('/admin/procurements/:id/order', async (c) => {
    try {
      if (!config.databaseConfigured) return c.json({ error: true, message: 'Database not configured' }, 400);
      const input = procurementOrderSchema.parse(await c.req.json().catch(() => ({})));
      const procurement = await getPrisma().procurement.findUnique({ where: { id: c.req.param('id') } });
      if (!procurement) return c.json({ error: true, message: 'Procurement not found' }, 404);

      const plan = buildOrderPlan(procurement);
      const updated = await getPrisma().procurement.update({
        where: { id: procurement.id },
        data: {
          status: input.execute ? 'order_blocked' : 'order_planned',
          result: {
            ...jsonRecord(procurement.result),
            order_plan: plan,
            order_note: input.note ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      if (input.execute) return c.json({ error: true, message: 'Live host ordering is blocked by policy', procurement: updated, plan }, input.confirm === 'ORDER REAL HOSTS' ? 501 : 409);
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
      return c.json({ hosts, persisted: true });
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

  app.get('/images', async (c) => {
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
  });

  app.get('/machines', async (c) => {
    try {
      const machines = (await Promise.all(config.clusters.map(async (cluster) => {
        const observed = await clientFor(cluster).listInstances();
        return observed.map((instance) => ({
          id: instance.config?.['user.justavps.machine_id'] ?? instance.name,
          name: instance.name,
          type: instance.type === 'virtual-machine' ? 'vm' : 'container',
          status: instance.status,
          location: instance.location ?? null,
          cluster: publicCluster(cluster),
          incus: instance,
        }));
      }))).flat();
      return c.json({ machines });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machines/:id', async (c) => {
    try {
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const incus = await resolved.client.getInstance(resolved.machine.incusInstanceName);
      return c.json({ machine: serializeMachine(resolved.machine, incus) });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machines', async (c) => {
    try {
      const authError = adminGuard(config, c.req.header('authorization'));
      if (authError) return c.json(authError, 401);

      const input = createMachineSchema.parse(await c.req.json());
      const cluster = pickCluster(config, input.region);
      if (!cluster) return c.json({ error: true, message: `No Incus cluster configured for region ${input.region}` }, 409);

      const client = clientFor(cluster);
      const resolvedSource = await resolveCreateInstanceSource(config, input, cluster);
      if ('error' in resolvedSource) return c.json(resolvedSource.error.body, resolvedSource.error.status as never);

      const member = await pickOnlineMember(client, resolvedSource.preferredMemberName);
      if (!member) return c.json({ error: true, message: 'No online Incus cluster member available' }, 409);

      const name = generatedMachineName(input.name);
      const operation = await client.createInstance({
        name,
        machineType: input.type,
        source: resolvedSource.source,
        targetMember: member.server_name,
        resources: {
          vcpu: input.resources.vcpu,
          memoryGb: input.resources.memory_gb,
          diskGb: input.resources.disk_gb,
        },
      });

      let productMachine = null;
      if (config.databaseConfigured) {
        productMachine = await getPrisma().machine.create({
          data: {
            id: name,
            accountId: c.req.header('x-account-id') || 'system',
            name,
            region: input.region,
            type: input.type,
            status: 'provisioned',
            sourceType: input.source.type,
            sourceId: resolvedSource.sourceId,
            incusClusterId: cluster.id,
            incusProject: cluster.project,
            incusInstanceName: name,
            incusMemberName: member.server_name,
            resources: input.resources,
            metadata: { incus_operation: operation },
          },
        });
      }

      return c.json({
        machine: productMachine ? serializeMachine(productMachine) : {
          id: name,
          name,
          type: input.type,
          region: input.region,
          cluster: publicCluster(cluster),
          member: member.server_name,
          source: input.source,
          resources: input.resources,
          incus_operation: operation,
        },
      }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  for (const action of ['start', 'stop', 'reboot'] as const) {
    app.post(`/machines/:id/${action}`, async (c) => {
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
        if (config.databaseConfigured) {
          const metadata = { ...(resolved.machine.metadata as Record<string, unknown>), last_lifecycle_operation: operation } as Prisma.InputJsonValue;
          await getPrisma().machine.update({
            where: { id: resolved.machine.id },
            data: { status: action === 'stop' ? 'Stopped' : 'Running', metadata },
          }).catch(() => undefined);
        }
        return c.json({ ok: true, noop, operation });
      } catch (error) {
        const response = routeError(error);
        return c.json(response.body, response.status as never);
      }
    });
  }

  app.delete('/machines/:id', async (c) => {
    try {
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const operation = await resolved.client.deleteInstance(resolved.machine.incusInstanceName, { force: true });
      if (config.databaseConfigured) {
        await getPrisma().machine.update({ where: { id: resolved.machine.id }, data: { status: 'deleted' } }).catch(() => undefined);
      }
      return c.json({ ok: true, operation });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machines/:id/snapshots', async (c) => {
    try {
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const snapshots = await resolved.client.listSnapshots(resolved.machine.incusInstanceName);
      return c.json({ snapshots });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machines/:id/snapshots', async (c) => {
    try {
      const input = createSnapshotSchema.parse(await c.req.json().catch(() => ({})));
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const name = input.name ?? generatedResourceName('snap');
      const operation = await resolved.client.createSnapshot(resolved.machine.incusInstanceName, name, { stateful: input.stateful, expiresAt: input.expires_at });
      let snapshot = null;
      if (config.databaseConfigured) {
        snapshot = await getPrisma().snapshot.create({
          data: {
            accountId: resolved.machine.accountId,
            machineId: resolved.machine.id,
            name,
            incusSnapshotName: name,
            status: 'ready',
            metadata: { incus_operation: operation },
          },
        });
      }
      return c.json({ snapshot: snapshot ?? { id: name, name, incus_snapshot_name: name }, operation }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machines/:id/snapshots/:snapshotId/restore', async (c) => {
    try {
      const input = restoreSnapshotSchema.parse(await c.req.json().catch(() => ({})));
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const operation = await resolved.client.restoreSnapshot(resolved.machine.incusInstanceName, c.req.param('snapshotId'), input);
      return c.json({ ok: true, operation });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.delete('/machines/:id/snapshots/:snapshotId', async (c) => {
    try {
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const snapshotName = c.req.param('snapshotId');
      const operation = await resolved.client.deleteSnapshot(resolved.machine.incusInstanceName, snapshotName);
      if (config.databaseConfigured) {
        await getPrisma().snapshot.deleteMany({ where: { machineId: resolved.machine.id, incusSnapshotName: snapshotName } });
      }
      return c.json({ ok: true, operation });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/images', async (c) => {
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
        const operation = await clientFor(cluster).createImageFromOci({
          server,
          ociRef: input.docker.ref,
          aliases: [{ name: alias, description: `JustAVPS image ${alias} (OCI: ${input.docker.ref})` }],
          properties: { ...input.properties, 'justavps.source': 'docker', 'justavps.docker_ref': input.docker.ref, 'justavps.docker_server': server },
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
  });

  app.delete('/images/:id', async (c) => {
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
      return c.json({ ok: true, operation });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.get('/machines/:id/backups', async (c) => {
    try {
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const backups = await resolved.client.listBackups(resolved.machine.incusInstanceName);
      return c.json({ backups });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machines/:id/backups', async (c) => {
    try {
      const input = createBackupSchema.parse(await c.req.json().catch(() => ({})));
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const name = input.name ?? generatedResourceName('backup');
      const operation = await resolved.client.createBackup(resolved.machine.incusInstanceName, name, {
        instanceOnly: input.instance_only,
        optimizedStorage: input.optimized_storage,
        expiresAt: input.expires_at,
      });
      let backup = null;
      if (config.databaseConfigured) {
        backup = await getPrisma().backup.create({
          data: {
            accountId: resolved.machine.accountId,
            machineId: resolved.machine.id,
            status: 'ready',
            incusBackupName: name,
            metadata: { incus_operation: operation },
          },
        });
      }
      return c.json({ backup: backup ?? { id: name, name, incus_backup_name: name }, operation }, 201);
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

  app.post('/machines/:id/backups/:backupId/restore', async (c) => {
    void c;
    return c.json({ error: true, message: 'Incus backup restore requires import/export plumbing and is not implemented yet' }, 501);
  });

  app.delete('/machines/:id/backups/:backupId', async (c) => {
    try {
      const resolved = await machineClient(config, c.req.param('id'));
      if (!resolved) return c.json({ error: true, message: 'Machine not found' }, 404);
      const backupName = c.req.param('backupId');
      const operation = await resolved.client.deleteBackup(resolved.machine.incusInstanceName, backupName);
      if (config.databaseConfigured) await getPrisma().backup.deleteMany({ where: { machineId: resolved.machine.id, incusBackupName: backupName } });
      return c.json({ ok: true, operation });
    } catch (error) {
      const response = routeError(error);
      return c.json(response.body, response.status as never);
    }
  });

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
      return c.json({ machine: serializeMachine(updated), toolbox: toolboxRoutes(updated.id, toolboxBaseUrl(updated)) });
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

  return app;
}
