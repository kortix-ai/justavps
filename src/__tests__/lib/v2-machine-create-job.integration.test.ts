import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { db } from '@/server/db';
import { accounts, baremetalHosts, hostCapacityReservations, machines, subscriptions, users } from '@/server/db/schema';
import { encryptSecret } from '@/server/lib/crypto';

const createServerMock = vi.fn();
const deleteSSHKeyMock = vi.fn();
const deleteServerMock = vi.fn();
const autoGenerateAndSaveSSHKeyMock = vi.fn();
const uploadSSHKeyToProviderMock = vi.fn();
const resolveSSHKeyPublicKeysMock = vi.fn();
const emitStageChangeMock = vi.fn();
const emitStatusChangeMock = vi.fn();

vi.mock('@/server/lib/providers', () => ({
  getProvider: vi.fn(() => ({
    name: 'baremetal',
    createServer: createServerMock,
    deleteSSHKey: deleteSSHKeyMock,
    deleteServer: deleteServerMock,
  })),
}));

vi.mock('@/server/lib/machine-lifecycle', () => ({
  autoGenerateAndSaveSSHKey: autoGenerateAndSaveSSHKeyMock,
  buildMachineUserData: vi.fn(() => '#cloud-config'),
  cleanupMachineResources: vi.fn(),
  createMachineRecord: vi.fn(),
  generateMachineIdentity: vi.fn(),
  resolveMachineCallbackConfig: vi.fn(() => ({ callbackExpected: true, url: 'https://callback.example/machine' })),
  resolveSSHKeyPublicKeys: resolveSSHKeyPublicKeysMock,
  setupProxyDNS: vi.fn(() => Promise.resolve()),
  syncMachineStatus: vi.fn((machine) => machine),
  uploadSSHKeyToProvider: uploadSSHKeyToProviderMock,
}));

vi.mock('@/server/lib/event-bus', () => ({
  eventBus: {
    emitStageChange: emitStageChangeMock,
    emitStatusChange: emitStatusChangeMock,
  },
}));

vi.mock('@/server/lib/stripe', () => ({
  stripeClient: {
    isConfigured: vi.fn(() => false),
  },
}));

vi.mock('@/server/lib/cloud-init-v2', () => ({
  buildCloudInitV2: vi.fn(() => '#cloud-config'),
}));

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdHostIds: string[] = [];
const createdMachineIds: string[] = [];
const createdReservationIds: string[] = [];

async function cleanupRows() {
  if (createdReservationIds.length) {
    await db.delete(hostCapacityReservations).where(inArray(hostCapacityReservations.id, createdReservationIds));
    createdReservationIds.length = 0;
  }
  if (createdMachineIds.length) {
    await db.delete(subscriptions).where(inArray(subscriptions.machineId, createdMachineIds));
    await db.delete(machines).where(inArray(machines.id, createdMachineIds));
    createdMachineIds.length = 0;
  }
  if (createdHostIds.length) {
    await db.delete(baremetalHosts).where(inArray(baremetalHosts.id, createdHostIds));
    createdHostIds.length = 0;
  }
  if (createdAccountIds.length) {
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
    createdAccountIds.length = 0;
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
}

describe.skipIf(!process.env.DATABASE_URL)('durable machine create job integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await cleanupRows();

    autoGenerateAndSaveSSHKeyMock.mockResolvedValue({
      publicKey: 'ssh-rsa AAA-test',
      privateKey: encryptSecret('PRIVATE KEY'),
    });
    uploadSSHKeyToProviderMock.mockResolvedValue('provider-key-1');
    resolveSSHKeyPublicKeysMock.mockResolvedValue([]);
    deleteSSHKeyMock.mockResolvedValue(undefined);
    deleteServerMock.mockResolvedValue(undefined);
    emitStageChangeMock.mockResolvedValue(undefined);
    emitStatusChangeMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupRows();
  });

  async function seedMachineWithReservation() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await db.insert(users).values({
      email: `machine-create-${suffix}@example.com`,
      name: 'Machine Create Integration',
    }).returning();
    createdUserIds.push(user.id);

    const [account] = await db.insert(accounts).values({
      name: `Machine Create ${suffix}`,
      slug: `machine-create-${suffix}`,
      type: 'organization',
    }).returning();
    createdAccountIds.push(account.id);

    const [host] = await db.insert(baremetalHosts).values({
      name: `host-${suffix}`,
      region: 'hel1',
      location: 'HEL1',
      hostClass: 'general-small',
      vendor: 'hetzner_robot',
      status: 'active',
      runnerBaseUrl: 'http://runner.test',
      runnerToken: 'runner-token',
      publicIpv4: '1.2.3.4',
      totalVcpu: 16,
      totalMemoryGb: 64,
      totalDiskGb: 800,
      usedVcpu: 0,
      usedMemoryGb: 0,
      usedDiskGb: 0,
      maintenanceState: 'in_service',
      metadata: {},
    }).returning();
    createdHostIds.push(host.id);

    const [machine] = await db.insert(machines).values({
      ownerId: user.id,
      accountId: account.id,
      slug: `agent-${suffix}`,
      name: 'Agent Box',
      status: 'provisioning',
      provider: 'baremetal',
      serverType: 'custom',
      region: 'hel1',
      vcpu: 2,
      ramGb: 4,
      diskGb: 80,
      ip: null,
      providerServerId: null,
      providerMeta: {
        baremetal_host_id: host.id,
        runner_base_url: host.runnerBaseUrl,
        public_ipv4: host.publicIpv4,
      },
      machineToken: encryptSecret('machine-token'),
      codeServerPassword: '',
      sshPublicKey: null,
      sshPrivateKey: null,
      backupsEnabled: false,
      source: 'user',
      priceMonthly: 20,
    }).returning();
    createdMachineIds.push(machine.id);

    const [reservation] = await db.insert(hostCapacityReservations).values({
      hostId: host.id,
      machineId: machine.id,
      reservationType: 'machine_create',
      state: 'reserved',
      vcpu: 2,
      memoryGb: 4,
      diskGb: 80,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      metadata: {},
    }).returning();
    createdReservationIds.push(reservation.id);

    return { user, account, host, machine, reservation };
  }

  it('creates the provider server and commits the reserved host capacity on success', async () => {
    const { user, account, machine, reservation } = await seedMachineWithReservation();
    createServerMock.mockResolvedValue({
      serverId: 'srv-success',
      publicIp: '1.2.3.4',
      publicIpv4: '1.2.3.4',
      publicIpv6: null,
      createActionId: 'action-1',
      metadata: { http_port: 18888 },
    });

    const { handleMachineCreateJob } = await import('@/server/lib/v2/machines');
    const result = await handleMachineCreateJob(machine.id, {
      accountId: account.id,
      userId: user.id,
      isAdmin: true,
      reservationId: reservation.id,
      enableBackups: false,
    }, 0, 3);

    const [updatedMachine] = await db.select().from(machines).where(eq(machines.id, machine.id));
    const [updatedReservation] = await db.select().from(hostCapacityReservations).where(eq(hostCapacityReservations.id, reservation.id));

    expect(result.status).toBe('succeeded');
    expect(updatedMachine.providerServerId).toBe('srv-success');
    expect(updatedReservation.state).toBe('committed');
    expect(updatedReservation.committedAt).toBeTruthy();
  });

  it('releases the reservation and marks the machine errored on terminal create failure', async () => {
    const { user, account, machine, reservation } = await seedMachineWithReservation();
    createServerMock.mockRejectedValue(new Error('runner create failed'));

    const { handleMachineCreateJob } = await import('@/server/lib/v2/machines');
    const result = await handleMachineCreateJob(machine.id, {
      accountId: account.id,
      userId: user.id,
      isAdmin: true,
      reservationId: reservation.id,
      enableBackups: false,
    }, 0, 1);

    const [updatedMachine] = await db.select().from(machines).where(eq(machines.id, machine.id));
    const [updatedReservation] = await db.select().from(hostCapacityReservations).where(eq(hostCapacityReservations.id, reservation.id));

    expect(result).toMatchObject({ status: 'dead_lettered', error: 'runner create failed' });
    expect(updatedMachine.status).toBe('error');
    expect((updatedMachine.providerMeta ?? {})['create_status']).toBe('error');
    expect(updatedReservation.state).toBe('released');
    expect(updatedReservation.releasedAt).toBeTruthy();
  });
});
