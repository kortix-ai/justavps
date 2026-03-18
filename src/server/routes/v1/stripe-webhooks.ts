/**
 * Stripe webhook handler — receives events from Stripe and acts on them.
 *
 * Key events handled:
 *   - checkout.session.completed: User completed payment → provision their machine
 *   - invoice.payment_failed: Subscription payment failed → log warning
 *
 * This route does NOT use apiGuard — Stripe authenticates via webhook signature.
 * Stripe webhook routes are intentionally not included in the OpenAPI spec.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db';
import { users, machines } from '../../db/schema';
import { stripeClient, type CheckoutMachineConfig } from '../../lib/stripe';
import { config } from '../../lib/config';
import { getProvider } from '../../lib/providers';
import { eventBus } from '../../lib/event-bus';
import {
  generateMachineIdentity,
  uploadSSHKeyToProvider,
  buildMachineUserData,
  setupProxyKV,
  createMachineRecord,
} from '../../lib/machine-lifecycle';

export const stripeWebhooksApp = new OpenAPIHono();

/**
 * POST /stripe/webhooks — Stripe sends events here.
 * The raw body must be read for signature verification.
 * Not included in the OpenAPI spec (hide: true would work but this route
 * uses raw body so we just use a plain Hono handler).
 */
stripeWebhooksApp.post('/', async (c) => {
  if (!stripeClient.isConfigured() || !config.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Stripe webhooks not configured' }, 503);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  let event;
  try {
    event = stripeClient.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error('[STRIPE WEBHOOK] Signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  console.log(`[STRIPE WEBHOOK] Received ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        break;
    }
  } catch (err) {
    console.error(`[STRIPE WEBHOOK] Error handling ${event.type}:`, err);
  }

  return c.json({ received: true });
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata;
  if (!metadata) return;

  const action = metadata.justavps_action;
  if (action !== 'create_machine') {
    console.log(`[STRIPE WEBHOOK] checkout.session.completed — not a machine creation (action: ${action})`);
    return;
  }

  const userId = metadata.justavps_user_id;
  const priceMonthly = parseFloat(metadata.price_monthly || '0');
  let machineConfig: CheckoutMachineConfig;

  try {
    machineConfig = JSON.parse(metadata.machine_config) as CheckoutMachineConfig;
  } catch {
    console.error('[STRIPE WEBHOOK] Failed to parse machine_config from checkout session metadata');
    return;
  }

  console.log(`[STRIPE WEBHOOK] Provisioning machine for user ${userId}: ${machineConfig.server_type} in ${machineConfig.region}`);

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription as Stripe.Subscription | null)?.id || '';

  try {
    const provider = getProvider(machineConfig.provider);

    let resolvedImage = 'ubuntu-24.04';
    if (machineConfig.image_id) {
      const { images: imagesTable } = await import('../../db/schema');
      const [img] = await db.select().from(imagesTable).where(eq(imagesTable.id, machineConfig.image_id));
      if (img?.status === 'ready' && img.providerImageId) {
        resolvedImage = img.providerImageId;
      }
    }

    const { slug, machineToken, codeServerPassword, keyPair } = await generateMachineIdentity();
    const providerKeyId = await uploadSSHKeyToProvider(provider, slug, keyPair.publicKey);
    const userdata = buildMachineUserData(
      slug,
      codeServerPassword,
      keyPair.publicKey,
      machineToken,
      machineConfig.env_vars,
      machineConfig.docker_image,
      machineConfig.entrypoint,
    );

    const machine = await createMachineRecord({
      ownerId: userId,
      slug,
      name: machineConfig.name || `machine-${slug}`,
      provider: machineConfig.provider,
      imageId: machineConfig.image_id || null,
      serverType: machineConfig.server_type,
      region: machineConfig.region,
      ip: null,
      providerServerId: null,
      machineToken,
      codeServerPassword,
      sshPublicKey: keyPair.publicKey,
      sshPrivateKey: keyPair.privateKey,
      priceMonthly: priceMonthly || null,
      dockerImage: machineConfig.docker_image || null,
      entrypoint: machineConfig.entrypoint || null,
    });

    if (subscriptionId) {
      await db.update(machines).set({
        stripeSubItemId: `${subscriptionId}|checkout`,
      }).where(eq(machines.id, machine.id));
    }

    await eventBus.emitStageChange(machine.id, userId, 'server_creating', 'Creating server on provider...');

    provisionMachineAsync(machine, provider, machineConfig, slug, userId, userdata, providerKeyId, priceMonthly, resolvedImage);

    console.log(`[STRIPE WEBHOOK] Machine ${slug} created and queued for provisioning`);
  } catch (err) {
    console.error(`[STRIPE WEBHOOK] Failed to provision machine for user ${userId}:`, err);
  }
}

function provisionMachineAsync(
  machine: { id: string },
  provider: ReturnType<typeof getProvider>,
  machineConfig: CheckoutMachineConfig,
  slug: string,
  userId: string,
  userdata: string,
  providerKeyId: string | undefined,
  priceMonthly: number,
  resolvedImage: string,
) {
  (async () => {
    try {
      const server = await provider.createServer({
        name: `justavps-${slug}`,
        serverType: machineConfig.server_type,
        image: resolvedImage,
        region: machineConfig.region,
        userData: userdata,
        sshKeyIds: providerKeyId ? [providerKeyId] : [],
        enableBackups: true,
        labels: {
          'justavps': 'true',
          'slug': slug,
          'owner': userId.slice(0, 63),
        },
      });

      await db.update(machines).set({
        ip: server.publicIp,
        providerServerId: server.serverId,
      }).where(eq(machines.id, machine.id));

      await eventBus.emitStageChange(machine.id, userId, 'server_created', `Server created (IP: ${server.publicIp})`, { ip: server.publicIp });

      try {
        await setupProxyKV(slug, server.publicIp, userId, machineConfig.server_type);
      } catch (err) {
        console.warn(`[STRIPE WEBHOOK] KV setup failed for ${slug}:`, err);
      }

      if (priceMonthly) {
        await db.update(machines).set({ priceMonthly }).where(eq(machines.id, machine.id));
      }

    } catch (err) {
      console.error(`[STRIPE WEBHOOK] Background provisioning failed for ${slug}:`, err);
      await db.update(machines).set({
        status: 'error',
        providerMeta: { error: err instanceof Error ? err.message : String(err) },
      }).where(eq(machines.id, machine.id));
      await eventBus.emitStatusChange(machine.id, userId, 'error', `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '';
  const sub = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  const subscriptionId = typeof sub === 'string' ? sub : sub?.id || '';
  const amountDue = (invoice.amount_due ?? 0) / 100;

  console.warn(`[STRIPE WEBHOOK] Payment failed for customer ${customerId}, subscription ${subscriptionId}, amount $${amountDue}`);

  if (customerId) {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    if (user) {
      console.warn(`[STRIPE WEBHOOK] Payment failed for user ${user.email} (${user.id})`);
    }
  }
}
