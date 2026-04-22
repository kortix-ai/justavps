/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin Webhooks + Webhook Deliveries surface.
 *
 * Covers:
 *  - GET /admin/webhooks                 — list + summary shape (active/disabled counts)
 *  - GET /admin/webhooks/:id             — secret is masked to first 4 chars + "..."
 *  - GET /admin/webhook-deliveries       — filters by status; response_body truncated
 *  - GET /admin/webhook-deliveries/:id   — returns full payload + response_body
 *  - GET /admin/webhook-deliveries/:id   — 404 for unknown
 *  - Non-admin 403 on all routes
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fixtures ────────────────────────────────────────────────────────────────

const WEBHOOK_ACTIVE_ID = 'aaaa1111-2222-4333-8444-555555555551';
const WEBHOOK_DISABLED_ID = 'aaaa1111-2222-4333-8444-555555555552';
const UNKNOWN_ID = 'aaaa1111-2222-4333-8444-999999999999';
const OWNER_ID = 'bbbb1111-2222-4333-8444-555555555551';
const ACCOUNT_ID = 'cccc1111-2222-4333-8444-555555555551';
const DELIVERY_OK_ID = 'dddd1111-2222-4333-8444-555555555551';
const DELIVERY_FAIL_ID = 'dddd1111-2222-4333-8444-555555555552';
const DELIVERY_DEAD_ID = 'dddd1111-2222-4333-8444-555555555553';

const activeWebhookRow = {
  id: WEBHOOK_ACTIVE_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  url: 'https://example.com/hook',
  secret: 'whsec_supersecrettoken',
  events: ['machine.created', 'machine.deleted'],
  active: true,
  failureCount: 0,
  lastDeliveredAt: new Date('2026-04-20T00:00:00.000Z'),
  disabledAt: null,
  disableReason: null,
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
};

const disabledWebhookRow = {
  id: WEBHOOK_DISABLED_ID,
  ownerId: OWNER_ID,
  accountId: ACCOUNT_ID,
  url: 'https://broken.example.com/hook',
  secret: 'whsec_brokenbrokentoken',
  events: ['*'],
  active: false,
  failureCount: 12,
  lastDeliveredAt: null,
  disabledAt: new Date('2026-04-15T00:00:00.000Z'),
  disableReason: 'Too many consecutive failures',
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
};

// A big response body (>1KB) — used to verify truncation in list endpoint.
const BIG_RESPONSE_BODY = 'X'.repeat(5_000);

const deliveredDeliveryRow = {
  id: DELIVERY_OK_ID,
  webhookId: WEBHOOK_ACTIVE_ID,
  eventType: 'machine.created',
  payload: { machine_id: 'm-123', status: 'ready' },
  payloadVersion: 1,
  status: 'delivered',
  statusCode: 200,
  responseBody: BIG_RESPONSE_BODY,
  durationMs: 210,
  attempt: 1,
  nextAttemptAt: null,
  lastAttemptAt: new Date('2026-04-20T00:00:00.000Z'),
  success: true,
  error: null,
  deliveredAt: new Date('2026-04-20T00:00:00.000Z'),
  deadLetteredAt: null,
  createdAt: new Date('2026-04-20T00:00:00.000Z'),
};

const deadLetteredDeliveryRow = {
  id: DELIVERY_DEAD_ID,
  webhookId: WEBHOOK_DISABLED_ID,
  eventType: 'machine.errored',
  payload: { machine_id: 'm-789' },
  payloadVersion: 1,
  status: 'dead_lettered',
  statusCode: null,
  responseBody: null,
  durationMs: null,
  attempt: 10,
  nextAttemptAt: null,
  lastAttemptAt: new Date('2026-04-15T00:00:00.000Z'),
  success: false,
  error: 'Giving up after 10 attempts',
  deliveredAt: null,
  deadLetteredAt: new Date('2026-04-15T00:00:00.000Z'),
  createdAt: new Date('2026-04-10T00:00:00.000Z'),
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
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: async () => [] })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    transaction: vi.fn(async (fn: any) =>
      fn({ select: vi.fn(), update: vi.fn(), insert: vi.fn() }),
    ),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin webhooks + webhook-deliveries routes', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    currentIsAdmin = true;
  });

  // ─── GET /admin/webhooks ─────────────────────────────────────────────────

  it('GET /admin/webhooks returns list with aggregates + summary', async () => {
    // SELECT order:
    //  1. count(*) total
    //  2. page rows (webhook + joins + correlated 24h aggregates)
    //  3. summary webhooks aggregates (total / active_count / disabled_count)
    //  4. summary deliveries aggregates (24h + dead_lettered)
    enqueueSelect([{ count: 2 }]);
    enqueueSelect([
      {
        webhook: activeWebhookRow,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        deliveryCount24h: 42,
        successCount24h: 40,
        failureCount24h: 2,
      },
      {
        webhook: disabledWebhookRow,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        deliveryCount24h: 0,
        successCount24h: 0,
        failureCount24h: 0,
      },
    ]);
    enqueueSelect([{ total: 2, active_count: 1, disabled_count: 1 }]);
    enqueueSelect([
      {
        total_deliveries_24h: 42,
        total_failures_24h: 2,
        dead_lettered_count: 1,
      },
    ]);

    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(new Request('http://localhost/webhooks'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(2);
    expect(data.webhooks).toHaveLength(2);

    const active = data.webhooks.find((w: any) => w.id === WEBHOOK_ACTIVE_ID);
    const disabled = data.webhooks.find((w: any) => w.id === WEBHOOK_DISABLED_ID);
    expect(active.active).toBe(true);
    expect(active.delivery_count_24h).toBe(42);
    expect(active.success_count_24h).toBe(40);
    expect(active.failure_count_24h).toBe(2);
    // Secret must NEVER appear in the list response.
    expect(active).not.toHaveProperty('secret');
    expect(active).not.toHaveProperty('secret_preview');

    expect(disabled.active).toBe(false);
    expect(disabled.failure_count).toBe(12);
    expect(disabled.disable_reason).toBe('Too many consecutive failures');

    expect(data.summary).toEqual({
      total: 2,
      active_count: 1,
      disabled_count: 1,
      total_deliveries_24h: 42,
      total_failures_24h: 2,
      dead_lettered_count: 1,
    });
  });

  it('GET /admin/webhooks rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(new Request('http://localhost/webhooks'));
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/webhooks/:id ──────────────────────────────────────────────

  it('GET /admin/webhooks/:id masks secret to first 4 chars + "..."', async () => {
    enqueueSelect([
      {
        webhook: activeWebhookRow,
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
      },
    ]);
    enqueueSelect([]); // deliveries list empty

    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request(`http://localhost/webhooks/${WEBHOOK_ACTIVE_ID}`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    // secret = 'whsec_supersecrettoken' → masked to first 4 chars + "..."
    expect(data.webhook.secret_preview).toBe('whse...');
    // Ensure we never leak the raw secret anywhere in the body.
    expect(JSON.stringify(data)).not.toContain('whsec_supersecrettoken');
    expect(data.webhook).not.toHaveProperty('secret');

    expect(data.owner.email).toBe('owner@example.com');
    expect(data.account.slug).toBe('acme');
    expect(Array.isArray(data.deliveries)).toBe(true);
  });

  it('GET /admin/webhooks/:id returns 404 for unknown webhook', async () => {
    enqueueSelect([]); // not found
    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request(`http://localhost/webhooks/${UNKNOWN_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it('GET /admin/webhooks/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request(`http://localhost/webhooks/${WEBHOOK_ACTIVE_ID}`),
    );
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/webhook-deliveries ────────────────────────────────────────

  it('GET /admin/webhook-deliveries filters by status and truncates response_body', async () => {
    // Filter ?status=delivered — only delivered rows come back.
    // SELECT order:
    //  1. count(*) total
    //  2. page rows (delivery + webhook url)
    //  3. summary aggregates
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        delivery: deliveredDeliveryRow,
        webhookUrl: 'https://example.com/hook',
      },
    ]);
    enqueueSelect([
      {
        delivered_count: 1,
        failed_count: 0,
        dead_lettered_count: 0,
        avg_duration_ms: 210,
      },
    ]);

    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request('http://localhost/webhook-deliveries?status=delivered'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(1);
    expect(data.deliveries).toHaveLength(1);
    const d = data.deliveries[0];
    expect(d.id).toBe(DELIVERY_OK_ID);
    expect(d.status).toBe('delivered');
    expect(d.success).toBe(true);
    expect(d.webhook_url).toBe('https://example.com/hook');
    // Response body was 5000 chars — list endpoint truncates to 1024.
    expect(d.response_body).toHaveLength(1024);
    // The list endpoint must NOT include the full payload (big).
    expect(d).not.toHaveProperty('payload');

    expect(data.summary).toEqual({
      delivered_count: 1,
      failed_count: 0,
      dead_lettered_count: 0,
      avg_duration_ms: 210,
    });
  });

  it('GET /admin/webhook-deliveries derives dead_lettered status for DLQ rows', async () => {
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        delivery: deadLetteredDeliveryRow,
        webhookUrl: 'https://broken.example.com/hook',
      },
    ]);
    enqueueSelect([
      {
        delivered_count: 0,
        failed_count: 0,
        dead_lettered_count: 1,
        avg_duration_ms: 0,
      },
    ]);

    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request('http://localhost/webhook-deliveries?status=dead_lettered'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.deliveries[0].id).toBe(DELIVERY_DEAD_ID);
    expect(data.deliveries[0].status).toBe('dead_lettered');
    expect(data.deliveries[0].dead_lettered_at).toBeTruthy();
  });

  it('GET /admin/webhook-deliveries rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request('http://localhost/webhook-deliveries'),
    );
    expect(res.status).toBe(403);
  });

  // ─── GET /admin/webhook-deliveries/:id ────────────────────────────────────

  it('GET /admin/webhook-deliveries/:id returns full payload + untruncated response_body', async () => {
    enqueueSelect([
      {
        delivery: deliveredDeliveryRow,
        webhookUrl: 'https://example.com/hook',
        webhookActive: true,
        webhookEvents: ['machine.created'],
        ownerEmail: 'owner@example.com',
        ownerName: 'Owner',
        accountName: 'Acme',
        accountSlug: 'acme',
        accountType: 'organization',
        accountId: ACCOUNT_ID,
      },
    ]);

    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request(`http://localhost/webhook-deliveries/${DELIVERY_OK_ID}`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.delivery.id).toBe(DELIVERY_OK_ID);
    expect(data.delivery.status).toBe('delivered');
    // Full payload is returned (big payload OK on detail endpoint)
    expect(data.delivery.payload).toEqual({ machine_id: 'm-123', status: 'ready' });
    // Full untruncated response body
    expect(data.delivery.response_body).toHaveLength(BIG_RESPONSE_BODY.length);

    expect(data.webhook.url).toBe('https://example.com/hook');
    expect(data.account.slug).toBe('acme');
    expect(data.owner?.email).toBe('owner@example.com');
  });

  it('GET /admin/webhook-deliveries/:id returns 404 for unknown delivery', async () => {
    enqueueSelect([]); // not found
    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request(`http://localhost/webhook-deliveries/${UNKNOWN_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it('GET /admin/webhook-deliveries/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminWebhooksApp } = await import('@/server/v1/routes/internal/admin-webhooks');
    const res = await adminWebhooksApp.request(
      new Request(`http://localhost/webhook-deliveries/${DELIVERY_FAIL_ID}`),
    );
    expect(res.status).toBe(403);
  });
});
