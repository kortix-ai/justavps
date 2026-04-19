#!/usr/bin/env npx tsx
import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../../src/server/db';
import { users, apiKeys, machines, sshKeys, machineEvents, subscriptions } from '../../src/server/db/schema';
import { hashPassword, generateApiKey } from "@/server/core/crypto";
import { eq, inArray } from 'drizzle-orm';

const BASE = process.env.BASE_URL || 'http://localhost:4100';
const API = `${BASE}/api/v1`;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';

if (!STRIPE_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

const stripe = new Stripe(STRIPE_KEY);

type TestUser = {
  userId: string;
  email: string;
  apiKey: string;
};

let testUser: TestUser | null = null;
const createdMachineIds: string[] = [];

type MachinePayload = {
  id: string;
  status: string;
  server_type: string;
  price_monthly: number | null;
};

type CheckoutRequiredPayload = {
  requires_checkout: boolean;
  checkout_url: string;
};

type CreateMachinePayload = {
  id: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  if (!testUser) throw new Error('Test user missing');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${testUser.apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => null) as T;
  return { status: res.status, data };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForMachine(machineId: string, predicate: (payload: MachinePayload) => boolean, timeoutMs: number, label: string) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status, data } = await api<MachinePayload>(`/machines/${machineId}`);
    assert(status === 200, `${label}: failed to fetch machine (${status})`);
    if (predicate(data)) return data;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`${label}: timed out after ${timeoutMs}ms`);
}

async function createTestUser() {
  const email = `billing-e2e-${Date.now()}@test.justavps.com`;
  const passwordHash = await hashPassword('TestPass123!');
  const [user] = await db.insert(users).values({
    email,
    passwordHash,
    name: 'Billing E2E',
  }).returning();
  const { key, hash, prefix } = await generateApiKey();
  await db.insert(apiKeys).values({
    ownerId: user.id,
    name: 'billing-e2e',
    keyPrefix: prefix,
    keyHash: hash,
  });
  testUser = { userId: user.id, email, apiKey: key };
}

async function attachPaymentMethod() {
  if (!testUser) throw new Error('Test user missing');
  const [user] = await db.select().from(users).where(eq(users.id, testUser.userId));
  assert(user?.stripeCustomerId, 'stripeCustomerId missing after checkout gate');
  const pm = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
  await stripe.paymentMethods.attach(pm.id, { customer: user.stripeCustomerId! });
  await stripe.customers.update(user.stripeCustomerId!, {
    invoice_settings: { default_payment_method: pm.id },
  });
}

async function verifyNoPmRequiresCheckout() {
  const { status, data } = await api<CheckoutRequiredPayload>('/machines', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'cloud',
      server_type: 'basic',
      region: 'hel1',
      name: 'billing-e2e-checkout-gate',
    }),
  });
  assert(status === 402, `expected 402 for no-PM create, got ${status}`);
  assert(Boolean(data?.requires_checkout), 'requires_checkout missing');
  assert(typeof data?.checkout_url === 'string' && data.checkout_url.includes('checkout.stripe.com'), 'checkout_url missing');

  const machinesRes = await api<{ machines: Array<{ id: string }> }>('/machines');
  assert(machinesRes.status === 200, 'failed to list machines');
  assert(machinesRes.data.machines.length === 0, 'machine should not exist before checkout success');
}

async function verifyInstantChargeAndResize() {
  const createRes = await api<CreateMachinePayload>('/machines', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'cloud',
      server_type: 'basic',
      region: 'hel1',
      name: 'billing-e2e-instant-charge',
    }),
  });
  assert(createRes.status === 202, `expected 202 for instant-charge create, got ${createRes.status}`);
  const machineId = createRes.data.id as string;
  createdMachineIds.push(machineId);

  const readyMachine = await waitForMachine(
    machineId,
    (machine) => machine.status === 'ready',
    8 * 60 * 1000,
    'instant-charge create',
  );
  assert(readyMachine.server_type === 'basic', 'initial machine type mismatch');
  assert(readyMachine.price_monthly === 21, 'initial monthly price mismatch');

  const [sub] = await db.select().from(subscriptions)
    .where(eq(subscriptions.machineId, machineId));
  assert(sub, 'subscription row missing for machine');
  assert(sub.stripeSubscriptionId.startsWith('sub_'), `billing link missing subscription: ${sub.stripeSubscriptionId}`);

  const resizeRes = await api<{ status: string }>(`/machines/${machineId}/resize`, {
    method: 'POST',
    body: JSON.stringify({ server_type: 'power' }),
  });
  assert(resizeRes.status === 202, `expected 202 for resize, got ${resizeRes.status}`);

  const resizedMachine = await waitForMachine(
    machineId,
    (machine) => machine.status === 'ready' && machine.server_type === 'power',
    8 * 60 * 1000,
    'resize',
  );
  assert(resizedMachine.price_monthly === 56, 'resized monthly price mismatch');

  // Re-fetch subscription after resize to get updated item
  const [subAfterResize] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, machineId));
  assert(subAfterResize.stripeSubscriptionItemId, 'subscription item ID missing after resize');
  const stripeItem = await stripe.subscriptionItems.retrieve(subAfterResize.stripeSubscriptionItemId, { expand: ['price'] });
  assert(stripeItem.price.unit_amount === 4900, `expected Stripe unit_amount=4900, got ${stripeItem.price.unit_amount}`);

  const subscription = await stripe.subscriptions.retrieve(subAfterResize.stripeSubscriptionId);
  const preview = await stripe.invoices.createPreview({
    customer: subscription.customer as string,
    subscription: subAfterResize.stripeSubscriptionId,
  });
  const descriptions = (preview.lines?.data || []).map((line) => line.description || '');
  assert(descriptions.some((line) => line.includes('Unused time on JustAVPS')), 'missing old-plan proration credit');
  assert(descriptions.some((line) => line.includes('Remaining time on JustAVPS')), 'missing new-plan proration charge');
}

async function cleanup() {
  if (createdMachineIds.length && testUser) {
    for (const machineId of createdMachineIds) {
      await fetch(`${API}/machines/${machineId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${testUser.apiKey}` },
      }).catch(() => null);
    }
  }

  if (testUser) {
    const ownedMachines = await db.select({ id: machines.id }).from(machines).where(eq(machines.ownerId, testUser.userId));
    if (ownedMachines.length) {
      await db.delete(machineEvents).where(inArray(machineEvents.machineId, ownedMachines.map((m) => m.id)));
      await db.delete(subscriptions).where(inArray(subscriptions.machineId, ownedMachines.map((m) => m.id)));
    }
    await db.delete(apiKeys).where(eq(apiKeys.ownerId, testUser.userId));
    await db.delete(sshKeys).where(eq(sshKeys.ownerId, testUser.userId));
    await db.delete(machines).where(eq(machines.ownerId, testUser.userId));
    await db.delete(users).where(eq(users.id, testUser.userId));
  }
}

async function main() {
  const health = await fetch(BASE);
  assert(health.ok, `app not reachable at ${BASE}`);

  await createTestUser();
  await verifyNoPmRequiresCheckout();
  await attachPaymentMethod();
  await verifyInstantChargeAndResize();
  console.log('billing e2e ok');
}

main()
  .catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
