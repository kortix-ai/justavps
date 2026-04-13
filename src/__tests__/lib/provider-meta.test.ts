import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectWhereMock = vi.fn();
const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
const selectMock = vi.fn(() => ({ from: selectFromMock }));
const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
}));

describe('provider-meta helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectWhereMock.mockResolvedValue([{ providerMeta: { create_status: 'queued' } }]);
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('writes promoted provider fields alongside merged providerMeta', async () => {
    const { updateProviderMeta } = await import('@/server/lib/provider-meta');

    await updateProviderMeta('machine-1', {
      create_action_id: 'action-1',
      last_probe_at: '2026-04-12T12:00:00.000Z',
      daemon_reachable_at: '2026-04-12T12:00:05.000Z',
      ready_via: 'probe',
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      createActionId: 'action-1',
      lastProbeAt: '2026-04-12T12:00:00.000Z',
      daemonReachableAt: '2026-04-12T12:00:05.000Z',
      readyVia: 'probe',
      providerMeta: expect.objectContaining({
        create_status: 'queued',
        create_action_id: 'action-1',
      }),
    }));
  });
});
