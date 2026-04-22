/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin global search palette backend.
 *
 * Covers:
 *  - GET /admin/search?q=foo returns { q, total, results, counts_by_type }
 *  - q shorter than 2 chars → empty results, no DB queries fire
 *  - UUID exact match is ranked ahead of fuzzy matches
 *  - limit parameter caps total results
 *  - Non-admin callers get a 403
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
//
// The search route dispatches one SELECT per entity (10 total). For uuid
// queries it runs an additional 10 exact-match SELECTs BEFORE the 10 fuzzy
// queries. Tests pre-load a FIFO queue of rows in the dispatch order.

const selectQueue: any[][] = [];
let selectCallCount = 0;

function enqueueSelect(rows: any[]) {
  selectQueue.push(rows);
}

function makeSelectChain() {
  selectCallCount++;
  const resolver = async (): Promise<any[]> => {
    const next = selectQueue.shift();
    return next ?? [];
  };
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    groupBy: () => chain,
    then: (onFulfilled: (v: any[]) => unknown, onRejected?: (err: unknown) => unknown) =>
      resolver().then(onFulfilled, onRejected),
  };
  return chain;
}

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: () => makeSelectChain() })),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const MACHINE_ID = 'aaaa1111-2222-4333-8444-555555555551';
const ACCOUNT_ID = 'aaaa1111-2222-4333-8444-555555555552';

const machineRow = {
  id: MACHINE_ID,
  slug: 'foo-bar',
  name: 'foo-bar',
  ip: '1.2.3.4',
  providerServerId: 'hz-123',
};

const accountRow = {
  id: ACCOUNT_ID,
  slug: 'foo-org',
  name: 'Foo Org',
  type: 'organization',
  billingEmail: 'billing@foo.example.com',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Seed the ten fuzzy per-entity queries with supplied buckets. Order matches
 * the dispatch order inside the route: machines, accounts, users, hosts,
 * procurements, webhooks, images, subscriptions, ssh_keys, api_keys.
 */
function seedFuzzy(opts: {
  machines?: any[];
  accounts?: any[];
  users?: any[];
  hosts?: any[];
  procurements?: any[];
  webhooks?: any[];
  images?: any[];
  subscriptions?: any[];
  sshKeys?: any[];
  apiKeys?: any[];
}) {
  enqueueSelect(opts.machines ?? []);
  enqueueSelect(opts.accounts ?? []);
  enqueueSelect(opts.users ?? []);
  enqueueSelect(opts.hosts ?? []);
  enqueueSelect(opts.procurements ?? []);
  enqueueSelect(opts.webhooks ?? []);
  enqueueSelect(opts.images ?? []);
  enqueueSelect(opts.subscriptions ?? []);
  enqueueSelect(opts.sshKeys ?? []);
  enqueueSelect(opts.apiKeys ?? []);
}

/**
 * Seed the ten UUID exact-lookup queries that run BEFORE the fuzzy batch when
 * the query looks like a UUID. Same order as above.
 */
function seedUuid(opts: {
  machines?: any[];
  accounts?: any[];
  users?: any[];
  hosts?: any[];
  procurements?: any[];
  webhooks?: any[];
  images?: any[];
  subscriptions?: any[];
  sshKeys?: any[];
  apiKeys?: any[];
}) {
  enqueueSelect(opts.machines ?? []);
  enqueueSelect(opts.accounts ?? []);
  enqueueSelect(opts.users ?? []);
  enqueueSelect(opts.hosts ?? []);
  enqueueSelect(opts.procurements ?? []);
  enqueueSelect(opts.webhooks ?? []);
  enqueueSelect(opts.images ?? []);
  enqueueSelect(opts.subscriptions ?? []);
  enqueueSelect(opts.sshKeys ?? []);
  enqueueSelect(opts.apiKeys ?? []);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin search route', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    selectCallCount = 0;
    currentIsAdmin = true;
  });

  it('GET /admin/search?q=foo returns shape { q, total, results, counts_by_type }', async () => {
    seedFuzzy({ machines: [machineRow], accounts: [accountRow] });

    const { adminSearchApp } = await import('@/server/v1/routes/internal/admin-search');
    const res = await adminSearchApp.request(new Request('http://localhost/search?q=foo'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.q).toBe('foo');
    expect(typeof data.total).toBe('number');
    expect(Array.isArray(data.results)).toBe(true);
    expect(typeof data.counts_by_type).toBe('object');

    // Two rows landed — one machine + one account
    expect(data.total).toBe(2);
    expect(data.results).toHaveLength(2);
    expect(data.counts_by_type).toEqual({ machine: 1, account: 1 });

    // Machine result uses href template /v2/admin/machines?highlight=<id>
    const machine = data.results.find((r: any) => r.type === 'machine');
    expect(machine.id).toBe(MACHINE_ID);
    expect(machine.href).toBe(`/v2/admin/machines?highlight=${MACHINE_ID}`);
    expect(machine.label).toBe('foo-bar');

    // Account result uses /v2/admin/accounts?highlight=<id>
    const account = data.results.find((r: any) => r.type === 'account');
    expect(account.href).toBe(`/v2/admin/accounts?highlight=${ACCOUNT_ID}`);
    expect(account.sub_label).toBe('organization');
  });

  it('q shorter than 2 chars returns empty results without running any query', async () => {
    const { adminSearchApp } = await import('@/server/v1/routes/internal/admin-search');

    const res = await adminSearchApp.request(new Request('http://localhost/search?q=a'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.q).toBe('a');
    expect(data.total).toBe(0);
    expect(data.results).toEqual([]);
    expect(data.counts_by_type).toEqual({});
    // No SELECTs should have been dispatched.
    expect(selectCallCount).toBe(0);

    // Empty q ("") also short-circuits.
    const emptyRes = await adminSearchApp.request(new Request('http://localhost/search?q='));
    expect(emptyRes.status).toBe(200);
    const emptyData = await emptyRes.json();
    expect(emptyData.results).toEqual([]);
    expect(selectCallCount).toBe(0);
  });

  it('UUID exact match ranks ahead of fuzzy matches', async () => {
    // Seed UUID lookups: machine equality hit lands first, everything else empty.
    seedUuid({ machines: [machineRow] });
    // Then the fuzzy batch — an accidental substring hit on accounts that
    // should still end up AFTER the UUID match in the ordered results.
    seedFuzzy({ accounts: [accountRow] });

    const { adminSearchApp } = await import('@/server/v1/routes/internal/admin-search');
    const res = await adminSearchApp.request(
      new Request(`http://localhost/search?q=${MACHINE_ID}`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(2);
    // UUID exact match (machine) should be first.
    expect(data.results[0].type).toBe('machine');
    expect(data.results[0].id).toBe(MACHINE_ID);
    // Fuzzy match (account) ranked behind.
    expect(data.results[1].type).toBe('account');
  });

  it('respects the limit parameter', async () => {
    // 3 rows across two entities, ask for limit=2 → only 2 returned.
    seedFuzzy({
      machines: [
        { ...machineRow, id: 'm-1', slug: 'foo-1', name: 'foo-1' },
        { ...machineRow, id: 'm-2', slug: 'foo-2', name: 'foo-2' },
      ],
      accounts: [accountRow],
    });

    const { adminSearchApp } = await import('@/server/v1/routes/internal/admin-search');
    const res = await adminSearchApp.request(
      new Request('http://localhost/search?q=foo&limit=2'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(2);
    expect(data.results).toHaveLength(2);
    // counts_by_type only reflects rows that made it into the capped list.
    const totalCount = Object.values(data.counts_by_type).reduce(
      (a: number, b: any) => a + Number(b),
      0,
    );
    expect(totalCount).toBe(2);
  });

  it('rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminSearchApp } = await import('@/server/v1/routes/internal/admin-search');
    const res = await adminSearchApp.request(new Request('http://localhost/search?q=foo'));
    expect(res.status).toBe(403);
  });
});
