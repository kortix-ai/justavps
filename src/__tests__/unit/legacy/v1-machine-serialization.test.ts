import { beforeEach, describe, expect, it, vi } from 'vitest';

const decryptSecretMock = vi.fn((value: string) => `decrypted:${value}`);

vi.mock('@/server/core/crypto', async () => {
  const actual = await vi.importActual<typeof import("@/server/core/crypto")>('@/server/core/crypto');
  return {
    ...actual,
    decryptSecret: decryptSecretMock,
  };
});

describe('legacy V1 machine serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers explicit machine network and callback fields over providerMeta fallbacks', async () => {
    const { serializeMachineV1 } = await import("@/server/v1/routes/legacy/serializers/machines");
    const machine = {
      id: 'machine-1',
      slug: 'legacy-box',
      name: 'Legacy Box',
      status: 'ready',
      provisioningStage: 'services_ready',
      provisioningStageUpdatedAt: new Date('2026-04-12T12:00:00.000Z'),
      provider: 'baremetal',
      imageId: null,
      serverType: 'basic',
      region: 'hel1',
      ip: '10.0.0.9',
      publicIpv4: '135.181.129.188',
      sshPort: 42022,
      providerProgress: 80,
      providerStatus: 'running',
      callbackExpected: false,
      callbackUrl: 'https://explicit.example/ignored',
      priceMonthly: 20,
      backupsEnabled: false,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      readyAt: new Date('2026-04-12T12:01:00.000Z'),
      sshPrivateKey: 'encrypted-key',
      sshPublicKey: 'ssh-ed25519 AAAA',
      providerMeta: {
        ssh_port: 9999,
        public_ipv4: '9.9.9.9',
        create_progress: 0.1,
        create_status: 'queued',
        callback_expected: true,
        callback_url: 'https://wrong.example',
      },
      source: 'user',
      kortixSandboxId: null,
      daemonVersion: '1.0.0',
      lastHeartbeat: null,
      lastHeartbeatAt: null,
    } as never;

    const view = serializeMachineV1(machine, null, { includeSensitive: true });
    expect(view.provider_progress).toBe(80);
    expect(view.provider_status).toBe('running');
    expect(view.callback_expected).toBe(false);
    expect(view.callback_url).toBe('https://explicit.example/ignored');
    expect(view.ssh).toContain('-p 42022');
    expect(view.ssh).toContain('135.181.129.188');
  });
});
