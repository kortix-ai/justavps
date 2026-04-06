/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSnapshotsMock = vi.fn();
const createSnapshotMock = vi.fn();
const restoreSnapshotMock = vi.fn();
const deleteSnapshotMock = vi.fn();

vi.mock('@/server/lib/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    c.set('accountId', '22222222-2222-2222-2222-222222222222');
    c.set('isAdmin', false);
    return next();
  },
}));

vi.mock('@/server/lib/v2/snapshots', () => ({
  listSnapshotsV2: listSnapshotsMock,
  createSnapshotV2: createSnapshotMock,
  restoreSnapshotV2: restoreSnapshotMock,
  deleteSnapshotV2: deleteSnapshotMock,
}));

describe('v2 snapshots API', () => {
  const machineId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('lists snapshots generically', async () => {
    listSnapshotsMock.mockResolvedValueOnce([{ id: 'snap-1', name: 'before-upgrade', created_at: new Date().toISOString(), status: 'ready' }]);
    const { snapshotsV2App } = await import('@/server/routes/v2/snapshots');
    const res = await snapshotsV2App.request(new Request(`http://localhost/${machineId}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.snapshots).toHaveLength(1);
  });

  it('creates, restores, and deletes snapshots', async () => {
    createSnapshotMock.mockResolvedValueOnce({ id: 'snap-1', name: 'before-upgrade', created_at: new Date().toISOString(), status: 'creating' });
    restoreSnapshotMock.mockResolvedValueOnce({ ok: true });
    deleteSnapshotMock.mockResolvedValueOnce({ ok: true });
    const { snapshotsV2App } = await import('@/server/routes/v2/snapshots');
    const createRes = await snapshotsV2App.request(new Request(`http://localhost/${machineId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'before-upgrade' }),
    }));
    expect(createRes.status).toBe(202);
    const restoreRes = await snapshotsV2App.request(new Request(`http://localhost/${machineId}/snap-1/restore`, { method: 'POST' }));
    expect(restoreRes.status).toBe(200);
    const deleteRes = await snapshotsV2App.request(new Request(`http://localhost/${machineId}/snap-1`, { method: 'DELETE' }));
    expect(deleteRes.status).toBe(200);
  });
});
