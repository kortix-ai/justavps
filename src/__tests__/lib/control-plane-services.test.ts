import { beforeEach, describe, expect, it, vi } from 'vitest';

const processDueControlPlaneJobsMock = vi.fn();
const acquireControlPlaneServiceLeaseMock = vi.fn();
const releaseControlPlaneServiceLeaseMock = vi.fn();
const upsertHeartbeatStateMock = vi.fn();
const projectHeartbeatStateToMachineMock = vi.fn();
const repairStaleMachineRoutingStatesMock = vi.fn();
const syncMachineRoutingStateMock = vi.fn();

vi.mock('@/server/lib/control-plane-jobs', () => ({
  enqueueControlPlaneJob: vi.fn(),
  ensureControlPlaneJobWorker: vi.fn(),
  kickControlPlaneJobWorker: vi.fn(),
  registerControlPlaneJobHandler: vi.fn(),
  processDueControlPlaneJobs: processDueControlPlaneJobsMock,
}));

vi.mock('@/server/lib/control-plane/service-state', () => ({
  acquireControlPlaneServiceLease: acquireControlPlaneServiceLeaseMock,
  releaseControlPlaneServiceLease: releaseControlPlaneServiceLeaseMock,
  buildControlPlaneServiceKey: vi.fn((target: { service: string; scope?: string }) => `${target.service}:${target.scope ?? 'global'}`),
}));

vi.mock('@/server/lib/heartbeat-state', () => ({
  upsertHeartbeatState: upsertHeartbeatStateMock,
  projectHeartbeatStateToMachine: projectHeartbeatStateToMachineMock,
}));

vi.mock('@/server/lib/routing-state', () => ({
  repairStaleMachineRoutingStates: repairStaleMachineRoutingStatesMock,
  syncMachineRoutingState: syncMachineRoutingStateMock,
}));

describe('control-plane service wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds allocator placement metadata around explicit service boundaries', async () => {
    const { buildMachinePlacementProviderMeta } = await import('@/server/lib/control-plane/allocator');
    const metadata = buildMachinePlacementProviderMeta({
      host: {
        id: 'host-1',
        cellId: 'cell-1',
        generation: 'gen1',
        runnerBaseUrl: 'http://runner',
        publicIpv4: '203.0.113.10',
        publicIpv6: null,
        cell: {
          id: 'cell-1',
          slug: 'hel1-general-small-gen1',
          name: 'HEL1 general-small gen1',
          region: 'hel1',
          hostClass: 'general-small',
          generation: 'gen1',
          status: 'active',
          reservePolicy: { warmReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 }, failureReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 }, procurementReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 } },
          admission: { state: 'open', sellability: 'sellable', reason: null, source: 'manual', setAt: null },
        },
      },
      reservation: { id: 'reservation-1' },
      decision: {
        selectedHostId: 'host-1',
        outcome: 'placed',
        summary: 'Selected host host-1',
        explanation: ['best score'],
      },
    } as never, { vcpu: 2, memoryGb: 4, diskGb: 80 });

    expect(metadata).toMatchObject({
      baremetal_host_id: 'host-1',
      baremetal_cell_id: 'cell-1',
      baremetal_cell_slug: 'hel1-general-small-gen1',
      reservation_id: 'reservation-1',
      placement_decision: {
        selected_host_id: 'host-1',
        outcome: 'placed',
      },
      vcpu: 2,
      ram_gb: 4,
      disk_gb: 80,
    });
  });

  it('runs the provisioner service pass under a service lease and records checkpoints', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-1', row: null });
    processDueControlPlaneJobsMock.mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);

    const { runProvisionerServicePass } = await import('@/server/lib/control-plane/provisioner');
    const result = await runProvisionerServicePass({ limit: 2, leaseMs: 20_000, leaseOwner: 'lease-1' });

    expect(processDueControlPlaneJobsMock).toHaveBeenCalledWith({
      jobTypes: ['machine_create'],
      limit: 2,
      leaseOwner: 'lease-1',
      leaseMs: 20_000,
    });
    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'provisioner',
      scope: 'machine_create',
      leaseOwner: 'lease-1',
      checkpoint: expect.objectContaining({
        last_processed_count: 2,
        last_job_ids: ['job-1', 'job-2'],
      }),
    }));
    expect(result).toMatchObject({ acquired: true, processed: 2, scope: 'provisioner:machine_create' });
  });

  it('ingests telemetry via the split telemetry service wrapper', async () => {
    upsertHeartbeatStateMock.mockResolvedValue({
      state: { machineId: 'machine-1' },
      projectedMachinePatch: { status: 'ready' },
    });

    const { ingestMachineHeartbeat } = await import('@/server/lib/control-plane/telemetry');
    const heartbeatAt = new Date('2026-04-11T12:00:00.000Z');
    const result = await ingestMachineHeartbeat({
      machine: { id: 'machine-1' } as never,
      heartbeatAt,
      shouldMarkReady: true,
      payload: {
        uptime: 42,
        services: { ssh: true },
        load: { cpu: 0.1, memory: 0.2, disk: 0.3 },
      },
    });

    expect(projectHeartbeatStateToMachineMock).toHaveBeenCalledWith({
      machineId: 'machine-1',
      patch: { status: 'ready' },
      projectedAt: heartbeatAt,
    });
    expect(result).toMatchObject({ projected: true, projectedMachinePatch: { status: 'ready' } });
  });

  it('runs routing repair through its own leased service pass', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-routing', row: null });
    repairStaleMachineRoutingStatesMock.mockResolvedValue(7);

    const { runRoutingRepairServicePass, syncRoutingFromHeartbeatReady } = await import('@/server/lib/control-plane/routing');
    const result = await runRoutingRepairServicePass(25, { leaseOwner: 'lease-routing', leaseMs: 45_000 });

    expect(repairStaleMachineRoutingStatesMock).toHaveBeenCalledWith(25);
    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'routing',
      scope: 'repair',
      leaseOwner: 'lease-routing',
      checkpoint: expect.objectContaining({ last_repair_count: 7 }),
    }));
    expect(result).toMatchObject({ acquired: true, repaired: 7, scope: 'routing:repair' });

    await syncRoutingFromHeartbeatReady({ machineId: 'machine-1' } as never);
    expect(syncMachineRoutingStateMock).toHaveBeenCalledWith({ machineId: 'machine-1' });
  });
});
