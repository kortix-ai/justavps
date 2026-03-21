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
import { eq, and } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db';
import { users, machines, images, stripeEvents, subscriptions } from '../../db/schema';
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
  resolveMachineCallbackConfig,
  setupProxyDNS,
  createMachineRecord,
  autoGenerateAndSaveSSHKey,
  resolveSSHKeyPublicKeys,
  cleanupMachineResources,
} from '../../lib/machine-lifecycle';
import { checkMachineLimit } from '../../lib/account-limits';
import { desc } from 'drizzle-orm';

const stripe = new Stripe(config.STRIPE_SECRET_KEY || 'sk_test_placeholder_not_configured');
import { DEFAULT_TEMPLATE_NAME, resolveRequestedProviderImage } from '../../lib/image-catalog';

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

    // Set the checkout payment method as the customer's default for future charges.
    // Stripe Checkout attaches the PM to the subscription but NOT to the customer.
    await stripeClient.setDefaultPaymentMethodFromCheckout(customerId, session)
      .catch((err: unknown) => console.warn(`[STRIPE WEBHOOK] Failed to set default payment method for ${customerId}:`, err));
  }

  const priceMonthly = parseFloat(metadata.price_monthly || '0');
  let machineConfig: CheckoutMachineConfig;

  try {
    machineConfig = JSON.parse(metadata.machine_config) as CheckoutMachineConfig;
  } catch {
    console.error('[STRIPE WEBHOOK] Failed to parse machine_config from checkout session metadata');
    return;
  }

  // DB-level idempotency: check if a subscription was already created for this checkout session
  const existingSubs = await db.select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCheckoutSessionId, session.id));

  if (existingSubs.length > 0) {
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

  const [userRow] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Check account machine limit before provisioning
  const machineLimit = await checkMachineLimit(userId, userRow?.isAdmin ?? false);
  if (!machineLimit.allowed) {
    console.warn(`[STRIPE WEBHOOK] Machine limit reached for user ${userId} (${machineLimit.current}/${machineLimit.max}) — cancelling subscription ${subscriptionId || 'unknown'}`);
    if (subscriptionId) {
      await stripeClient.cancelMachineSubscription(subscriptionId);
    }
    return;
  }

  try {
    const provider = getProvider(machineConfig.provider);

    let explicitImage = null;
    if (machineConfig.image_id) {
      const [img] = await db.select().from(images).where(eq(images.id, machineConfig.image_id));
      explicitImage = img ?? null;
    }

    const [baseImage] = await db.select().from(images)
      .where(and(eq(images.isTemplate, true), eq(images.status, 'ready'), eq(images.name, DEFAULT_TEMPLATE_NAME)))
      .orderBy(desc(images.createdAt))
      .limit(1);

    const resolvedImageResult = resolveRequestedProviderImage({
      explicitImage,
      fallbackPublicImage: baseImage,
    });

    if (!resolvedImageResult.ok) {
      throw new Error(resolvedImageResult.message);
    }

    const resolvedImage = resolvedImageResult.selection.providerImage;
    const machineImageId = resolvedImageResult.selection.machineImageId;
    const resolvedDockerImage = machineConfig.docker_image;
    const resolvedEntrypoint = machineConfig.entrypoint;
    const resolvedCommand = machineConfig.command;

    const { slug, machineToken } = await generateMachineIdentity();
    const autoKey = await autoGenerateAndSaveSSHKey(userId, slug);

    const extraSSHKeys = machineConfig.ssh_key_ids?.length
      ? await resolveSSHKeyPublicKeys(userId, machineConfig.ssh_key_ids)
      : [];

    const providerKeyId = await uploadSSHKeyToProvider(provider, slug, autoKey.publicKey);
    const callbackConfig = resolveMachineCallbackConfig();
    const userdata = buildMachineUserData(
      slug,
      autoKey.publicKey,
      machineToken,
      callbackConfig.url,
      machineConfig.env_vars,
      resolvedDockerImage,
      resolvedEntrypoint,
      resolvedCommand,
      extraSSHKeys,
    );

    const machine = await createMachineRecord({
      ownerId: userId,
      slug,
      name: machineConfig.name || `machine-${slug}`,
      provider: machineConfig.provider,
      imageId: machineImageId,
      serverType: machineConfig.server_type,
      region: machineConfig.region,
      ip: null,
      providerServerId: null,
      machineToken,
      sshPublicKey: autoKey.publicKey,
      sshPrivateKey: autoKey.privateKey,
      priceMonthly: priceMonthly || null,
      dockerImage: resolvedDockerImage || null,
      entrypoint: resolvedEntrypoint || null,
      dockerCommand: resolvedCommand || null,
      backupsEnabled: machineConfig.enable_backups !== false,
    });

    if (subscriptionId) {
      await stripeClient.linkSubscriptionToMachine(subscriptionId, machine.id, slug)
        .catch((err: unknown) => console.warn(`[STRIPE WEBHOOK] Failed to backfill subscription metadata for ${slug}:`, err));

      // Create subscription record
      await db.insert(subscriptions).values({
        machineId: machine.id,
        ownerId: userId,
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionItemId: subscriptionItemId || null,
        stripeCheckoutSessionId: session.id,
        status: 'active',
      });
    }

    await eventBus.emitStageChange(machine.id, userId, 'server_creating', 'Creating server on provider...');

    await db.update(machines).set({
      providerMeta: {
        callback_expected: callbackConfig.callbackExpected,
        callback_url: callbackConfig.url,
        create_status: 'running',
        create_progress: 0,
      },
    }).where(eq(machines.id, machine.id));

    // Provision async — don't block the webhook response
    provisionMachineAsync(machine, provider, machineConfig, slug, userId, userdata, providerKeyId, priceMonthly, resolvedImage, subscriptionId, callbackConfig);

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
  callbackConfig: { url: string; callbackExpected: boolean },
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
        enableBackups: machineConfig.enable_backups !== false,
        labels: {
          'justavps': 'true',
          'slug': slug,
          'owner': userId.slice(0, 63),
        },
      });

      // SSH key was only needed for createServer — delete it immediately
      // to avoid hitting Hetzner's 100-key project limit.
      provider.deleteSSHKey(providerKeyId).catch((err) => {
        console.warn(`[STRIPE WEBHOOK] Non-critical: failed to delete ephemeral SSH key ${providerKeyId} for ${slug}:`, err);
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

      await eventBus.emitStageChange(machine.id, userId, 'server_created', `Server created (IP: ${server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp})`, { ip: server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp });

      if (config.isCloudflareConfigured()) {
        await setupProxyDNS(slug, { ipv4: server.publicIpv4, ipv6: server.publicIpv6 }, userId, machineConfig.server_type);
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

  // Find machines via subscriptions table
  const subs = await db.select().from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

  for (const sub of subs) {
    if (!sub.machineId) continue;
    const [m] = await db.select().from(machines).where(eq(machines.id, sub.machineId));
    if (!m || m.status === 'deleted') continue;

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

  // Find machines via subscriptions table
  const subs = await db.select().from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

  for (const sub of subs) {
    if (!sub.machineId) continue;
    const [machine] = await db.select().from(machines).where(eq(machines.id, sub.machineId));
    if (!machine || machine.status === 'deleted') continue;

    console.log(`[STRIPE WEBHOOK] Subscription deleted for machine ${machine.slug} — destroying machine`);

    try {
      const provider = getProvider(machine.provider);
      await cleanupMachineResources(machine, provider);
      console.log(`[STRIPE WEBHOOK] Machine ${machine.slug} destroyed after subscription cancellation`);
    } catch (err) {
      console.error(`[STRIPE WEBHOOK] Failed to destroy machine ${machine.slug}:`, err);
      await db.update(machines).set({ status: 'deleted', deletedAt: new Date() }).where(eq(machines.id, machine.id));
    }

    // Mark subscription as canceled
    await db.update(subscriptions).set({ status: 'canceled', updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
  }
}

// ─── customer.subscription.updated ──────────────────────────────────────────
// Subscription was updated (e.g. price change, status change, cancellation scheduled).
// Sync relevant state to our DB.

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const subscriptionId = subscription.id;
  const newStatus = subscription.status;

  console.log(`[STRIPE WEBHOOK] Subscription ${subscriptionId} updated — status: ${newStatus}`);

  // Find subscriptions linked to this Stripe subscription
  const subs = await db.select().from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));

  for (const sub of subs) {
    if (!sub.machineId) continue;
    const [machine] = await db.select().from(machines).where(eq(machines.id, sub.machineId));
    if (!machine || machine.status === 'deleted') continue;

    // Sync price
    const stripePrice = subscription.items.data[0]?.price;
    if (stripePrice) {
      let newPriceMonthly = (stripePrice.unit_amount || 0) / 100;

      // Admin subscriptions use a $0 Stripe price and store the real audit/billing
      // amount in product metadata so the app still reflects the machine's real cost.
      try {
        const expandedPrice = await stripe.prices.retrieve(stripePrice.id, { expand: ['product'] });
        const product = expandedPrice.product as Stripe.Product;
        const realUnitAmount = product.metadata?.real_unit_amount_cents;
        if (realUnitAmount) {
          newPriceMonthly = Number(realUnitAmount) / 100;
        }
      } catch (err) {
        console.warn(`[STRIPE WEBHOOK] Failed to expand price ${stripePrice.id} for ${machine.slug}:`, err);
      }

      if (newPriceMonthly !== machine.priceMonthly) {
        await db.update(machines).set({ priceMonthly: newPriceMonthly }).where(eq(machines.id, machine.id));
        console.log(`[STRIPE WEBHOOK] Updated price for machine ${machine.slug}: $${machine.priceMonthly} → $${newPriceMonthly}`);
      }
    }

    // Sync cancel_at_period_end + cancel_at + period dates + status to subscriptions table
    const cancelAt = subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null;
    const cancelledAt = subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null;
    const currentPeriodStart = (subscription as unknown as { current_period_start?: number }).current_period_start
      ? new Date((subscription as unknown as { current_period_start: number }).current_period_start * 1000) : undefined;
    const currentPeriodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end
      ? new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000) : undefined;
    await db.update(subscriptions).set({
      status: newStatus,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt,
      cancelledAt,
      ...(currentPeriodStart ? { currentPeriodStart } : {}),
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      updatedAt: new Date(),
    }).where(eq(subscriptions.id, sub.id));

    if (subscription.cancel_at_period_end && !sub.cancelAtPeriodEnd) {
      console.log(`[STRIPE WEBHOOK] Subscription ${subscriptionId} scheduled for cancellation — machine ${machine.slug}`);
    } else if (!subscription.cancel_at_period_end && sub.cancelAtPeriodEnd) {
      console.log(`[STRIPE WEBHOOK] Subscription ${subscriptionId} cancellation reversed — machine ${machine.slug}`);
    }

    // Sync machine status based on subscription status
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
