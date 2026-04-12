import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiKeyWhereLimitMock = vi.fn();
const userWhereMock = vi.fn();
const selectFromMock = vi.fn((table: { __name?: string }) => {
  if (table?.__name === 'api_keys') {
    return {
      where: vi.fn(() => ({ limit: apiKeyWhereLimitMock })),
      limit: apiKeyWhereLimitMock,
    };
  }

  if (table?.__name === 'users') {
    return { where: userWhereMock, limit: vi.fn() };
  }

  return { where: vi.fn(), limit: vi.fn() };
});
const selectMock = vi.fn(() => ({ from: selectFromMock }));
const updateWhereMock = vi.fn(() => Promise.resolve(undefined));
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));

const validateApiKeyMock = vi.fn();
const ensureAutoAdminUserMock = vi.fn(async (user) => user);
const ensureUserAccountGraphMock = vi.fn(async () => undefined);
const resolveAccountForUserMock = vi.fn(async (user, forcedAccountId) => ({
  active: {
    account: { id: forcedAccountId ?? 'acct-1' },
    membership: { role: 'owner' },
  },
}));

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
}));

vi.mock('@/server/db/schema', () => ({
  apiKeys: {
    __name: 'api_keys',
    id: 'api_keys.id',
    keySha256: 'api_keys.key_sha256',
    keyPrefix: 'api_keys.key_prefix',
  },
  users: {
    __name: 'users',
    id: 'users.id',
    email: 'users.email',
    name: 'users.name',
    isAdmin: 'users.is_admin',
    stripeCustomerId: 'users.stripe_customer_id',
    defaultAccountId: 'users.default_account_id',
  },
}));

vi.mock('@/server/lib/crypto', () => ({
  validateApiKey: validateApiKeyMock,
}));

vi.mock('@/server/lib/auto-admin', () => ({
  ensureAutoAdminUser: ensureAutoAdminUserMock,
}));

vi.mock('@/server/lib/accounts', () => ({
  ACCOUNT_COOKIE_NAME: 'active_account_id',
  ensureUserAccountGraph: ensureUserAccountGraphMock,
  isAccountAdmin: vi.fn(() => true),
  isAccountOwner: vi.fn(() => true),
  resolveAccountForUser: resolveAccountForUserMock,
}));

describe('apiGuard API-key fallback lookup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    apiKeyWhereLimitMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'key-1',
        ownerId: 'user-1',
        accountId: 'acct-1',
        keyHash: 'bcrypt-hash',
        keyPrefix: 'sk_live_deadbeef...',
        keySha256: null,
        scope: 'account',
        machineIds: null,
        permissions: ['*'],
        expiresAt: null,
      }]);
    userWhereMock.mockResolvedValue([{
      id: 'user-1',
      email: 'owner@test.local',
      name: 'Owner',
      isAdmin: true,
      stripeCustomerId: null,
      defaultAccountId: 'acct-1',
    }]);
    validateApiKeyMock.mockResolvedValue(true);
  });

  it('limits bcrypt fallback lookup to matching key prefixes instead of scanning every API key', async () => {
    const { apiGuard } = await import('@/server/lib/api-guard');
    const app = new Hono();
    app.use('*', apiGuard);
    app.get('/', (c) => c.json({ ok: true, accountId: (c as any).get('accountId') }));

    const res = await app.request('http://localhost/', {
      headers: { Authorization: 'Bearer sk_live_deadbeefcafebabefeedface0123456789abcdef0123456789abcdef01234567' },
    });

    expect(res.status).toBe(200);
    expect(apiKeyWhereLimitMock).toHaveBeenCalledTimes(2);
    expect(validateApiKeyMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      keySha256: expect.any(String),
      lastUsed: expect.any(Date),
    }));
  });
});
