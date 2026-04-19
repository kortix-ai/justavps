import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postgresMock = vi.fn();
const drizzleMock = vi.fn();
const sqlEndMock = vi.fn(async () => undefined);

vi.mock('postgres', () => ({
  default: postgresMock,
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: drizzleMock,
}));

describe('db connection factory', () => {
  const originalEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    DB_CONNECT_TIMEOUT_SECONDS: process.env.DB_CONNECT_TIMEOUT_SECONDS,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete globalThis.__justavpsDb;
    delete globalThis.__justavpsSql;
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/justavps';
    delete process.env.DB_CONNECT_TIMEOUT_SECONDS;
    const sqlClient = { end: sqlEndMock };
    postgresMock.mockReturnValue(sqlClient);
    drizzleMock.mockReturnValue({ query: 'db-client' });
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    process.env.DB_CONNECT_TIMEOUT_SECONDS = originalEnv.DB_CONNECT_TIMEOUT_SECONDS;
  });

  it('uses a bounded connect timeout by default', async () => {
    const mod = await import('@/server/db');
    mod.getDb();

    expect(postgresMock).toHaveBeenCalledWith(
      'postgres://postgres:postgres@localhost:5432/justavps',
      expect.objectContaining({ connect_timeout: 5 }),
    );
  });

  it('resets and closes the cached sql client', async () => {
    const mod = await import('@/server/db');
    mod.getDb();

    await mod.resetDbConnection();

    expect(sqlEndMock).toHaveBeenCalledWith({ timeout: 0 });
    expect(globalThis.__justavpsDb).toBeUndefined();
    expect(globalThis.__justavpsSql).toBeUndefined();
  });
});
