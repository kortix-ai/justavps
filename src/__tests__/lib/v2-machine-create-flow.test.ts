import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionMock = vi.fn();
const createMachineRecordMock = vi.fn();
const reserveCapacityForMachineCreateMock = vi.fn();
const enqueueMachineCreateJobMock = vi.fn();
const kickProvisionerServiceWorkerMock = vi.fn();
const ensureProvisionerServiceWorkerMock = vi.fn();
const registerMachineCreateJobHandlerMock = vi.fn();
const checkMachineLimitMock = vi.fn();
const generateMachineIdentityMock = vi.fn();
const resolveMachineCallbackConfigMock = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    transaction: transactionMock,
    select: vi.fn(),
  },
}));

vi.mock('@/server/lib/account-limits', () => ({
  checkMachineLimit: checkMachineLimitMock,
}));

vi.mock('@/lib/v2-pricing', () => ({
  computeMonthlyPrice: vi.fn(() => 20),
}));

vi.mock('@/server/lib/machine-lifecycle', () => ({
  createMachineRecord: createMachineRecordMock,
  generateMachineIdentity: generateMachineIdentityMock,
  resolveMachineCallbackConfig: resolveMachineCallbackConfigMock,
  syncMachineStatus: vi.fn((machine) => machine),
  cleanupMachineResources: vi.fn(),
  autoGenerateAndSaveSSHKey: vi.fn(),
  resolveSSHKeyPublicKeys: vi.fn(),
  buildMachineUserData: vi.fn(),
  setupProxyDNS: vi.fn(),
  uploadSSHKeyToProvider: vi.fn(),
}));

vi.mock('@/server/lib/baremetal/reservations', () => ({
  getHostCapacityReservationForMachine: vi.fn(),
  commitHostCapacityReservation: vi.fn(),
  releaseHostCapacityReservation: vi.fn(),
}));

vi.mock('@/server/lib/control-plane/allocator', () => ({
  reserveCapacityForMachineCreate: reserveCapacityForMachineCreateMock,
  buildMachinePlacementProviderMeta: vi.fn((lease, resources) => ({
    baremetal_host_id: lease.host.id,
    baremetal_cell_id: lease.host.cellId,
    baremetal_cell_slug: 'cell-1',
    baremetal_cell_generation: lease.host.generation,
    runner_base_url: lease.host.runnerBaseUrl,
    public_ipv4: lease.host.publicIpv4,
    public_ipv6: lease.host.publicIpv6,
    reservation_id: lease.reservation.id,
    placement_decision: {
      selected_host_id: lease.decision.selectedHostId,
      selected_cell_id: lease.host.cellId,
      selected_cell_slug: 'cell-1',
      outcome: lease.decision.outcome,
      summary: lease.decision.summary,
      explanation: lease.decision.explanation,
    },
    vcpu: resources.vcpu,
    ram_gb: resources.memoryGb,
    disk_gb: resources.diskGb,
  })),
}));

vi.mock('@/server/lib/control-plane/provisioner', () => ({
  MACHINE_CREATE_JOB_TYPE: 'machine_create',
  machineCreateJobIdempotencyKey: vi.fn((machineId: string) => `machine_create:${machineId}`),
  enqueueMachineCreateJob: enqueueMachineCreateJobMock,
  kickProvisionerServiceWorker: kickProvisionerServiceWorkerMock,
  ensureProvisionerServiceWorker: ensureProvisionerServiceWorkerMock,
  registerMachineCreateJobHandler: registerMachineCreateJobHandlerMock,
}));

vi.mock('@/server/lib/providers', () => ({
  getProvider: vi.fn(() => ({
    name: 'baremetal',
    capabilities: { backups: false, images: true, bareMetal: true },
  })),
}));

describe('createMachineV2 durable machine create flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkMachineLimitMock.mockResolvedValue({ allowed: true, current: 0, max: 5 });
    generateMachineIdentityMock.mockResolvedValue({ slug: 'abc123', machineToken: 'token-123' });
    resolveMachineCallbackConfigMock.mockReturnValue({ callbackExpected: true, url: 'https://callback.example/machine' });

    transactionMock.mockImplementation(async (callback: (tx: { update: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn>; }) => Promise<void>) => {
      const updateReturningRow = {
        id: 'machine-1',
        ownerId: 'user-1',
        accountId: 'account-1',
        slug: 'abc123',
        name: 'Agent Box',
        status: 'provisioning',
        provider: 'baremetal',
        machineMode: 'vm',
        requestedImageKind: 'golden',
        requestedImageRef: null,
        imageId: null,
        serverType: 'custom',
        region: 'hel1',
        vcpu: 2,
        ramGb: 4,
        diskGb: 80,
        ip: null,
        providerServerId: null,
        providerMeta: {},
        machineToken: 'enc-token',
        codeServerPassword: '',
        sshPublicKey: '',
        sshPrivateKey: '',
        backupsEnabled: false,
        source: 'user',
        domains: [],
        priceMonthly: 20,
        provisioningStage: null,
        provisioningStageUpdatedAt: null,
        daemonVersion: null,
        lastHeartbeatAt: null,
        lastHeartbeat: null,
        createdAt: new Date('2026-04-10T00:00:00.000Z'),
        readyAt: null,
        deletedAt: null,
      };

      const tx = {
        update: vi.fn(() => ({
          set: (values: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => [{ ...updateReturningRow, ...values }],
            }),
          }),
        })),
        insert: vi.fn(),
        select: vi.fn(),
        execute: vi.fn(),
      };
      await callback(tx);
    });

    createMachineRecordMock.mockResolvedValue({
      id: 'machine-1',
      ownerId: 'user-1',
      accountId: 'account-1',
      slug: 'abc123',
      name: 'Agent Box',
      status: 'provisioning',
      provider: 'baremetal',
      machineMode: 'vm',
      requestedImageKind: 'golden',
      requestedImageRef: null,
      imageId: null,
      serverType: 'custom',
      region: 'hel1',
      vcpu: null,
      ramGb: null,
      diskGb: null,
      ip: null,
      providerServerId: null,
      providerMeta: {},
      machineToken: 'enc-token',
      codeServerPassword: '',
      sshPublicKey: '',
      sshPrivateKey: '',
      backupsEnabled: false,
      source: 'user',
      domains: [],
      priceMonthly: 20,
      provisioningStage: null,
      provisioningStageUpdatedAt: null,
      daemonVersion: null,
      lastHeartbeatAt: null,
      lastHeartbeat: null,
      createdAt: new Date('2026-04-10T00:00:00.000Z'),
      readyAt: null,
      deletedAt: null,
    });

    reserveCapacityForMachineCreateMock.mockResolvedValue({
      host: {
        id: 'host-1',
        region: 'hel1',
        status: 'active',
        hostClass: 'general-small',
        generation: 'gen1',
        cellId: 'cell-1',
        location: 'hel1-dc1',
        name: 'host-1',
        vendor: 'hetzner_robot',
        providerServerNumber: null,
        providerTransactionId: null,
        publicIpv4: '1.2.3.4',
        publicIpv6: null,
        runnerBaseUrl: 'http://runner',
        runnerToken: 'token',
        totalVcpu: 16,
        totalMemoryGb: 64,
        totalDiskGb: 800,
        usedVcpu: 4,
        usedMemoryGb: 8,
        usedDiskGb: 80,
        lastHeartbeatAt: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      reservation: {
        id: 'reservation-1',
      },
      projectedUsage: { vcpu: 6, memoryGb: 12, diskGb: 160 },
      decision: {
        outcome: 'placed',
        selectedHostId: 'host-1',
        summary: 'Selected host host-1 for hel1; 1 eligible host considered',
        explanation: ['host-1 had the best projected score'],
        request: {
          region: 'hel1',
          resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
          imageId: null,
          imageAlias: 'justavps-golden',
        },
        policy: {
          requiredHostClass: null,
          requiredCellId: null,
          preferredHostClasses: [],
          preferredCellIds: [],
          warmPoolPreference: 'prefer',
          requireLocalImage: false,
          cellSpreadPreference: 'spread',
          maxProjectedUtilizationScore: null,
          allowRestrictedCellAdmission: false,
          allowReserveOnlySellability: false,
        },
        cells: [],
        candidates: [],
      },
    });
  });

  it('creates the machine row, reserves host capacity, then enqueues a durable create job', async () => {
    const { createMachineV2 } = await import('@/server/lib/v2/machines');
    const result = await createMachineV2({
      accountId: 'account-1',
      userId: 'user-1',
      isAdmin: false,
      requestUrl: 'https://app.example/v2/machines',
      input: {
        vcpu: 2,
        ram_gb: 4,
        disk_gb: 80,
        region: 'hel1',
        name: 'Agent Box',
        machine_mode: 'vm',
      },
    });

    expect(result.kind).toBe('machine');
    expect(createMachineRecordMock).toHaveBeenCalledTimes(1);
    expect(createMachineRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      requestedImageKind: 'golden',
      requestedImageRef: null,
    }));
    expect(reserveCapacityForMachineCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-1',
      region: 'hel1',
      resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
      imageId: null,
      imageAlias: 'justavps-golden',
    }));
    expect(enqueueMachineCreateJobMock).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'machine_create',
      subjectId: 'machine-1',
      payload: expect.objectContaining({ reservationId: 'reservation-1', machineMode: 'vm' }),
    }));
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(kickProvisionerServiceWorkerMock).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({
      kind: 'machine',
      machine: {
        provider_status: 'queued',
      },
    });
  });

  it('passes docker image refs through the container create flow', async () => {
    const { createMachineV2 } = await import('@/server/lib/v2/machines');
    await createMachineV2({
      accountId: 'account-1',
      userId: 'user-1',
      isAdmin: false,
      requestUrl: 'https://app.example/v2/machines',
      input: {
        vcpu: 2,
        ram_gb: 4,
        disk_gb: 20,
        region: 'hel1',
        name: 'Docker Box',
        machine_mode: 'container',
        docker_image: 'nginx:latest',
      },
    });

    expect(reserveCapacityForMachineCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      imageId: null,
      imageAlias: null,
    }));
    expect(createMachineRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      requestedImageKind: 'docker',
      requestedImageRef: 'docker:nginx:latest',
    }));
    expect(enqueueMachineCreateJobMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        machineMode: 'container',
        dockerImage: 'docker:nginx:latest',
      }),
    }));
  });
});
