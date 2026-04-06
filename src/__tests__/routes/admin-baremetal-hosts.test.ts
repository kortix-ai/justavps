/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostRow = {
  id: 'ed822eae-59ef-4601-8782-a17cc85196ab',
  vendor: 'hetzner_robot',
  hostClass: 'general-small',
  region: 'hel1',
  location: 'HEL1',
  name: 'bm-general-small-HEL1-ed822eae',
  status: 'ordering',
  providerServerNumber: null,
  providerTransactionId: 'B20260402-3405936-2981133',
  publicIpv4: null,
  publicIpv6: null,
  runnerBaseUrl: null,
  runnerToken: null,
  totalVcpu: null,
  totalMemoryGb: null,
  totalDiskGb: null,
  usedVcpu: 0,
  usedMemoryGb: 0,
  usedDiskGb: 0,
  lastHeartbeatAt: null,
  metadata: {},
  createdAt: new Date('2026-04-02T09:55:32.536Z'),
  updatedAt: new Date('2026-04-02T09:55:32.536Z'),
};

const selectWhereMock = vi.fn();
const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
const updateReturningMock = vi.fn();

vi.mock('@/server/lib/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', true);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: selectFromMock })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: updateReturningMock })) })) })),
  },
}));

describe('admin baremetal host bootstrap routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectWhereMock.mockReset();
    process.env.HETZNER_ROBOT_USER = 'robot-user';
    process.env.HETZNER_ROBOT_PASSWORD = 'robot-pass';
  });

  it('returns bootstrap config and lazily creates a runner token', async () => {
    selectWhereMock.mockResolvedValueOnce([hostRow]);
    updateReturningMock.mockResolvedValueOnce([{ ...hostRow, runnerToken: 'runner-token-123' }]);

    const { adminBaremetalApp } = await import('@/server/routes/v1/admin-baremetal');
    const res = await adminBaremetalApp.request(new Request(`http://localhost/hosts/${hostRow.id}/bootstrap-config`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.runner_token).toBe('runner-token-123');
  });

  it('registers host runner details and capacity', async () => {
    selectWhereMock.mockResolvedValueOnce([{ ...hostRow, runnerToken: 'runner-token-123' }]);
    updateReturningMock.mockResolvedValueOnce([{
      ...hostRow,
      runnerToken: 'runner-token-123',
      runnerBaseUrl: 'http://1.2.3.4:7779',
      publicIpv4: '1.2.3.4',
      totalVcpu: 12,
      totalMemoryGb: 64,
      totalDiskGb: 900,
      status: 'active',
      updatedAt: new Date('2026-04-02T10:10:00.000Z'),
    }]);

    const { adminBaremetalApp } = await import('@/server/routes/v1/admin-baremetal');
    const res = await adminBaremetalApp.request(new Request(`http://localhost/hosts/${hostRow.id}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runner_base_url: 'http://1.2.3.4:7779',
        public_ipv4: '1.2.3.4',
        total_vcpu: 12,
        total_memory_gb: 64,
        total_disk_gb: 900,
        status: 'active',
        metadata: { bootstrap: { storage_driver: 'dir' } },
      }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.runner_base_url).toBe('http://1.2.3.4:7779');
    expect(data.host.total_vcpu).toBe(12);
    expect(data.host.status).toBe('active');
  });
});
