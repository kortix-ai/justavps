import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { db } from '@/server/db';
import { apiKeys, machineEvents, machines, sshKeys, subscriptions, users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateApiKey, hashPassword } from '@/server/lib/crypto';

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:4100/api/v1';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_dummy');

let userId = '';
let apiKey = '';
let machineId = '';

function headers() {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function api(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init?.headers || {}),
    },
  });
}

beforeAll(async () => {
  expect(STRIPE_SECRET_KEY).toBeTruthy();

  const email = `billing-create-${Date.now()}@test.justavps.com`;
  const passwordHash = await hashPassword('TestPass123!');
  const [user] = await db.insert(users).values({
    email,
    passwordHash,
    name: 'Billing Create E2E',
  }).returning();
  userId = user.id;

  const key = await generateApiKey();
  apiKey = key.key;
  await db.insert(apiKeys).values({
    ownerId: user.id,
    name: 'billing-create-e2e',
    keyPrefix: key.prefix,
    keyHash: key.hash,
  });
});

afterAll(async () => {
  if (machineId) {
    await fetch(`${API_BASE}/machines/${machineId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);
  }

  if (userId) {
    const ownedMachines = await db.select({ id: machines.id }).from(machines).where(eq(machines.ownerId, userId));
    for (const machine of ownedMachines) {
      await db.delete(machineEvents).where(eq(machineEvents.machineId, machine.id));
      await db.delete(subscriptions).where(eq(subscriptions.machineId, machine.id));
    }
    await db.delete(machines).where(eq(machines.ownerId, userId));
    await db.delete(apiKeys).where(eq(apiKeys.ownerId, userId));
    await db.delete(sshKeys).where(eq(sshKeys.ownerId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});

describe('billing-backed machine create', () => {
  it('requires checkout before a payment method exists', async () => {
    const res = await api('/machines', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'cloud',
        server_type: 'cpx32',
        region: 'hel1',
        name: 'Billing Create Checkout Gate',
      }),
    });

    expect(res.status).toBe(402);
    const data = await res.json() as { requires_checkout: boolean; checkout_url: string };
    expect(data.requires_checkout).toBe(true);
    expect(data.checkout_url).toContain('checkout.stripe.com');
  });

  it('creates a machine and subscription row after adding a Stripe payment method', async () => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.stripeCustomerId).toBeTruthy();

    const paymentMethod = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
    await stripe.paymentMethods.attach(paymentMethod.id, { customer: user!.stripeCustomerId! });
    await stripe.customers.update(user!.stripeCustomerId!, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });

    const res = await api('/machines', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'cloud',
        server_type: 'cpx32',
        region: 'hel1',
        name: 'Billing Create Direct Charge',
      }),
    });

    expect(res.status).toBe(202);
    const data = await res.json() as { id: string; status: string };
    machineId = data.id;
    expect(data.status).toBe('provisioning');

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, machineId));
    expect(sub).toBeTruthy();
    expect(sub.stripeSubscriptionId.startsWith('sub_')).toBe(true);
    expect(sub.stripeSubscriptionItemId?.startsWith('si_')).toBe(true);
    expect(sub.status).toBe('active');
  });
});
