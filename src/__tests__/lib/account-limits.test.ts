import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const ensureAutoAdminUserMock = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('@/server/auth/auto-admin', () => ({
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
    const { getAccountLimits, ADMIN_UNLIMITED_LIMIT } = await import("@/server/auth/account-limits");

    const result = await getAccountLimits('account-1', 'user-1', true);

    expect(result).toEqual({
      maxMachines: ADMIN_UNLIMITED_LIMIT,
      maxImages: ADMIN_UNLIMITED_LIMIT,
    });
    expect(selectMock).not.toHaveBeenCalled();
    expect(ensureAutoAdminUserMock).not.toHaveBeenCalled();
  });

  it('falls back to the user record and keeps admins unlimited even if isAdmin was false', async () => {
    mockSelectSequence(
      // hasUnlimitedAccountLimits queries users table
      [{ id: 'user-1', email: 'marko@kortix.com', isAdmin: true }],
    );
    ensureAutoAdminUserMock.mockResolvedValue({ id: 'user-1', email: 'marko@kortix.com', isAdmin: true });

    const { getAccountLimits, ADMIN_UNLIMITED_LIMIT } = await import("@/server/auth/account-limits");
    const result = await getAccountLimits('account-1', 'user-1', false);

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
    mockSelectSequence(
      // hasUnlimitedAccountLimits queries users table
      [{ id: 'user-2', email: 'user@example.com', isAdmin: false }],
      // getAccountLimits queries accountLimits table — no row
      [],
    );
    ensureAutoAdminUserMock.mockResolvedValue({ id: 'user-2', email: 'user@example.com', isAdmin: false });

    const { getAccountLimits, DEFAULT_LIMITS } = await import("@/server/auth/account-limits");
    const result = await getAccountLimits('account-2', 'user-2', false);

    expect(result).toEqual(DEFAULT_LIMITS);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it('returns stored custom limits for regular users', async () => {
    mockSelectSequence(
      // hasUnlimitedAccountLimits queries users table
      [{ id: 'user-3', email: 'user@example.com', isAdmin: false }],
      // getAccountLimits queries accountLimits table — has custom row
      [{ maxMachines: 12, maxImages: 34 }],
    );
    ensureAutoAdminUserMock.mockResolvedValue({ id: 'user-3', email: 'user@example.com', isAdmin: false });

    const { getAccountLimits } = await import("@/server/auth/account-limits");
    const result = await getAccountLimits('account-3', 'user-3', false);

    expect(result).toEqual({ maxMachines: 12, maxImages: 34 });
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
});
