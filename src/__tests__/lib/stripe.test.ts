/**
 * Stripe integration tests — hits real Stripe TEST API.
 * Uses the test keys from .env to verify:
 * 1. Customer creation
 * 2. Subscription creation with ad-hoc pricing
 * 3. Subscription cancellation
 * 4. Price update (resize)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import 'dotenv/config';
import Stripe from 'stripe';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';

// Skip if no Stripe key
const describeStripe = STRIPE_KEY ? describe : describe.skip;

describeStripe('Stripe Integration (real test API)', () => {
  let stripe: Stripe;
  let customerId: string;
  let subscriptionId: string;
  let subscriptionItemId: string;
  let priceId: string;

  beforeAll(() => {
    stripe = new Stripe(STRIPE_KEY);
  });

  it('creates a test customer', async () => {
    const customer = await stripe.customers.create({
      email: 'test-e2e@justavps.com',
      metadata: { justavps_user_id: 'test-user-001', test: 'true' },
    });
    expect(customer.id).toMatch(/^cus_/);
    customerId = customer.id;
  });

  it('creates an ad-hoc price for a machine', async () => {
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 800, // $8.00/mo
      recurring: { interval: 'month' },
      product_data: {
        name: 'JustAVPS Machine (cx23) - E2E Test',
        metadata: { machine_id: 'test-machine-001', server_type: 'cx23' },
      },
    });
    expect(price.id).toMatch(/^price_/);
    expect(price.unit_amount).toBe(800);
    priceId = price.id;
  });

  it('creates a subscription for the machine', async () => {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      metadata: { machine_id: 'test-machine-001', machine_slug: 'e2e-test' },
    });
    expect(subscription.id).toMatch(/^sub_/);
    expect(subscription.status).toBe('incomplete');
    expect(subscription.items.data.length).toBe(1);
    subscriptionId = subscription.id;
    subscriptionItemId = subscription.items.data[0].id;
  });

  it('updates subscription price (simulate resize)', async () => {
    // Create new price for bigger machine
    const newPrice = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 1300, // $13.00/mo (cx33)
      recurring: { interval: 'month' },
      product_data: {
        name: 'JustAVPS Machine (cx33) - E2E Test Resize',
        metadata: { machine_id: 'test-machine-001', server_type: 'cx33' },
      },
    });

    const updatedItem = await stripe.subscriptionItems.update(subscriptionItemId, {
      price: newPrice.id,
      proration_behavior: 'create_prorations',
    });
    expect(updatedItem.price.unit_amount).toBe(1300);
  });

  it('cancels the subscription (simulate machine delete)', async () => {
    const cancelled = await stripe.subscriptions.cancel(subscriptionId);
    // Status is 'canceled' or 'incomplete_expired' depending on whether payment was collected
    expect(['canceled', 'incomplete_expired']).toContain(cancelled.status);
  });

  it('cleans up test customer', async () => {
    await stripe.customers.del(customerId);
  });
});
