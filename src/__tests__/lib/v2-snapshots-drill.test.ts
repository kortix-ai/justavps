/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let machineRows: any[] = [];
let hostRows: any[] = [];

const createSnapshotMock = vi.fn();
const restoreSnapshotMock = vi.fn();
const ensureSnapshotArtifactMock = vi.fn();
const markSnapshotArtifactDeletedMock = vi.fn();
const startRestoreExecutionMock = vi.fn();
const completeRestoreExecutionMock = vi.fn();

vi.mock('@/server/db', async () => {
  const schema = await vi.importActual<typeof import('@/server/db/schema')>('@/server/db/schema');
  return {
    db: {
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.machines) return machineRows;
            if (table === schema.baremetalHosts) return hostRows;
            return [];
          },
        }),
      })),
    },
  };
});

vi.mock('@/server/platform/baremetal/runner-client', () => ({
  HttpBaremetalRunnerClient: vi.fn(function HttpBaremetalRunnerClient() {
    return {
      createSnapshot: createSnapshotMock,
      restoreSnapshot: restoreSnapshotMock,
    };
  }),
}));

vi.mock('@/server/platform/providers', () => ({
  getProvider: vi.fn(),
  isBackupCapableProvider: vi.fn(() => false),
}));

vi.mock('@/server/v2/services/backup-artifacts', () => ({
  baremetalSnapshotStorageUrl: vi.fn((hostId: string, instanceId: string, snapshotId: string) => `incus-snapshot://${hostId}/${instanceId}/${snapshotId}`),
  ensureSnapshotArtifact: ensureSnapshotArtifactMock,
  markSnapshotArtifactDeleted: markSnapshotArtifactDeletedMock,
  startRestoreExecution: startRestoreExecutionMock,
  completeRestoreExecution: completeRestoreExecutionMock,
}));

describe('v2 snapshot backup artifacts and restore drill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    machineRows = [{
      id: 'machine-1',
      accountId: 'account-1',
      slug: 'agent-box',
      status: 'ready',
      provider: 'baremetal',
      providerServerId: 'justavps-agent-box',
      providerMeta: {
        baremetal_host_id: 'host-1',
        runner_base_url: 'http://runner',
      },
    }];
    hostRows = [{ id: 'host-1', runnerToken: 'runner-token' }];
  });

  it('records a backup artifact when creating a baremetal snapshot', async () => {
    createSnapshotMock.mockResolvedValueOnce({
      id: 'snap-1',
      name: 'before-upgrade',
      createdAt: '2026-04-10T12:00:00.000Z',
      status: 'ready',
    });
    ensureSnapshotArtifactMock.mockResolvedValueOnce({ id: 'artifact-1' });

    const { createSnapshotV2 } = await import("@/server/v2/services/snapshots");
    const result = await createSnapshotV2({ accountId: 'account-1', machineId: 'machine-1', name: 'before-upgrade' });

    expect(result.artifact_id).toBe('artifact-1');
    expect(ensureSnapshotArtifactMock).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      machineId: 'machine-1',
      provider: 'baremetal_runner_snapshot',
      providerArtifactId: 'snap-1',
      inventoryScope: 'customer',
      storageScope: 'host_local',
      sourceHostId: 'host-1',
      sourceMachineSlug: 'agent-box',
    }));
  });

  it('records a restore execution for the restore drill path', async () => {
    ensureSnapshotArtifactMock.mockResolvedValueOnce({ id: 'artifact-1' });
    startRestoreExecutionMock.mockResolvedValueOnce({ id: 'restore-1' });
    restoreSnapshotMock.mockResolvedValueOnce(undefined);

    const { restoreSnapshotV2 } = await import("@/server/v2/services/snapshots");
    const result = await restoreSnapshotV2({
      accountId: 'account-1',
      machineId: 'machine-1',
      snapshotId: 'snap-1',
      requestedByUserId: 'user-1',
    });

    expect(result).toEqual({ ok: true, restore_execution_id: 'restore-1' });
    expect(startRestoreExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-1',
      accountId: 'account-1',
      machineId: 'machine-1',
      sourceHostId: 'host-1',
      targetHostId: 'host-1',
      requestedByUserId: 'user-1',
      triggerSource: 'user_request',
    }));
    expect(completeRestoreExecutionMock).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'restore-1',
      status: 'succeeded',
    }));
  });

  it('marks the artifact deleted when removing a baremetal snapshot', async () => {
    const { deleteSnapshotV2 } = await import("@/server/v2/services/snapshots");

    const result = await deleteSnapshotV2({ accountId: 'account-1', machineId: 'machine-1', snapshotId: 'snap-1' });

    expect(result).toEqual({ ok: true });
    expect(markSnapshotArtifactDeletedMock).toHaveBeenCalledWith({
      provider: 'baremetal_runner_snapshot',
      providerArtifactId: 'snap-1',
    });
  });
});
