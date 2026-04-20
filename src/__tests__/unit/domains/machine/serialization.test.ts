import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectWhereMock = vi.fn();
const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
const selectMock = vi.fn(() => ({ from: selectFromMock }));
const getMachinePortAllocationsMock = vi.fn();
const getProviderMock = vi.fn(() => ({ capabilities: { backups: false, images: true } }));
const decryptSecretMock = vi.fn((value: string) => `decrypted:${value}`);
const serializeImageRowMock = vi.fn((image: { id: string; name: string }) => ({ id: image.id, name: image.name }));

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock('@/server/platform/baremetal/port-allocations', () => ({
  getMachinePortAllocations: getMachinePortAllocationsMock,
}));

vi.mock('@/server/platform/providers', () => ({
  getProvider: getProviderMock,
}));

vi.mock('@/server/core/crypto', () => ({
  decryptSecret: decryptSecretMock,
}));

vi.mock('@/server/core/image-catalog', () => ({
  serializeImageRow: serializeImageRowMock,
}));

describe('machine serialization domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMachinePortAllocationsMock.mockResolvedValue({
      ssh: { publicPort: 42022 },
      http: { publicPort: 42080 },
      rows: [],
    });
    selectWhereMock.mockResolvedValue([]);
  });

  it('hides SSH connectivity for exec-first instances while keeping image refs and URLs', async () => {
    selectWhereMock.mockResolvedValueOnce([{ id: 'img-1', name: 'Golden' }]);

    const { serializeMachineV2 } = await import("@/server/v2/domains/machine/serialization");
    const machine = {
      id: 'machine-1',
      slug: 'abcd1234',
      name: 'Agent Box',
      status: 'ready',
      provisioningStage: 'services_ready',
      provisioningStageUpdatedAt: new Date('2026-04-12T12:00:00.000Z'),
      provider: 'baremetal',
      machineMode: 'container',
      requestedImageKind: 'docker',
      requestedImageRef: 'docker:nginx:latest',
      imageId: 'img-1',
      region: 'hel1',
      publicIpv4: '135.181.129.188',
      publicIpv6: null,
      sshPort: 42022,
      httpPort: 42080,
      readyVia: 'probe',
      providerProgress: 50,
      providerStatus: 'running',
      callbackExpected: false,
      callbackUrl: null,
      vcpu: 4,
      ramGb: 8,
      diskGb: 100,
      providerMeta: {
        access_mode: 'exec',
        ssh_proxy_enabled: false,
        public_ipv4: '135.181.129.188',
        private_ipv4: '10.0.0.5',
      },
      sshPrivateKey: 'encrypted-key',
      sshPublicKey: 'ssh-ed25519 AAAA',
      priceMonthly: 20,
      lastHeartbeat: { cpu: 10, memory: 20, disk: 30, services: { app: true } },
      lastHeartbeatAt: new Date('2026-04-12T12:00:10.000Z'),
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      readyAt: new Date('2026-04-12T12:00:15.000Z'),
    } as never;

    const view = await serializeMachineV2(machine, null);

    expect(view.machine_mode).toBe('container');
    expect(view.requested_image_kind).toBe('docker');
    expect(view.requested_image_ref).toBe('docker:nginx:latest');
    expect(view.connectivity.access).toEqual({
      mode: 'rest_exec',
      exec_endpoint: '/api/v2/machines/machine-1/exec',
    });
    expect(view.connectivity.urls.proxy).toBe('https://abcd1234.test.example.com');
    expect(view.provider_progress).toBe(50);
    expect(view.image).toEqual({ id: 'img-1', name: 'Golden' });
    expect(view.ready_via).toBe('probe');
  });

  it('falls back to legacy resource fields when machine columns are null', async () => {
    const { serializeMachineV2 } = await import("@/server/v2/domains/machine/serialization");
    const machine = {
      id: 'machine-2',
      slug: 'legacy123',
      name: 'Legacy Box',
      status: 'provisioning',
      provisioningStage: null,
      provisioningStageUpdatedAt: null,
      provider: 'baremetal',
      machineMode: 'vm',
      imageId: null,
      region: 'hel1',
      vcpu: null,
      ramGb: null,
      diskGb: null,
      providerMeta: { vcpu: 2, ram_gb: 4, disk_gb: 80 },
      sshPrivateKey: null,
      sshPublicKey: null,
      priceMonthly: null,
      lastHeartbeat: null,
      lastHeartbeatAt: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      readyAt: null,
    } as never;

    const view = await serializeMachineV2(machine, null);
    expect(view.resources).toEqual({ vcpu: 2, ram_gb: 4, disk_gb: 80 });
    expect(view.connectivity.access.exec_endpoint).toBe('/api/v2/machines/machine-2/exec');
  });
});
