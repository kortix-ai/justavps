/**
 * Machine routes — CRUD + lifecycle operations.
 * Uses @hono/zod-openapi: each route declares its schemas inline → spec is auto-generated.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, desc, inArray, ne } from 'drizzle-orm';
import { db } from '../../db';
import { machines, images, users, subscriptions } from '../../db/schema';
import { config } from '../../lib/config';
import { DEFAULT_TEMPLATE_NAME, resolveRequestedProviderImage } from '../../lib/image-catalog';

type Machine = typeof machines.$inferSelect;
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { stripeClient } from '../../lib/stripe';
import { requireOwnedResource, requireProvider, errorResponse, handleRouteError } from '../../lib/route-helpers';
import { checkMachineLimit, checkImageLimit } from '../../lib/account-limits';
import { HetznerProvider, getPlanTierIndex } from '../../lib/providers/hetzner';
import { backupSurcharge } from '@/lib/hetzner-pricing';
import { eventBus } from '../../lib/event-bus';
import { after } from 'next/server';
import {
  generateMachineIdentity,
  uploadSSHKeyToProvider,
  buildMachineUserData,
  resolveMachineCallbackConfig,
  setupProxyDNS,
  lookupPriceAndSpecs,
  createMachineRecord,
  cleanupMachineResources,
  syncMachineStatus,
  autoGenerateAndSaveSSHKey,
  resolveSSHKeyPublicKeys,
} from '../../lib/machine-lifecycle';
import { decryptSecret } from '../../lib/crypto';
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

/** Safely convert a Date to ISO string, returning null for invalid/missing dates */
function safeISO(d?: Date | null) {
  if (!d) return null;
  const iso = d.toISOString?.();
  return iso && !iso.includes('Invalid') ? iso : null;
}

function readProvisionMeta(meta: Record<string, unknown> | null | undefined) {
  const value = (meta ?? {}) as Record<string, unknown>;
  const fallbackCallback = resolveMachineCallbackConfig();
  return {
    providerProgress: typeof value.create_progress === 'number' ? value.create_progress : null,
    providerStatus: typeof value.create_status === 'string' ? value.create_status : null,
    callbackExpected: typeof value.callback_expected === 'boolean' ? value.callback_expected : fallbackCallback.callbackExpected,
    callbackUrl: typeof value.callback_url === 'string' ? value.callback_url : fallbackCallback.url,
  };
}

function shouldSyncMachineStatusForList(machine: typeof machines.$inferSelect) {
  if (!machine.providerServerId) return false;
  if (machine.status === 'provisioning') return true;
  return machine.status === 'error' && machine.provisioningStage === 'timeout';
}

function serializeMachine(
  m: typeof machines.$inferSelect,
  sub?: typeof subscriptions.$inferSelect | null,
  options?: { includeSensitive?: boolean },
) {
  const includeSensitive = options?.includeSensitive ?? true;
  const proxyDomain = config.PROXY_DOMAIN;
  const sshKeyPath = `~/.ssh/justavps_${m.slug}`;

  // Decrypt SSH private key from DB (may be encrypted at rest).
  // If decryption fails (wrong key, corrupted data), degrade gracefully —
  // the machine still shows up in the list, just without SSH key access.
  let sshPrivateKeyPlain: string | null = null;
  if (includeSensitive && m.sshPrivateKey) {
    try {
      sshPrivateKeyPlain = decryptSecret(m.sshPrivateKey);
    } catch (err) {
      console.warn(`[MACHINES] Failed to decrypt SSH key for ${m.slug}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const setupCommand = sshPrivateKeyPlain && m.ip
    ? `mkdir -p ~/.ssh && echo '${sshPrivateKeyPlain.replace(/'/g, "'\\''")}' > ${sshKeyPath} && chmod 600 ${sshKeyPath} && ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${m.ip}`
    : null;

  const sshCommand = m.ip ? `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no root@${m.ip}` : null;

  const provisionMeta = readProvisionMeta(m.providerMeta);

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
    provider_progress: provisionMeta.providerProgress,
    provider_status: provisionMeta.providerStatus,
    callback_expected: provisionMeta.callbackExpected,
    callback_url: provisionMeta.callbackUrl,
    price_monthly: m.priceMonthly || null,
    backups_enabled: m.backupsEnabled,
    created_at: m.createdAt.toISOString(),
    ready_at: m.readyAt?.toISOString() ?? null,
    urls: m.ip ? {
      proxy: `https://${m.slug}.${proxyDomain}`,
      terminal: `https://${m.slug}.${proxyDomain}/_terminal`,
      port_template: `https://{port}--${m.slug}.${proxyDomain}`,
    } : null,
    ssh: sshCommand,
    ssh_key: sshPrivateKeyPlain ? {
      private_key: sshPrivateKeyPlain,
      public_key: m.sshPublicKey,
      setup_command: setupCommand,
      key_path: sshKeyPath,
    } : null,
    connect: {
      ssh_command: sshCommand,
      setup_command: setupCommand,
      vscode_url: `https://${m.slug}.${proxyDomain}`,
      cursor_ssh: m.ip ? `ssh -i ${sshKeyPath} root@${m.ip}` : null,
    },
    source: m.source || 'user',
    kortix_sandbox_id: m.kortixSandboxId ?? null,
    daemon_version: m.daemonVersion ?? null,
    subscription: sub ? {
      status: sub.status,
      cancel_at_period_end: sub.cancelAtPeriodEnd,
      cancel_at: safeISO(sub.cancelAt),
      cancelled_at: safeISO(sub.cancelledAt),
      current_period_end: safeISO(sub.currentPeriodEnd),
    } : null,
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
    403: {
      description: 'Forbidden',
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
  const isAdmin = c.get('isAdmin');

  // 0. Check account machine limit
  const machineLimit = await checkMachineLimit(ownerId, isAdmin);
  if (!machineLimit.allowed) {
    return errorResponse(c, 403, `Machine limit reached (${machineLimit.current}/${machineLimit.max}). Delete an existing machine or contact support to increase your limit.`) as any;
  }

  // 1. Validate provider
  const lookup = requireProvider(c, data.provider);
  if (lookup.response) return lookup.response as any;
  const provider = lookup.provider;

  // 2. Resolve image — explicit template/snapshot → default JustAVPS base snapshot → fallback public image → Ubuntu
  let resolvedImage = 'ubuntu-24.04';
  let machineImageId: string | null = null;
  if (data.image_id) {
    const [img] = await db.select().from(images).where(eq(images.id, data.image_id));
    if (!img || (img.ownerId !== ownerId && !img.isTemplate)) {
      return errorResponse(c, 404, 'Image not found') as any;
    }

    const resolved = resolveRequestedProviderImage({ explicitImage: img });

    if (!resolved.ok) {
      return errorResponse(c, resolved.status, resolved.message) as any;
    }

    resolvedImage = resolved.selection.providerImage;
    machineImageId = resolved.selection.machineImageId;
  } else {
    const [baseImage] = await db.select().from(images)
      .where(and(eq(images.isTemplate, true), eq(images.status, 'ready'), eq(images.name, DEFAULT_TEMPLATE_NAME)))
      .orderBy(desc(images.createdAt))
      .limit(1);

    const resolved = resolveRequestedProviderImage({
      fallbackPublicImage: baseImage,
    });

    if (!resolved.ok) {
      return errorResponse(c, resolved.status, resolved.message) as any;
    }

    resolvedImage = resolved.selection.providerImage;
    machineImageId = resolved.selection.machineImageId;
  }

  if (resolvedImage !== 'ubuntu-24.04') {
    const imageExists = await provider.validateImage(resolvedImage);
    if (!imageExists) {
      const imageLabel = machineImageId ? 'selected image' : 'default template image';
      return errorResponse(
        c,
        400,
        `${imageLabel} is no longer available on the provider. Reseed the template snapshots or choose a different image.`,
      ) as any;
    }
  }

  const resolvedDockerImage = data.docker_image;
  const resolvedEntrypoint = data.entrypoint;
  const resolvedCommand = data.command;

  const { priceMonthly: basePrice, specs } = await lookupPriceAndSpecs(provider, data.region, data.server_type);
  const wantBackups = data.enable_backups === true;
  const priceMonthly = wantBackups ? basePrice + backupSurcharge(basePrice) : basePrice;

  let stripeSubId: string | null = null;
  let stripeSubItemId: string | null = null;

  if (stripeClient.isConfigured()) {
    const [user] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!user) return errorResponse(c, 404, 'User not found') as any;

    const customerId = await stripeClient.getOrCreateCustomer(ownerId, user.email, user.stripeCustomerId);
    if (!user.stripeCustomerId) {
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, ownerId));
    }

    const billingInterval = data.billing_interval ?? 'monthly';

    if (isAdmin) {
      // ── Admin path: real subscription at $0 (no coupon) ─────────────────
      // Keeps the data model identical to paid users — subscription record,
      // item ID, Stripe product/price all exist. Resize & cancel work normally.
      try {
        const result = await stripeClient.createAdminMachineSubscription(
          customerId,
          '',
          `pending-${Date.now()}`,
          priceMonthly,
          data.server_type,
          specs,
          billingInterval,
        );
        stripeSubId = result.subscriptionId;
        stripeSubItemId = result.subscriptionItemId;
        console.log(`[MACHINES] Admin subscription ${result.subscriptionId} created for user ${ownerId} ($0 admin price)`);
      } catch (err) {
        console.error(`[MACHINES] Admin subscription creation failed for user ${ownerId}:`, err);
        return errorResponse(c, 500, 'Failed to create admin billing record. Please try again.') as any;
      }
    } else {
      // ── Regular user path: charge or redirect to checkout ─────────────
      const createCheckout = async () => {
        const { url } = await stripeClient.createCheckoutSession({
          customerId,
          userId: ownerId,
          machineConfig: {
            provider: data.provider,
            server_type: data.server_type,
            region: data.region,
            name: data.name,
            image_id: data.image_id ?? machineImageId,
            docker_image: resolvedDockerImage,
            entrypoint: resolvedEntrypoint,
            command: resolvedCommand,
            env_vars: data.env_vars,
            ssh_key_ids: data.ssh_key_ids,
            specs,
            billing_interval: billingInterval,
            enable_backups: wantBackups,
          },
          priceMonthlyUsd: priceMonthly,
          billingInterval,
          successUrl: `${config.APP_URL}/machines`,
          cancelUrl: `${config.APP_URL}/machines`,
        });
        return url;
      };

      // Fast path: try direct subscription if user has a payment method
      const hasPM = await stripeClient.hasPaymentMethod(customerId);

      if (hasPM) {
        try {
          const result = await stripeClient.createMachineSubscription(
            customerId,
            '',
            `pending-${Date.now()}`,
            priceMonthly,
            data.server_type,
            specs,
            billingInterval,
          );
          stripeSubId = result.subscriptionId;
          stripeSubItemId = result.subscriptionItemId;
          console.log(`[MACHINES] Subscription ${result.subscriptionId} created and charged for user ${ownerId}`);
        } catch (err) {
          console.warn(`[MACHINES] Direct subscription failed for user ${ownerId}, falling back to checkout:`, (err as Error).message);
          // Fall through to checkout below
        }
      }

      // If direct subscription didn't work (no PM or charge failed), use Checkout
      if (!stripeSubId) {
        try {
          const checkoutUrl = await createCheckout();
          console.log(`[MACHINES] User ${ownerId} redirected to Stripe Checkout`);
          return c.json({
            requires_checkout: true as const,
            checkout_url: checkoutUrl,
            message: 'Payment required. Complete checkout to provision your machine.',
          }, 402);
        } catch (checkoutErr) {
          console.error(`[MACHINES] Checkout creation failed for user ${ownerId}:`, checkoutErr);
          return errorResponse(c, 500, 'Failed to initiate payment. Please try again.') as any;
        }
      }
    }
  }

  // 5. Provision — billing is already settled (or Stripe not configured)
  try {
    const { slug, machineToken } = await generateMachineIdentity();

    // Auto-generate SSH key and save to user's ssh_keys table
    const autoKey = await autoGenerateAndSaveSSHKey(ownerId, slug);

    // Resolve any user-selected SSH keys to inject alongside the auto-generated one
    const extraSSHKeys = data.ssh_key_ids?.length
      ? await resolveSSHKeyPublicKeys(ownerId, data.ssh_key_ids)
      : [];

    const providerKeyId = await uploadSSHKeyToProvider(provider, slug, autoKey.publicKey);
    const callbackConfig = resolveMachineCallbackConfig(c.req.url);
    const callbackUrl = callbackConfig.url;
    const userdata = buildMachineUserData(slug, autoKey.publicKey, machineToken, callbackUrl, data.env_vars, resolvedDockerImage, resolvedEntrypoint, resolvedCommand, extraSSHKeys);

    const machine = await createMachineRecord({
      ownerId,
      slug,
      name: data.name || `machine-${slug}`,
      provider: data.provider,
      imageId: machineImageId,
      serverType: data.server_type,
      region: data.region,
      ip: null,
      providerServerId: null,
      machineToken,
      sshPublicKey: autoKey.publicKey,
      sshPrivateKey: autoKey.privateKey,
      priceMonthly,
      dockerImage: resolvedDockerImage || null,
      entrypoint: resolvedEntrypoint || null,
      dockerCommand: resolvedCommand || null,
      backupsEnabled: wantBackups,
    });

    if (stripeSubId) {
      await stripeClient.linkSubscriptionToMachine(stripeSubId, machine.id, slug)
        .catch((err: unknown) => console.warn(`[MACHINES] Failed to backfill subscription metadata for ${slug}:`, err));

      // Create subscription record linking machine ↔ Stripe subscription
      await db.insert(subscriptions).values({
        machineId: machine.id,
        ownerId,
        stripeSubscriptionId: stripeSubId,
        stripeSubscriptionItemId: stripeSubItemId,
        status: 'active',
      });
    }

    await db.update(machines).set({
      providerMeta: {
        callback_expected: callbackConfig.callbackExpected,
        callback_url: callbackConfig.url,
        create_status: 'running',
        create_progress: 0,
      },
    }).where(eq(machines.id, machine.id));

    await eventBus.emitStageChange(machine.id, ownerId, 'server_creating', 'Creating server on provider...');

    after(async () => {
      try {
        const server = await provider.createServer({
          name: `justavps-${slug}`,
          image: resolvedImage,
          serverType: data.server_type,
          region: data.region,
          userData: userdata,
          sshKeyIds: [providerKeyId],
          enableBackups: wantBackups,
          labels: {
            'justavps': 'true',
            'slug': slug,
            'owner': ownerId.slice(0, 63),
          },
        });

        // SSH key was only needed for createServer — delete it immediately
        // to avoid hitting Hetzner's 100-key project limit.
        // The real per-machine key is injected via cloud-init into authorized_keys.
        provider.deleteSSHKey(providerKeyId).catch((err) => {
          console.warn(`[MACHINES] Non-critical: failed to delete ephemeral SSH key ${providerKeyId} for ${slug}:`, err);
        });

        await db.update(machines).set({
          ip: server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp,
          providerServerId: server.serverId,
          providerMeta: {
            callback_expected: callbackConfig.callbackExpected,
            callback_url: callbackConfig.url,
            create_action_id: server.createActionId ?? null,
            create_status: 'running',
            create_progress: 1,
            public_ipv4: server.publicIpv4 ?? null,
            public_ipv6: server.publicIpv6 ?? null,
          },
        }).where(eq(machines.id, machine.id));

        await eventBus.emitStageChange(machine.id, ownerId, 'server_created', `Server created (IP: ${server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp})`, { ip: server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp });

        if (config.isCloudflareConfigured()) {
          await setupProxyDNS(machine.id, slug, { ipv4: server.publicIpv4, ipv6: server.publicIpv6 }, ownerId, data.server_type);
        }

      } catch (err) {
        console.error(`[MACHINES] Background provisioning failed for ${slug}:`, err);

        // Provisioning failed — cancel the Stripe subscription so user isn't charged
        if (stripeSubId) {
          await stripeClient.cancelMachineSubscription(stripeSubId).catch(() => {});
        }

        await db.update(machines).set({
          status: 'error',
          providerMeta: { error: err instanceof Error ? err.message : String(err) },
        }).where(eq(machines.id, machine.id));
        await eventBus.emitStatusChange(machine.id, ownerId, 'error', `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return c.json(serializeMachine(machine), 202);
  } catch (err) {
    // Machine creation failed — cancel subscription if we already created one
    if (stripeSubId) {
      await stripeClient.cancelMachineSubscription(stripeSubId).catch(() => {});
    }
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
    and(eq(machines.ownerId, ownerId), ne(machines.status, 'deleted')),
  );

  const synced = await Promise.all(result.map((machine) => (
    shouldSyncMachineStatusForList(machine) ? syncMachineStatus(machine) : machine
  )));

  // Batch-fetch subscriptions for all machines
  const machineIds = synced.map(m => m.id);
  const subs = machineIds.length
    ? await db.select().from(subscriptions).where(inArray(subscriptions.machineId, machineIds))
    : [];
  const subsByMachineId = new Map(subs.map(s => [s.machineId, s]));

  return c.json({
    machines: synced.map((m) => serializeMachine(m, subsByMachineId.get(m.id) ?? null, { includeSensitive: false })),
  }, 200);
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
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));

  return c.json(serializeMachine(machine, sub ?? null));
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

// ─── POST /:id/cancel — Cancel subscription at period end ───────────────────

const cancelMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/cancel',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Cancel a machine subscription',
  description: 'Schedules the machine for cancellation at the end of the current billing period. The machine keeps running until then. Use `POST /:id/reactivate` to undo.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    200: {
      description: 'Cancellation scheduled',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(cancelMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  if (owned.resource.status === 'deleted') {
    return errorResponse(c, 400, 'Machine is already deleted') as any;
  }

  // Find the linked subscription
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));
  if (!sub) {
    return errorResponse(c, 400, 'No active subscription found for this machine') as any;
  }
  if (sub.cancelAtPeriodEnd) {
    return errorResponse(c, 400, 'Subscription is already scheduled for cancellation') as any;
  }

  try {
    const updated = await stripeClient.cancelAtPeriodEnd(sub.stripeSubscriptionId);

    // Sync cancellation state to our DB immediately (webhook will also sync, but be proactive)
    const cancelAt = updated.cancel_at ? new Date(updated.cancel_at * 1000) : null;
    const cancelledAt = updated.canceled_at ? new Date(updated.canceled_at * 1000) : null;
    const periodEnd = (updated as unknown as { current_period_end?: number }).current_period_end;
    await db.update(subscriptions).set({
      cancelAtPeriodEnd: true,
      cancelAt,
      cancelledAt,
      ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
      updatedAt: new Date(),
    }).where(eq(subscriptions.id, sub.id));

    return c.json({ action: 'cancel', status: 'scheduled' }, 200);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES') as any;
  }
});

// ─── POST /:id/reactivate — Reverse a scheduled cancellation ────────────────

const reactivateMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/reactivate',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Reactivate a cancelled subscription',
  description: 'Reverses a scheduled cancellation. The subscription continues as normal and the machine will not be deleted.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    200: {
      description: 'Subscription reactivated',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(reactivateMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  // Find the linked subscription
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));
  if (!sub) {
    return errorResponse(c, 400, 'No subscription found for this machine') as any;
  }
  if (!sub.cancelAtPeriodEnd) {
    return errorResponse(c, 400, 'Subscription is not scheduled for cancellation') as any;
  }

  try {
    await stripeClient.reactivateSubscription(sub.stripeSubscriptionId);

    // Sync reactivation state to our DB immediately
    await db.update(subscriptions).set({
      cancelAtPeriodEnd: false,
      cancelAt: null,
      cancelledAt: null,
      updatedAt: new Date(),
    }).where(eq(subscriptions.id, sub.id));

    return c.json({ action: 'reactivate', status: 'completed' }, 200);
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

// ─── POST /:id/stop ─────────────────────────────────────────────────────────

const stopMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/stop',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Stop a machine',
  description: 'Powers off the machine (graceful shutdown). Billing continues while stopped.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    202: {
      description: 'Stop initiated',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(stopMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  if (!owned.resource.providerServerId) {
    return errorResponse(c, 404, 'Machine not found') as any;
  }
  if (owned.resource.status !== 'ready') {
    return errorResponse(c, 400, 'Machine must be running to stop') as any;
  }

  const lookup = requireProvider(c, owned.resource.provider);
  if (lookup.response) return lookup.response as any;

  await lookup.provider.stopServer(owned.resource.providerServerId);

  await db.update(machines)
    .set({ status: 'stopped' })
    .where(eq(machines.id, id));

  return c.json({ action: 'stop', status: 'initiated' }, 202);
});

// ─── POST /:id/start ────────────────────────────────────────────────────────

const startMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/start',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Start a stopped machine',
  description: 'Powers on a previously stopped machine.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    202: {
      description: 'Start initiated',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(startMachineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  if (!owned.resource.providerServerId) {
    return errorResponse(c, 404, 'Machine not found') as any;
  }
  if (owned.resource.status !== 'stopped') {
    return errorResponse(c, 400, 'Machine must be stopped to start') as any;
  }

  const lookup = requireProvider(c, owned.resource.provider);
  if (lookup.response) return lookup.response as any;

  await lookup.provider.startServer(owned.resource.providerServerId);

  await db.update(machines)
    .set({ status: 'ready' })
    .where(eq(machines.id, id));

  return c.json({ action: 'start', status: 'initiated' }, 202);
});

// ─── POST /:id/resize ───────────────────────────────────────────────────────

const resizeMachineRoute = createRoute({
  method: 'post',
  path: '/{id}/resize',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Resize (scale up) a machine',
  description:
    'Scales a machine UP to a larger server type. **Only upgrades are allowed** — you cannot downgrade to a smaller plan. ' +
    'The machine is stopped, resized, and restarted (~60-90s downtime). Disk is permanently enlarged. Billing is prorated.',
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
    400: { description: 'Bad Request (e.g. downgrade attempt, same plan, invalid type)', content: { 'application/json': { schema: ErrorResponseSchema } } },
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
    return errorResponse(c, 400, 'Machine has no provider server — cannot resize') as any;
  }

  // Only allow resize when machine is running
  if (machine.status !== 'ready') {
    return errorResponse(c, 400, `Machine must be running to resize (current status: ${machine.status})`) as any;
  }

  // Same type = no-op
  if (machine.serverType === server_type) {
    return errorResponse(c, 400, 'Machine is already on this server type') as any;
  }

  // ── Scale-up validation ──────────────────────────────────────────────────
  const currentTierIdx = getPlanTierIndex(machine.serverType);
  const newTierIdx = getPlanTierIndex(server_type);

  if (newTierIdx === -1) {
    return errorResponse(c, 400, `Unknown server type: ${server_type}`) as any;
  }

  if (currentTierIdx !== -1 && newTierIdx <= currentTierIdx) {
    return errorResponse(c, 400, 'Only scale-up is allowed — you cannot downgrade to a smaller plan') as any;
  }

  const lookup = requireProvider(c, machine.provider);
  if (lookup.response) return lookup.response as any;

  // ── Look up new price + specs BEFORE starting the resize ──────────────
  const serverTypes = await lookup.provider.listServerTypes(machine.region);
  const newSt = serverTypes.find(t => t.name === server_type);
  if (!newSt) {
    return errorResponse(c, 400, `Server type ${server_type} is not available in region ${machine.region}`) as any;
  }

  const newBasePrice = newSt.priceMonthly;
  const newPrice = machine.backupsEnabled ? newBasePrice + backupSurcharge(newBasePrice) : newBasePrice;
  const newSpecs = { vcpus: newSt.cores, ramGb: newSt.memory, diskGb: newSt.disk, cpuType: newSt.cpuType } as const;

  // Look up subscription for billing
  let machineSub: typeof subscriptions.$inferSelect | null = null;
  if (stripeClient.isConfigured()) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));
    if (!sub) {
      return errorResponse(c, 400, 'Machine has no linked billing subscription — resize is blocked') as any;
    }
    machineSub = sub;

    // Repair: if subscription item ID is missing, fetch from Stripe
    if (!sub.stripeSubscriptionItemId) {
      try {
        const repairedItemId = await stripeClient.getSubscriptionItemId(sub.stripeSubscriptionId);
        if (!repairedItemId) {
          return errorResponse(c, 400, 'Billing subscription is missing its item — resize is blocked') as any;
        }
        await db.update(subscriptions)
          .set({ stripeSubscriptionItemId: repairedItemId, updatedAt: new Date() })
          .where(eq(subscriptions.id, sub.id));
        machineSub = { ...sub, stripeSubscriptionItemId: repairedItemId };
      } catch (err) {
        console.error(`[MACHINES] Failed to repair Stripe billing link for ${machine.slug}:`, err);
        return errorResponse(c, 400, 'Billing subscription could not be verified — resize is blocked') as any;
      }
    }
  }

  // ── Respond immediately, run resize in background ─────────────────────
  // Mark machine as resizing so the frontend can show progress
  await db.update(machines)
    .set({
      status: 'provisioning',
      provisioningStage: 'resizing',
      provisioningStageUpdatedAt: new Date(),
    })
    .where(eq(machines.id, id));

  await eventBus.emitStageChange(
    machine.id,
    ownerId,
    'resizing',
    `Scaling up from ${machine.serverType} to ${server_type}...`,
  );

  // Background: stop → resize → start → update DB & billing
  after(async () => {
    try {
      // 1. Provider resize (stop → change_type → start)
      await lookup.provider.resizeServer(machine.providerServerId!, server_type);

      // 2. Update machine record: new server type, new price, back to ready
      await db.update(machines)
        .set({
          serverType: server_type,
          priceMonthly: newPrice,
          status: 'ready',
          provisioningStage: null,
          provisioningStageUpdatedAt: new Date(),
        })
        .where(eq(machines.id, id));

      // 3. Update Stripe subscription price with proration
      if (stripeClient.isConfigured() && machineSub?.stripeSubscriptionItemId) {
        await stripeClient.updateMachineSubscription(machineSub.stripeSubscriptionItemId, newPrice, server_type, machine.id, newSpecs)
          .catch(err => console.error('[MACHINES] Stripe resize billing update failed:', err));
      }

      // 4. Emit success event
      await eventBus.emitStageChange(
        machine.id,
        ownerId,
        'resize_complete',
        `Scaled up to ${server_type} ($${newPrice}/mo)`,
        { old_type: machine.serverType, new_type: server_type, new_price: newPrice },
      );

      console.log(`[MACHINES] Resize complete: ${machine.slug} ${machine.serverType} → ${server_type} ($${newPrice}/mo)`);
    } catch (err) {
      console.error(`[MACHINES] Resize failed for ${machine.slug}:`, err);

      // Revert machine status to ready with original server type
      await db.update(machines)
        .set({
          status: 'ready',
          provisioningStage: null,
          provisioningStageUpdatedAt: new Date(),
        })
        .where(eq(machines.id, id));

      await eventBus.emitStatusChange(
        machine.id,
        ownerId,
        'ready',
        `Resize failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  return c.json({
    action: 'resize' as const,
    old_type: machine.serverType,
    new_type: server_type,
    status: 'initiated',
  }, 202);
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
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
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

  // Check account image limit
  const imageLimit = await checkImageLimit(ownerId, c.get('isAdmin'));
  if (!imageLimit.allowed) {
    return errorResponse(c, 403, `Image limit reached (${imageLimit.current}/${imageLimit.max}). Delete an existing image or contact support to increase your limit.`) as any;
  }

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

// ─── GET /:id/backups — List backups ────────────────────────────────────────

const BackupSchema = z.object({
  id: z.string(),
  description: z.string(),
  created: z.string(),
  size: z.number(),
  status: z.string(),
});

const listBackupsRoute = createRoute({
  method: 'get',
  path: '/{id}/backups',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'List machine backups',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Backup list',
      content: { 'application/json': { schema: z.object({ backups: z.array(BackupSchema), backups_enabled: z.boolean() }) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(listBackupsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  const machine = owned.resource;
  if (!machine.providerServerId) return errorResponse(c, 404, 'Machine has no provider server') as any;

  const lookup = requireProvider(c, machine.provider);
  if (lookup.response) return lookup.response as any;

  const provider = lookup.provider as HetznerProvider;
  const backups = await provider.listBackups(machine.providerServerId);

  return c.json({ backups, backups_enabled: machine.backupsEnabled }, 200);
});

// ─── POST /:id/backups — Create manual backup ──────────────────────────────

const createBackupRoute = createRoute({
  method: 'post',
  path: '/{id}/backups',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Create a manual backup',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: false,
      content: { 'application/json': { schema: z.object({ description: z.string().optional() }).optional() } },
    },
  },
  responses: {
    202: {
      description: 'Backup creation initiated',
      content: { 'application/json': { schema: z.object({ backup_id: z.string(), status: z.string() }) } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(createBackupRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  const machine = owned.resource;
  if (!machine.providerServerId) return errorResponse(c, 404, 'Machine has no provider server') as any;

  const lookup = requireProvider(c, machine.provider);
  if (lookup.response) return lookup.response as any;

  const body = await c.req.json().catch(() => ({}));
  const provider = lookup.provider as HetznerProvider;
  const result = await provider.createBackup(machine.providerServerId, body?.description);

  return c.json({ backup_id: result.id, status: 'creating' }, 202);
});

// ─── POST /:id/backups/enable — Enable automatic backups ────────────────────

const enableBackupsRoute = createRoute({
  method: 'post',
  path: '/{id}/backups/enable',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Enable automatic backups',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Backups enabled',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(enableBackupsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  const machine = owned.resource;
  if (!machine.providerServerId) return errorResponse(c, 404, 'Machine has no provider server') as any;
  if (machine.backupsEnabled) return c.json({ action: 'enable_backups', status: 'already_enabled' }, 200);

  const lookup = requireProvider(c, machine.provider);
  if (lookup.response) return lookup.response as any;

  // 1. Enable on provider
  const provider = lookup.provider as HetznerProvider;
  await provider.enableBackups(machine.providerServerId).catch((err) => {
    console.error('[MACHINES] Provider backup enable failed, continuing with billing state update:', err);
  });

  // 2. Update billing — add 20% surcharge
  const { priceMonthly: basePrice, specs } = await lookupPriceAndSpecs(provider, machine.region, machine.serverType);
  const newPrice = basePrice + backupSurcharge(basePrice);

  if (stripeClient.isConfigured()) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));
    if (sub?.stripeSubscriptionItemId) {
      await stripeClient.updateMachineSubscription(
        sub.stripeSubscriptionItemId, newPrice, machine.serverType, machine.id, specs,
      ).catch(err => console.error('[MACHINES] Stripe backup enable billing update failed:', err));
    }
  }

  await db.update(machines).set({ backupsEnabled: true, priceMonthly: newPrice }).where(eq(machines.id, id));

  return c.json({ action: 'enable_backups', status: 'completed' }, 200);
});

// ─── POST /:id/backups/disable — Disable automatic backups ──────────────────

const disableBackupsRoute = createRoute({
  method: 'post',
  path: '/{id}/backups/disable',
  tags: ['Machines'],
  security: bearerSecurity,
  summary: 'Disable automatic backups',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Backups disabled',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

machinesApp.openapi(disableBackupsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response as any;

  const machine = owned.resource;
  if (!machine.providerServerId) return errorResponse(c, 404, 'Machine has no provider server') as any;
  if (!machine.backupsEnabled) return c.json({ action: 'disable_backups', status: 'already_disabled' }, 200);

  const lookup = requireProvider(c, machine.provider);
  if (lookup.response) return lookup.response as any;

  // 1. Disable on provider
  const provider = lookup.provider as HetznerProvider;
  await provider.disableBackups(machine.providerServerId).catch((err) => {
    console.error('[MACHINES] Provider backup disable failed, continuing with billing state update:', err);
  });

  // 2. Update billing — remove 20% surcharge (back to base price)
  const { priceMonthly: basePrice, specs } = await lookupPriceAndSpecs(provider, machine.region, machine.serverType);

  if (stripeClient.isConfigured()) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, id));
    if (sub?.stripeSubscriptionItemId) {
      await stripeClient.updateMachineSubscription(
        sub.stripeSubscriptionItemId, basePrice, machine.serverType, machine.id, specs,
      ).catch(err => console.error('[MACHINES] Stripe backup disable billing update failed:', err));
    }
  }

  await db.update(machines).set({ backupsEnabled: false, priceMonthly: basePrice }).where(eq(machines.id, id));

  return c.json({ action: 'disable_backups', status: 'completed' }, 200);
});
