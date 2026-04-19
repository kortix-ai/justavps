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

const benchmarkRow = {
  id: 'f2b8c412-17fd-41cf-b70f-b3f2a040e111',
  machineId: 'aaaaaaaa-1111-4444-8888-bbbbbbbbbbbb',
  accountId: 'cccccccc-1111-4444-8888-dddddddddddd',
  baremetalHostId: hostRow.id,
  machineMode: 'vm',
  scenario: 'cold_create',
  success: true,
  totalMs: 18234,
  stageTimings: { boot_ms: 18000 },
  metadata: { benchmark: { scenario: 'cold_create', total_ms: 18234 } },
  createdAt: new Date('2026-04-12T10:00:00.000Z'),
};

const selectWhereMock = vi.fn();
const selectDirectMock = vi.fn();
const selectFromMock = vi.fn(() => ({
  where: selectWhereMock,
  then: (resolve: (value: unknown) => unknown) => resolve(selectDirectMock()),
}));
const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateReturningMock = vi.fn();
const insertReturningMock = vi.fn();
const deleteInstanceMock = vi.fn();
const reconcileBaremetalHostMock = vi.fn(async () => ({ hostId: hostRow.id, status: 'ok' }));
const runProvisionerServicePassMock = vi.fn(async () => ({ acquired: true, processed: 0, leaseOwner: 'p', scope: 'provisioner:machine_create' }));
const runWebhookDispatcherServicePassMock = vi.fn(async () => ({ acquired: true, processed: 0, leaseOwner: 'w', scope: 'webhook_dispatcher:webhook_deliver' }));
const runAuthCacheServicePassMock = vi.fn(async () => ({ acquired: true, synced: 0, leaseOwner: 'ac', scope: 'auth_cache:api_keys' }));
const runRoutingRepairServicePassMock = vi.fn(async () => ({ acquired: true, repaired: 0, leaseOwner: 'r', scope: 'routing:repair' }));
const runTelemetryRetentionServicePassMock = vi.fn(async () => ({ acquired: true, pruned: 0, leaseOwner: 't', scope: 'telemetry:retention' }));
const runWatchdogServicePassMock = vi.fn(async () => ({ acquired: true, alerts: 0, alertSummaries: [], leaseOwner: 'wd', scope: 'watchdog:global' }));
const runFleetAuditorServicePassMock = vi.fn(async () => ({ acquired: true, hostsChecked: 1, snapshotsRecorded: 1, snapshotsPruned: 0, checkedAt: '2026-04-11T00:00:00.000Z', leaseOwner: 'fa', scope: 'fleet_auditor:baremetal' }));

vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', true);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

vi.mock('@/server/platform/baremetal/cell-store', () => ({
  ensureBaremetalCellRecord: vi.fn(async () => ({
    id: hostRow.cellId,
    slug: 'hel1--general-small--gen1',
    name: 'HEL1 general-small gen1',
    region: 'hel1',
    hostClass: 'general-small',
    generation: 'gen1',
  })),
}));

vi.mock('@/server/platform/baremetal/runner-client', () => ({
  HttpBaremetalRunnerClient: vi.fn(function HttpBaremetalRunnerClient() {
    return {
      deleteInstance: deleteInstanceMock,
    };
  }),
}));

vi.mock('@/server/platform/baremetal/reconcile', () => ({
  reconcileBaremetalHost: reconcileBaremetalHostMock,
}));

vi.mock('@/server/platform/control-plane/provisioner', () => ({
  runProvisionerServicePass: runProvisionerServicePassMock,
}));

vi.mock('@/server/platform/control-plane/webhook-dispatcher', () => ({
  runWebhookDispatcherServicePass: runWebhookDispatcherServicePassMock,
}));

vi.mock('@/server/platform/control-plane/auth-cache', () => ({
  runAuthCacheServicePass: runAuthCacheServicePassMock,
}));

vi.mock('@/server/platform/control-plane/routing', () => ({
  runRoutingRepairServicePass: runRoutingRepairServicePassMock,
}));

vi.mock('@/server/platform/control-plane/telemetry', () => ({
  runTelemetryRetentionServicePass: runTelemetryRetentionServicePassMock,
}));

vi.mock('@/server/platform/control-plane/watchdog', () => ({
  runWatchdogServicePass: runWatchdogServicePassMock,
}));

vi.mock('@/server/platform/control-plane/fleet-auditor', () => ({
  runFleetAuditorServicePass: runFleetAuditorServicePassMock,
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: selectFromMock })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturningMock, onConflictDoUpdate: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: updateSetMock })),
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
    runProvisionerServicePassMock.mockClear();
    runWebhookDispatcherServicePassMock.mockClear();
    runAuthCacheServicePassMock.mockClear();
    runRoutingRepairServicePassMock.mockClear();
    runTelemetryRetentionServicePassMock.mockClear();
    runWatchdogServicePassMock.mockClear();
    runFleetAuditorServicePassMock.mockClear();
    process.env.HETZNER_ROBOT_USER = 'robot-user';
    process.env.HETZNER_ROBOT_PASSWORD = 'robot-pass';
  });

  it('returns bootstrap config and lazily creates a runner token', async () => {
    selectWhereMock.mockResolvedValueOnce([hostRow]);
    updateReturningMock.mockResolvedValueOnce([{ ...hostRow, runnerToken: 'runner-token-123' }]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
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

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
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
    expect(data.host.bootstrap_validation.status).toBeNull();
    expect(data.host.drift_status).toBeNull();
    expect(data.host.scheduler).toEqual({ schedulable: null, unschedulable_reason: null, updated_at: null, updated_by: null });
    expect(data.host.incus_ui.exposure).toBeNull();
  });

  it('records a host bootstrap validation artifact and exposes drift status', async () => {
    selectWhereMock.mockResolvedValueOnce([{ ...hostRow, status: 'bootstrapping', runnerToken: 'runner-token-123', metadata: { bootstrap: { storage_driver: 'dir' } } }]);
    selectDirectMock
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);
    updateReturningMock.mockResolvedValueOnce([{
      ...hostRow,
      status: 'active',
      runnerToken: 'runner-token-123',
      metadata: {
        scheduler: {
          schedulable: true,
          unschedulableReason: null,
          updatedAt: '2026-04-11T10:01:00.000Z',
          updatedBy: 'bootstrap-script',
        },
        bootstrap: {
          storage_driver: 'dir',
          drift_status: 'in_policy',
          validation_artifact: {
            status: 'passed',
            bootstrap_version: 'bootstrap-baremetal-host.sh@v1',
            runnerd_version: '1.0.0',
            incus_version: '6.0',
            storage_driver: 'dir',
            storage_pool: 'default',
            started_at: '2026-04-11T10:00:00.000Z',
            completed_at: '2026-04-11T10:01:00.000Z',
            smoke_test_result: 'passed',
            warm_pool_result: 'passed',
            triggered_by: 'bootstrap-script',
            notes: ['runner registration succeeded'],
          },
        },
      },
      updatedAt: new Date('2026-04-11T10:01:00.000Z'),
    }]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/validation-artifact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'passed',
        bootstrap_version: 'bootstrap-baremetal-host.sh@v1',
        runnerd_version: '1.0.0',
        incus_version: '6.0',
        storage_driver: 'dir',
        storage_pool: 'default',
        started_at: '2026-04-11T10:00:00.000Z',
        completed_at: '2026-04-11T10:01:00.000Z',
        smoke_test_result: 'passed',
        warm_pool_result: 'passed',
        drift_status: 'in_policy',
        triggered_by: 'bootstrap-script',
        notes: ['runner registration succeeded'],
      }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.bootstrap_validation).toMatchObject({
      status: 'passed',
      runnerd_version: '1.0.0',
      incus_version: '6.0',
      storage_driver: 'dir',
      storage_pool: 'default',
      smoke_test_result: 'passed',
      warm_pool_result: 'passed',
    });
    expect(data.host.drift_status).toBe('in_policy');
    expect(data.host.status).toBe('active');
    expect(data.host.scheduler).toMatchObject({ schedulable: true, unschedulable_reason: null, updated_by: 'bootstrap-script' });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        scheduler: expect.objectContaining({ schedulable: true, unschedulableReason: null }),
      }),
    }));
  });

  it('marks a bootstrapping host as error when validation fails', async () => {
    selectWhereMock.mockResolvedValueOnce([{ ...hostRow, status: 'bootstrapping', metadata: { bootstrap: { storage_driver: 'dir' } } }]);
    selectDirectMock
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);
    updateReturningMock.mockResolvedValueOnce([{
      ...hostRow,
      status: 'error',
      metadata: {
        scheduler: {
          schedulable: false,
          unschedulableReason: 'host quarantined after failed bootstrap validation',
          updatedAt: '2026-04-11T10:01:00.000Z',
          updatedBy: 'system/bootstrap-validation',
        },
        bootstrap: {
          storage_driver: 'dir',
          drift_status: 'blocking_drift',
          validation_artifact: {
            status: 'failed',
            bootstrap_version: 'bootstrap-baremetal-host.sh@v1',
            runnerd_version: '1.0.0',
            incus_version: '6.0',
            storage_driver: 'dir',
            storage_pool: 'default',
            started_at: '2026-04-11T10:00:00.000Z',
            completed_at: '2026-04-11T10:01:00.000Z',
            smoke_test_result: 'failed',
            warm_pool_result: 'failed',
            triggered_by: 'bootstrap-script',
            notes: ['proxy smoke test failed'],
          },
        },
      },
      updatedAt: new Date('2026-04-11T10:01:00.000Z'),
    }]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/validation-artifact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'failed',
        bootstrap_version: 'bootstrap-baremetal-host.sh@v1',
        runnerd_version: '1.0.0',
        incus_version: '6.0',
        storage_driver: 'dir',
        storage_pool: 'default',
        started_at: '2026-04-11T10:00:00.000Z',
        completed_at: '2026-04-11T10:01:00.000Z',
        smoke_test_result: 'failed',
        warm_pool_result: 'failed',
        notes: ['proxy smoke test failed'],
      }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.status).toBe('error');
    expect(data.host.bootstrap_validation.status).toBe('failed');
    expect(data.host.drift_status).toBe('blocking_drift');
    expect(data.host.scheduler).toEqual({
      schedulable: false,
      unschedulable_reason: 'host quarantined after failed bootstrap validation',
      updated_at: '2026-04-11T10:01:00.000Z',
      updated_by: 'system/bootstrap-validation',
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        scheduler: expect.objectContaining({
          schedulable: false,
          unschedulableReason: 'host quarantined after failed bootstrap validation',
        }),
      }),
    }));
  });

  it('updates operator Incus UI exposure settings for a host', async () => {
    selectWhereMock.mockResolvedValueOnce([{ ...hostRow, status: 'active', publicIpv4: '1.2.3.4', metadata: {} }]);
    selectDirectMock
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);
    updateReturningMock.mockResolvedValueOnce([{
      ...hostRow,
      status: 'active',
      publicIpv4: '1.2.3.4',
      metadata: {
        operator: {
          incus_ui: {
            exposure: 'operator_only',
            url: 'https://1.2.3.4:8443',
            note: 'vpn-only',
            updated_at: '2026-04-11T11:00:00.000Z',
          },
        },
      },
      updatedAt: new Date('2026-04-11T11:00:00.000Z'),
    }]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/operator-settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        incus_ui_exposure: 'operator_only',
        incus_ui_url: 'https://1.2.3.4:8443',
        incus_ui_note: 'vpn-only',
      }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.incus_ui).toMatchObject({
      exposure: 'operator_only',
      url: 'https://1.2.3.4:8443',
      note: 'vpn-only',
    });
  });

  it('updates host scheduler quarantine state', async () => {
    selectWhereMock.mockResolvedValueOnce([{ ...hostRow, status: 'active', metadata: {} }]);
    selectDirectMock
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);
    updateReturningMock.mockResolvedValueOnce([{
      ...hostRow,
      status: 'active',
      metadata: {
        scheduler: {
          schedulable: false,
          unschedulableReason: 'host manually quarantined by operator',
          updatedAt: '2026-04-11T11:05:00.000Z',
          updatedBy: '11111111-1111-1111-1111-111111111111',
        },
      },
      updatedAt: new Date('2026-04-11T11:05:00.000Z'),
    }]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/scheduler-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedulable: false, reason: 'host manually quarantined by operator' }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.host.scheduler).toEqual({
      schedulable: false,
      unschedulable_reason: 'host manually quarantined by operator',
      updated_at: '2026-04-11T11:05:00.000Z',
      updated_by: '11111111-1111-1111-1111-111111111111',
    });
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

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
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

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
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

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
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

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
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

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
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

  it('lists control-plane service state', async () => {
    selectDirectMock.mockReturnValueOnce([{
      id: 'service-1',
      service: 'provisioner',
      scope: 'machine_create',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastStartedAt: new Date('2026-04-11T02:00:00.000Z'),
      lastCompletedAt: new Date('2026-04-11T02:00:05.000Z'),
      checkpoint: { last_processed_count: 2 },
      metadata: { last_job_type: 'machine_create' },
      createdAt: new Date('2026-04-11T01:59:00.000Z'),
      updatedAt: new Date('2026-04-11T02:00:05.000Z'),
    }]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/control-plane/services'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.services[0]).toMatchObject({
      service: 'provisioner',
      scope: 'machine_create',
      lease_owner: null,
      checkpoint: { last_processed_count: 2 },
    });
  });

  it('lists recent cell capacity snapshots', async () => {
    selectDirectMock.mockReturnValueOnce([{
      id: 'snap-1',
      cellId: 'cell-1',
      cellSlug: 'hel1--general-small--gen1',
      region: 'hel1',
      hostClass: 'general-small',
      generation: 'gen1',
      admissionState: 'open',
      sellabilityState: 'sellable',
      hostCount: 2,
      activeHostCount: 2,
      activeSchedulableHostCount: 1,
      constrainedHostCount: 0,
      totalVcpu: 24,
      totalMemoryGb: 124,
      totalDiskGb: 895,
      usedVcpu: 10,
      usedMemoryGb: 12,
      usedDiskGb: 200,
      reservedVcpu: 0,
      reservedMemoryGb: 0,
      reservedDiskGb: 0,
      reserveBudgetVcpu: 4,
      reserveBudgetMemoryGb: 8,
      reserveBudgetDiskGb: 80,
      availableVcpu: 14,
      availableMemoryGb: 112,
      availableDiskGb: 695,
      sellableVcpu: 10,
      sellableMemoryGb: 104,
      sellableDiskGb: 615,
      utilizationScore: 2597,
      snapshotWindowStart: new Date('2026-04-11T05:00:00.000Z'),
      createdAt: new Date('2026-04-11T05:00:05.000Z'),
    }]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/cell-capacity-snapshots?limit=1'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.snapshots[0]).toMatchObject({
      cell_slug: 'hel1--general-small--gen1',
      active_schedulable_host_count: 1,
      total_vcpu: 24,
      reserve_budget_vcpu: 4,
      utilization_score_basis_points: 2597,
    });
  });

  it('lists startup benchmarks with timing summaries', async () => {
    selectDirectMock.mockReturnValueOnce([benchmarkRow]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/benchmarks?limit=10&machine_mode=vm'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.benchmarks).toHaveLength(1);
    expect(data.benchmarks[0]).toMatchObject({
      machine_mode: 'vm',
      scenario: 'cold_create',
      total_ms: 18234,
    });
    expect(data.summary).toEqual([
      expect.objectContaining({
        machine_mode: 'vm',
        scenario: 'cold_create',
        sample_count: 1,
        avg_ms: 18234,
      }),
    ]);
  });

  it('runs the V2 control-plane maintenance surface', async () => {
    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/control-plane/run', { method: 'POST' }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(runProvisionerServicePassMock).toHaveBeenCalledTimes(1);
    expect(runWebhookDispatcherServicePassMock).toHaveBeenCalledTimes(1);
    expect(runAuthCacheServicePassMock).toHaveBeenCalledTimes(1);
    expect(runRoutingRepairServicePassMock).toHaveBeenCalledTimes(1);
    expect(runTelemetryRetentionServicePassMock).toHaveBeenCalledTimes(1);
    expect(runWatchdogServicePassMock).toHaveBeenCalledTimes(1);
    expect(runFleetAuditorServicePassMock).toHaveBeenCalledTimes(1);
    expect(data).toMatchObject({
      checked: true,
      alerts: 0,
      auth_cache: { synced: 0 },
      fleet_auditor: { hostsChecked: 1, snapshotsRecorded: 1 },
    });
  });

  it('can run a selective control-plane maintenance pass', async () => {
    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/control-plane/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ services: ['auth_cache'] }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(runAuthCacheServicePassMock).toHaveBeenCalledTimes(1);
    expect(runProvisionerServicePassMock).not.toHaveBeenCalled();
    expect(data.auth_cache).toMatchObject({ synced: 0 });
    expect(data.provisioner).toMatchObject({ acquired: false });
  });

  it('can clear a control-plane service lease manually', async () => {
    updateReturningMock.mockResolvedValueOnce([]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/control-plane/reset-lease', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: 'auth_cache', scope: 'api_keys' }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true });
  });

  it('returns a config audit summary', async () => {
    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/config-audit'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      status: expect.stringMatching(/ok|warning|degraded/),
      counts: expect.objectContaining({ ok: expect.any(Number), warning: expect.any(Number), error: expect.any(Number) }),
    });
    expect(Array.isArray(data.checks)).toBe(true);
    expect(data.checks.some((check: { key: string }) => check.key === 'database_url')).toBe(true);
  });

  it('returns a fleet host audit summary', async () => {
    selectDirectMock.mockReturnValueOnce([
      { ...hostRow, status: 'bootstrapping', metadata: {} },
      { ...hostRow, id: '00000000-0000-4000-8000-000000000099', name: 'bm-host-2', metadata: { scheduler: { schedulable: false, unschedulableReason: 'host quarantined after failed bootstrap validation' }, bootstrap: { drift_status: 'blocking_drift', validation_artifact: { status: 'failed' } } } },
    ]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request('http://localhost/host-audit'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toMatchObject({
      total_hosts: 2,
      active_schedulable_hosts: 0,
      bootstrapping_hosts: 1,
      pending_validation_hosts: 1,
      quarantined_hosts: 1,
      blocking_drift_hosts: 1,
    });
    expect(data.pending_validation).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: hostRow.name, status: 'bootstrapping' }),
    ]));
    expect(data.quarantined).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'bm-host-2', quarantined: true, unschedulable_reason: 'host quarantined after failed bootstrap validation' }),
    ]));
    expect(data.blocking_drift).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'bm-host-2', drift_status: 'blocking_drift', quarantined: true, unschedulable_reason: 'host quarantined after failed bootstrap validation' }),
    ]));
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
          orphan_instance_ids: ['justavps-deadbox'],
          warm_pool_instance_ids: ['justavps-warm-cpu2-abc123'],
        },
      },
    }]);
    selectDirectMock
      .mockReturnValueOnce([{ ...hostRow, status: 'active', runnerBaseUrl: 'http://1.2.3.4:7779', runnerToken: 'runner-token-123', metadata: { reconciliation: { checked_at: '2026-04-11T01:01:00.000Z', instance_count: 4, image_count: 2, stale_machine_ids: [], stale_image_ids: [], orphan_instance_ids: [], warm_pool_instance_ids: ['justavps-warm-cpu2-abc123'] } } }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([cellRow])
      .mockReturnValueOnce([cellAdmissionRow]);

    const { adminFleetV2App } = await import("@/server/v2/routes/admin/fleet");
    const res = await adminFleetV2App.request(new Request(`http://localhost/hosts/${hostRow.id}/cleanup-orphans`, { method: 'POST' }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(deleteInstanceMock).toHaveBeenCalledWith('justavps-deadbox');
    expect(deleteInstanceMock).not.toHaveBeenCalledWith('justavps-warm-cpu2-abc123');
    expect(reconcileBaremetalHostMock).toHaveBeenCalledWith(hostRow.id);
    expect(data.cleaned_instance_ids).toEqual(['justavps-deadbox']);
    expect(data.skipped_instance_ids).toEqual(['justavps-warm-cpu2-abc123']);
    expect(data.host.reconciliation_report.orphan_instance_ids).toEqual([]);
    expect(data.host.reconciliation_report.warm_pool_instance_ids).toEqual(['justavps-warm-cpu2-abc123']);
  });
});
