/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cancelMachineMock = vi.fn();
const reactivateMachineMock = vi.fn();

vi.mock('@/server/lib/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    c.set('accountId', '22222222-2222-2222-2222-222222222222');
    c.set('isAdmin', false);
    return next();
  },
}));

vi.mock('@/server/lib/v2/machines', () => ({
  listMachinesV2: vi.fn(),
  getMachineV2: vi.fn(),
  createMachineV2: vi.fn(),
  startMachineV2: vi.fn(),
  stopMachineV2: vi.fn(),
  rebootMachineV2: vi.fn(),
  deleteMachineV2: vi.fn(),
  cancelMachineV2: cancelMachineMock,
  reactivateMachineV2: reactivateMachineMock,
}));

describe('v2 billing lifecycle actions', () => {
  const machineId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('cancels a machine subscription via v2 route', async () => {
    cancelMachineMock.mockResolvedValueOnce({ action: 'cancel', status: 'scheduled' });
    const { machinesV2App } = await import('@/server/api/v2/public/machines');
    const res = await machinesV2App.request(new Request(`http://localhost/${machineId}/cancel`, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(cancelMachineMock).toHaveBeenCalledWith(expect.objectContaining({ machineId }));
  });

  it('reactivates a machine subscription via v2 route', async () => {
    reactivateMachineMock.mockResolvedValueOnce({ action: 'reactivate', status: 'active' });
    const { machinesV2App } = await import('@/server/api/v2/public/machines');
    const res = await machinesV2App.request(new Request(`http://localhost/${machineId}/reactivate`, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(reactivateMachineMock).toHaveBeenCalledWith(expect.objectContaining({ machineId }));
  });
});
