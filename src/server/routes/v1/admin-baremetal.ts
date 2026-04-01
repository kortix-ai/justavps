import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../../db';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { errorResponse, handleRouteError } from '../../lib/route-helpers';
import { config } from '../../lib/config';
import { baremetalHosts, baremetalProcurements } from '../../db/schema';
import { HetznerRobotClient } from '../../lib/baremetal/vendors/hetzner-robot';

export const adminBaremetalApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminBaremetalApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) return errorResponse(c, 403, 'Admin access required');
  return null;
}

const HostClassSchema = z.enum(['general-small', 'general-medium', 'memory-heavy', 'gpu']);

const HostListResponseSchema = z.object({
  hosts: z.array(z.object({
    id: z.string().uuid(),
    vendor: z.string(),
    host_class: z.string(),
    region: z.string(),
    location: z.string(),
    name: z.string(),
    status: z.string(),
    provider_server_number: z.string().nullable(),
    provider_transaction_id: z.string().nullable(),
    public_ipv4: z.string().nullable(),
    public_ipv6: z.string().nullable(),
    runner_base_url: z.string().nullable(),
    total_vcpu: z.number().nullable(),
    total_memory_gb: z.number().nullable(),
    total_disk_gb: z.number().nullable(),
    used_vcpu: z.number(),
    used_memory_gb: z.number(),
    used_disk_gb: z.number(),
    last_heartbeat_at: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.string(),
    updated_at: z.string(),
  })),
});

const ProcurementListResponseSchema = z.object({
  procurements: z.array(z.object({
    id: z.string().uuid(),
    vendor: z.string(),
    host_class: z.string(),
    product_id: z.string(),
    region: z.string(),
    location: z.string(),
    status: z.string(),
    host_id: z.string().uuid().nullable(),
    provider_transaction_id: z.string().nullable(),
    requires_approval: z.boolean(),
    error: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    approved_at: z.string().nullable(),
    ordered_at: z.string().nullable(),
    resolved_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })),
});

const HetznerProductListResponseSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    name: z.string(),
    location: z.array(z.string()).optional(),
    description: z.array(z.string()).optional(),
  })),
});

function serializeHost(row: typeof baremetalHosts.$inferSelect) {
  return {
    id: row.id,
    vendor: row.vendor,
    host_class: row.hostClass,
    region: row.region,
    location: row.location,
    name: row.name,
    status: row.status,
    provider_server_number: row.providerServerNumber,
    provider_transaction_id: row.providerTransactionId,
    public_ipv4: row.publicIpv4,
    public_ipv6: row.publicIpv6,
    runner_base_url: row.runnerBaseUrl,
    total_vcpu: row.totalVcpu,
    total_memory_gb: row.totalMemoryGb,
    total_disk_gb: row.totalDiskGb,
    used_vcpu: row.usedVcpu,
    used_memory_gb: row.usedMemoryGb,
    used_disk_gb: row.usedDiskGb,
    last_heartbeat_at: row.lastHeartbeatAt?.toISOString() ?? null,
    metadata: row.metadata ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function serializeProcurement(row: typeof baremetalProcurements.$inferSelect) {
  return {
    id: row.id,
    vendor: row.vendor,
    host_class: row.hostClass,
    product_id: row.productId,
    region: row.region,
    location: row.location,
    status: row.status,
    host_id: row.hostId,
    provider_transaction_id: row.providerTransactionId,
    requires_approval: row.requiresApproval,
    error: row.error,
    metadata: row.metadata ?? {},
    approved_at: row.approvedAt?.toISOString() ?? null,
    ordered_at: row.orderedAt?.toISOString() ?? null,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

async function placeHetznerRobotOrder(procurementId: string, approvedByUserId?: string) {
  const [procurement] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurementId));
  if (!procurement) throw new Error('Procurement request not found');
  if (!config.hasHetznerRobotCredentials()) throw new Error('Hetzner Robot credentials are not configured');
  if (!config.BAREMETAL_BOOTSTRAP_PUBLIC_KEY) throw new Error('Bare-metal bootstrap public key is not configured');

  const robot = new HetznerRobotClient();
  const bootstrapFingerprint = await robot.ensureKey({
    name: 'justavps-bootstrap',
    data: config.BAREMETAL_BOOTSTRAP_PUBLIC_KEY,
  });
  const transaction = await robot.orderServer({
    productId: procurement.productId,
    location: procurement.location,
    distribution: 'Ubuntu 24.04 LTS base',
    authorizedKeys: [bootstrapFingerprint],
    addons: ['primary_ipv4'],
  });

  const hostId = procurement.hostId ?? randomUUID();
  const hostName = `bm-${procurement.hostClass}-${procurement.location}-${hostId.slice(0, 8)}`;

  const [host] = await db.insert(baremetalHosts).values({
    id: hostId,
    vendor: procurement.vendor,
    hostClass: procurement.hostClass,
    region: procurement.region,
    location: procurement.location,
    name: hostName,
    status: 'ordering',
    providerTransactionId: transaction.transaction.id,
    providerServerNumber: transaction.transaction.server_number ? String(transaction.transaction.server_number) : null,
    publicIpv4: transaction.transaction.server_ip,
    metadata: {
      procurement_id: procurement.id,
      product_id: procurement.productId,
      order_status: transaction.transaction.status,
      bootstrap_key_fingerprint: bootstrapFingerprint,
    },
  }).onConflictDoNothing().returning();

  await db.update(baremetalProcurements).set({
    status: 'ordering',
    approvedByUserId: approvedByUserId ?? procurement.approvedByUserId,
    approvedAt: approvedByUserId ? new Date() : procurement.approvedAt,
    providerTransactionId: transaction.transaction.id,
    orderedAt: new Date(),
    hostId: host?.id ?? hostId,
    metadata: {
      ...(procurement.metadata ?? {}),
      order_status: transaction.transaction.status,
      server_ip: transaction.transaction.server_ip,
      bootstrap_key_fingerprint: bootstrapFingerprint,
    },
    updatedAt: new Date(),
  }).where(eq(baremetalProcurements.id, procurement.id));

  return { transactionId: transaction.transaction.id, hostId: host?.id ?? hostId };
}

adminBaremetalApp.openapi(createRoute({
  method: 'get',
  path: '/products/hetzner',
  tags: ['Admin Bare Metal'],
  summary: 'List Hetzner Robot dedicated products',
  request: {
    query: z.object({
      location: z.string().optional(),
      max_price: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: { description: 'Hetzner dedicated products', content: { 'application/json': { schema: HetznerProductListResponseSchema } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;
  if (!config.hasHetznerRobotCredentials()) return errorResponse(c, 400, 'Hetzner Robot credentials are not configured');

  try {
    const { location, max_price } = c.req.valid('query');
    const robot = new HetznerRobotClient();
    const products = await robot.listServerProducts({
      ...(location ? { location } : {}),
      ...(typeof max_price === 'number' ? { maxPrice: max_price } : {}),
    });
    return c.json({
      products: products.map((item) => ({
        id: item.product.id,
        name: item.product.name,
        location: item.product.location,
        description: item.product.description,
      })),
    });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL');
  }
});

adminBaremetalApp.openapi(createRoute({
  method: 'get',
  path: '/hosts',
  tags: ['Admin Bare Metal'],
  summary: 'List bare-metal hosts',
  responses: { 200: { description: 'Hosts', content: { 'application/json': { schema: HostListResponseSchema } } } },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;
  const rows = await db.select().from(baremetalHosts);
  return c.json({ hosts: rows.map(serializeHost) });
});

adminBaremetalApp.openapi(createRoute({
  method: 'get',
  path: '/procurements',
  tags: ['Admin Bare Metal'],
  summary: 'List bare-metal procurement requests',
  responses: { 200: { description: 'Procurements', content: { 'application/json': { schema: ProcurementListResponseSchema } } } },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;
  const rows = await db.select().from(baremetalProcurements);
  return c.json({ procurements: rows.map(serializeProcurement) });
});

adminBaremetalApp.openapi(createRoute({
  method: 'post',
  path: '/procurements',
  tags: ['Admin Bare Metal'],
  summary: 'Create a bare-metal procurement request',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            vendor: z.literal('hetzner_robot').default('hetzner_robot'),
            host_class: HostClassSchema,
            product_id: z.string().min(1),
            region: z.string().min(1),
            location: z.string().min(1),
            requires_approval: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Procurement created', content: { 'application/json': { schema: z.object({ procurement: ProcurementListResponseSchema.shape.procurements.element }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  try {
    const body = c.req.valid('json');
    const userId = c.get('userId');
    const requiresApproval = body.requires_approval ?? config.BAREMETAL_PURCHASE_APPROVAL_REQUIRED;

    const [procurement] = await db.insert(baremetalProcurements).values({
      vendor: body.vendor,
      hostClass: body.host_class,
      productId: body.product_id,
      region: body.region,
      location: body.location,
      status: requiresApproval ? 'requested' : 'approved',
      requestedByUserId: userId,
      approvedByUserId: requiresApproval ? null : userId,
      approvedAt: requiresApproval ? null : new Date(),
      requiresApproval,
      metadata: {},
    }).returning();

    if (!requiresApproval) {
      await placeHetznerRobotOrder(procurement.id, userId);
    }

    const [fresh] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurement.id));
    return c.json({ procurement: serializeProcurement(fresh) }, 201);
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL');
  }
});

adminBaremetalApp.openapi(createRoute({
  method: 'post',
  path: '/procurements/{id}/approve',
  tags: ['Admin Bare Metal'],
  summary: 'Approve and place a bare-metal procurement order',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Procurement approved', content: { 'application/json': { schema: z.object({ ok: z.boolean(), transaction_id: z.string(), host_id: z.string().uuid() }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  try {
    const { id } = c.req.valid('param');
    const result = await placeHetznerRobotOrder(id, c.get('userId'));
    return c.json({ ok: true, transaction_id: result.transactionId, host_id: result.hostId });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL');
  }
});

adminBaremetalApp.openapi(createRoute({
  method: 'post',
  path: '/procurements/{id}/sync',
  tags: ['Admin Bare Metal'],
  summary: 'Sync a procurement transaction from Hetzner Robot',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Procurement synced', content: { 'application/json': { schema: z.object({ ok: z.boolean(), procurement: ProcurementListResponseSchema.shape.procurements.element }) } } },
  },
}), async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  try {
    const { id } = c.req.valid('param');
    const [procurement] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, id));
    if (!procurement) return errorResponse(c, 404, 'Procurement not found');
    if (!procurement.providerTransactionId) return errorResponse(c, 400, 'Procurement has no provider transaction');
    if (!config.hasHetznerRobotCredentials()) return errorResponse(c, 400, 'Hetzner Robot credentials are not configured');

    const robot = new HetznerRobotClient();
    const tx = await robot.getOrderTransaction(procurement.providerTransactionId);

    await db.update(baremetalProcurements).set({
      status: tx.transaction.status === 'ready' ? 'bootstrapping' : procurement.status,
      metadata: {
        ...(procurement.metadata ?? {}),
        order_status: tx.transaction.status,
        server_ip: tx.transaction.server_ip,
      },
      resolvedAt: tx.transaction.status === 'ready' ? new Date() : procurement.resolvedAt,
      updatedAt: new Date(),
    }).where(eq(baremetalProcurements.id, procurement.id));

    if (procurement.hostId) {
      await db.update(baremetalHosts).set({
        status: tx.transaction.status === 'ready' ? 'bootstrapping' : 'ordering',
        providerServerNumber: tx.transaction.server_number ? String(tx.transaction.server_number) : null,
        publicIpv4: tx.transaction.server_ip,
        metadata: {
          order_status: tx.transaction.status,
          procurement_id: procurement.id,
        },
        updatedAt: new Date(),
      }).where(eq(baremetalHosts.id, procurement.hostId));
    }

    const [fresh] = await db.select().from(baremetalProcurements).where(eq(baremetalProcurements.id, procurement.id));
    return c.json({ ok: true, procurement: serializeProcurement(fresh) });
  } catch (err) {
    return handleRouteError(c, err, 'ADMIN-BAREMETAL');
  }
});
