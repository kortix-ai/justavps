import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('BaremetalProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('schedules onto a runner host and returns host networking plus runner metadata', async () => {
    const runnerCreate = vi.fn().mockResolvedValue({
      instanceId: 'vm-abc123',
      hostIpv4: '5.6.7.8',
      privateIpv4: '10.120.0.15',
      sshPort: 22015,
      metadata: { proxy_slug: 'abc123' },
    });

    const { BaremetalProvider } = await import("@/server/platform/providers/baremetal");
    const provider = new BaremetalProvider({
      selectHost: async () => ({
        host: {
          id: 'host-1',
          region: 'fsn1',
           status: 'active',
           generation: 'gen1',
           cellId: 'cell-1',
           cell: {
             id: 'cell-1', slug: 'fsn1--general-small--gen1', name: 'FSN1 general-small gen1', region: 'fsn1', hostClass: 'general-small', generation: 'gen1', status: 'active',
             reservePolicy: { warmReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 }, failureReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 }, procurementReserve: { vcpu: 0, memoryGb: 0, diskGb: 0 } },
             admission: { state: 'open', sellability: 'sellable', reason: null, source: 'manual', setAt: null },
           },
          publicIpv4: '5.6.7.8',
          runnerBaseUrl: 'http://runner-host-1:7779',
          runnerToken: 'runner-secret',
          capacity: { totalVcpu: 16, totalMemoryGb: 64, totalDiskGb: 900, usedVcpu: 4, usedMemoryGb: 8, usedDiskGb: 80 },
        },
        plan: { id: 'starter', vcpu: 2, memory: 4, disk: 80, priceMonthly: 12, providerCostMonthly: 6 },
        decision: {
          outcome: 'placed',
          selectedHostId: 'host-1',
          summary: 'Selected host host-1',
          explanation: [],
          request: { region: 'fsn1', resources: { vcpu: 2, memoryGb: 4, diskGb: 80 } },
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
      }),
      createRunnerClient: () => ({
        createInstance: runnerCreate,
        deleteInstance: vi.fn(),
        startInstance: vi.fn(),
        stopInstance: vi.fn(),
        rebootInstance: vi.fn(),
      }),
    });

    const result = await provider.createServer({
      name: 'justavps-abc123',
      image: 'justavps-standard',
      labels: { slug: 'abc123' },
      region: 'fsn1',
      serverType: 'starter',
      sshKeyIds: [],
      userData: '#cloud-config\n{}',
      sshPort: 23001,
      httpPort: 43001,
    });

    expect(runnerCreate).toHaveBeenCalledWith(expect.objectContaining({
      instanceName: 'justavps-abc123',
      serverType: 'starter',
      region: 'fsn1',
      cloudInitUserData: '#cloud-config\n{}',
      vcpu: 2,
      memoryGb: 4,
      diskGb: 80,
      sshPort: 23001,
      httpPort: 43001,
    }));

    expect(result).toMatchObject({
      serverId: 'vm-abc123',
      publicIp: '5.6.7.8',
      publicIpv4: '5.6.7.8',
      metadata: {
        baremetal_host_id: 'host-1',
        baremetal_cell_id: 'cell-1',
        baremetal_cell_slug: 'fsn1--general-small--gen1',
        private_ipv4: '10.120.0.15',
        ssh_port: 22015,
        runner_base_url: 'http://runner-host-1:7779',
      },
    });
  });

  it('fails clearly when there is no capacity', async () => {
    const { BaremetalProvider } = await import("@/server/platform/providers/baremetal");
    const provider = new BaremetalProvider({
      selectHost: async () => null,
      createRunnerClient: () => ({
        createInstance: vi.fn(),
        deleteInstance: vi.fn(),
        startInstance: vi.fn(),
        stopInstance: vi.fn(),
        rebootInstance: vi.fn(),
      }),
    });

    await expect(provider.createServer({
      name: 'justavps-abc123',
      image: 'justavps-standard',
      labels: { slug: 'abc123' },
      region: 'fsn1',
      serverType: 'starter',
      sshKeyIds: [],
      userData: '#cloud-config\n{}',
    })).rejects.toThrow(/capacity|host/i);
  });

});
