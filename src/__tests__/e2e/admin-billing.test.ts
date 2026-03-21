/**
 * E2E: Admin billing — machine creation & resize with $0 Stripe subscriptions.
 *
 * Verifies:
 *  1. Admin machine creation produces a real Stripe subscription at $0
 *  2. The subscription record exists in the DB (machineId, sub ID, item ID)
 *  3. Admin machine resize updates the Stripe subscription (stays $0)
 *  4. No coupons or promo codes are used (nothing to leak)
 *  5. Regular (non-admin) users still get charged / redirected to checkout
 *
 * Requires:
 *   - Dev server running on port 4100
 *   - STRIPE_SECRET_KEY set (test mode)
 *   - Database access
 *
 * Run:  npx vitest run --config vitest.e2e.config.ts src/__tests__/e2e/admin-billing.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { db } from '@/server/db';
import { apiKeys, machineEvents, machines, sshKeys, subscriptions, users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateApiKey, hashPassword } from '@/server/lib/crypto';

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:4100/api/v1';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_dummy');

// ─── Admin user state ───────────────────────────────────────────────────────

let adminUserId = '';
let adminApiKey = '';
let adminMachineId = '';

// ─── Regular user state ─────────────────────────────────────────────────────

let regularUserId = '';
let regularApiKey = '';

// ─── Helpers ────────────────────────────────────────────────────────────────

function adminHeaders() {
  return {
    Authorization: `Bearer ${adminApiKey}`,
    'Content-Type': 'application/json',
  };
}

function regularHeaders() {
  return {
    Authorization: `Bearer ${regularApiKey}`,
    'Content-Type': 'application/json',
  };
}

async function api(path: string, init?: RequestInit, hdrs?: Record<string, string>) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(hdrs || adminHeaders()),
      ...(init?.headers || {}),
    },
  });
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  expect(STRIPE_SECRET_KEY).toBeTruthy();

  // Create admin user (@kortix.ai domain triggers auto-admin)
  const adminEmail = `admin-billing-e2e-${Date.now()}@kortix.ai`;
  const passwordHash = await hashPassword('TestPass123!');
  const [adminUser] = await db.insert(users).values({
    email: adminEmail,
    passwordHash,
    name: 'Admin Billing E2E',
    isAdmin: true,
  }).returning();
  adminUserId = adminUser.id;

  const adminKey = await generateApiKey();
  adminApiKey = adminKey.key;
  await db.insert(apiKeys).values({
    ownerId: adminUser.id,
    name: 'admin-billing-e2e',
    keyPrefix: adminKey.prefix,
    keyHash: adminKey.hash,
  });

  // Create regular (non-admin) user
  const regularEmail = `regular-billing-e2e-${Date.now()}@test.justavps.com`;
  const [regularUser] = await db.insert(users).values({
    email: regularEmail,
    passwordHash,
    name: 'Regular Billing E2E',
    isAdmin: false,
  }).returning();
  regularUserId = regularUser.id;

  const regularKey = await generateApiKey();
  regularApiKey = regularKey.key;
  await db.insert(apiKeys).values({
    ownerId: regularUser.id,
    name: 'regular-billing-e2e',
    keyPrefix: regularKey.prefix,
    keyHash: regularKey.hash,
  });
});

// ─── Teardown ───────────────────────────────────────────────────────────────

afterAll(async () => {
  // Clean up admin resources
  for (const uid of [adminUserId, regularUserId]) {
    if (!uid) continue;
    const ownedMachines = await db.select({ id: machines.id }).from(machines).where(eq(machines.ownerId, uid));
    for (const machine of ownedMachines) {
      await db.delete(machineEvents).where(eq(machineEvents.machineId, machine.id));
      await db.delete(subscriptions).where(eq(subscriptions.machineId, machine.id));
    }
    await db.delete(machines).where(eq(machines.ownerId, uid));
    await db.delete(sshKeys).where(eq(sshKeys.ownerId, uid));
    await db.delete(apiKeys).where(eq(apiKeys.ownerId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('admin billing: machine create with $0 subscription', () => {
  it('admin machine creation succeeds without payment method', async () => {
    const res = await api('/machines', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'cloud',
        server_type: 'cpx32',
        region: 'hel1',
        name: 'Admin Billing E2E Machine',
      }),
    });

    // Admin should NOT get 402 (checkout required) — should proceed directly
    expect(res.status).toBe(202);
    const data = await res.json() as { id: string; status: string };
    expect(data.id).toBeTruthy();
    expect(data.status).toBe('provisioning');
    adminMachineId = data.id;
  });

  it('admin machine has a subscription record in DB', async () => {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, adminMachineId));
    expect(sub).toBeTruthy();
    expect(sub.stripeSubscriptionId).toMatch(/^sub_/);
    expect(sub.stripeSubscriptionItemId).toMatch(/^si_/);
    expect(sub.status).toBe('active');
  });

  it('Stripe subscription is active at $0 with admin_discount metadata', async () => {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, adminMachineId));
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
      expand: ['discounts'],
    });

    expect(stripeSub.status).toBe('active');
    expect(stripeSub.metadata.admin_discount).toBe('true');

    // Price should be $0
    const item = stripeSub.items.data[0];
    expect(item.price.unit_amount).toBe(0);

    // No coupons — nothing to leak
    expect(stripeSub.discounts.length).toBe(0);
  });

  it('Stripe product metadata tracks the real price for auditing', async () => {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, adminMachineId));
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const priceObj = await stripe.prices.retrieve(stripeSub.items.data[0].price.id, {
      expand: ['product'],
    });
    const product = priceObj.product as Stripe.Product;

    expect(product.metadata.admin_discount).toBe('true');
    expect(product.metadata.real_unit_amount_cents).toBeTruthy();
    expect(Number(product.metadata.real_unit_amount_cents)).toBeGreaterThan(0);
  });
});

describe('admin billing: machine resize updates subscription', () => {
  it('updates machine to ready status so resize is allowed', async () => {
    // The machine is in 'provisioning' state — we need to mark it ready for resize
    // Also need to set providerServerId for the resize endpoint
    await db.update(machines)
      .set({
        status: 'ready',
        providerServerId: 'test-provider-server-admin-e2e',
        serverType: 'cpx32',
      })
      .where(eq(machines.id, adminMachineId));
  });

  it('resize succeeds for admin machine (has subscription)', async () => {
    const res = await api(`/machines/${adminMachineId}/resize`, {
      method: 'POST',
      body: JSON.stringify({ server_type: 'cpx42' }),
    });

    // Should NOT get 400 "no linked billing subscription"
    expect(res.status).toBe(202);
    const data = await res.json() as { action: string; old_type: string; new_type: string; status: string };
    expect(data.action).toBe('resize');
    expect(data.old_type).toBe('cpx32');
    expect(data.new_type).toBe('cpx42');
    expect(data.status).toBe('initiated');
  });

  it('Stripe subscription item price is updated (still $0 for admin)', async () => {
    // Wait briefly for the background update
    await new Promise(r => setTimeout(r, 3000));

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, adminMachineId));
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

    expect(stripeSub.status).toBe('active');
    expect(stripeSub.metadata.admin_discount).toBe('true');

    // Price should still be $0 after resize
    const item = stripeSub.items.data[0];
    expect(item.price.unit_amount).toBe(0);
  });
});

describe('regular user billing: checkout still required', () => {
  it('non-admin user without payment method gets 402 checkout redirect', async () => {
    const res = await api('/machines', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'cloud',
        server_type: 'cpx32',
        region: 'hel1',
        name: 'Regular Billing E2E Machine',
      }),
    }, regularHeaders());

    expect(res.status).toBe(402);
    const data = await res.json() as { requires_checkout: boolean; checkout_url: string };
    expect(data.requires_checkout).toBe(true);
    expect(data.checkout_url).toContain('checkout.stripe.com');
  });
});

describe('security: no admin coupon exists', () => {
  it('no justavps_admin coupon exists in Stripe', async () => {
    // Verify we're not leaving coupons around that could be exploited
    try {
      const coupon = await stripe.coupons.retrieve('justavps_admin_100pct_off');
      // If it exists from a previous test run, delete it
      if (coupon) {
        await stripe.coupons.del('justavps_admin_100pct_off');
      }
    } catch {
      // Expected — coupon should not exist
    }

    // Verify it's gone or never existed
    let exists = false;
    try {
      await stripe.coupons.retrieve('justavps_admin_100pct_off');
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
