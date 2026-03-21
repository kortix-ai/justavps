import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const ensureAutoAdminUserMock = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('@/server/lib/auto-admin', () => ({
  ensureAutoAdminUser: ensureAutoAdminUserMock,
}));

function mockSelectSequence(...results: unknown[][]) {
  const queue = [...results];

  selectMock.mockImplementation(() => ({
    from: () => ({
      where: async () => queue.shift() ?? [],
    }),
  }));
}

describe('getAccountLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unlimited limits when the caller is already marked admin', async () => {
    const { getAccountLimits, ADMIN_UNLIMITED_LIMIT } = await import('@/server/lib/account-limits');

    const result = await getAccountLimits('user-1', true);

    expect(result).toEqual({
      maxMachines: ADMIN_UNLIMITED_LIMIT,
      maxImages: ADMIN_UNLIMITED_LIMIT,
    });
    expect(selectMock).not.toHaveBeenCalled();
    expect(ensureAutoAdminUserMock).not.toHaveBeenCalled();
  });

  it('falls back to the user record and keeps admins unlimited even if isAdmin was false', async () => {
    mockSelectSequence([
      { id: 'user-1', email: 'marko@kortix.com', isAdmin: true },
    ]);
    ensureAutoAdminUserMock.mockResolvedValue({ id: 'user-1', email: 'marko@kortix.com', isAdmin: true });

    const { getAccountLimits, ADMIN_UNLIMITED_LIMIT } = await import('@/server/lib/account-limits');
    const result = await getAccountLimits('user-1', false);

    expect(result).toEqual({
      maxMachines: ADMIN_UNLIMITED_LIMIT,
      maxImages: ADMIN_UNLIMITED_LIMIT,
    });
    expect(ensureAutoAdminUserMock).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'marko@kortix.com',
      isAdmin: true,
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('returns defaults for non-admin users without custom limits', async () => {
    mockSelectSequence([
      { id: 'user-2', email: 'user@example.com', isAdmin: false },
    ], []);
    ensureAutoAdminUserMock.mockResolvedValue({ id: 'user-2', email: 'user@example.com', isAdmin: false });

    const { getAccountLimits, DEFAULT_LIMITS } = await import('@/server/lib/account-limits');
    const result = await getAccountLimits('user-2', false);

    expect(result).toEqual(DEFAULT_LIMITS);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it('returns stored custom limits for regular users', async () => {
    mockSelectSequence([
      { id: 'user-3', email: 'user@example.com', isAdmin: false },
    ], [
      { maxMachines: 12, maxImages: 34 },
    ]);
    ensureAutoAdminUserMock.mockResolvedValue({ id: 'user-3', email: 'user@example.com', isAdmin: false });

    const { getAccountLimits } = await import('@/server/lib/account-limits');
    const result = await getAccountLimits('user-3', false);

    expect(result).toEqual({ maxMachines: 12, maxImages: 34 });
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
});
