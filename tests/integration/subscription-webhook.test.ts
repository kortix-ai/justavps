import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { db } from '@/server/db';
import { apiKeys, machines, stripeEvents, subscriptions, users } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { generateApiKey, hashPassword } from "@/server/core/crypto";

const API_BASE = process.env.E2E_BASE_URL || 'http://localhost:4100/api/v1';
const WEBHOOK_URL = 'http://localhost:4100/api/v1/stripe/webhooks';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let apiKey = '';
let userId = '';
let machineId = '';
let subscriptionRowId = '';
const createdEventIds: string[] = [];

const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_dummy');

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function sendSignedWebhook(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: STRIPE_WEBHOOK_SECRET,
  });

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body,
  });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  expect(STRIPE_SECRET_KEY).toBeTruthy();
  expect(STRIPE_WEBHOOK_SECRET).toBeTruthy();

  const email = `subscription-webhook-${Date.now()}@test.justavps.com`;
  const passwordHash = await hashPassword('TestPass123!');
  const [user] = await db.insert(users).values({
    email,
    passwordHash,
    name: 'Subscription Webhook E2E',
  }).returning();
  userId = user.id;

  const key = await generateApiKey();
  apiKey = key.key;
  await db.insert(apiKeys).values({
    ownerId: user.id,
    name: 'subscription-webhook-e2e',
    keyPrefix: key.prefix,
    keyHash: key.hash,
  });

  const [machine] = await db.insert(machines).values({
    ownerId: user.id,
    slug: `subscription-webhook-${Date.now()}`,
    name: 'Subscription Webhook Machine',
    status: 'ready',
    provider: 'cloud',
    serverType: 'cpx23',
    region: 'hel1',
    ip: '10.0.0.51',
    machineToken: `mt_${Date.now()}`,
    codeServerPassword: '',
    providerServerId: 'test-provider-server',
    priceMonthly: 15,
    readyAt: new Date(),
  }).returning();
  machineId = machine.id;

  const [subscription] = await db.insert(subscriptions).values({
    machineId: machine.id,
    ownerId: user.id,
    stripeSubscriptionId: 'sub_webhook_e2e',
    stripeSubscriptionItemId: 'si_webhook_e2e',
    status: 'active',
    cancelAtPeriodEnd: false,
  }).returning();
  subscriptionRowId = subscription.id;
});

afterAll(async () => {
  if (createdEventIds.length) {
    await db.delete(stripeEvents).where(inArray(stripeEvents.eventId, createdEventIds));
  }
  if (subscriptionRowId) {
    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionRowId));
  }
  if (machineId) {
    await db.delete(machines).where(eq(machines.id, machineId));
  }
  if (userId) {
    await db.delete(apiKeys).where(eq(apiKeys.ownerId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});

describe('subscription webhook sync', () => {
  it('syncs cancel_at_period_end into the machine API response', async () => {
    const cancelAtUnix = Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
    const eventId = `evt_webhook_cancel_${Date.now()}`;
    createdEventIds.push(eventId);

    await sendSignedWebhook({
      id: eventId,
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_webhook_e2e',
          object: 'subscription',
          status: 'active',
          cancel_at_period_end: true,
          cancel_at: cancelAtUnix,
          canceled_at: Math.floor(Date.now() / 1000),
          items: {
            object: 'list',
            data: [
              {
                id: 'si_webhook_e2e',
                object: 'subscription_item',
                price: {
                  id: 'price_webhook_e2e',
                  object: 'price',
                  unit_amount: 1500,
                },
              },
            ],
          },
        },
      },
    });

    const sub = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionRowId));
    expect(sub[0]?.cancelAtPeriodEnd).toBe(true);
    expect(sub[0]?.cancelAt).toBeTruthy();

    const res = await fetch(`${API_BASE}/machines/${machineId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      subscription: null | {
        cancel_at_period_end: boolean;
        cancel_at: string | null;
      };
    };

    expect(data.subscription?.cancel_at_period_end).toBe(true);
    expect(data.subscription?.cancel_at).toBeTruthy();
  });

  it('clears cancellation state when Stripe reactivates the subscription', async () => {
    const eventId = `evt_webhook_reactivate_${Date.now()}`;
    createdEventIds.push(eventId);

    await sendSignedWebhook({
      id: eventId,
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_webhook_e2e',
          object: 'subscription',
          status: 'active',
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
          items: {
            object: 'list',
            data: [
              {
                id: 'si_webhook_e2e',
                object: 'subscription_item',
                price: {
                  id: 'price_webhook_e2e',
                  object: 'price',
                  unit_amount: 1500,
                },
              },
            ],
          },
        },
      },
    });

    const sub = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionRowId));
    expect(sub[0]?.cancelAtPeriodEnd).toBe(false);
    expect(sub[0]?.cancelAt).toBeNull();

    const res = await fetch(`${API_BASE}/machines/${machineId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      subscription: null | {
        cancel_at_period_end: boolean;
        cancel_at: string | null;
      };
    };

    expect(data.subscription?.cancel_at_period_end).toBe(false);
    expect(data.subscription?.cancel_at).toBeNull();
  });
});
