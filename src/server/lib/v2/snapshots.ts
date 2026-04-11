import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { backupArtifacts, machines, restoreExecutions } from '../../db/schema';
import { getProvider, isBackupCapableProvider } from '../providers';
import { HttpBaremetalRunnerClient } from '../baremetal/runner-client';
import {
  baremetalSnapshotStorageUrl,
  completeRestoreExecution,
  ensureSnapshotArtifact,
  markSnapshotArtifactDeleted,
  startRestoreExecution,
} from '../backup-artifacts';

export interface V2RestoreExecution {
  id: string;
  artifact_id: string;
  snapshot_id: string | null;
  snapshot_name: string | null;
  status: string;
  trigger_source: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  requested_by_user_id: string | null;
  source_host_id: string | null;
  target_host_id: string | null;
}

export interface V2Snapshot {
  id: string;
  name: string;
  created_at: string;
  status: string;
  artifact_id?: string | null;
  artifact_status?: string | null;
  inventory_source?: 'provider' | 'database' | 'merged';
  backup_kind?: string | null;
  inventory_scope?: string | null;
  storage_scope?: string | null;
  display_name?: string | null;
  storage_url?: string | null;
  retention_until?: string | null;
  source_host_id?: string | null;
  restore_count?: number;
  last_restore_at?: string | null;
  latest_restore?: V2RestoreExecution | null;
}

export interface V2SnapshotInventory {
  snapshots: V2Snapshot[];
  restore_executions: V2RestoreExecution[];
  summary: {
    total_snapshots: number;
    ready_snapshots: number;
    deleted_snapshots: number;
    snapshots_with_restore_history: number;
    total_restores: number;
    failed_restores: number;
    last_restore_at: string | null;
  };
}

async function loadOwnedMachine(machineId: string, accountId: string) {
  const [machine] = await db.select().from(machines).where(and(eq(machines.id, machineId), eq(machines.accountId, accountId)));
  if (!machine || machine.status === 'deleted') throw new Error('Machine not found');
  return machine;
}

function inferProviderServerId(machine: typeof machines.$inferSelect) {
  return machine.providerServerId || (machine.provider === 'baremetal' ? `justavps-${machine.slug}` : null);
}

function baremetalRunnerFromMachine(machine: typeof machines.$inferSelect) {
  const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
  const runnerBaseUrl = typeof meta.runner_base_url === 'string' ? meta.runner_base_url : null;
  const hostId = machine.baremetalHostId ?? (typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null);
  if (!runnerBaseUrl || !hostId) throw new Error('Baremetal runner metadata is missing');
  return { runnerBaseUrl, hostId };
}

async function loadRunnerToken(hostId: string) {
  const { baremetalHosts } = await import('../../db/schema');
  const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, hostId));
  if (!host?.runnerToken) throw new Error('Baremetal host runner token missing');
  return host.runnerToken;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function metadataValue(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function mapRestoreExecution(
  execution: typeof restoreExecutions.$inferSelect,
  artifact: typeof backupArtifacts.$inferSelect | null,
): V2RestoreExecution {
  return {
    id: execution.id,
    artifact_id: execution.artifactId,
    snapshot_id: artifact?.providerArtifactId ?? null,
    snapshot_name: artifact?.displayName ?? metadataValue(artifact?.metadata, 'snapshot_name') ?? artifact?.providerArtifactId ?? null,
    status: execution.status,
    trigger_source: execution.triggerSource,
    started_at: execution.startedAt.toISOString(),
    completed_at: toIso(execution.completedAt),
    duration_ms: execution.durationMs ?? null,
    error: execution.error ?? null,
    requested_by_user_id: execution.requestedByUserId ?? null,
    source_host_id: execution.sourceHostId ?? null,
    target_host_id: execution.targetHostId ?? null,
  };
}

function mapSnapshotFromArtifact(
  artifact: typeof backupArtifacts.$inferSelect,
  latestRestore: V2RestoreExecution | null,
): V2Snapshot {
  return {
    id: artifact.providerArtifactId ?? artifact.id,
    name: artifact.displayName ?? metadataValue(artifact.metadata, 'snapshot_name') ?? artifact.providerArtifactId ?? artifact.id,
    created_at: metadataValue(artifact.metadata, 'created_at') ?? artifact.completedAt?.toISOString() ?? artifact.createdAt.toISOString(),
    status: artifact.status,
    artifact_id: artifact.id,
    artifact_status: artifact.status,
    inventory_source: 'database',
    backup_kind: artifact.backupKind,
    inventory_scope: artifact.inventoryScope,
    storage_scope: artifact.storageScope,
    display_name: artifact.displayName ?? null,
    storage_url: artifact.storageUrl ?? null,
    retention_until: toIso(artifact.retentionUntil),
    source_host_id: artifact.sourceHostId ?? null,
    restore_count: artifact.restoreCount,
    last_restore_at: toIso(artifact.lastRestoreAt),
    latest_restore: latestRestore,
  };
}

function mergeLiveSnapshotWithArtifact(
  snapshot: { id: string; name: string; createdAt: string; status: string },
  artifact: typeof backupArtifacts.$inferSelect | null,
  latestRestore: V2RestoreExecution | null,
): V2Snapshot {
  return {
    id: snapshot.id,
    name: artifact?.displayName ?? snapshot.name,
    created_at: snapshot.createdAt,
    status: snapshot.status,
    artifact_id: artifact?.id ?? null,
    artifact_status: artifact?.status ?? null,
    inventory_source: artifact ? 'merged' : 'provider',
    backup_kind: artifact?.backupKind ?? null,
    inventory_scope: artifact?.inventoryScope ?? null,
    storage_scope: artifact?.storageScope ?? null,
    display_name: artifact?.displayName ?? snapshot.name,
    storage_url: artifact?.storageUrl ?? null,
    retention_until: toIso(artifact?.retentionUntil),
    source_host_id: artifact?.sourceHostId ?? null,
    restore_count: artifact?.restoreCount ?? 0,
    last_restore_at: toIso(artifact?.lastRestoreAt),
    latest_restore: latestRestore,
  };
}

async function loadSnapshotInventory(machineId: string) {
  const artifacts = await db.select().from(backupArtifacts)
    .where(eq(backupArtifacts.machineId, machineId))
    .orderBy(desc(backupArtifacts.createdAt));

  const executions = artifacts.length
    ? await db.select().from(restoreExecutions)
      .where(inArray(restoreExecutions.artifactId, artifacts.map((artifact) => artifact.id)))
      .orderBy(desc(restoreExecutions.createdAt))
    : [];

  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const artifactByProviderArtifactId = new Map(
    artifacts
      .filter((artifact) => artifact.providerArtifactId)
      .map((artifact) => [artifact.providerArtifactId!, artifact]),
  );

  const restoreExecutionsView = executions.map((execution) => mapRestoreExecution(execution, artifactById.get(execution.artifactId) ?? null));
  const latestRestoreByArtifactId = new Map<string, V2RestoreExecution>();
  for (const execution of restoreExecutionsView) {
    if (!latestRestoreByArtifactId.has(execution.artifact_id)) latestRestoreByArtifactId.set(execution.artifact_id, execution);
  }

  return {
    artifacts,
    artifactByProviderArtifactId,
    restoreExecutionsView,
    latestRestoreByArtifactId,
  };
}

function buildInventorySummary(snapshots: V2Snapshot[], restoreExecutionRows: V2RestoreExecution[]) {
  return {
    total_snapshots: snapshots.length,
    ready_snapshots: snapshots.filter((snapshot) => ['ready', 'available'].includes(snapshot.status)).length,
    deleted_snapshots: snapshots.filter((snapshot) => snapshot.status === 'deleted').length,
    snapshots_with_restore_history: snapshots.filter((snapshot) => (snapshot.restore_count ?? 0) > 0).length,
    total_restores: restoreExecutionRows.length,
    failed_restores: restoreExecutionRows.filter((execution) => execution.status === 'failed').length,
    last_restore_at: restoreExecutionRows.find((execution) => execution.completed_at)?.completed_at ?? null,
  };
}

export async function listSnapshotsV2(input: { accountId: string; machineId: string }): Promise<V2SnapshotInventory> {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');

  const inventory = await loadSnapshotInventory(machine.id);
  let snapshots: V2Snapshot[] = [];

  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    const liveSnapshots = await runner.listSnapshots?.(providerServerId);
    const liveIds = new Set((liveSnapshots ?? []).map((snapshot) => snapshot.id));
    snapshots = (liveSnapshots ?? []).map((snapshot) => {
      const artifact = inventory.artifactByProviderArtifactId.get(snapshot.id) ?? null;
      return mergeLiveSnapshotWithArtifact(snapshot, artifact, artifact ? inventory.latestRestoreByArtifactId.get(artifact.id) ?? null : null);
    });

    const artifactOnlySnapshots = inventory.artifacts
      .filter((artifact) => !artifact.providerArtifactId || !liveIds.has(artifact.providerArtifactId))
      .map((artifact) => mapSnapshotFromArtifact(artifact, inventory.latestRestoreByArtifactId.get(artifact.id) ?? null));
    snapshots = [...snapshots, ...artifactOnlySnapshots];
  } else {
    const provider = getProvider(machine.provider);
    if (!isBackupCapableProvider(provider)) {
      return {
        snapshots: inventory.artifacts.map((artifact) => mapSnapshotFromArtifact(artifact, inventory.latestRestoreByArtifactId.get(artifact.id) ?? null)),
        restore_executions: inventory.restoreExecutionsView,
        summary: buildInventorySummary(inventory.artifacts.map((artifact) => mapSnapshotFromArtifact(artifact, inventory.latestRestoreByArtifactId.get(artifact.id) ?? null)), inventory.restoreExecutionsView),
      };
    }

    const backups = await provider.listBackups(providerServerId);
    const liveIds = new Set(backups.map((backup) => backup.id));
    snapshots = backups.map((backup) => {
      const artifact = inventory.artifactByProviderArtifactId.get(backup.id) ?? null;
      return {
        id: backup.id,
        name: artifact?.displayName ?? backup.description ?? backup.id,
        created_at: backup.createdAt,
        status: artifact?.status === 'deleted' ? 'deleted' : 'ready',
        artifact_id: artifact?.id ?? null,
        artifact_status: artifact?.status ?? null,
        inventory_source: artifact ? 'merged' : 'provider',
        backup_kind: artifact?.backupKind ?? null,
        inventory_scope: artifact?.inventoryScope ?? null,
        storage_scope: artifact?.storageScope ?? null,
        display_name: artifact?.displayName ?? backup.description ?? backup.id,
        storage_url: artifact?.storageUrl ?? null,
        retention_until: toIso(artifact?.retentionUntil),
        source_host_id: artifact?.sourceHostId ?? null,
        restore_count: artifact?.restoreCount ?? 0,
        last_restore_at: toIso(artifact?.lastRestoreAt),
        latest_restore: artifact ? inventory.latestRestoreByArtifactId.get(artifact.id) ?? null : null,
      };
    });

    const artifactOnlySnapshots = inventory.artifacts
      .filter((artifact) => !artifact.providerArtifactId || !liveIds.has(artifact.providerArtifactId))
      .map((artifact) => mapSnapshotFromArtifact(artifact, inventory.latestRestoreByArtifactId.get(artifact.id) ?? null));
    snapshots = [...snapshots, ...artifactOnlySnapshots];
  }

  snapshots.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return {
    snapshots,
    restore_executions: inventory.restoreExecutionsView,
    summary: buildInventorySummary(snapshots, inventory.restoreExecutionsView),
  };
}

export async function createSnapshotV2(input: { accountId: string; machineId: string; name?: string; requestedByUserId?: string | null }): Promise<V2Snapshot> {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');
  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    const snapshot = await runner.createSnapshot?.(providerServerId, input.name);
    if (!snapshot) throw new Error('Baremetal snapshots are not supported by runner');
    const artifact = await ensureSnapshotArtifact({
      accountId: machine.accountId,
      machineId: machine.id,
      createdByUserId: input.requestedByUserId ?? null,
      provider: 'baremetal_runner_snapshot',
      providerArtifactId: snapshot.id,
      backupKind: 'user_snapshot',
      inventoryScope: 'customer',
      storageScope: 'host_local',
      displayName: input.name ?? snapshot.name,
      sourceMachineSlug: machine.slug,
      sourceHostId: hostId,
      storageUrl: baremetalSnapshotStorageUrl(hostId, providerServerId, snapshot.id),
      metadata: {
        machine_slug: machine.slug,
        snapshot_name: snapshot.name,
        provider_server_id: providerServerId,
        created_at: snapshot.createdAt,
      },
      status: snapshot.status === 'error' ? 'failed' : 'ready',
    });
    return { id: snapshot.id, name: snapshot.name, created_at: snapshot.createdAt, status: snapshot.status, artifact_id: artifact.id };
  }

  const provider = getProvider(machine.provider);
  if (!isBackupCapableProvider(provider)) throw new Error('Snapshots are not supported for this machine');
  const backup = await provider.createBackup(providerServerId, input.name);
  const artifact = await ensureSnapshotArtifact({
    accountId: machine.accountId,
    machineId: machine.id,
    createdByUserId: input.requestedByUserId ?? null,
    provider: `${machine.provider}_snapshot`,
    providerArtifactId: backup.id,
    backupKind: 'user_snapshot',
    inventoryScope: 'customer',
    storageScope: 'host_local',
    displayName: input.name ?? backup.id,
    sourceMachineSlug: machine.slug,
    storageUrl: null,
    metadata: {
      machine_slug: machine.slug,
      snapshot_name: input.name ?? backup.id,
      provider_server_id: providerServerId,
    },
    status: 'creating',
  });
  return { id: backup.id, name: input.name ?? backup.id, created_at: new Date().toISOString(), status: 'creating', artifact_id: artifact.id };
}

export async function restoreSnapshotV2(input: { accountId: string; machineId: string; snapshotId: string; requestedByUserId?: string }) {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');
  const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
  const targetHostId = typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null;

  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const artifact = await ensureSnapshotArtifact({
      accountId: machine.accountId,
      machineId: machine.id,
      provider: 'baremetal_runner_snapshot',
      providerArtifactId: input.snapshotId,
      backupKind: 'user_snapshot',
      inventoryScope: 'customer',
      storageScope: 'host_local',
      sourceMachineSlug: machine.slug,
      sourceHostId: hostId,
      storageUrl: baremetalSnapshotStorageUrl(hostId, providerServerId, input.snapshotId),
      metadata: {
        machine_slug: machine.slug,
        provider_server_id: providerServerId,
      },
      status: 'ready',
    });
    const execution = await startRestoreExecution({
      artifactId: artifact.id,
      accountId: machine.accountId,
      machineId: machine.id,
      sourceHostId: hostId,
      targetHostId: hostId,
      requestedByUserId: input.requestedByUserId ?? null,
      triggerSource: 'user_request',
      metadata: {
        machine_slug: machine.slug,
        snapshot_id: input.snapshotId,
      },
    });
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    try {
      await runner.restoreSnapshot?.(providerServerId, input.snapshotId);
      await completeRestoreExecution({
        executionId: execution.id,
        status: 'succeeded',
        result: {
          machine_id: machine.id,
          snapshot_id: input.snapshotId,
        },
      });
      return { ok: true, restore_execution_id: execution.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await completeRestoreExecution({ executionId: execution.id, status: 'failed', error: message });
      throw error;
    }
  }

  const provider = getProvider(machine.provider);
  if (!isBackupCapableProvider(provider)) throw new Error('Snapshots are not supported for this machine');
  const artifact = await ensureSnapshotArtifact({
    accountId: machine.accountId,
    machineId: machine.id,
    provider: `${machine.provider}_snapshot`,
    providerArtifactId: input.snapshotId,
    backupKind: 'user_snapshot',
    inventoryScope: 'customer',
    storageScope: 'host_local',
    sourceMachineSlug: machine.slug,
    metadata: {
      machine_slug: machine.slug,
      provider_server_id: providerServerId,
    },
    status: 'ready',
  });
  const execution = await startRestoreExecution({
    artifactId: artifact.id,
    accountId: machine.accountId,
    machineId: machine.id,
    sourceHostId: targetHostId,
    targetHostId,
    requestedByUserId: input.requestedByUserId ?? null,
    triggerSource: 'user_request',
    metadata: {
      machine_slug: machine.slug,
      snapshot_id: input.snapshotId,
    },
  });
  try {
    await provider.restoreBackup(providerServerId, input.snapshotId);
    await completeRestoreExecution({
      executionId: execution.id,
      status: 'succeeded',
      result: {
        machine_id: machine.id,
        snapshot_id: input.snapshotId,
      },
    });
    return { ok: true, restore_execution_id: execution.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeRestoreExecution({ executionId: execution.id, status: 'failed', error: message });
    throw error;
  }
}

export async function deleteSnapshotV2(input: { accountId: string; machineId: string; snapshotId: string }) {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');
  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    await runner.deleteSnapshot?.(providerServerId, input.snapshotId);
    await markSnapshotArtifactDeleted({ provider: 'baremetal_runner_snapshot', providerArtifactId: input.snapshotId });
    return { ok: true };
  }

  const provider = getProvider(machine.provider);
  if (!isBackupCapableProvider(provider)) throw new Error('Snapshots are not supported for this machine');
  await provider.deleteBackup(input.snapshotId);
  await markSnapshotArtifactDeleted({ provider: `${machine.provider}_snapshot`, providerArtifactId: input.snapshotId });
  return { ok: true };
}
