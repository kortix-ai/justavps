/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostRow = {
  id: 'ed822eae-59ef-4601-8782-a17cc85196ab',
  vendor: 'hetzner_robot',
  hostClass: 'general-small',
  generation: 'gen1',
  region: 'hel1',
  location: 'HEL1',
  cellId: '8a034d1a-7780-43ff-bf2d-36efc4f3e858',
  name: 'bm-general-small-HEL1-ed822eae',
  status: 'ordering',
  maintenanceState: 'in_service',
  maintenanceRequestedAt: null,
  maintenanceStartedAt: null,
  maintenanceCompletedAt: null,
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

const cellRow = {
  id: hostRow.cellId,
  slug: 'hel1--general-small--gen1',
  name: 'HEL1 general-small gen1',
  region: 'hel1',
  hostClass: 'general-small',
  generation: 'gen1',
  status: 'active',
  reservePolicy: {
    warmReserve: { vcpu: 1, memoryGb: 2, diskGb: 20 },
    failureReserve: { vcpu: 2, memoryGb: 4, diskGb: 40 },
    procurementReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 },
  },
  metadata: {},
  createdAt: new Date('2026-04-02T09:55:32.536Z'),
  updatedAt: new Date('2026-04-02T09:55:32.536Z'),
};

const cellAdmissionRow = {
  cellId: hostRow.cellId,
  admissionState: 'restricted',
  sellabilityState: 'reserve_only',
  reason: 'holding spare capacity for HEL1 failover',
  source: 'manual',
  setAt: new Date('2026-04-02T10:00:00.000Z'),
  metadata: {},
  createdAt: new Date('2026-04-02T10:00:00.000Z'),
  updatedAt: new Date('2026-04-02T10:00:00.000Z'),
};

const selectWhereMock = vi.fn();
const selectDirectMock = vi.fn();
const selectFromMock = vi.fn(() => ({
  where: selectWhereMock,
  then: (resolve: (value: unknown) => unknown) => resolve(selectDirectMock()),
}));
const updateReturningMock = vi.fn();
const insertReturningMock = vi.fn();
const deleteInstanceMock = vi.fn();
const reconcileBaremetalHostMock = vi.fn(async () => ({ hostId: hostRow.id, status: 'ok' }));

vi.mock('@/server/lib/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', true);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

vi.mock('@/server/lib/baremetal/cell-store', () => ({
  ensureBaremetalCellRecord: vi.fn(async () => ({
    id: hostRow.cellId,
    slug: 'hel1--general-small--gen1',
    name: 'HEL1 general-small gen1',
    region: 'hel1',
    hostClass: 'general-small',
    generation: 'gen1',
  })),
}));

vi.mock('@/server/lib/baremetal/runner-client', () => ({
  HttpBaremetalRunnerClient: vi.fn(function HttpBaremetalRunnerClient() {
    return {
      deleteInstance: deleteInstanceMock,
    };
  }),
}));

vi.mock('@/server/lib/baremetal/reconcile', () => ({
  reconcileBaremetalHost: reconcileBaremetalHostMock,
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: selectFromMock })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturningMock, onConflictDoUpdate: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: updateReturningMock })) })) })),
  },
}));

describe('admin baremetal host bootstrap routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectWhereMock.mockReset();
    selectDirectMock.mockReset();
    insertReturningMock.mockReset();
    deleteInstanceMock.mockReset();
    reconcileBaremetalHostMock.mockClear();
    process.env.HETZNER_ROBOT_USER = 'robot-user';
    process.env.HETZNER_ROBOT_PASSWORD = 'robot-pass';
  });

  it('returns bootstrap config and lazily creates a runner token', async () => {
    selectWhereMock.mockResolvedValueOnce([hostRow]);
    updateReturningMock.mockResolvedValueOnce([{ ...hostRow, runnerToken: 'runner-token-123' }]);

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/bootstrap-config`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.runner_token).toBe('runner-token-123');
  });

  it('registers host runner details and capacity', async () => {
    selectWhereMock.mockResolvedValueOnce([{ ...hostRow, runnerToken: 'runner-token-123' }]);
    selectDirectMock
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);
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

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/register`, {
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
    expect(data.host.cell_slug).toBe('hel1--general-small--gen1');
  });

  it('updates host maintenance state', async () => {
    selectWhereMock.mockResolvedValueOnce([{ ...hostRow, status: 'active', runnerBaseUrl: 'http://1.2.3.4:7779' }]);
    selectDirectMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);
    updateReturningMock.mockResolvedValueOnce([{
      ...hostRow,
      status: 'active',
      runnerBaseUrl: 'http://1.2.3.4:7779',
      maintenanceState: 'drain_requested',
      maintenanceRequestedAt: new Date('2026-04-02T10:20:00.000Z'),
      updatedAt: new Date('2026-04-02T10:20:00.000Z'),
    }]);

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/maintenance-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'drain_requested' }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.maintenance_state).toBe('drain_requested');
    expect(data.host.drain_report.blockers_total).toBe(0);
  });

  it('lists hosts with cell reserve and admission visibility', async () => {
    selectDirectMock
      .mockReturnValueOnce([{ ...hostRow, status: 'active', totalVcpu: 12, totalMemoryGb: 64, totalDiskGb: 900, runnerBaseUrl: 'http://1.2.3.4:7779', publicIpv4: '1.2.3.4' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request('http://localhost/hosts'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hosts[0]).toMatchObject({
      cell_slug: 'hel1--general-small--gen1',
      cell_admission_state: 'restricted',
      cell_sellability_state: 'reserve_only',
    });
    expect(data.cells[0]).toMatchObject({
      slug: 'hel1--general-small--gen1',
      admission_state: 'restricted',
      sellability_state: 'reserve_only',
      reserve_budget_vcpu: 3,
      reserve_budget_memory_gb: 6,
      reserve_budget_disk_gb: 60,
    });
  });

  it('updates cell admission and sellability state', async () => {
    selectWhereMock.mockResolvedValueOnce([cellRow]);
    selectDirectMock
      .mockReturnValueOnce([{ ...hostRow, status: 'active', totalVcpu: 12, totalMemoryGb: 64, totalDiskGb: 900, runnerBaseUrl: 'http://1.2.3.4:7779', publicIpv4: '1.2.3.4' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([{ ...cellAdmissionRow, admissionState: 'closed', sellabilityState: 'unsellable', reason: 'Paused' }]);
    updateReturningMock.mockResolvedValueOnce([]);

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/cells/${cellRow.id}/admission-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admission_state: 'closed', sellability_state: 'unsellable', reason: 'Paused' }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cell).toMatchObject({
      id: cellRow.id,
      admission_state: 'closed',
      sellability_state: 'unsellable',
      admission_reason: 'Paused',
    });
  });

  it('updates cell reserve policy', async () => {
    selectWhereMock.mockResolvedValueOnce([cellRow]);
    selectDirectMock
      .mockReturnValueOnce([{ ...hostRow, status: 'active', totalVcpu: 12, totalMemoryGb: 64, totalDiskGb: 900, runnerBaseUrl: 'http://1.2.3.4:7779', publicIpv4: '1.2.3.4' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ ...cellRow, reservePolicy: { warmReserve: { vcpu: 2, memoryGb: 4, diskGb: 40 }, failureReserve: { vcpu: 3, memoryGb: 6, diskGb: 60 }, procurementReserve: { vcpu: 1, memoryGb: 2, diskGb: 20 } } }])
      .mockReturnValueOnce([cellAdmissionRow]);
    updateReturningMock.mockResolvedValueOnce([]);

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/cells/${cellRow.id}/reserve-policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        warm_reserve: { vcpu: 2, memory_gb: 4, disk_gb: 40 },
        failure_reserve: { vcpu: 3, memory_gb: 6, disk_gb: 60 },
        procurement_reserve: { vcpu: 1, memory_gb: 2, disk_gb: 20 },
      }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cell).toMatchObject({
      id: cellRow.id,
      reserve_budget_vcpu: 6,
      reserve_budget_memory_gb: 12,
      reserve_budget_disk_gb: 120,
    });
  });

  it('lists reserve-aware procurement recommendations', async () => {
    selectDirectMock
      .mockReturnValueOnce([{ ...hostRow, status: 'active', totalVcpu: 12, totalMemoryGb: 64, totalDiskGb: 900, usedVcpu: 10, usedMemoryGb: 58, usedDiskGb: 850, runnerBaseUrl: 'http://1.2.3.4:7779', publicIpv4: '1.2.3.4' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request('http://localhost/procurement-recommendations'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recommendations[0]).toMatchObject({
      cell_slug: 'hel1--general-small--gen1',
      current_host_class: 'general-small',
      current_role: 'starter_edge',
      recommended_host_class: 'general-medium',
      recommended_role: 'mainstream',
      procurement_purpose: 'reserve_replenishment',
      minimum_hosts: 1,
    });
  });

  it('cleans up non-warm orphan instances and preserves warm reserves', async () => {
    deleteInstanceMock.mockResolvedValue(undefined);
    selectWhereMock.mockResolvedValueOnce([{
      ...hostRow,
      status: 'active',
      runnerBaseUrl: 'http://1.2.3.4:7779',
      runnerToken: 'runner-token-123',
      metadata: {
        reconciliation: {
          checked_at: '2026-04-11T01:00:00.000Z',
          instance_count: 5,
          image_count: 2,
          stale_machine_ids: [],
          stale_image_ids: [],
          orphan_instance_ids: ['justavps-deadbox', 'justavps-warm-cpu2-abc123'],
        },
      },
    }]);
    selectDirectMock
      .mockReturnValueOnce([{ ...hostRow, status: 'active', runnerBaseUrl: 'http://1.2.3.4:7779', runnerToken: 'runner-token-123', metadata: { reconciliation: { checked_at: '2026-04-11T01:01:00.000Z', instance_count: 4, image_count: 2, stale_machine_ids: [], stale_image_ids: [], orphan_instance_ids: ['justavps-warm-cpu2-abc123'] } } }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);

    const { adminFleetV2App } = await import('@/server/routes/v2/admin-fleet');
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/cleanup-orphans`, { method: 'POST' }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(deleteInstanceMock).toHaveBeenCalledWith('justavps-deadbox');
    expect(deleteInstanceMock).not.toHaveBeenCalledWith('justavps-warm-cpu2-abc123');
    expect(reconcileBaremetalHostMock).toHaveBeenCalledWith(hostRow.id);
    expect(data.cleaned_instance_ids).toEqual(['justavps-deadbox']);
    expect(data.skipped_instance_ids).toEqual(['justavps-warm-cpu2-abc123']);
    expect(data.host.reconciliation_report.orphan_instance_ids).toEqual(['justavps-warm-cpu2-abc123']);
  });
});
