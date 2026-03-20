import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { apiKeys, machines, subscriptions, users } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateApiKey, hashPassword } from '@/server/lib/crypto';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:4100/api/v1';

let apiKey = '';
let userId = '';
let machineId = '';
let subscriptionId = '';

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

beforeAll(async () => {
  const email = `subscription-e2e-${Date.now()}@test.justavps.com`;
  const passwordHash = await hashPassword('TestPass123!');
  const [user] = await db.insert(users).values({
    email,
    passwordHash,
    name: 'Subscription State E2E',
  }).returning();
  userId = user.id;

  const key = await generateApiKey();
  apiKey = key.key;
  await db.insert(apiKeys).values({
    ownerId: user.id,
    name: 'subscription-state-e2e',
    keyPrefix: key.prefix,
    keyHash: key.hash,
  });

  const [machine] = await db.insert(machines).values({
    ownerId: user.id,
    slug: `subscription-e2e-${Date.now()}`,
    name: 'Subscription E2E Machine',
    status: 'ready',
    provider: 'cloud',
    serverType: 'cpx23',
    region: 'hel1',
    ip: '10.0.0.50',
    machineToken: `mt_${Date.now()}`,
    codeServerPassword: '',
    providerServerId: 'test-provider-server',
    sshPublicKey: 'ssh-ed25519 AAAAC3NzaTest subscription-e2e',
    sshPrivateKey: '-----BEGIN TEST KEY-----\nsubscription-e2e\n-----END TEST KEY-----',
    priceMonthly: 15,
    readyAt: new Date(),
  }).returning();
  machineId = machine.id;

  const [subscription] = await db.insert(subscriptions).values({
    machineId: machine.id,
    ownerId: user.id,
    stripeSubscriptionId: 'sub_subscription_state_e2e',
    stripeSubscriptionItemId: 'si_subscription_state_e2e',
    status: 'active',
    cancelAtPeriodEnd: true,
    cancelledAt: new Date(),
    cancelAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }).returning();
  subscriptionId = subscription.id;
});

afterAll(async () => {
  if (subscriptionId) {
    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId));
  }
  if (machineId) {
    await db.delete(machines).where(eq(machines.id, machineId));
  }
  if (userId) {
    await db.delete(apiKeys).where(eq(apiKeys.ownerId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});

describe('subscription state API', () => {
  it('GET /machines includes subscription state', async () => {
    const res = await fetch(`${BASE_URL}/machines`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      machines: Array<{
        id: string;
        subscription: null | {
          status: string;
          cancel_at_period_end: boolean;
          cancel_at: string | null;
          cancelled_at: string | null;
          current_period_end: string | null;
        };
      }>;
    };

    const machine = data.machines.find((entry) => entry.id === machineId);
    expect(machine).toBeTruthy();
    expect(machine?.subscription).toBeTruthy();
    expect(machine?.subscription?.status).toBe('active');
    expect(machine?.subscription?.cancel_at_period_end).toBe(true);
    expect(machine?.subscription?.cancel_at).toBeTruthy();
  });

  it('GET /machines/:id includes subscription state', async () => {
    const res = await fetch(`${BASE_URL}/machines/${machineId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      id: string;
      subscription: null | {
        status: string;
        cancel_at_period_end: boolean;
        cancel_at: string | null;
        cancelled_at: string | null;
        current_period_end: string | null;
      };
    };

    expect(data.id).toBe(machineId);
    expect(data.subscription).toBeTruthy();
    expect(data.subscription?.status).toBe('active');
    expect(data.subscription?.cancel_at_period_end).toBe(true);
    expect(data.subscription?.cancelled_at).toBeTruthy();
    expect(data.subscription?.current_period_end).toBeTruthy();
  });
});
