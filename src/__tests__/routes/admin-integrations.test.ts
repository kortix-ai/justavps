/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin Integrations surface.
 *
 * Covers:
 *  - GET /admin/integrations                 — returns expected ids + valid status values
 *  - Stripe absent                           — block status='not_configured' + configured=false
 *  - Hetzner Robot listServers throws        — block status='down' + non-null error
 *  - GET /admin/integrations/:id             — returns the single block
 *  - GET /admin/integrations/:id unknown id  — 404
 *  - Non-admin 403
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module-scoped mock state ───────────────────────────────────────────────

let currentIsAdmin = true;

// Mutable mocks that each test can tweak before importing the route.
const hetznerRobotListServersMock = vi.fn();
const hetznerRobotListServerProductsMock = vi.fn();
const stripeBalanceRetrieveMock = vi.fn();

// ── Auth guard stub ────────────────────────────────────────────────────────

vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', currentIsAdmin);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

// ── DB stub ────────────────────────────────────────────────────────────────
//
// The route issues multiple selects against stripeEvents, controlPlaneJobs,
// and webhookDeliveries. All just count(*) — return a uniform 0-count row.
// We also stub db.execute for the SELECT 1 liveness check.

vi.mock('@/server/db', () => {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    then: (onFulfilled: (v: any[]) => unknown) => Promise.resolve([{ count: 0 }]).then(onFulfilled),
  };
  return {
    db: {
      select: vi.fn(() => chain),
      execute: vi.fn(async () => [{ '?column?': 1 }]),
    },
  };
});

// ── Stripe stub ────────────────────────────────────────────────────────────

vi.mock('stripe', () => {
  // The route does `new Stripe(...)` and uses `.balance.retrieve()` +
  // Stripe.createFetchHttpClient. The constructor is replaced by a class
  // that returns an object with just what we need.
  const StripeCtor: any = function (this: any) {
    this.balance = { retrieve: stripeBalanceRetrieveMock };
  };
  StripeCtor.createFetchHttpClient = () => ({});
  return { __esModule: true, default: StripeCtor };
});

// ── Hetzner Robot client stub ──────────────────────────────────────────────

vi.mock('@/server/platform/baremetal/vendors/hetzner-robot', () => {
  class HetznerRobotClient {
    async listServers() { return hetznerRobotListServersMock(); }
    async listServerProducts() { return hetznerRobotListServerProductsMock(); }
  }
  return { HetznerRobotClient };
});

// ── Outbound fetch stub for Cloudflare + Hetzner Cloud ────────────────────
//
// Every request returns 200 with an empty JSON body.

const originalFetch = globalThis.fetch;
beforeEach(() => {
  currentIsAdmin = true;
  hetznerRobotListServersMock.mockReset();
  hetznerRobotListServerProductsMock.mockReset();
  stripeBalanceRetrieveMock.mockReset();
  // Defaults: Hetzner Robot works
  hetznerRobotListServersMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  hetznerRobotListServerProductsMock.mockResolvedValue([{ id: 'AX41' }]);
  stripeBalanceRetrieveMock.mockResolvedValue({ livemode: false });
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('admin integrations route', () => {
  it('GET /admin/integrations returns array with expected ids and valid statuses', async () => {
    const { adminIntegrationsApp } = await import('@/server/v1/routes/internal/admin-integrations');
    const res = await adminIntegrationsApp.request(new Request('http://localhost/integrations'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(typeof data.probed_at).toBe('string');
    expect(Array.isArray(data.integrations)).toBe(true);

    const ids = data.integrations.map((x: any) => x.id).sort();
    expect(ids).toEqual(
      [
        'cloudflare_dns',
        'cloudflare_kv',
        'database',
        'hetzner_cloud',
        'hetzner_robot',
        'smtp',
        'stripe',
      ].sort(),
    );

    for (const block of data.integrations) {
      expect(['ok', 'degraded', 'down', 'not_configured']).toContain(block.status);
      expect(typeof block.configured).toBe('boolean');
      expect(block).toHaveProperty('probe_ms');
      expect(block).toHaveProperty('checked_at');
      expect(block).toHaveProperty('context');
    }
  });

  it("returns status='not_configured' + configured=false when Stripe credentials are absent", async () => {
    // Re-import with STRIPE_SECRET_KEY unset. The `config` module snapshots
    // env vars at import time, so we must reset the module graph first.
    vi.resetModules();
    const originalStripeKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const { adminIntegrationsApp } = await import('@/server/v1/routes/internal/admin-integrations');
      const res = await adminIntegrationsApp.request(new Request('http://localhost/integrations/stripe'));
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.id).toBe('stripe');
      expect(data.status).toBe('not_configured');
      expect(data.configured).toBe(false);
    } finally {
      if (originalStripeKey !== undefined) process.env.STRIPE_SECRET_KEY = originalStripeKey;
    }
  });

  it("returns status='down' + non-null error when Hetzner Robot listServers throws", async () => {
    hetznerRobotListServersMock.mockRejectedValueOnce(new Error('401 unauthorized'));
    const { adminIntegrationsApp } = await import('@/server/v1/routes/internal/admin-integrations');
    const res = await adminIntegrationsApp.request(new Request('http://localhost/integrations/hetzner_robot'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe('hetzner_robot');
    expect(data.status).toBe('down');
    expect(data.error).toBeTruthy();
    // Do NOT leak the raw credentials-or-URL error string
    expect(data.error).not.toContain('robot-ws.your-server.de');
  });

  it('GET /admin/integrations/:id returns a single block for the requested id', async () => {
    const { adminIntegrationsApp } = await import('@/server/v1/routes/internal/admin-integrations');
    const res = await adminIntegrationsApp.request(new Request('http://localhost/integrations/database'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe('database');
    expect(data.label).toBeTruthy();
    expect(['ok', 'degraded', 'down', 'not_configured']).toContain(data.status);
  });

  it('GET /admin/integrations/:id returns 404 for unknown id', async () => {
    const { adminIntegrationsApp } = await import('@/server/v1/routes/internal/admin-integrations');
    const res = await adminIntegrationsApp.request(new Request('http://localhost/integrations/does_not_exist'));
    expect(res.status).toBe(404);
  });

  it('rejects non-admin callers with 403 on both routes', async () => {
    currentIsAdmin = false;
    const { adminIntegrationsApp } = await import('@/server/v1/routes/internal/admin-integrations');

    const listRes = await adminIntegrationsApp.request(new Request('http://localhost/integrations'));
    expect(listRes.status).toBe(403);

    const oneRes = await adminIntegrationsApp.request(new Request('http://localhost/integrations/stripe'));
    expect(oneRes.status).toBe(403);
  });
});
