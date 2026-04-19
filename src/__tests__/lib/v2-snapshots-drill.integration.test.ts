import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { db } from '@/server/db';
import { accounts, backupArtifacts, baremetalHosts, machines, restoreExecutions, users } from '@/server/db/schema';

const createSnapshotMock = vi.fn();
const restoreSnapshotMock = vi.fn();

vi.mock('@/server/platform/baremetal/runner-client', () => ({
  HttpBaremetalRunnerClient: vi.fn(function HttpBaremetalRunnerClient() {
    return {
      createSnapshot: createSnapshotMock,
      restoreSnapshot: restoreSnapshotMock,
    };
  }),
}));

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdHostIds: string[] = [];
const createdMachineIds: string[] = [];
const createdArtifactIds: string[] = [];
const createdExecutionIds: string[] = [];

async function cleanupRows() {
  if (createdExecutionIds.length) {
    await db.delete(restoreExecutions).where(inArray(restoreExecutions.id, createdExecutionIds));
    createdExecutionIds.length = 0;
  }
  if (createdArtifactIds.length) {
    await db.delete(backupArtifacts).where(inArray(backupArtifacts.id, createdArtifactIds));
    createdArtifactIds.length = 0;
  }
  if (createdMachineIds.length) {
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

describe.skipIf(!process.env.DATABASE_URL)('backup artifact + restore drill integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await cleanupRows();
  });

  afterEach(async () => {
    await cleanupRows();
  });

  async function seedBaremetalMachine() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await db.insert(users).values({
      email: `snapshots-${suffix}@example.com`,
      name: 'Snapshots Integration',
    }).returning();
    createdUserIds.push(user.id);

    const [account] = await db.insert(accounts).values({
      name: `Snapshots ${suffix}`,
      slug: `snapshots-${suffix}`,
      type: 'organization',
    }).returning();
    createdAccountIds.push(account.id);

    const [host] = await db.insert(baremetalHosts).values({
      name: `snap-host-${suffix}`,
      region: 'hel1',
      location: 'HEL1',
      hostClass: 'general-small',
      vendor: 'hetzner_robot',
      status: 'active',
      runnerBaseUrl: 'http://runner.snapshots',
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
      slug: `snapshot-${suffix}`,
      name: 'Snapshot Target',
      status: 'ready',
      provider: 'baremetal',
      serverType: 'custom',
      region: 'hel1',
      vcpu: 2,
      ramGb: 4,
      diskGb: 80,
      ip: '10.0.0.2',
      providerServerId: `justavps-snapshot-${suffix}`,
      providerMeta: {
        baremetal_host_id: host.id,
        runner_base_url: host.runnerBaseUrl,
      },
      machineToken: 'plain-token',
      codeServerPassword: '',
      backupsEnabled: true,
      source: 'user',
      priceMonthly: 20,
    }).returning();
    createdMachineIds.push(machine.id);

    return { user, account, host, machine };
  }

  it('persists snapshot artifacts and restore executions for the baremetal drill path', async () => {
    const { user, account, host, machine } = await seedBaremetalMachine();
    createSnapshotMock.mockResolvedValue({
      id: 'snap-success',
      name: 'before-upgrade',
      createdAt: '2026-04-10T12:00:00.000Z',
      status: 'ready',
    });
    restoreSnapshotMock.mockResolvedValue(undefined);

    const { createSnapshotV2, restoreSnapshotV2 } = await import("@/server/v2/services/snapshots");
    const snapshot = await createSnapshotV2({ accountId: account.id, machineId: machine.id, name: 'before-upgrade', requestedByUserId: user.id });
    const restore = await restoreSnapshotV2({
      accountId: account.id,
      machineId: machine.id,
      snapshotId: snapshot.id,
      requestedByUserId: user.id,
    });

    const [artifact] = await db.select().from(backupArtifacts).where(eq(backupArtifacts.id, snapshot.artifact_id!));
    const [execution] = await db.select().from(restoreExecutions).where(eq(restoreExecutions.id, restore.restore_execution_id));
    createdArtifactIds.push(artifact.id);
    createdExecutionIds.push(execution.id);

    expect(artifact.provider).toBe('baremetal_runner_snapshot');
    expect(artifact.accountId).toBe(account.id);
    expect(artifact.createdByUserId).toBe(user.id);
    expect(artifact.displayName).toBe('before-upgrade');
    expect(artifact.restoreCount).toBe(1);
    expect(artifact.lastRestoreAt).not.toBeNull();
    expect(artifact.sourceHostId).toBe(host.id);
    expect(execution.status).toBe('succeeded');
    expect(execution.accountId).toBe(account.id);
    expect(execution.sourceHostId).toBe(host.id);
    expect(execution.targetHostId).toBe(host.id);
    expect(execution.triggerSource).toBe('user_request');
    expect(execution.durationMs).not.toBeNull();
    expect(execution.requestedByUserId).toBe(user.id);
  });

  it('records failed restore drills in restore_executions', async () => {
    const { user, account, machine } = await seedBaremetalMachine();
    restoreSnapshotMock.mockRejectedValue(new Error('restore failed on runner'));

    const { restoreSnapshotV2 } = await import("@/server/v2/services/snapshots");

    await expect(restoreSnapshotV2({
      accountId: account.id,
      machineId: machine.id,
      snapshotId: 'snap-fail',
      requestedByUserId: user.id,
    })).rejects.toThrow('restore failed on runner');

    const [artifact] = await db.select().from(backupArtifacts).where(eq(backupArtifacts.providerArtifactId, 'snap-fail'));
    const [execution] = await db.select().from(restoreExecutions).where(eq(restoreExecutions.artifactId, artifact.id));
    createdArtifactIds.push(artifact.id);
    createdExecutionIds.push(execution.id);

    expect(execution.status).toBe('failed');
    expect(execution.accountId).toBe(account.id);
    expect(execution.sourceHostId).toBe(machine.providerMeta?.baremetal_host_id ?? null);
    expect(execution.error).toBe('restore failed on runner');
    expect(execution.durationMs).not.toBeNull();
  });
});
