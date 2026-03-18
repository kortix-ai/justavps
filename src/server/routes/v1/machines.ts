/**
 * Machine routes — CRUD + lifecycle operations.
 * Uses @hono/zod-openapi: each route declares its schemas inline → spec is auto-generated.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import { machines, images, users } from '../../db/schema';
import { config } from '../../lib/config';

type Machine = typeof machines.$inferSelect;
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { stripeClient } from '../../lib/stripe';
import { requireOwnedResource, requireProvider, errorResponse, handleRouteError } from '../../lib/route-helpers';
import { eventBus } from '../../lib/event-bus';
import { after } from 'next/server';
import {
  generateMachineIdentity,
  uploadSSHKeyToProvider,
  buildMachineUserData,
  setupProxyDNS,
  lookupPriceAndSpecs,
  createMachineRecord,
  createStripeSubscription,
  cleanupMachineResources,
  syncMachineStatus,
} from '../../lib/machine-lifecycle';
import {
  CreateMachineSchema,
  ResizeMachineSchema,
  CreateImageSchema,
  MachineResponseSchema,
  MachineListResponseSchema,
  CheckoutRequiredSchema,
  ActionResponseSchema,
  ResizeResponseSchema,
  ImageResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const machinesApp = new OpenAPIHono<{ Variables: AuthVariables }>();

machinesApp.use('*', apiGuard);


// ─── Helpers ────────────────────────────────────────────────────────────────

function serializeMachine(m: typeof machines.$inferSelect) {
  const proxyDomain = config.PROXY_DOMAIN;
  const sshKeyPath = `~/.ssh/justavps_${m.slug}`;

  const setupCommand = m.sshPrivateKey && m.ip
    ? `mkdir -p ~/.ssh && echo '${m.sshPrivateKey.replace(/'/g, "'\\''")}' > ${sshKeyPath} && chmod 600 ${sshKeyPath} && ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${m.ip}`
    : null;

  const sshCommand = m.ip ? `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no root@${m.ip}` : null;

  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    status: m.status,
    provisioning_stage: m.provisioningStage ?? null,
    provisioning_stage_updated_at: m.provisioningStageUpdatedAt?.toISOString() ?? null,
    provider: m.provider,
    image_id: m.imageId,
    server_type: m.serverType,
    region: m.region,
    ip: m.ip,
    price_monthly: m.priceMonthly || null,
    backups_enabled: m.backupsEnabled,
    created_at: m.createdAt.toISOString(),
    ready_at: m.readyAt?.toISOString() ?? null,
    urls: m.ip ? {
      vscode: `https://${m.slug}.${proxyDomain}`,
      pty: `wss://${m.slug}.${proxyDomain}/_pty`,
    } : null,
    ssh: sshCommand,
    ssh_key: m.sshPrivateKey ? {
      private_key: m.sshPrivateKey,
      public_key: m.sshPublicKey,
      setup_command: setupCommand,
      key_path: sshKeyPath,
    } : null,
    connect: {
      ssh_command: sshCommand,
      setup_command: setupCommand,
      vscode_url: `https://${m.slug}.${proxyDomain}`,
      vscode_password: m.codeServerPassword,
      cursor_ssh: m.ip ? `ssh -i ${sshKeyPath} root@${m.ip}` : null,
    },
    health: m.lastHeartbeat ? {
      ...m.lastHeartbeat,
      last_heartbeat_at: m.lastHeartbeatAt?.toISOString() ?? null,
    } : null,
  };
}

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

// ─── POST / — Create Machine ────────────────────────────────────────────────

const createMachineRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Create a machine',
  description: 'Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots from Ubuntu 24.04.\n\nReturns 202 if provisioning starts immediately (user has payment method), or 402 with a `checkout_url` if payment is required first.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateMachineSchema } },
    },
  },
  responses: {
    202: {
      description: 'Machine provisioning started',
      content: { 'application/json': { schema: MachineResponseSchema } },
    },
    402: {
      description: 'Payment required — redirect to checkout',
      content: { 'application/json': { schema: CheckoutRequiredSchema } },
    },
    400: {
      description: 'Bad Request',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Not Found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

machinesApp.openapi(createMachineRoute, async (c) => {
  const data = c.req.valid('json');
  const ownerId = c.get('userId');

  // 1. Validate provider
  const lookup = requireProvider(c, data.provider);
  if (lookup.response) return lookup.response as any;
  const provider = lookup.provider;

  // 2. Resolve image — user image → latest public base image → fresh Ubuntu 24.04
  let resolvedImage = 'ubuntu-24.04';
  if (data.image_id) {
    // User specified an image — must own it or it must be public
    const [img] = await db.select().from(images).where(eq(images.id, data.image_id));
    if (!img || (img.ownerId !== ownerId && !img.isPublic)) {
      return errorResponse(c, 404, 'Image not found') as any;
    }
    if (img.status !== 'ready') {
      return errorResponse(c, 400, `Image is not ready (status: ${img.status})`) as any;
    }
    if (!img.providerImageId) {
      return errorResponse(c, 400, 'Image has no provider image ID') as any;
    }
    resolvedImage = img.providerImageId;
  } else {
    // No image specified — use latest public base image from DB
    const [baseImage] = await db.select().from(images)
      .where(and(eq(images.isPublic, true), eq(images.status, 'ready')))
      .orderBy(desc(images.createdAt))
      .limit(1);
    if (baseImage?.providerImageId) {
      resolvedImage = baseImage.providerImageId;
    }
  }

  // 3. Price + specs lookup
  const { priceMonthly, specs } = await lookupPriceAndSpecs(provider, data.region, data.server_type);

  // 4. Payment gate
  if (stripeClient.isConfigured()) {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, ownerId));
      if (!user) return errorResponse(c, 404, 'User not found') as any;

      const customerId = await stripeClient.getOrCreateCustomer(ownerId, user.email);
      if (!user.stripeCustomerId) {
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, ownerId));
      }

      const hasPM = await stripeClient.hasPaymentMethod(customerId);

      if (!hasPM) {
        const { url: checkoutUrl } = await stripeClient.createCheckoutSession({
          customerId,
          userId: ownerId,
          machineConfig: {
            provider: data.provider,
            server_type: data.server_type,
            region: data.region,
            name: data.name,
            image_id: data.image_id ?? null,
            docker_image: data.docker_image,
            entrypoint: data.entrypoint,
            env_vars: data.env_vars,
            specs,
          },
          priceMonthlyUsd: priceMonthly,
          successUrl: `${config.APP_URL}/machines`,
          cancelUrl: `${config.APP_URL}/machines`,
        });

        console.log(`[MACHINES] User ${ownerId} has no payment method — redirecting to Stripe Checkout`);

        return c.json({
          requires_checkout: true as const,
          checkout_url: checkoutUrl,
          message: 'Payment method required. Complete checkout to provision your machine.',
        }, 402);
      }
    } catch (err) {
      console.error('[MACHINES] Payment check failed:', err);
    }
  }

  // 5. Provision immediately
  try {
    const { slug, machineToken, codeServerPassword, keyPair } = await generateMachineIdentity();
    const providerKeyId = await uploadSSHKeyToProvider(provider, slug, keyPair.publicKey);
    const userdata = buildMachineUserData(slug, codeServerPassword, keyPair.publicKey, machineToken, data.env_vars, data.docker_image, data.entrypoint);

    const machine = await createMachineRecord({
      ownerId,
      slug,
      name: data.name || `machine-${slug}`,
      provider: data.provider,
      imageId: data.image_id || null,
      serverType: data.server_type,
      region: data.region,
      ip: null,
      providerServerId: null,
      machineToken,
      codeServerPassword,
      sshPublicKey: keyPair.publicKey,
      sshPrivateKey: keyPair.privateKey,
      priceMonthly,
      dockerImage: data.docker_image || null,
      entrypoint: data.entrypoint || null,
    });

    await eventBus.emitStageChange(machine.id, ownerId, 'server_creating', 'Creating server on provider...');

    after(async () => {
      try {
        const server = await provider.createServer({
          name: `justavps-${slug}`,
          serverType: data.server_type,
          image: resolvedImage,
          region: data.region,
          userData: userdata,
          sshKeyIds: providerKeyId ? [providerKeyId] : [],
          enableBackups: true,
          labels: {
            'justavps': 'true',
            'slug': slug,
            'owner': ownerId.slice(0, 63),
          },
        });

        await db.update(machines).set({
          ip: server.publicIp,
          providerServerId: server.serverId,
        }).where(eq(machines.id, machine.id));

        await eventBus.emitStageChange(machine.id, ownerId, 'server_created', `Server created (IP: ${server.publicIp})`, { ip: server.publicIp });

        try {
          await setupProxyDNS(slug, server.publicIp, ownerId, data.server_type);
        } catch (err) {
          console.warn(`[MACHINES] KV setup failed for ${slug}:`, err);
        }

        try {
          createStripeSubscription(ownerId, machine.id, slug, priceMonthly, data.server_type, specs);
        } catch (err) {
          console.warn(`[MACHINES] Billing setup failed for ${slug}:`, err);
        }

      } catch (err) {
        console.error(`[MACHINES] Background provisioning failed for ${slug}:`, err);
        await db.update(machines).set({
          status: 'error',
          providerMeta: { error: err instanceof Error ? err.message : String(err) },
        }).where(eq(machines.id, machine.id));
        await eventBus.emitStatusChange(machine.id, ownerId, 'error', `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return c.json(serializeMachine(machine), 202);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES') as any;
  }
});

// ─── GET / — List Machines ──────────────────────────────────────────────────

const listMachinesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'List machines',
  description: 'Returns all non-deleted machines owned by the authenticated user.',
  responses: {
    200: {
      description: 'List of machines',
      content: { 'application/json': { schema: MachineListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

// @ts-expect-error — DB returns string status, schema expects enum; runtime values are always valid
machinesApp.openapi(listMachinesRoute, async (c) => {
  const ownerId = c.get('userId');
  const result = await db.select().from(machines).where(
    eq(machines.ownerId, ownerId),
  ).then(rows => rows.filter(r => r.status !== 'deleted'));

  const synced = await Promise.all(result.map(syncMachineStatus));

  return c.json({ machines: synced.map(m => serializeMachine(m)) }, 200);
});

// ─── GET /:id — Get Machine ────────────────────────────────────────────────

const getMachineRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Get a machine',
  description: 'Returns full details of a machine including connection info, health metrics, and SSH keys.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    200: {
      description: 'Machine details',
      content: { 'application/json': { schema: MachineResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(getMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  const machine = await syncMachineStatus(owned.resource);

  return c.json(serializeMachine(machine));
});

// ─── DELETE /:id — Destroy Machine ──────────────────────────────────────────

const destroyMachineRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Delete a machine',
  description: 'Permanently destroys the machine, removes DNS records, cancels billing, and deletes the provider server. **Irreversible.**',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    204: { description: 'Machine deleted' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(destroyMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  try {
    const lookup = requireProvider(c, owned.resource.provider);
    if (lookup.response) return lookup.response as any;

    await cleanupMachineResources(owned.resource, lookup.provider);
    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES') as any;
  }
});

// ─── POST /:id/reboot ───────────────────────────────────────────────────────

const rebootMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/reboot',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Reboot a machine',
  description: 'Initiates a hard reboot via the provider API (~30s downtime).',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    202: {
      description: 'Reboot initiated',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(rebootMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  if (!owned.resource.providerServerId) {
    return errorResponse(c, 404, 'Machine not found') as any;
  }

  const lookup = requireProvider(c, owned.resource.provider);
  if (lookup.response) return lookup.response as any;

  await lookup.provider.rebootServer(owned.resource.providerServerId);
  return c.json({ action: 'reboot', status: 'initiated' }, 202);
});

// ─── POST /:id/resize ───────────────────────────────────────────────────────

const resizeMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/resize',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Resize a machine',
  description: 'Changes the machine to a different server type. Requires reboot (~30s downtime). Billing is prorated.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
    body: {
      required: true,
      content: { 'application/json': { schema: ResizeMachineSchema } },
    },
  },
  responses: {
    202: {
      description: 'Resize initiated',
      content: { 'application/json': { schema: ResizeResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(resizeMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { server_type } = c.req.valid('json');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  const machine = owned.resource;
  if (!machine.providerServerId) {
    return errorResponse(c, 404, 'Machine not found') as any;
  }

  try {
    const lookup = requireProvider(c, machine.provider);
    if (lookup.response) return lookup.response as any;

    await lookup.provider.resizeServer(machine.providerServerId, server_type);
    await db.update(machines)
      .set({ serverType: server_type })
      .where(eq(machines.id, id));

    if (stripeClient.isConfigured() && machine.stripeSubItemId) {
      const subItemId = machine.stripeSubItemId.split('|')[1];
      const serverTypes = await lookup.provider.listServerTypes(machine.region);
      const st = serverTypes.find(t => t.name === server_type);
      if (st && subItemId) {
        const resizeSpecs = { vcpus: st.cores, ramGb: st.memory, diskGb: st.disk, cpuType: st.cpuType } as const;
        await stripeClient.updateMachineSubscription(subItemId, st.priceMonthly, server_type, machine.id, resizeSpecs)
          .catch(err => console.error('[MACHINES] Stripe resize failed:', err));
      }
    }

    return c.json({
      action: 'resize' as const,
      old_type: machine.serverType,
      new_type: server_type,
      status: 'initiated',
    }, 202);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES') as any;
  }
});

// ─── POST /:id/image — Create image from running machine ────────────────────

const createImageFromMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/image',
  tags: ['Machines', 'Images'],
  security: bearerSecurity,
  summary: 'Create image from machine',
  description: 'Creates a point-in-time image (snapshot) from a running machine. Machine must be in `ready` status. Returns 202 — poll `GET /images/{id}` until status is `ready`.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
    body: {
      required: true,
      content: { 'application/json': { schema: CreateImageSchema } },
    },
  },
  responses: {
    202: {
      description: 'Image creation started',
      content: { 'application/json': { schema: ImageResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(createImageFromMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { name } = c.req.valid('json');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  const machine = owned.resource;
  if (machine.status !== 'ready') return errorResponse(c, 400, `Machine must be ready (current: ${machine.status})`) as any;
  if (!machine.providerServerId) return errorResponse(c, 400, 'Machine has no provider server') as any;

  const lookup = requireProvider(c, machine.provider);
  if (lookup.response) return lookup.response as any;

  const [image] = await db.insert(images).values({
    ownerId,
    name,
    status: 'creating',
    sourceMachineId: machine.id,
    provider: machine.provider,
  }).returning();

  (async () => {
    try {
      const result = await lookup.provider.createImage(
        Number(machine.providerServerId),
        `justavps-img-${name.replace(/[^a-z0-9-]/gi, '-').slice(0, 50)}`,
      );
      await db.update(images).set({
        status: 'ready',
        providerImageId: result.imageId,
        diskSizeGb: result.diskSize,
        architecture: result.architecture,
        updatedAt: new Date(),
      }).where(eq(images.id, image.id));
    } catch (err) {
      console.error(`[IMAGES] Failed to create image from machine ${machine.slug}:`, err);
      await db.update(images).set({
        status: 'failed',
        updatedAt: new Date(),
      }).where(eq(images.id, image.id));
    }
  })();

  return c.json({
    id: image.id,
    name: image.name,
    status: image.status,
    source_machine_id: image.sourceMachineId,
    provider: image.provider,
    provider_image_id: image.providerImageId,
    disk_size_gb: image.diskSizeGb,
    architecture: image.architecture,
    created_at: image.createdAt.toISOString(),
    updated_at: image.updatedAt.toISOString(),
  }, 202);
});
