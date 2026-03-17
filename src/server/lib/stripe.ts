/**
 * Stripe billing integration.
 *
 * Each machine = one Stripe subscription with a metered price based on server type.
 * We use Stripe's usage-based billing with a fixed monthly price per machine.
 */

import Stripe from 'stripe';
import { config } from './config';

const stripe = new Stripe(config.STRIPE_SECRET_KEY);

export const stripeClient = {
  /**
   * Get or create a Stripe customer for a user.
   */
  async getOrCreateCustomer(userId: string, email: string): Promise<string> {
    // Search for existing customer by metadata
    const existing = await stripe.customers.search({
      query: `metadata['justavps_user_id']:'${userId}'`,
    });

    if (existing.data.length > 0) {
      return existing.data[0].id;
    }

    // Create new customer
    const customer = await stripe.customers.create({
      email,
      metadata: { justavps_user_id: userId },
    });

    return customer.id;
  },

  /**
   * Create a subscription for a machine.
   * Uses a dynamic price based on the server type's monthly cost.
   */
  async createMachineSubscription(
    customerId: string,
    machineId: string,
    machineSlug: string,
    priceMonthlyUsd: number,
    serverType: string,
  ): Promise<{ subscriptionId: string; subscriptionItemId: string }> {
    // Create an ad-hoc price for this machine
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: Math.round(priceMonthlyUsd * 100), // cents
      recurring: { interval: 'month' },
      product_data: {
        name: `JustAVPS Machine (${serverType})`,
        metadata: {
          machine_id: machineId,
          machine_slug: machineSlug,
          server_type: serverType,
        },
      },
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      payment_behavior: 'default_incomplete',
      proration_behavior: 'create_prorations',
      metadata: {
        machine_id: machineId,
        machine_slug: machineSlug,
      },
    });

    const itemId = subscription.items.data[0]?.id || '';

    console.log(`[STRIPE] Created subscription ${subscription.id} for machine ${machineSlug} ($${priceMonthlyUsd}/mo)`);

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
   * Update a subscription price (on machine resize).
   */
  async updateMachineSubscription(
    subscriptionItemId: string,
    newPriceMonthlyUsd: number,
    serverType: string,
    machineId: string,
  ): Promise<void> {
    if (!subscriptionItemId) return;

    // Create new price
    const newPrice = await stripe.prices.create({
      currency: 'usd',
      unit_amount: Math.round(newPriceMonthlyUsd * 100),
      recurring: { interval: 'month' },
      product_data: {
        name: `JustAVPS Machine (${serverType})`,
        metadata: { machine_id: machineId, server_type: serverType },
      },
    });

    // Update subscription item
    await stripe.subscriptionItems.update(subscriptionItemId, {
      price: newPrice.id,
      proration_behavior: 'create_prorations',
    });

    console.log(`[STRIPE] Updated subscription item ${subscriptionItemId} to $${newPriceMonthlyUsd}/mo (${serverType})`);
  },

  /**
   * Create a Stripe Customer Portal session for billing management.
   */
  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
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
   * Verify Stripe is configured.
   */
  isConfigured(): boolean {
    return !!config.STRIPE_SECRET_KEY;
  },
};
