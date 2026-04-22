/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Route-level tests for the admin Accounts + Users surface.
 *
 * Covers:
 *  - GET /admin/accounts       — list with aggregates
 *  - GET /admin/accounts/:id   — detail + 404
 *  - GET /admin/users          — list
 *  - GET /admin/users/:id      — detail + 404 + secret masking
 *  - Non-admin guard on all routes
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fixtures ────────────────────────────────────────────────────────────────

const ACC1_ID = 'aaaa1111-2222-4333-8444-555555555551';
const ACC2_ID = 'aaaa1111-2222-4333-8444-555555555552';
const USER1_ID = 'bbbb1111-2222-4333-8444-555555555551';
const USER2_ID = 'bbbb1111-2222-4333-8444-555555555552';
const MACHINE1_ID = 'cccc1111-2222-4333-8444-555555555551';

const account1 = {
  id: ACC1_ID,
  type: 'personal' as const,
  name: 'Ada Lovelace',
  slug: 'ada',
  personalForUserId: USER1_ID,
  billingEmail: 'ada@example.com',
  stripeCustomerId: 'cus_ada',
  createdAt: new Date('2026-04-01T00:00:00.000Z'),
  updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  deletedAt: null as Date | null,
};

const account2 = {
  id: ACC2_ID,
  type: 'organization' as const,
  name: 'Acme Corp',
  slug: 'acme',
  personalForUserId: null,
  billingEmail: 'billing@acme.test',
  stripeCustomerId: 'cus_acme',
  createdAt: new Date('2026-04-05T00:00:00.000Z'),
  updatedAt: new Date('2026-04-05T00:00:00.000Z'),
  deletedAt: null as Date | null,
};

const userRow = {
  id: USER1_ID,
  email: 'ada@example.com',
  emailVerified: new Date('2026-04-01T00:00:00.000Z'),
  passwordHash: 'HASH-SHOULD-NEVER-LEAK',
  githubId: 'gh-1',
  name: 'Ada Lovelace',
  stripeCustomerId: 'cus_ada',
  defaultAccountId: ACC1_ID,
  isAdmin: false,
  createdAt: new Date('2026-03-20T00:00:00.000Z'),
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
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: async () => [] })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    transaction: vi.fn(async (fn: any) => fn({ select: vi.fn(), update: vi.fn(), insert: vi.fn() })),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('admin accounts + users routes', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    currentIsAdmin = true;
  });

  // ── GET /admin/accounts ───────────────────────────────────────────────────

  it('GET /admin/accounts returns a list with aggregates and summary', async () => {
    // Order of SELECTs the handler issues:
    //  1. count(*) for total
    //  2. page rows
    //  3. member count group-by
    //  4. machine count + priceSum group-by
    //  5. active subscription count group-by
    //  6. personal summary count
    //  7. org summary count
    //  8. total members
    //  9. total machines
    enqueueSelect([{ count: 2 }]);
    enqueueSelect([account1, account2]);
    enqueueSelect([
      { accountId: ACC1_ID, count: 1 },
      { accountId: ACC2_ID, count: 2 },
    ]);
    enqueueSelect([
      { accountId: ACC1_ID, count: 1, priceSum: 10 },
      { accountId: ACC2_ID, count: 3, priceSum: 60 },
    ]);
    enqueueSelect([
      { accountId: ACC1_ID, count: 1 },
      { accountId: ACC2_ID, count: 2 },
    ]);
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([{ count: 3 }]);
    enqueueSelect([{ count: 4 }]);

    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request('http://localhost/accounts'));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(2);
    expect(data.accounts).toHaveLength(2);

    const a1 = data.accounts.find((x: any) => x.id === ACC1_ID);
    const a2 = data.accounts.find((x: any) => x.id === ACC2_ID);
    expect(a1.member_count).toBe(1);
    expect(a1.machine_count).toBe(1);
    expect(a1.active_subscription_count).toBe(1);
    expect(a1.mrr_cents).toBe(1000); // 10 USD * 100
    expect(a2.member_count).toBe(2);
    expect(a2.machine_count).toBe(3);
    expect(a2.active_subscription_count).toBe(2);
    expect(a2.mrr_cents).toBe(6000);

    expect(data.summary).toEqual({
      personal_count: 1,
      org_count: 1,
      total_members: 3,
      total_machines: 4,
    });
  });

  it('GET /admin/accounts rejects non-admin callers with 403', async () => {
    currentIsAdmin = false;
    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request('http://localhost/accounts'));
    expect(res.status).toBe(403);
  });

  // ── GET /admin/accounts/:id ──────────────────────────────────────────────

  it('GET /admin/accounts/:id returns 404 for unknown accounts', async () => {
    enqueueSelect([]); // account lookup empty
    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request(`http://localhost/accounts/${ACC1_ID}`));
    expect(res.status).toBe(404);
  });

  it('GET /admin/accounts/:id returns full detail for known accounts', async () => {
    // SELECT order:
    //  1. account row lookup
    //  2. members list
    //  3. machines list
    //  4. subscriptions list
    //  5. invitations list
    //  6. ssh keys (branch when memberUserIds.length > 0)
    enqueueSelect([account1]);
    enqueueSelect([
      {
        id: 'm1',
        userId: USER1_ID,
        role: 'owner',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        userEmail: 'ada@example.com',
        userName: 'Ada',
      },
    ]);
    enqueueSelect([
      {
        id: MACHINE1_ID,
        slug: 'ada-box',
        name: 'ada-box',
        status: 'ready',
        region: 'eu',
        serverType: 'custom',
        priceMonthly: 10,
        createdAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    ]);
    enqueueSelect([]);
    enqueueSelect([]);
    enqueueSelect([]);

    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request(`http://localhost/accounts/${ACC1_ID}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.account.id).toBe(ACC1_ID);
    expect(data.members).toHaveLength(1);
    expect(data.members[0].email).toBe('ada@example.com');
    expect(data.machines).toHaveLength(1);
    expect(data.machines[0].slug).toBe('ada-box');
  });

  it('GET /admin/accounts/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request(`http://localhost/accounts/${ACC1_ID}`));
    expect(res.status).toBe(403);
  });

  // ── GET /admin/users/:id ──────────────────────────────────────────────────

  it('GET /admin/users/:id returns 404 for unknown users', async () => {
    enqueueSelect([]);
    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request(`http://localhost/users/${USER2_ID}`));
    expect(res.status).toBe(404);
  });

  it('GET /admin/users/:id returns detail and never leaks password_hash or api-key secrets', async () => {
    // SELECT order:
    //  1. user row lookup
    //  2. memberships
    //  3. machines
    //  4. active subs
    //  5. ssh keys
    //  6. api keys (projection excludes keyHash/keySha256)
    enqueueSelect([userRow]);
    enqueueSelect([
      {
        id: 'mem-1',
        accountId: ACC1_ID,
        role: 'owner',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        accountName: 'Ada Lovelace',
        accountSlug: 'ada',
        accountType: 'personal',
      },
    ]);
    enqueueSelect([]);
    enqueueSelect([]);
    enqueueSelect([]);
    enqueueSelect([
      {
        id: 'key-1',
        name: 'CI Key',
        keyPrefix: 'jk_live_abc',
        scope: 'account',
        permissions: ['*'],
        accountId: ACC1_ID,
        machineIds: null,
        expiresAt: null,
        lastUsed: new Date('2026-04-15T00:00:00.000Z'),
        createdAt: new Date('2026-04-10T00:00:00.000Z'),
      },
    ]);

    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request(`http://localhost/users/${USER1_ID}`));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Core user fields are there
    expect(data.user.id).toBe(USER1_ID);
    expect(data.user.email).toBe('ada@example.com');
    expect(data.user.is_admin).toBe(false);

    // Password hash must never appear in the response
    expect(JSON.stringify(data)).not.toContain('HASH-SHOULD-NEVER-LEAK');
    expect(data.user.password_hash).toBeUndefined();
    expect(data.user.passwordHash).toBeUndefined();

    // API keys: prefix + scope + last-used, no hash or sha256
    expect(data.api_keys).toHaveLength(1);
    const k = data.api_keys[0];
    expect(k.key_prefix).toBe('jk_live_abc');
    expect(k.scope).toBe('account');
    expect(k.last_used).toBeTruthy();
    expect(k.key_hash).toBeUndefined();
    expect(k.key_sha256).toBeUndefined();
    expect(k.keyHash).toBeUndefined();
  });

  it('GET /admin/users/:id rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request(`http://localhost/users/${USER1_ID}`));
    expect(res.status).toBe(403);
  });

  // ── GET /admin/users (listing + typeahead compat) ────────────────────────

  it('GET /admin/users without pagination params returns typeahead shape', async () => {
    enqueueSelect([
      {
        id: USER1_ID,
        email: 'ada@example.com',
        name: 'Ada',
        defaultAccountId: ACC1_ID,
        accountId: ACC1_ID,
        accountName: 'Ada Lovelace',
        accountSlug: 'ada',
        accountType: 'personal',
      },
    ]);
    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request('http://localhost/users'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.users)).toBe(true);
    expect(data.total).toBeUndefined(); // typeahead shape — no total
    expect(data.users[0]).toMatchObject({
      id: USER1_ID,
      email: 'ada@example.com',
      account: { id: ACC1_ID, type: 'personal' },
    });
  });

  it('GET /admin/users with limit returns paginated shape with aggregates', async () => {
    // SELECT order (pagination mode):
    //  1. count(*)
    //  2. page rows
    //  3. machine aggs group-by
    //  4. active-sub group-by
    enqueueSelect([{ count: 1 }]);
    enqueueSelect([
      {
        id: USER1_ID,
        email: 'ada@example.com',
        name: 'Ada',
        isAdmin: false,
        defaultAccountId: ACC1_ID,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        accountId: ACC1_ID,
        accountName: 'Ada Lovelace',
        accountSlug: 'ada',
        accountType: 'personal',
      },
    ]);
    enqueueSelect([
      {
        ownerId: USER1_ID,
        count: 2,
        lastCreatedAt: new Date('2026-04-10T00:00:00.000Z'),
      },
    ]);
    enqueueSelect([{ ownerId: USER1_ID, count: 1 }]);

    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request('http://localhost/users?limit=50'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.users).toHaveLength(1);
    expect(data.users[0].machine_count).toBe(2);
    expect(data.users[0].active_subscription_count).toBe(1);
    expect(data.users[0].last_machine_created_at).toBeTruthy();
  });

  it('GET /admin/users rejects non-admins with 403', async () => {
    currentIsAdmin = false;
    const { adminAccountsApp } = await import('@/server/v1/routes/internal/admin-accounts');
    const res = await adminAccountsApp.request(new Request('http://localhost/users'));
    expect(res.status).toBe(403);
  });
});
