import { beforeEach, describe, expect, it, vi } from 'vitest';

const processDueControlPlaneJobsMock = vi.fn();
const acquireControlPlaneServiceLeaseMock = vi.fn();
const releaseControlPlaneServiceLeaseMock = vi.fn();
const recordControlPlaneServiceCheckpointMock = vi.fn();
const upsertHeartbeatStateMock = vi.fn();
const projectHeartbeatStateToMachineMock = vi.fn();
const repairStaleMachineRoutingStatesMock = vi.fn();
const syncMachineRoutingStateMock = vi.fn();
const runWatchdogMock = vi.fn();
const reconcileBaremetalFleetMock = vi.fn();
const pruneExpiredMachineTelemetryRollupsMock = vi.fn();
const pruneExpiredMachineEventsMock = vi.fn();
const pruneDeletedMachinePortAllocationsMock = vi.fn();
const pruneTerminalControlPlaneJobsMock = vi.fn();
const pruneTerminalWebhookDeliveriesMock = vi.fn();
const processDueWebhookJobsMock = processDueControlPlaneJobsMock;

vi.mock('@/server/v2/services/control-plane-jobs', () => ({
  enqueueControlPlaneJob: vi.fn(),
  ensureControlPlaneJobWorker: vi.fn(),
  kickControlPlaneJobWorker: vi.fn(),
  registerControlPlaneJobHandler: vi.fn(),
  processDueControlPlaneJobs: processDueControlPlaneJobsMock,
  pruneTerminalControlPlaneJobs: pruneTerminalControlPlaneJobsMock,
}));

vi.mock('@/server/platform/control-plane/service-state', () => ({
  acquireControlPlaneServiceLease: acquireControlPlaneServiceLeaseMock,
  releaseControlPlaneServiceLease: releaseControlPlaneServiceLeaseMock,
  recordControlPlaneServiceCheckpoint: recordControlPlaneServiceCheckpointMock,
  buildControlPlaneServiceKey: vi.fn((target: { service: string; scope?: string }) => `${target.service}:${target.scope ?? 'global'}`),
}));

vi.mock('@/server/platform/control-plane/heartbeat-state', () => ({
  upsertHeartbeatState: upsertHeartbeatStateMock,
  projectHeartbeatStateToMachine: projectHeartbeatStateToMachineMock,
}));

vi.mock('@/server/core/event-bus', async () => {
  const actual = await vi.importActual<typeof import("@/server/core/event-bus")>('@/server/core/event-bus');
  return {
    ...actual,
    pruneExpiredMachineEvents: pruneExpiredMachineEventsMock,
  };
});

vi.mock('@/server/platform/control-plane/machine-telemetry', () => ({
  pruneExpiredMachineTelemetryRollups: pruneExpiredMachineTelemetryRollupsMock,
}));

vi.mock('@/server/platform/control-plane/routing-state', () => ({
  repairStaleMachineRoutingStates: repairStaleMachineRoutingStatesMock,
  syncMachineRoutingState: syncMachineRoutingStateMock,
}));

vi.mock('@/server/platform/control-plane/machine-watchdog', () => ({
  runWatchdog: runWatchdogMock,
}));

vi.mock('@/server/platform/baremetal/reconcile', () => ({
  reconcileBaremetalFleet: reconcileBaremetalFleetMock,
}));

vi.mock('@/server/platform/baremetal/port-allocations', async () => {
  const actual = await vi.importActual<typeof import("@/server/platform/baremetal/port-allocations")>('@/server/platform/baremetal/port-allocations');
  return {
    ...actual,
    pruneDeletedMachinePortAllocations: pruneDeletedMachinePortAllocationsMock,
  };
});

describe('control-plane service wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds allocator placement metadata around explicit service boundaries', async () => {
    const { buildMachinePlacementProviderMeta } = await import("@/server/platform/control-plane/allocator");
    const metadata = buildMachinePlacementProviderMeta({
      host: {
        id: 'host-1',
        runnerBaseUrl: 'http://runner',
        publicIpv4: '203.0.113.10',
        publicIpv6: null,
      },
      reservation: { id: 'reservation-1' },
      decision: {
        selectedHostId: 'host-1',
        outcome: 'placed',
        summary: 'Selected host host-1',
        explanation: ['best score'],
        candidates: [{ hostId: 'host-1' }],
      },
    } as never, { vcpu: 2, memoryGb: 4, diskGb: 80 });

    expect(metadata).toMatchObject({
      baremetal_host_id: 'host-1',
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

  it('records allocator checkpoints around machine capacity reservation attempts', async () => {
    vi.resetModules();
    const leaseHostCapacityMock = vi.fn(async () => ({
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
          admission: { state: 'open', sellability: 'sellable', reason: null, source: null, setAt: null },
        },
      },
      reservation: { id: 'reservation-1' },
      projectedUsage: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      decision: { outcome: 'placed', selectedHostId: 'host-1', summary: 'Selected host host-1', explanation: ['best score'], request: {} as never, policy: {} as never, cells: [], candidates: [] },
}));

    vi.doMock('@/server/platform/baremetal/reservations', () => ({
      leaseHostCapacity: leaseHostCapacityMock,
    }));
    vi.doMock('@/server/platform/control-plane/service-state', () => ({
      acquireControlPlaneServiceLease: acquireControlPlaneServiceLeaseMock,
      releaseControlPlaneServiceLease: releaseControlPlaneServiceLeaseMock,
      recordControlPlaneServiceCheckpoint: recordControlPlaneServiceCheckpointMock,
      buildControlPlaneServiceKey: vi.fn((target: { service: string; scope?: string }) => `${target.service}:${target.scope ?? 'global'}`),
    }));

    const { reserveCapacityForMachineCreate } = await import("@/server/platform/control-plane/allocator");
    await reserveCapacityForMachineCreate({ machineId: 'machine-1', region: 'hel1', resources: { vcpu: 2, memoryGb: 4, diskGb: 80 } });

    expect(recordControlPlaneServiceCheckpointMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'allocator',
      scope: 'machine_create',
      checkpoint: expect.objectContaining({ last_selected_host_id: 'host-1', last_outcome: 'placed' }),
      metadata: expect.objectContaining({ last_error: null }),
    }));
  });

  it('runs the provisioner service pass under a service lease and records checkpoints', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-1', row: null });
    processDueControlPlaneJobsMock.mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);

    const { runProvisionerServicePass } = await import("@/server/platform/control-plane/provisioner");
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

    const { ingestMachineHeartbeat } = await import("@/server/platform/control-plane/telemetry");
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

  it('runs telemetry retention pruning through its own leased service pass', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-telemetry', row: null });
    pruneExpiredMachineEventsMock.mockResolvedValue(7);
    pruneExpiredMachineTelemetryRollupsMock.mockResolvedValue(11);

    const { runTelemetryRetentionServicePass } = await import("@/server/platform/control-plane/telemetry");
    const result = await runTelemetryRetentionServicePass({ leaseOwner: 'lease-telemetry', leaseMs: 45_000, limit: 1000 });

    expect(pruneExpiredMachineEventsMock).toHaveBeenCalledWith({ limit: 1000 });
    expect(pruneExpiredMachineTelemetryRollupsMock).toHaveBeenCalledWith({ limit: 1000 });
    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'telemetry',
      scope: 'retention',
      leaseOwner: 'lease-telemetry',
      checkpoint: expect.objectContaining({ last_pruned_count: 11, last_lifecycle_event_pruned_count: 7 }),
    }));
    expect(result).toMatchObject({ acquired: true, pruned: 11, lifecycleEventsPruned: 7, scope: 'telemetry:retention' });
  });

  it('runs routing repair through its own leased service pass', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-routing', row: null });
    repairStaleMachineRoutingStatesMock.mockResolvedValue(7);

    const { runRoutingRepairServicePass, syncRoutingFromHeartbeatReady } = await import("@/server/platform/control-plane/routing");
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

  it('runs watchdog through its own leased service pass', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-watchdog', row: null });
    runWatchdogMock.mockResolvedValue([
      { machineId: 'machine-1', slug: 'm1', type: 'heartbeat_dead', details: ['dead'] },
      { machineId: 'machine-2', slug: 'm2', type: 'network_anomaly', details: ['network'] },
    ]);

    const { runWatchdogServicePass } = await import("@/server/platform/control-plane/watchdog");
    const result = await runWatchdogServicePass({ leaseOwner: 'lease-watchdog', leaseMs: 45_000 });

    expect(runWatchdogMock).toHaveBeenCalledTimes(1);
    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'watchdog',
      scope: 'global',
      leaseOwner: 'lease-watchdog',
      checkpoint: expect.objectContaining({ last_alert_count: 2 }),
    }));
    expect(result).toMatchObject({ acquired: true, alerts: 2, alertSummaries: [{ machineId: 'machine-1' }, { machineId: 'machine-2' }], scope: 'watchdog:global' });
  });

  it('runs fleet auditor through its own leased service pass', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-fleet', row: null });
    reconcileBaremetalFleetMock.mockResolvedValue({ checkedAt: '2026-04-11T00:00:00.000Z', hosts: [{ status: 'ok' }, { status: 'error' }] });
    pruneDeletedMachinePortAllocationsMock.mockResolvedValue(4);

    const { runFleetAuditorServicePass } = await import("@/server/platform/control-plane/fleet-auditor");
    const result = await runFleetAuditorServicePass({ leaseOwner: 'lease-fleet', leaseMs: 45_000, maxHosts: 12 });

    expect(reconcileBaremetalFleetMock).toHaveBeenCalledWith(undefined, expect.objectContaining({
      onlyDueHosts: true,
      maxHosts: 12,
      skipGlobalMachineAudit: true,
      skipGlobalImageAudit: true,
    }));
    expect(pruneDeletedMachinePortAllocationsMock).toHaveBeenCalledTimes(1);
    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'fleet_auditor',
      scope: 'baremetal',
      leaseOwner: 'lease-fleet',
      checkpoint: expect.objectContaining({ last_host_count: 2, last_error_count: 1, last_deleted_port_allocation_pruned_count: 4 }),
    }));
    expect(result).toMatchObject({ acquired: true, hostsChecked: 2, portAllocationsPruned: 4, scope: 'fleet_auditor:baremetal' });
  });

  it('runs webhook dispatcher through its own leased service pass', async () => {
    acquireControlPlaneServiceLeaseMock.mockResolvedValue({ acquired: true, leaseOwner: 'lease-webhook', row: null });
    processDueWebhookJobsMock.mockResolvedValue([{ id: 'job-1' }]);
    pruneTerminalControlPlaneJobsMock.mockResolvedValue(2);
    pruneTerminalWebhookDeliveriesMock.mockResolvedValue(0);
    vi.doMock('@/server/platform/control-plane/webhook-delivery', async () => {
      const actual = await vi.importActual<typeof import("@/server/platform/control-plane/webhook-delivery")>('@/server/platform/control-plane/webhook-delivery');
      return {
        ...actual,
        pruneTerminalWebhookDeliveries: pruneTerminalWebhookDeliveriesMock,
      };
    });

    const { runWebhookDispatcherServicePass } = await import("@/server/platform/control-plane/webhook-dispatcher");
    const result = await runWebhookDispatcherServicePass({ leaseOwner: 'lease-webhook', leaseMs: 20_000, limit: 5 });

    expect(processDueWebhookJobsMock).toHaveBeenCalledWith(expect.objectContaining({
      jobTypes: ['webhook_deliver'],
      leaseOwner: 'lease-webhook',
      limit: 5,
    }));
    expect(releaseControlPlaneServiceLeaseMock).toHaveBeenCalledWith(expect.objectContaining({
      service: 'webhook_dispatcher',
      scope: 'webhook_deliver',
      checkpoint: expect.objectContaining({ last_processed_count: 1, last_pruned_jobs_count: 2, last_pruned_deliveries_count: 0 }),
    }));
    expect(result).toMatchObject({ acquired: true, processed: 1, jobsPruned: 2, deliveriesPruned: 0, scope: 'webhook_dispatcher:webhook_deliver' });
  });

});
