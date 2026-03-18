/**
 * Machine routes — CRUD + lifecycle operations.
 * Machines are created from user images or default Ubuntu 24.04.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
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
  setupProxyKV,
  lookupPriceAndSpecs,
  createMachineRecord,
  createStripeSubscription,
  cleanupMachineResources,
  syncMachineStatus,
} from '../../lib/machine-lifecycle';
import { z } from 'zod';

export const machinesApp = new Hono<{ Variables: AuthVariables }>();

machinesApp.use('*', apiGuard);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateMachineSchema = z.object({
  image_id: z.string().uuid().optional().nullable(),
  provider: z.string().min(1).describe('Cloud provider (e.g. "hetzner")'),
  server_type: z.string().min(1).describe('Provider-specific server type (e.g. "cpx22")'),
  region: z.string().min(1).describe('Provider-specific region (e.g. "nbg1")'),
  name: z.string().min(1).max(64).optional().describe('Human-readable name'),
  env_vars: z.record(z.string()).optional().describe('Extra environment variables written to /etc/justavps/env on the machine'),
  docker_image: z.string().optional().describe('Docker image to run on boot (e.g. "myapp:latest"). Starts with --env-file /etc/justavps/env'),
  entrypoint: z.string().optional().describe('Entrypoint for the Docker container'),
});

const ResizeMachineSchema = z.object({
  server_type: z.string().min(1).describe('New server type'),
});

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

// ─── POST / — Create Machine ────────────────────────────────────────────────
//
// Payment flow:
//   1. Validate input + provider
//   2. Ensure Stripe customer exists
//   3. Check if customer has a payment method on file
//      - YES → provision machine immediately, subscription charges default PM
//      - NO  → create Stripe Checkout Session, return 402 with checkout_url
//              Machine is provisioned by the webhook after successful payment

machinesApp.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = CreateMachineSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, 400, parsed.error.message);
  }

  const data = parsed.data;
  const ownerId = c.get('userId');

  // 1. Validate provider
  const lookup = requireProvider(c, data.provider);
  if (lookup.response) return lookup.response;
  const provider = lookup.provider;

  // 2. Resolve image — either user image or default Ubuntu 24.04
  let resolvedImage = 'ubuntu-24.04';
  if (data.image_id) {
    const [img] = await db.select().from(images).where(eq(images.id, data.image_id));
    if (!img || img.ownerId !== ownerId) {
      return errorResponse(c, 404, 'Image not found');
    }
    if (img.status !== 'ready') {
      return errorResponse(c, 400, `Image is not ready (status: ${img.status})`);
    }
    if (!img.providerImageId) {
      return errorResponse(c, 400, 'Image has no provider image ID');
    }
    resolvedImage = img.providerImageId;
  }

  // 3. Price + specs lookup
  const { priceMonthly, specs } = await lookupPriceAndSpecs(provider, data.region, data.server_type);

  // 4. Payment gate — check if user has a payment method
  if (stripeClient.isConfigured()) {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, ownerId));
      if (!user) return errorResponse(c, 404, 'User not found');

      // Ensure Stripe customer exists
      const customerId = await stripeClient.getOrCreateCustomer(ownerId, user.email);
      if (!user.stripeCustomerId) {
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, ownerId));
      }

      // Check for payment method
      const hasPM = await stripeClient.hasPaymentMethod(customerId);

      if (!hasPM) {
        // No payment method → redirect to Stripe Checkout
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
          requires_checkout: true,
          checkout_url: checkoutUrl,
          message: 'Payment method required. Complete checkout to provision your machine.',
        }, 402);
      }
    } catch (err) {
      console.error('[MACHINES] Payment check failed:', err);
      // Fall through — don't block machine creation if Stripe check fails
    }
  }

  // 5. User has a payment method (or Stripe is not configured) → provision immediately
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

    // Background: provider creation + Stripe subscription
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
          await setupProxyKV(slug, server.publicIp, ownerId, data.server_type);
        } catch (err) {
          console.warn(`[MACHINES] KV setup failed for ${slug}:`, err);
        }

        // Create Stripe subscription (charges default payment method immediately)
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
    return handleRouteError(c, err, 'MACHINES');
  }
});

// ─── GET / — List Machines ──────────────────────────────────────────────────

machinesApp.get('/', async (c) => {
  const ownerId = c.get('userId');
  const result = await db.select().from(machines).where(
    eq(machines.ownerId, ownerId),
  ).then(rows => rows.filter(r => r.status !== 'deleted'));

  // Auto-transition provisioning machines to ready if provider says running
  const synced = await Promise.all(result.map(syncMachineStatus));

  return c.json({ machines: synced.map(m => serializeMachine(m)) });
});

// ─── GET /:id — Get Machine ────────────────────────────────────────────────

machinesApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  const machine = await syncMachineStatus(owned.resource);

  return c.json(serializeMachine(machine));
});

// ─── DELETE /:id — Destroy Machine ──────────────────────────────────────────

machinesApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  try {
    const lookup = requireProvider(c, owned.resource.provider);
    if (lookup.response) return lookup.response;

    await cleanupMachineResources(owned.resource, lookup.provider);
    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES');
  }
});

// ─── POST /:id/reboot ───────────────────────────────────────────────────────

machinesApp.post('/:id/reboot', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  if (!owned.resource.providerServerId) {
    return errorResponse(c, 404, 'Machine not found');
  }

  const lookup = requireProvider(c, owned.resource.provider);
  if (lookup.response) return lookup.response;

  await lookup.provider.rebootServer(owned.resource.providerServerId);
  return c.json({ action: 'reboot', status: 'initiated' }, 202);
});

// ─── POST /:id/resize ───────────────────────────────────────────────────────

machinesApp.post('/:id/resize', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const body = await c.req.json();
  const parsed = ResizeMachineSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, 'Invalid request');
  }

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  const machine = owned.resource;
  if (!machine.providerServerId) {
    return errorResponse(c, 404, 'Machine not found');
  }

  try {
    const lookup = requireProvider(c, machine.provider);
    if (lookup.response) return lookup.response;

    await lookup.provider.resizeServer(machine.providerServerId, parsed.data.server_type);
    await db.update(machines)
      .set({ serverType: parsed.data.server_type })
      .where(eq(machines.id, id));

    // Update Stripe subscription price
    if (stripeClient.isConfigured() && machine.stripeSubItemId) {
      const subItemId = machine.stripeSubItemId.split('|')[1];
      const serverTypes = await lookup.provider.listServerTypes(machine.region);
      const st = serverTypes.find(t => t.name === parsed.data.server_type);
      if (st && subItemId) {
        const resizeSpecs = { vcpus: st.cores, ramGb: st.memory, diskGb: st.disk, cpuType: st.cpuType } as const;
        await stripeClient.updateMachineSubscription(subItemId, st.priceMonthly, parsed.data.server_type, machine.id, resizeSpecs)
          .catch(err => console.error('[MACHINES] Stripe resize failed:', err));
      }
    }

    return c.json({
      action: 'resize',
      old_type: machine.serverType,
      new_type: parsed.data.server_type,
      status: 'initiated',
    }, 202);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES');
  }
});

// ─── POST /:id/image — Create image from running machine ────────────────────

const CreateImageSchema = z.object({
  name: z.string().min(1).max(128).describe('Name for the image'),
});

machinesApp.post('/:id/image', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const body = await c.req.json();
  const parsed = CreateImageSchema.safeParse(body);
  if (!parsed.success) return errorResponse(c, 400, parsed.error.message);

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  const machine = owned.resource;
  if (machine.status !== 'ready') return errorResponse(c, 400, `Machine must be ready (current: ${machine.status})`);
  if (!machine.providerServerId) return errorResponse(c, 400, 'Machine has no provider server');

  const lookup = requireProvider(c, machine.provider);
  if (lookup.response) return lookup.response;

  // Insert image record
  const [image] = await db.insert(images).values({
    ownerId,
    name: parsed.data.name,
    status: 'creating',
    sourceMachineId: machine.id,
    provider: machine.provider,
  }).returning();

  // Async: create image on provider
  (async () => {
    try {
      const result = await lookup.provider.createImage(
        Number(machine.providerServerId),
        `justavps-img-${parsed.data.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 50)}`,
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
    created_at: image.createdAt.toISOString(),
  }, 202);
});
