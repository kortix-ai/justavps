/**
 * Stripe integration tests — hits real Stripe TEST API.
 * Uses the test keys from .env to verify:
 * 1. Customer creation
 * 2. Subscription creation with ad-hoc pricing
 * 3. Subscription cancellation
 * 4. Price update (resize)
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import 'dotenv/config';
import Stripe from 'stripe';

vi.setConfig({ testTimeout: 20000 });

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

// ─── Admin subscription tests ($0 price, no coupons) ────────────────────────

describeStripe('Stripe Admin Subscription ($0 ad-hoc price)', () => {
  let stripe: Stripe;
  let customerId: string;
  let adminSubId: string;
  let adminSubItemId: string;

  beforeAll(() => {
    stripe = new Stripe(STRIPE_KEY);
  });

  it('creates a test customer for admin flow', async () => {
    const customer = await stripe.customers.create({
      email: 'admin-test-e2e@kortix.ai',
      metadata: { justavps_user_id: 'admin-test-001', test: 'true' },
    });
    expect(customer.id).toMatch(/^cus_/);
    customerId = customer.id;
  });

  it('creates admin subscription at $0 price (no payment method needed)', async () => {
    // Create price at $0 — product metadata shows real specs
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 0, // $0 — admin gets free
      recurring: { interval: 'month' },
      product_data: {
        name: 'JustAVPS — 4 vCPU / 8 GB RAM / 80 GB SSD (Admin)',
        metadata: {
          platform: 'justavps',
          server_type: 'cpx32',
          admin_discount: 'true',
          real_unit_amount_cents: '2000', // real price tracked for auditing
        },
      },
    });

    expect(price.unit_amount).toBe(0);

    // Create subscription — no payment method needed for $0
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      collection_method: 'charge_automatically',
      metadata: {
        machine_id: 'admin-test-machine',
        machine_slug: 'admin-test-slug',
        billing_interval: 'monthly',
        admin_discount: 'true',
      },
    });

    expect(subscription.id).toMatch(/^sub_/);
    // $0 price → active immediately, no payment needed
    expect(subscription.status).toBe('active');
    expect(subscription.items.data.length).toBe(1);
    expect(subscription.items.data[0].price.unit_amount).toBe(0);
    expect(subscription.metadata.admin_discount).toBe('true');

    adminSubId = subscription.id;
    adminSubItemId = subscription.items.data[0].id;
  });

  it('has no coupons or discounts attached (secure — nothing to leak)', async () => {
    const sub = await stripe.subscriptions.retrieve(adminSubId, {
      expand: ['discounts'],
    });
    // No coupons or promo codes — security by design
    expect(sub.discounts.length).toBe(0);
  });

  it('updates admin subscription price on resize (stays $0)', async () => {
    // Simulate resize: create new $0 price for larger plan
    const newPrice = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 0,
      recurring: { interval: 'month' },
      product_data: {
        name: 'JustAVPS — 8 vCPU / 16 GB RAM / 160 GB SSD (Admin)',
        metadata: {
          platform: 'justavps',
          server_type: 'cpx42',
          admin_discount: 'true',
          real_unit_amount_cents: '3600',
        },
      },
    });

    // Update subscription item (same as regular resize path)
    const updatedItem = await stripe.subscriptionItems.update(adminSubItemId, {
      price: newPrice.id,
      proration_behavior: 'create_prorations',
    });
    expect(updatedItem.price.unit_amount).toBe(0);

    // Verify subscription is still active and $0
    const sub = await stripe.subscriptions.retrieve(adminSubId);
    expect(sub.status).toBe('active');
  });

  it('cancels admin subscription (simulate machine delete)', async () => {
    const cancelled = await stripe.subscriptions.cancel(adminSubId);
    expect(cancelled.status).toBe('canceled');
  });

  it('cleans up admin test customer', async () => {
    await stripe.customers.del(customerId);
  });
});

// ─── Admin resize via stripeClient (integration with our helper) ─────────────

describeStripe('stripeClient.createAdminMachineSubscription + updateMachineSubscription', () => {
  // Tests the actual stripeClient methods end-to-end with real Stripe API
  let stripeClient: Awaited<typeof import("@/server/v1/services/stripe")>['stripeClient'];
  let stripe: Stripe;
  let customerId: string;
  let subId: string;
  let subItemId: string;

  beforeAll(async () => {
    stripe = new Stripe(STRIPE_KEY);
    const mod = await import("@/server/v1/services/stripe");
    stripeClient = mod.stripeClient;
  });

  it('creates admin customer', async () => {
    const customer = await stripe.customers.create({
      email: `admin-helper-test-${Date.now()}@kortix.ai`,
      metadata: { justavps_user_id: 'admin-helper-test', test: 'true' },
    });
    customerId = customer.id;
  });

  it('createAdminMachineSubscription creates $0 sub with no coupons', async () => {
    const result = await stripeClient.createAdminMachineSubscription(
      customerId,
      'test-machine-id',
      'test-machine-slug',
      20, // $20/mo — should be zeroed
      'cpx32',
      { vcpus: 4, ramGb: 8, diskGb: 80 },
    );

    expect(result.subscriptionId).toMatch(/^sub_/);
    expect(result.subscriptionItemId).toMatch(/^si_/);

    // Verify the sub is active at $0
    const sub = await stripe.subscriptions.retrieve(result.subscriptionId, {
      expand: ['discounts'],
    });
    expect(sub.status).toBe('active');
    expect(sub.items.data[0].price.unit_amount).toBe(0);
    expect(sub.metadata.admin_discount).toBe('true');
    // No coupons — secure
    expect(sub.discounts.length).toBe(0);

    subId = result.subscriptionId;
    subItemId = result.subscriptionItemId;
  });

  it('updateMachineSubscription detects admin sub and keeps $0 on resize', async () => {
    // This tests the full resize flow through our helper
    await stripeClient.updateMachineSubscription(
      subItemId,
      36, // $36/mo — should stay $0 for admin
      'cpx42',
      'test-machine-id',
      { vcpus: 8, ramGb: 16, diskGb: 160 },
    );

    // Verify the subscription item was updated but is still $0
    const sub = await stripe.subscriptions.retrieve(subId);
    expect(sub.status).toBe('active');
    expect(sub.items.data[0].price.unit_amount).toBe(0);
    // Product metadata should have the real price for auditing
    const price = await stripe.prices.retrieve(sub.items.data[0].price.id, { expand: ['product'] });
    const product = price.product as Stripe.Product;
    expect(product.metadata.admin_discount).toBe('true');
    expect(product.metadata.real_unit_amount_cents).toBe('3600');
  });

  it('cleanup: cancel sub + delete customer', async () => {
    await stripe.subscriptions.cancel(subId);
    await stripe.customers.del(customerId);
  });
});
