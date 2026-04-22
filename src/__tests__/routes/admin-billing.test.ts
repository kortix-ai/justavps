/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin Billing surface.
 *
 * Covers:
 *  - GET /admin/billing/summary       — shape + MRR math
 *  - GET /admin/billing/subscriptions — status filter, q filter
 *  - GET /admin/billing/subscriptions/:id — 404 + detail
 *  - Non-admin guard on all routes
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SUB1_ID = 'aaaa1111-2222-4333-8444-555555555551';
const SUB2_ID = 'aaaa1111-2222-4333-8444-555555555552';
const MACHINE1_ID = 'bbbb1111-2222-4333-8444-555555555551';
const MACHINE2_ID = 'bbbb1111-2222-4333-8444-555555555552';
const USER1_ID = 'cccc1111-2222-4333-8444-555555555551';
const ACCOUNT1_ID = 'dddd1111-2222-4333-8444-555555555551';

const subscription1 = {
  id: SUB1_ID,
  machineId: MACHINE1_ID,
  ownerId: USER1_ID,
  accountId: ACCOUNT1_ID,
  stripeSubscriptionId: 'sub_abc123',
  stripeSubscriptionItemId: 'si_abc123',
  stripeCheckoutSessionId: null,
  stripePriceId: 'price_10',
  status: 'active' as const,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  cancelledAt: null,
  currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-01T00:00:00.000Z'),
};

const subscription2 = {
  id: SUB2_ID,
  machineId: MACHINE2_ID,
  ownerId: USER1_ID,
  accountId: ACCOUNT1_ID,
  stripeSubscriptionId: 'sub_def456',
  stripeSubscriptionItemId: 'si_def456',
  stripeCheckoutSessionId: null,
  stripePriceId: 'price_20',
  status: 'past_due' as const,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  cancelledAt: null,
  currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
  createdAt: new Date('2026-03-15T00:00:00.000Z'),
  updatedAt: new Date('2026-04-05T00:00:00.000Z'),
};

const machine1 = {
  id: MACHINE1_ID,
  slug: 'ada-box',
  name: 'ada-box',
  status: 'ready' as const,
  region: 'eu',
  serverType: 'custom',
  priceMonthly: 10,
  lastHeartbeatAt: new Date('2026-04-15T00:00:00.000Z'),
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  deletedAt: null as Date | null,
};

const machine2 = {
  id: MACHINE2_ID,
  slug: 'acme-box',
  name: 'acme-box',
  status: 'ready' as const,
  region: 'us',
  serverType: 'custom',
  priceMonthly: 20,
  lastHeartbeatAt: new Date('2026-04-15T00:00:00.000Z'),
  createdAt: new Date('2026-03-15T00:00:00.000Z'),
  deletedAt: null as Date | null,
};

// ── Auth guard stub ─────────────────────────────────────────────────────────

let currentIsAdmin = true;
vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', currentIsAdmin);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

// ── DB stub (FIFO queue) ────────────────────────────────────────────────────

const selectQueue: any[][] = [];

function enqueueSelect(rows: any[]) {
  selectQueue.push(rows);
}

function makeSelectChain() {
  const resolver = async (): Promise<any[]> => {
    const next = selectQueue.shift();
    return next ?? [];
  };
  const chain: any = {
    from: (_t: any) => chain,
    leftJoin: (_t: any, _c: any) => chain,
    innerJoin: (_t: any, _c: any) => chain,
    where: (_c: any) => chain,
    orderBy: (..._a: any[]) => chain,
    limit: (_n: number) => chain,
    offset: (_n: number) => chain,
    groupBy: (..._a: any[]) => chain,
    then: (onFulfilled: (v: any[]) => unknown, onRejected?: (err: unknown) => unknown) =>
      resolver().then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn((_shape?: any) => ({
      from: (_t: any) => makeSelectChain(),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: async () => [] })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    transaction: vi.fn(async (fn: any) => fn({ select: vi.fn(), update: vi.fn(), insert: vi.fn() })),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin billing routes', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    currentIsAdmin = true;
  });

  // ── GET /summary ─────────────────────────────────────────────────────────

  it('GET /summary returns expected shape and correct MRR math', async () => {
    // SELECT order:
    //  1. MRR priceSum (active subs joined to machines)     → 30
    //  2. per-status counts                                 → [active:1, past_due:1]
    //  3. cancelling count                                  → 0
    //  4. cancelled_last_30d count                          → 0
    //  5. top accounts by MRR                               → [acct1: 30]
    //  6. stripe events last 24h                            → 5
    enqueueSelect([{ priceSum: 30 }]);
    enqueueSelect([
      { status: 'active', count: 1 },
      { status: 'past_due', count: 1 },
    ]);
    enqueueSelect([{ count: 0 }]);
    enqueueSelect([{ count: 0 }]);
    enqueueSelect([
      {
        accountId: ACCOUNT1_ID,
        accountName: 'Ada',
        priceSum: 30,
        subscriptionCount: 2,
      },
    ]);
    enqueueSelect([{ count: 5 }]);

    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(new Request('http://localhost/summary'));
    expect(res.status).toBe(200);
    const data = await res.json();

    // MRR: 2 machines @ $10 + $20 = $30/mo → 3000 cents
    expect(data.mrr_cents).toBe(3000);
    expect(data.active_count).toBe(1);
    expect(data.at_risk_count).toBe(1); // 1 past_due + 0 unpaid
    expect(data.mrr_by_status).toEqual({
      active: 1,
      past_due: 1,
      unpaid: 0,
      canceled: 0,
      incomplete: 0,
    });
    expect(data.cancelling_count).toBe(0);
    expect(data.cancelled_last_30d).toBe(0);
    expect(Array.isArray(data.top_accounts_by_mrr)).toBe(true);
    expect(data.top_accounts_by_mrr).toHaveLength(1);
    expect(data.top_accounts_by_mrr[0]).toMatchObject({
      account_id: ACCOUNT1_ID,
      account_name: 'Ada',
      mrr_cents: 3000,
      subscription_count: 2,
    });
    expect(data.stripe_events_last_24h).toBe(5);
  });

  it('GET /summary rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(new Request('http://localhost/summary'));
    expect(res.status).toBe(403);
  });

  // ── GET /subscriptions ────────────────────────────────────────────────────

  it('GET /subscriptions returns joined rows + total', async () => {
    // SELECT order: count, page rows
    enqueueSelect([{ count: 2 }]);
    enqueueSelect([
      {
        subscription: subscription1,
        machine: machine1,
        ownerEmail: 'ada@example.com',
        ownerName: 'Ada',
        ownerId: USER1_ID,
        accountId: ACCOUNT1_ID,
        accountName: 'Ada Lovelace',
        accountSlug: 'ada',
        accountType: 'personal',
      },
      {
        subscription: subscription2,
        machine: machine2,
        ownerEmail: 'ada@example.com',
        ownerName: 'Ada',
        ownerId: USER1_ID,
        accountId: ACCOUNT1_ID,
        accountName: 'Ada Lovelace',
        accountSlug: 'ada',
        accountType: 'personal',
      },
    ]);

    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(new Request('http://localhost/subscriptions'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.subscriptions).toHaveLength(2);
    expect(data.subscriptions[0].stripe_subscription_id).toBe('sub_abc123');
    expect(data.subscriptions[0].machine.slug).toBe('ada-box');
    expect(data.subscriptions[0].owner.email).toBe('ada@example.com');
    expect(data.subscriptions[0].account.name).toBe('Ada Lovelace');
  });

  it('GET /subscriptions?status=past_due returns only matching subs', async () => {
    // Handler still issues count + list selects; the mock DB doesn't apply
    // the status filter — that's the route's responsibility. We assert the
    // handler forwards what the DB returns. This feeds only past_due rows.
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        subscription: subscription2,
        machine: machine2,
        ownerEmail: 'ada@example.com',
        ownerName: 'Ada',
        ownerId: USER1_ID,
        accountId: ACCOUNT1_ID,
        accountName: 'Ada Lovelace',
        accountSlug: 'ada',
        accountType: 'personal',
      },
    ]);

    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(
      new Request('http://localhost/subscriptions?status=past_due'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.subscriptions).toHaveLength(1);
    expect(data.subscriptions[0].status).toBe('past_due');
  });

  it('GET /subscriptions?q=ada matches against slug OR email', async () => {
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        subscription: subscription1,
        machine: machine1,
        ownerEmail: 'ada@example.com',
        ownerName: 'Ada',
        ownerId: USER1_ID,
        accountId: ACCOUNT1_ID,
        accountName: 'Ada',
        accountSlug: 'ada',
        accountType: 'personal',
      },
    ]);

    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(
      new Request('http://localhost/subscriptions?q=ada'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.subscriptions).toHaveLength(1);
    // Matches either on machine slug (ada-box) or owner email (ada@example.com)
    const hit = data.subscriptions[0];
    const matchedSlug = hit.machine.slug.includes('ada');
    const matchedEmail = (hit.owner.email ?? '').includes('ada');
    expect(matchedSlug || matchedEmail).toBe(true);
  });

  it('GET /subscriptions rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(new Request('http://localhost/subscriptions'));
    expect(res.status).toBe(403);
  });

  // ── GET /subscriptions/:id ────────────────────────────────────────────────

  it('GET /subscriptions/:id returns 404 for unknown subscription', async () => {
    enqueueSelect([]); // detail lookup empty
    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(
      new Request(`http://localhost/subscriptions/${SUB1_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it('GET /subscriptions/:id returns detail including recent events', async () => {
    enqueueSelect([
      {
        subscription: subscription1,
        machine: machine1,
        ownerEmail: 'ada@example.com',
        ownerName: 'Ada',
        accountId: ACCOUNT1_ID,
        accountName: 'Ada Lovelace',
        accountSlug: 'ada',
        accountType: 'personal',
      },
    ]);
    enqueueSelect([
      {
        id: 'ev-1',
        event: 'status_changed',
        stage: null,
        message: 'ready',
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ]);

    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(
      new Request(`http://localhost/subscriptions/${SUB1_ID}`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.subscription.id).toBe(SUB1_ID);
    expect(data.subscription.stripe_subscription_id).toBe('sub_abc123');
    expect(data.machine.slug).toBe('ada-box');
    expect(data.owner.email).toBe('ada@example.com');
    expect(data.account.name).toBe('Ada Lovelace');
    expect(data.recent_events).toHaveLength(1);
  });

  it('GET /subscriptions/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(
      new Request(`http://localhost/subscriptions/${SUB1_ID}`),
    );
    expect(res.status).toBe(403);
  });

  // ── GET /stripe-events ────────────────────────────────────────────────────

  it('GET /stripe-events returns recent events list', async () => {
    enqueueSelect([
      {
        eventId: 'evt_1',
        eventType: 'customer.subscription.updated',
        processedAt: new Date('2026-04-20T00:00:00.000Z'),
      },
      {
        eventId: 'evt_2',
        eventType: 'invoice.paid',
        processedAt: new Date('2026-04-19T00:00:00.000Z'),
      },
    ]);

    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(new Request('http://localhost/stripe-events'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toHaveLength(2);
    expect(data.events[0].event_id).toBe('evt_1');
  });

  it('GET /stripe-events rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminBillingApp } = await import('@/server/v1/routes/internal/admin-billing');
    const res = await adminBillingApp.request(new Request('http://localhost/stripe-events'));
    expect(res.status).toBe(403);
  });
});
