import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { machines } from '../../db/schema';
import { getProvider, isBackupCapableProvider } from '../providers';
import { HttpBaremetalRunnerClient } from '../baremetal/runner-client';

export interface V2Snapshot {
  id: string;
  name: string;
  created_at: string;
  status: string;
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
  const hostId = typeof meta.baremetal_host_id === 'string' ? meta.baremetal_host_id : null;
  if (!runnerBaseUrl || !hostId) throw new Error('Baremetal runner metadata is missing');
  return { runnerBaseUrl, hostId };
}

async function loadRunnerToken(hostId: string) {
  const { baremetalHosts } = await import('../../db/schema');
  const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, hostId));
  if (!host?.runnerToken) throw new Error('Baremetal host runner token missing');
  return host.runnerToken;
}

export async function listSnapshotsV2(input: { accountId: string; machineId: string }): Promise<V2Snapshot[]> {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');
  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    const snapshots = await runner.listSnapshots?.(providerServerId);
    return (snapshots ?? []).map((snapshot) => ({ id: snapshot.id, name: snapshot.name, created_at: snapshot.createdAt, status: snapshot.status }));
  }

  const provider = getProvider(machine.provider);
  if (!isBackupCapableProvider(provider)) return [];
  const backups = await provider.listBackups(providerServerId);
  return backups.map((backup) => ({
    id: backup.id,
    name: backup.description ?? backup.id,
    created_at: backup.createdAt,
    status: 'ready',
  }));
}

export async function createSnapshotV2(input: { accountId: string; machineId: string; name?: string }): Promise<V2Snapshot> {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');
  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    const snapshot = await runner.createSnapshot?.(providerServerId, input.name);
    if (!snapshot) throw new Error('Baremetal snapshots are not supported by runner');
    return { id: snapshot.id, name: snapshot.name, created_at: snapshot.createdAt, status: snapshot.status };
  }

  const provider = getProvider(machine.provider);
  if (!isBackupCapableProvider(provider)) throw new Error('Snapshots are not supported for this machine');
  const backup = await provider.createBackup(providerServerId, input.name);
  return { id: backup.id, name: input.name ?? backup.id, created_at: new Date().toISOString(), status: 'creating' };
}

export async function restoreSnapshotV2(input: { accountId: string; machineId: string; snapshotId: string }) {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');
  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    await runner.restoreSnapshot?.(providerServerId, input.snapshotId);
    return { ok: true };
  }

  const provider = getProvider(machine.provider);
  if (!isBackupCapableProvider(provider)) throw new Error('Snapshots are not supported for this machine');
  await provider.restoreBackup(providerServerId, input.snapshotId);
  return { ok: true };
}

export async function deleteSnapshotV2(input: { accountId: string; machineId: string; snapshotId: string }) {
  const machine = await loadOwnedMachine(input.machineId, input.accountId);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');
  if (machine.provider === 'baremetal') {
    const { runnerBaseUrl, hostId } = baremetalRunnerFromMachine(machine);
    const runner = new HttpBaremetalRunnerClient(runnerBaseUrl, await loadRunnerToken(hostId));
    await runner.deleteSnapshot?.(providerServerId, input.snapshotId);
    return { ok: true };
  }

  const provider = getProvider(machine.provider);
  if (!isBackupCapableProvider(provider)) throw new Error('Snapshots are not supported for this machine');
  await provider.deleteBackup(input.snapshotId);
  return { ok: true };
}
