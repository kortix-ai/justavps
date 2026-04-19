import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbSelectFromMock = vi.fn();
const dbSelectMock = vi.fn(() => ({ from: dbSelectFromMock }));
const resetDbConnectionMock = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    select: dbSelectMock,
  },
  resetDbConnection: resetDbConnectionMock,
}));

describe('config audit db recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetDbConnectionMock.mockResolvedValue(undefined);
  });

  it('retries host audit queries after resetting a stale db connection', async () => {
    dbSelectFromMock
      .mockRejectedValueOnce(new Error('stale connection'))
      .mockResolvedValueOnce([{ id: 'host-1', name: 'bm-host-1', status: 'active', metadata: {} }]);

    const { loadFleetHostAuditSummary } = await import("@/server/v2/services/config-audit");
    const result = await loadFleetHostAuditSummary();

    expect(result.summary.total_hosts).toBe(1);
    expect(resetDbConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('marks database connectivity as failed when audit queries keep failing', async () => {
    dbSelectFromMock.mockRejectedValue(new Error('db still down'));

    const { loadConfigAuditChecks } = await import("@/server/v2/services/config-audit");
    const checks = await loadConfigAuditChecks([], { databaseReachable: true });

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'database_connectivity', severity: 'error' }),
    ]));
    expect(resetDbConnectionMock).toHaveBeenCalled();
  });
});
