/**
 * Stripe billing integration.
 *
 * Each machine = one Stripe subscription with a metered price based on server type.
 * Payment flow:
 *   1. User creates a machine
 *   2. If they have a payment method → subscription is created and charged immediately
 *   3. If they DON'T have a payment method → Stripe Checkout Session is created,
 *      user pays on Stripe, webhook provisions the machine on success
 */

import Stripe from 'stripe';
import { config } from "@/server/core/config";

const stripe = new Stripe(config.STRIPE_SECRET_KEY || 'sk_test_placeholder_not_configured', {
  httpClient: Stripe.createFetchHttpClient(),
  maxNetworkRetries: 2,
  timeout: 30000,
});

// ─── Machine specs for Stripe product naming ───────────────────────────────

export interface MachineSpecs {
  vcpus: number;
  ramGb: number;
  diskGb: number;
  cpuType?: 'shared' | 'dedicated';
}

export type BillingInterval = 'monthly' | 'yearly' | '2year';

export interface CheckoutMachineConfig {
  provider: string;
  server_type: string;
  region: string;
  name?: string;
  image_id?: string | null;
  env_vars?: Record<string, string>;
  ssh_key_ids?: string[];
  /** Machine specs for Stripe product display — optional, falls back to generic name */
  specs?: MachineSpecs;
  /** Billing interval — determines Stripe recurring interval + discount */
  billing_interval?: BillingInterval;
  /** Whether daily backups are enabled (+20% surcharge). Defaults to true. */
  enable_backups?: boolean;
}

/**
 * Compute the Stripe price and interval for a given billing interval.
 *
 * - monthly  → unit = monthly price,               interval = month
 * - yearly   → unit = monthly price * 0.80 * 12,   interval = year   (20% off)
 * - 2year    → unit = monthly price * 0.70 * 12,   interval = year   (30% off, billed annually)
 */
function resolveStripePrice(
  monthlyUsd: number,
  billingInterval: BillingInterval = 'monthly',
): { unitAmountCents: number; interval: 'month' | 'year'; intervalLabel: string } {
  switch (billingInterval) {
    case 'yearly': {
      const discounted = monthlyUsd * 0.80;
      return {
        unitAmountCents: Math.round(discounted * 12 * 100),
        interval: 'year',
        intervalLabel: '$' + (discounted * 12).toFixed(2) + '/yr (20% off)',
      };
    }
    case '2year': {
      const discounted = monthlyUsd * 0.70;
      return {
        unitAmountCents: Math.round(discounted * 12 * 100),
        interval: 'year',
        intervalLabel: '$' + (discounted * 12).toFixed(2) + '/yr (30% off, 2-year plan)',
      };
    }
    default: {
      return {
        unitAmountCents: Math.round(monthlyUsd * 100),
        interval: 'month',
        intervalLabel: '$' + monthlyUsd.toFixed(2) + '/mo',
      };
    }
  }
}

// ─── Product naming helpers ─────────────────────────────────────────────────

/**
 * Build a clean product name for Stripe invoices / checkout.
 * No provider identifiers — user-facing only.
 */
function formatProductName(specs?: MachineSpecs): string {
  if (!specs) return 'JustAVPS Cloud VPS';
  return `JustAVPS — ${specs.vcpus} vCPU / ${specs.ramGb} GB RAM / ${specs.diskGb} GB SSD`;
}

// ─── Stripe client ──────────────────────────────────────────────────────────

export const stripeClient = {
  async getOrCreateCustomerByEmail(email: string): Promise<string> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
    if (existing.data.length > 0) {
      return existing.data[0].id;
    }

    const customer = await stripe.customers.create({ email: normalizedEmail });
    return customer.id;
  },

  /**
   * Get or create a Stripe customer for an account.
   */
  async getOrCreateCustomer(accountId: string, email: string, existingCustomerId?: string | null): Promise<string> {
    if (existingCustomerId) {
      try {
        const existingById = await stripe.customers.retrieve(existingCustomerId);
        if (!existingById.deleted) {
          return existingById.id;
        }
      } catch {
        // Fall through to metadata search/create if the stored customer is stale.
      }
    }

    // Search for existing customer by metadata
    const existing = await stripe.customers.search({
      query: `metadata['justavps_account_id']:'${accountId}'`,
    });

    if (existing.data.length > 0) {
      return existing.data[0].id;
    }

    // Create new customer
    const customer = await stripe.customers.create({
      email,
      metadata: { justavps_account_id: accountId },
    });

    return customer.id;
  },

  /**
   * Check if a Stripe customer has a valid default payment method.
   * Returns false if the customer doesn't exist (e.g. stale ID from a previous Stripe account).
   */
  async hasPaymentMethod(customerId: string): Promise<boolean> {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) return false;

      // Check for default payment method on the customer
      if (customer.invoice_settings?.default_payment_method) return true;

      // Check for any attached payment methods
      const methods = await stripe.paymentMethods.list({
        customer: customerId,
        limit: 1,
      });

      return methods.data.length > 0;
    } catch {
      // Customer doesn't exist on this Stripe account (stale ID) — treat as no payment method
      console.warn(`[STRIPE] hasPaymentMethod failed for ${customerId} — customer may not exist on this account`);
      return false;
    }
  },

  /**
   * Create a Stripe Checkout Session in subscription mode.
   * Used when a user has no payment method and wants to create a machine.
   * The machine config is stored in session metadata so the webhook can provision it.
   */
  async createCheckoutSession(params: {
    customerId?: string | null;
    userId?: string | null;
    accountId?: string | null;
    machineConfig: CheckoutMachineConfig;
    priceMonthlyUsd: number;
    successUrl: string;
    cancelUrl: string;
    billingInterval?: BillingInterval;
  }): Promise<{ sessionId: string; url: string }> {
    const specs = params.machineConfig.specs;
    const billingInterval = params.billingInterval ?? params.machineConfig.billing_interval ?? 'monthly';
    const resolved = resolveStripePrice(params.priceMonthlyUsd, billingInterval);

    // Create an ad-hoc price for the checkout
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: resolved.unitAmountCents,
      recurring: { interval: resolved.interval },
      product_data: {
        name: formatProductName(specs),
        metadata: {
          platform: 'justavps',
          server_type: params.machineConfig.server_type,
        },
      },
    });

    // Checkout in subscription mode — charges IMMEDIATELY at checkout.
    // No trial, no deferred billing. User pays before machine is provisioned.
    const session = await stripe.checkout.sessions.create({
      ...(params.customerId ? { customer: params.customerId } : {}),
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${params.successUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${params.cancelUrl}?checkout=cancelled`,
      metadata: {
        justavps_action: 'create_machine',
        machine_config: JSON.stringify(params.machineConfig),
        price_monthly: String(params.priceMonthlyUsd),
        billing_interval: billingInterval,
        ...(params.userId ? { justavps_user_id: params.userId } : {}),
        ...(params.accountId ? { justavps_account_id: params.accountId } : {}),
      },
      subscription_data: {
        metadata: {
          machine_provider: params.machineConfig.provider,
          machine_server_type: params.machineConfig.server_type,
          machine_region: params.machineConfig.region,
          billing_interval: billingInterval,
          ...(params.userId ? { justavps_user_id: params.userId } : {}),
          ...(params.accountId ? { justavps_account_id: params.accountId } : {}),
        },
      },
      payment_method_types: ['card'],
      payment_method_collection: 'always',
    });

    console.log(`[STRIPE] Created checkout session ${session.id} for customer ${params.customerId || 'guest'} (${resolved.intervalLabel})`);

    return {
      sessionId: session.id,
      url: session.url!,
    };
  },

  /**
   * Create a Stripe Checkout Session in setup mode.
   * Used when a user wants to add a payment method from the billing page
   * without creating a machine.
   */
  async createSetupCheckoutSession(params: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    const session = await stripe.checkout.sessions.create({
      customer: params.customerId,
      mode: 'setup',
      success_url: `${params.successUrl}?setup=success`,
      cancel_url: `${params.cancelUrl}?setup=cancelled`,
      payment_method_types: ['card'],
    });

    console.log(`[STRIPE] Created setup session ${session.id} for customer ${params.customerId}`);

    return {
      sessionId: session.id,
      url: session.url!,
    };
  },

  /**
   * Create a subscription for a machine.
   * CHARGES IMMEDIATELY for the full month — no trials, no delayed billing.
   * Only call this when the customer HAS a valid payment method.
   *
   * - `error_if_incomplete` → fails fast if payment can't be collected
   * - `charge_automatically` → charges the card on file, no manual invoicing
   * - First invoice covers the full billing period (1 month) starting now
   */
  async createMachineSubscription(
    customerId: string,
    machineId: string,
    machineSlug: string,
    priceMonthlyUsd: number,
    serverType: string,
    specs?: MachineSpecs,
    billingInterval: BillingInterval = 'monthly',
  ): Promise<{ subscriptionId: string; subscriptionItemId: string }> {
    const resolved = resolveStripePrice(priceMonthlyUsd, billingInterval);

    // Create an ad-hoc price for this machine
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: resolved.unitAmountCents,
      recurring: { interval: resolved.interval },
      product_data: {
        name: formatProductName(specs),
        metadata: {
          platform: 'justavps',
          machine_id: machineId,
          machine_slug: machineSlug,
          server_type: serverType,
        },
      },
    });

    // Create subscription — charges the default payment method RIGHT NOW
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      collection_method: 'charge_automatically',
      payment_behavior: 'error_if_incomplete',
      payment_settings: {
        payment_method_types: ['card'],
      },
      metadata: {
        machine_id: machineId,
        machine_slug: machineSlug,
        billing_interval: billingInterval,
      },
    });

    const itemId = subscription.items.data[0]?.id || '';

    console.log(`[STRIPE] Created subscription ${subscription.id} for machine ${machineSlug} (${resolved.intervalLabel}) — charged immediately`);

    return {
      subscriptionId: subscription.id,
      subscriptionItemId: itemId,
    };
  },

  /**
   * Create a $0 subscription for an admin machine.
   * Uses a real Stripe subscription with `unit_amount: 0` so the data model
   * is identical to a paid user (sub ID, item ID, product, price all exist).
   * Resize, cancel, proration — everything works identically.
   *
   * Security: no coupons or promo codes that could be leaked. The price is
   * simply created at $0. The subscription metadata includes `admin_discount: 'true'`
   * so `updateMachineSubscription` can detect admin subs and keep the $0 price on resize.
   */
  async createAdminMachineSubscription(
    customerId: string,
    machineId: string,
    machineSlug: string,
    priceMonthlyUsd: number,
    serverType: string,
    specs?: MachineSpecs,
    billingInterval: BillingInterval = 'monthly',
  ): Promise<{ subscriptionId: string; subscriptionItemId: string }> {
    const resolved = resolveStripePrice(priceMonthlyUsd, billingInterval);

    // Create an ad-hoc price at $0 — product still shows real specs for tracking
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 0,
      recurring: { interval: resolved.interval },
      product_data: {
        name: `${formatProductName(specs)} (Admin)`,
        metadata: {
          platform: 'justavps',
          machine_id: machineId,
          machine_slug: machineSlug,
          server_type: serverType,
          admin_discount: 'true',
          // Store the real price in metadata for auditing
          real_unit_amount_cents: String(resolved.unitAmountCents),
        },
      },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      collection_method: 'charge_automatically',
      metadata: {
        machine_id: machineId,
        machine_slug: machineSlug,
        billing_interval: billingInterval,
        admin_discount: 'true',
      },
    });

    const itemId = subscription.items.data[0]?.id || '';

    console.log(`[STRIPE] Created ADMIN subscription ${subscription.id} for machine ${machineSlug} ($0 — real price would be ${resolved.intervalLabel})`);

    return {
      subscriptionId: subscription.id,
      subscriptionItemId: itemId,
    };
  },

  /**
   * Cancel a machine's subscription (on machine delete).
   * Prorated credit is applied automatically.
   */
  async cancelMachineSubscription(subscriptionId: string): Promise<void> {
    if (!subscriptionId) return;
    try {
      await stripe.subscriptions.cancel(subscriptionId);
      console.log(`[STRIPE] Cancelled subscription ${subscriptionId}`);
    } catch (err) {
      console.error(`[STRIPE] Failed to cancel subscription ${subscriptionId}:`, err);
    }
  },

  /**
   * Schedule a subscription to cancel at the end of the current billing period.
   * The machine keeps running until the period ends, then Stripe fires
   * `customer.subscription.deleted` and the webhook destroys the machine.
   */
  async cancelAtPeriodEnd(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    console.log(`[STRIPE] Subscription ${subscriptionId} scheduled for cancellation at period end`);
    return subscription;
  },

  /**
   * Reverse a scheduled cancellation — subscription continues as normal.
   */
  async reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
    console.log(`[STRIPE] Subscription ${subscriptionId} reactivated (cancellation reversed)`);
    return subscription;
  },

  /**
   * Update a subscription price (on machine resize).
   * Detects admin subscriptions via metadata and keeps the price at $0.
   */
  async updateMachineSubscription(
    subscriptionItemId: string,
    newPriceMonthlyUsd: number,
    serverType: string,
    machineId: string,
    specs?: MachineSpecs,
    billingInterval: BillingInterval = 'monthly',
  ): Promise<void> {
    if (!subscriptionItemId) return;

    const resolved = resolveStripePrice(newPriceMonthlyUsd, billingInterval);

    // Check if this is an admin subscription by reading the parent subscription's metadata
    const item = await stripe.subscriptionItems.retrieve(subscriptionItemId);
    const sub = await stripe.subscriptions.retrieve(item.subscription as string);
    const isAdminSub = sub.metadata?.admin_discount === 'true';

    // Create new price — $0 for admin, real price for regular users
    const newPrice = await stripe.prices.create({
      currency: 'usd',
      unit_amount: isAdminSub ? 0 : resolved.unitAmountCents,
      recurring: { interval: resolved.interval },
      product_data: {
        name: isAdminSub ? `${formatProductName(specs)} (Admin)` : formatProductName(specs),
        metadata: {
          platform: 'justavps',
          machine_id: machineId,
          server_type: serverType,
          ...(isAdminSub ? { admin_discount: 'true', real_unit_amount_cents: String(resolved.unitAmountCents) } : {}),
        },
      },
    });

    // Update subscription item
    await stripe.subscriptionItems.update(subscriptionItemId, {
      price: newPrice.id,
      proration_behavior: 'create_prorations',
    });

    console.log(`[STRIPE] Updated subscription item ${subscriptionItemId} to ${resolved.intervalLabel}${isAdminSub ? ' (admin $0)' : ''}`);
  },

  /**
   * Backfill the real machine metadata onto an existing subscription.
   * Used when we must charge before the DB machine record exists.
   */
  async linkSubscriptionToMachine(
    subscriptionId: string,
    machineId: string,
    machineSlug: string,
  ): Promise<void> {
    if (!subscriptionId) return;

    await stripe.subscriptions.update(subscriptionId, {
      metadata: {
        machine_id: machineId,
        machine_slug: machineSlug,
      },
    });

    console.log(`[STRIPE] Linked subscription ${subscriptionId} to machine ${machineSlug}`);
  },

  /**
   * After checkout, set the payment method used as the customer's default.
   * This ensures future direct subscriptions (without checkout) can charge the card.
   */
  async setDefaultPaymentMethodFromCheckout(customerId: string, session: Stripe.Checkout.Session): Promise<void> {
    try {
      // Get the subscription created by checkout
      const subId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as Stripe.Subscription | null)?.id;

      if (!subId) return;

      const subscription = await stripe.subscriptions.retrieve(subId);
      const paymentMethodId = typeof subscription.default_payment_method === 'string'
        ? subscription.default_payment_method
        : subscription.default_payment_method?.id;

      if (!paymentMethodId) return;

      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      console.log(`[STRIPE] Set default payment method ${paymentMethodId} for customer ${customerId}`);
    } catch (err) {
      console.warn(`[STRIPE] Failed to set default payment method for ${customerId}:`, err);
    }
  },

  async linkCustomerToAccount(customerId: string, accountId: string, email?: string | null): Promise<void> {
    if (!customerId) return;

    await stripe.customers.update(customerId, {
      ...(email ? { email: email.trim().toLowerCase() } : {}),
      metadata: {
        justavps_account_id: accountId,
      },
    });
  },

  async linkCustomerToUser(customerId: string, userId: string, email?: string | null): Promise<void> {
    if (!customerId) return;

    await stripe.customers.update(customerId, {
      ...(email ? { email: email.trim().toLowerCase() } : {}),
      metadata: {
        justavps_user_id: userId,
      },
    });
  },

  /**
   * Retrieve the first subscription item id for an existing subscription.
   * Used to repair legacy machine billing links that stored `sub|checkout`.
   */
  async getSubscriptionItemId(subscriptionId: string): Promise<string | null> {
    if (!subscriptionId) return null;

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription.items.data[0]?.id || null;
  },

  /**
   * Create a Stripe Customer Portal session for billing management.
   * Returns null if the customer doesn't exist (stale ID from a previous Stripe account).
   */
  async createPortalSession(customerId: string, returnUrl: string): Promise<string | null> {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return session.url;
    } catch {
      console.warn(`[STRIPE] createPortalSession failed for ${customerId} — customer may not exist on this account`);
      return null;
    }
  },

  /**
   * Get customer's active subscriptions with details.
   */
  async getCustomerSubscriptions(customerId: string): Promise<Array<{
    id: string;
    status: string;
    machineId: string | null;
    machineSlug: string | null;
    priceMonthly: number;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  }>> {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      expand: ['data.items.data.price'],
    });

    return subs.data.map(sub => ({
      id: sub.id,
      status: sub.status,
      machineId: sub.metadata.machine_id || null,
      machineSlug: sub.metadata.machine_slug || null,
      priceMonthly: (sub.items.data[0]?.price?.unit_amount || 0) / 100,
      currentPeriodStart: new Date((sub as unknown as { current_period_start: number }).current_period_start * 1000),
      currentPeriodEnd: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000),
    }));
  },

  /**
   * Retrieve a Checkout Session by ID with expanded subscription/line items.
   */
  async getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
  },

  /**
   * Construct and verify a Stripe webhook event from the raw body + signature.
   */
  constructWebhookEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
    return stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  },

  /**
   * Verify Stripe is configured.
   */
  isConfigured(): boolean {
    return !!config.STRIPE_SECRET_KEY;
  },
};
