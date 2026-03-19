/**
 * Stripe webhook handler — receives events from Stripe and acts on them.
 *
 * Key events handled:
 *   - checkout.session.completed: User completed payment → provision their machine
 *   - invoice.payment_failed: Subscription payment failed → suspend machine
 *   - customer.subscription.deleted: Subscription cancelled externally → mark machine
 *   - customer.subscription.updated: Subscription changed → sync billing state
 *
 * This route does NOT use apiGuard — Stripe authenticates via webhook signature.
 * Stripe webhook routes are intentionally not included in the OpenAPI spec.
 *
 * IDEMPOTENCY: We track processed Stripe event IDs to prevent duplicate processing.
 * A checkout session ID is checked against existing machines to prevent duplicate provisioning.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { eq, and, like } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db';
import { users, machines, images, stripeEvents } from '../../db/schema';
import { stripeClient, type CheckoutMachineConfig } from '../../lib/stripe';
import { config } from '../../lib/config';
import { getProvider } from '../../lib/providers';
import { eventBus } from '../../lib/event-bus';
import { resolveCheckoutUser } from '../../lib/checkout-users';
import { emailClient } from '../../lib/email';
import {
  generateMachineIdentity,
  uploadSSHKeyToProvider,
  buildMachineUserData,
  setupProxyDNS,
  createMachineRecord,
  autoGenerateAndSaveSSHKey,
  resolveSSHKeyPublicKeys,
  cleanupMachineResources,
} from '../../lib/machine-lifecycle';
import { checkMachineLimit } from '../../lib/account-limits';
import { desc } from 'drizzle-orm';

export const stripeWebhooksApp = new OpenAPIHono();

// ─── DB-based idempotency ────────────────────────────────────────────────────
// Uses unique constraint on stripe_events.event_id to prevent duplicate processing.
// INSERT fails silently if event was already processed (even across server restarts).

async function isEventProcessed(eventId: string): Promise<boolean> {
  const [existing] = await db.select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.eventId, eventId))
    .limit(1);
  return !!existing;
}

async function markEventProcessed(eventId: string, eventType: string): Promise<void> {
  try {
    await db.insert(stripeEvents).values({ eventId, eventType }).onConflictDoNothing();
  } catch {
    // Unique constraint violation = already processed, safe to ignore
  }
}

/**
 * POST /stripe/webhooks — Stripe sends events here.
 * The raw body must be read for signature verification.
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

  let event: Stripe.Event;
  try {
    event = stripeClient.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error('[STRIPE WEBHOOK] Signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  // Idempotency check — skip already-processed events
  if (await isEventProcessed(event.id)) {
    console.log(`[STRIPE WEBHOOK] Skipping already-processed event ${event.id}`);
    return c.json({ received: true, skipped: true });
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

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log(`[STRIPE WEBHOOK] Unhandled event type: ${event.type}`);
        break;
    }
  } catch (err) {
    console.error(`[STRIPE WEBHOOK] Error handling ${event.type}:`, err);
    // Still return 200 so Stripe doesn't retry (we logged the error)
  }

  await markEventProcessed(event.id, event.type);
  return c.json({ received: true });
});

// ─── checkout.session.completed ─────────────────────────────────────────────
// User completed Stripe Checkout → provision the machine they configured.

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata;
  if (!metadata) return;

  const action = metadata.justavps_action;
  if (action !== 'create_machine') {
    console.log(`[STRIPE WEBHOOK] checkout.session.completed — not a machine creation (action: ${action})`);
    return;
  }

  const checkoutEmail = metadata.justavps_checkout_email || session.customer_details?.email || session.customer_email || null;
  const checkoutName = session.customer_details?.name || null;
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id || null;
  let userId = metadata.justavps_user_id || '';

  if (!userId) {
    if (!checkoutEmail) {
      console.error(`[STRIPE WEBHOOK] Checkout session ${session.id} has no user id or email — refusing provisioning`);
      return;
    }

    const resolvedUser = await resolveCheckoutUser({
      email: checkoutEmail,
      name: checkoutName,
      stripeCustomerId: customerId,
    });
    userId = resolvedUser.user.id;
  }

  if (customerId) {
    await stripeClient.linkCustomerToUser(customerId, userId, checkoutEmail)
      .catch((err: unknown) => console.warn(`[STRIPE WEBHOOK] Failed to link customer ${customerId} to user ${userId}:`, err));
  }

  const priceMonthly = parseFloat(metadata.price_monthly || '0');
  let machineConfig: CheckoutMachineConfig;

  try {
    machineConfig = JSON.parse(metadata.machine_config) as CheckoutMachineConfig;
  } catch {
    console.error('[STRIPE WEBHOOK] Failed to parse machine_config from checkout session metadata');
    return;
  }

  // DB-level idempotency: check if a machine was already provisioned for this checkout session
  const existingMachines = await db.select({ id: machines.id })
    .from(machines)
    .where(and(
      eq(machines.ownerId, userId),
      like(machines.stripeSubItemId, `%|${session.id}`),
    ));

  if (existingMachines.length > 0) {
    console.log(`[STRIPE WEBHOOK] Machine already provisioned for checkout ${session.id} — skipping`);
    return;
  }

  console.log(`[STRIPE WEBHOOK] Provisioning machine for user ${userId}: ${machineConfig.server_type} in ${machineConfig.region}`);

  // Extract subscription ID and subscription item ID from the checkout session
  let subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription as Stripe.Subscription | null)?.id || '';

  let subscriptionItemId = '';
  if (session.subscription && typeof session.subscription !== 'string') {
    const sub = session.subscription as Stripe.Subscription;
    subscriptionItemId = sub.items?.data?.[0]?.id || '';
  }

  // If the event payload does not include the expanded subscription details,
  // refetch the Checkout Session to recover the subscription id + item id.
  if (session.id && (!subscriptionId || !subscriptionItemId)) {
    try {
      const fullCheckoutSession = await stripeClient.getCheckoutSession(session.id);
      if (typeof fullCheckoutSession.subscription === 'string') {
        subscriptionId = fullCheckoutSession.subscription;
      }
      if (fullCheckoutSession.subscription && typeof fullCheckoutSession.subscription !== 'string') {
        const sub = fullCheckoutSession.subscription as Stripe.Subscription;
        subscriptionId = sub.id;
        subscriptionItemId = sub.items?.data?.[0]?.id || '';
      }
    } catch {
      // Fallback — we'll store just the subscription ID
    }
  }

  if (!subscriptionId) {
    console.error(`[STRIPE WEBHOOK] Checkout session ${session.id} has no subscription id — refusing to provision unpaid machine`);
    return;
  }

  const stripeSubItemIdValue = subscriptionId
    ? `${subscriptionId}|${subscriptionItemId || 'checkout'}|${session.id}`
    : null;

  const planLabel = machineConfig.specs
    ? `${machineConfig.specs.vcpus} vCPU / ${machineConfig.specs.ramGb} GB RAM / ${machineConfig.specs.diskGb} GB SSD`
    : machineConfig.server_type;

  if (checkoutEmail) {
    await emailClient.sendCheckoutAccessEmail({
      email: checkoutEmail,
      name: checkoutName,
      sessionId: session.id,
      planLabel,
    });
  }

  // Check account machine limit before provisioning
  const machineLimit = await checkMachineLimit(userId);
  if (!machineLimit.allowed) {
    console.warn(`[STRIPE WEBHOOK] Machine limit reached for user ${userId} (${machineLimit.current}/${machineLimit.max}) — cancelling subscription ${subscriptionId || 'unknown'}`);
    if (subscriptionId) {
      await stripeClient.cancelMachineSubscription(subscriptionId);
    }
    return;
  }

  try {
    const provider = getProvider(machineConfig.provider);

    // Resolve image
    let resolvedImage = 'ubuntu-24.04';
    if (machineConfig.image_id) {
      const [img] = await db.select().from(images).where(eq(images.id, machineConfig.image_id));
      if (img?.status === 'ready' && img.providerImageId) {
        resolvedImage = img.providerImageId;
      }
    } else {
      const [baseImage] = await db.select().from(images)
        .where(and(eq(images.isPublic, true), eq(images.status, 'ready')))
        .orderBy(desc(images.createdAt))
        .limit(1);
      if (baseImage?.providerImageId) resolvedImage = baseImage.providerImageId;
    }

    const { slug, machineToken } = await generateMachineIdentity();
    const autoKey = await autoGenerateAndSaveSSHKey(userId, slug);

    const extraSSHKeys = machineConfig.ssh_key_ids?.length
      ? await resolveSSHKeyPublicKeys(userId, machineConfig.ssh_key_ids)
      : [];

    const providerKeyId = await uploadSSHKeyToProvider(provider, slug, autoKey.publicKey);
    const userdata = buildMachineUserData(
      slug,
      autoKey.publicKey,
      machineToken,
      machineConfig.env_vars,
      machineConfig.docker_image,
      machineConfig.entrypoint,
      extraSSHKeys,
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
      sshPublicKey: autoKey.publicKey,
      sshPrivateKey: autoKey.privateKey,
      priceMonthly: priceMonthly || null,
      dockerImage: machineConfig.docker_image || null,
      entrypoint: machineConfig.entrypoint || null,
    });

    if (subscriptionId) {
      await stripeClient.linkSubscriptionToMachine(subscriptionId, machine.id, slug)
        .catch((err: unknown) => console.warn(`[STRIPE WEBHOOK] Failed to backfill subscription metadata for ${slug}:`, err));
    }

    // Store the subscription link (with checkout session ID for idempotency)
    if (stripeSubItemIdValue) {
      await db.update(machines).set({
        stripeSubItemId: stripeSubItemIdValue,
      }).where(eq(machines.id, machine.id));
    }

    await eventBus.emitStageChange(machine.id, userId, 'server_creating', 'Creating server on provider...');

    // Provision async — don't block the webhook response
    provisionMachineAsync(machine, provider, machineConfig, slug, userId, userdata, providerKeyId, priceMonthly, resolvedImage, subscriptionId);

    console.log(`[STRIPE WEBHOOK] Machine ${slug} created and queued for provisioning`);
  } catch (err) {
    console.error(`[STRIPE WEBHOOK] Failed to provision machine for user ${userId}:`, err);
  }
}

// ─── Async provisioning ────────────────────────────────────────────────────

function provisionMachineAsync(
  machine: { id: string },
  provider: ReturnType<typeof getProvider>,
  machineConfig: CheckoutMachineConfig,
  slug: string,
  userId: string,
  userdata: string,
  providerKeyId: string,
  priceMonthly: number,
  resolvedImage: string,
  subscriptionId: string,
) {
  (async () => {
    try {
      const server = await provider.createServer({
        name: `justavps-${slug}`,
        serverType: machineConfig.server_type,
        image: resolvedImage,
        region: machineConfig.region,
        userData: userdata,
        sshKeyIds: [providerKeyId],
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
        await setupProxyDNS(slug, server.publicIp, userId, machineConfig.server_type);
      } catch (err) {
        console.warn(`[STRIPE WEBHOOK] KV setup failed for ${slug}:`, err);
      }

      if (priceMonthly) {
        await db.update(machines).set({ priceMonthly }).where(eq(machines.id, machine.id));
      }

    } catch (err) {
      console.error(`[STRIPE WEBHOOK] Background provisioning failed for ${slug}:`, err);

      // Cancel subscription since provisioning failed — user shouldn't be charged
      if (subscriptionId) {
        await stripeClient.cancelMachineSubscription(subscriptionId).catch(() => {});
      }

      await db.update(machines).set({
        status: 'error',
        providerMeta: { error: err instanceof Error ? err.message : String(err) },
      }).where(eq(machines.id, machine.id));
      await eventBus.emitStatusChange(machine.id, userId, 'error', `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

// ─── invoice.payment_failed ─────────────────────────────────────────────────
// A recurring invoice payment failed — the machine may be suspended by Stripe.

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '';
  const sub = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  const subscriptionId = typeof sub === 'string' ? sub : sub?.id || '';
  const amountDue = (invoice.amount_due ?? 0) / 100;
  const attemptCount = invoice.attempt_count ?? 0;

  console.warn(`[STRIPE WEBHOOK] Payment failed for customer ${customerId}, subscription ${subscriptionId}, amount $${amountDue}, attempt #${attemptCount}`);

  if (!customerId) return;

  const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
  if (!user) return;

  console.warn(`[STRIPE WEBHOOK] Payment failed for user ${user.email} (${user.id})`);

  if (!subscriptionId) return;

  const affected = await db.select().from(machines)
    .where(and(
      eq(machines.ownerId, user.id),
      like(machines.stripeSubItemId, `${subscriptionId}|%`),
    ));

  for (const m of affected) {
    if (m.status === 'deleted') continue;

    if (attemptCount >= 3 && m.status === 'ready') {
      console.warn(`[STRIPE WEBHOOK] Stopping machine ${m.slug} after ${attemptCount} failed payment attempts`);
      await db.update(machines).set({ status: 'stopped' }).where(eq(machines.id, m.id));
      await eventBus.emitStatusChange(m.id, user.id, 'stopped', `Machine stopped due to failed payment (attempt #${attemptCount})`);
    } else {
      console.warn(`[STRIPE WEBHOOK] Machine ${m.slug} has failed payment (attempt #${attemptCount}) — Stripe will retry`);
    }
  }
}

// ─── customer.subscription.deleted ──────────────────────────────────────────
// Subscription was cancelled (by user via portal, or by Stripe after failed payments).
// We should suspend/delete the linked machine.

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const subscriptionId = subscription.id;
  console.log(`[STRIPE WEBHOOK] Subscription ${subscriptionId} deleted`);

  // Find machines linked to this subscription
  const affected = await db.select().from(machines)
    .where(like(machines.stripeSubItemId, `${subscriptionId}|%`));

  for (const machine of affected) {
    if (machine.status === 'deleted') continue;

    console.log(`[STRIPE WEBHOOK] Subscription deleted for machine ${machine.slug} — destroying machine`);

    try {
      const provider = getProvider(machine.provider);
      await cleanupMachineResources(machine, provider);
      console.log(`[STRIPE WEBHOOK] Machine ${machine.slug} destroyed after subscription cancellation`);
    } catch (err) {
      console.error(`[STRIPE WEBHOOK] Failed to destroy machine ${machine.slug}:`, err);
      // At minimum, mark as deleted in DB
      await db.update(machines).set({ status: 'deleted', deletedAt: new Date() }).where(eq(machines.id, machine.id));
    }
  }
}

// ─── customer.subscription.updated ──────────────────────────────────────────
// Subscription was updated (e.g. price change, status change).
// Sync relevant state to our DB.

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const subscriptionId = subscription.id;
  const newStatus = subscription.status;

  console.log(`[STRIPE WEBHOOK] Subscription ${subscriptionId} updated — status: ${newStatus}`);

  // Find machines linked to this subscription
  const affected = await db.select().from(machines)
    .where(like(machines.stripeSubItemId, `${subscriptionId}|%`));

  for (const machine of affected) {
    if (machine.status === 'deleted') continue;

    const priceAmount = subscription.items.data[0]?.price?.unit_amount;
    if (priceAmount != null) {
      const newPriceMonthly = priceAmount / 100;
      if (newPriceMonthly !== machine.priceMonthly) {
        await db.update(machines).set({ priceMonthly: newPriceMonthly }).where(eq(machines.id, machine.id));
        console.log(`[STRIPE WEBHOOK] Updated price for machine ${machine.slug}: $${machine.priceMonthly} → $${newPriceMonthly}`);
      }
    }

    if ((newStatus === 'past_due' || newStatus === 'unpaid') && machine.status === 'ready') {
      console.warn(`[STRIPE WEBHOOK] Stopping machine ${machine.slug} — subscription is ${newStatus}`);
      await db.update(machines).set({ status: 'stopped' }).where(eq(machines.id, machine.id));
      await eventBus.emitStatusChange(machine.id, machine.ownerId, 'stopped', `Machine stopped: subscription ${newStatus}`);
    }

    if (newStatus === 'active' && machine.status === 'stopped') {
      console.log(`[STRIPE WEBHOOK] Reactivating machine ${machine.slug} — subscription is active again`);
      await db.update(machines).set({ status: 'ready' }).where(eq(machines.id, machine.id));
      await eventBus.emitStatusChange(machine.id, machine.ownerId, 'ready', 'Machine reactivated: payment succeeded');
    }
  }
}
