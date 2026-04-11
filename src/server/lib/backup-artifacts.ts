import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db';
import { backupArtifacts, restoreExecutions } from '../db/schema';

interface EnsureSnapshotArtifactInput {
  accountId?: string | null;
  machineId: string;
  createdByUserId?: string | null;
  provider: string;
  providerArtifactId: string;
  backupKind?: 'user_snapshot' | 'operator_dr_export';
  inventoryScope?: 'customer' | 'operator';
  storageScope?: 'host_local' | 'remote_object_storage';
  displayName?: string | null;
  sourceMachineSlug?: string | null;
  sourceHostId?: string | null;
  storageUrl?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  retentionUntil?: Date | null;
  metadata?: Record<string, unknown>;
  status?: 'creating' | 'ready' | 'failed' | 'deleted';
}

export function baremetalSnapshotStorageUrl(hostId: string, instanceId: string, snapshotId: string) {
  return `incus-snapshot://${hostId}/${instanceId}/${snapshotId}`;
}

export async function ensureSnapshotArtifact(input: EnsureSnapshotArtifactInput) {
  const now = new Date();
  const existing = await db.select().from(backupArtifacts).where(and(
    eq(backupArtifacts.provider, input.provider),
    eq(backupArtifacts.providerArtifactId, input.providerArtifactId),
  )).limit(1).then((rows) => rows[0] ?? null);

  const patch = {
    accountId: input.accountId ?? null,
    machineId: input.machineId,
    createdByUserId: input.createdByUserId ?? null,
    artifactType: 'machine_snapshot',
    backupKind: input.backupKind ?? 'user_snapshot',
    inventoryScope: input.inventoryScope ?? 'customer',
    storageScope: input.storageScope ?? 'host_local',
    displayName: input.displayName ?? null,
    provider: input.provider,
    providerArtifactId: input.providerArtifactId,
    sourceMachineSlug: input.sourceMachineSlug ?? null,
    sourceHostId: input.sourceHostId ?? null,
    storageUrl: input.storageUrl ?? null,
    sizeBytes: input.sizeBytes ?? null,
    checksum: input.checksum ?? null,
    retentionUntil: input.retentionUntil ?? null,
    lastVerifiedAt: now,
    metadata: input.metadata ?? {},
    status: input.status ?? 'ready',
    updatedAt: now,
    completedAt: (input.status ?? 'ready') === 'ready' ? now : null,
  } as const;

  if (existing) {
    const [updated] = await db.update(backupArtifacts).set({
      ...patch,
      accountId: input.accountId ?? existing.accountId,
      createdByUserId: input.createdByUserId ?? existing.createdByUserId,
      displayName: input.displayName ?? existing.displayName,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
    }).where(eq(backupArtifacts.id, existing.id)).returning();
    return updated ?? existing;
  }

  const [created] = await db.insert(backupArtifacts).values({
    ...patch,
    createdAt: now,
  }).returning();
  if (!created) throw new Error(`Failed to persist backup artifact ${input.providerArtifactId}`);
  return created;
}

export async function startRestoreExecution(input: {
  artifactId: string;
  accountId?: string | null;
  machineId?: string | null;
  sourceHostId?: string | null;
  targetHostId?: string | null;
  requestedByUserId?: string | null;
  triggerSource?: 'user_request' | 'operator_drill' | 'system_recovery';
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  const [execution] = await db.insert(restoreExecutions).values({
    artifactId: input.artifactId,
    accountId: input.accountId ?? null,
    machineId: input.machineId ?? null,
    sourceHostId: input.sourceHostId ?? null,
    targetHostId: input.targetHostId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
    executionType: 'snapshot_restore',
    triggerSource: input.triggerSource ?? 'user_request',
    status: 'running',
    metadata: input.metadata ?? {},
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning();

  if (!execution) throw new Error(`Failed to create restore execution for artifact ${input.artifactId}`);
  return execution;
}

export async function completeRestoreExecution(input: {
  executionId: string;
  status: 'succeeded' | 'failed';
  error?: string | null;
  result?: Record<string, unknown>;
}) {
  const now = new Date();
  const [existing] = await db.select({
    artifactId: restoreExecutions.artifactId,
    startedAt: restoreExecutions.startedAt,
  }).from(restoreExecutions).where(eq(restoreExecutions.id, input.executionId)).limit(1);

  const durationMs = existing?.startedAt
    ? Math.max(0, now.getTime() - existing.startedAt.getTime())
    : null;

  await db.update(restoreExecutions).set({
    status: input.status,
    error: input.error ?? null,
    result: input.result ?? null,
    completedAt: now,
    durationMs,
    updatedAt: now,
  }).where(eq(restoreExecutions.id, input.executionId));

  if (input.status === 'succeeded' && existing?.artifactId) {
    await db.update(backupArtifacts).set({
      lastRestoreAt: now,
      updatedAt: now,
      restoreCount: sql`${backupArtifacts.restoreCount} + 1`,
    }).where(eq(backupArtifacts.id, existing.artifactId));
  }
}

export async function markSnapshotArtifactDeleted(input: {
  provider: string;
  providerArtifactId: string;
}) {
  const now = new Date();
  await db.update(backupArtifacts).set({
    status: 'deleted',
    updatedAt: now,
    metadata: sql`COALESCE(${backupArtifacts.metadata}, '{}'::jsonb) || jsonb_build_object('deleted_at', ${now.toISOString()})`,
  }).where(and(
    eq(backupArtifacts.provider, input.provider),
    eq(backupArtifacts.providerArtifactId, input.providerArtifactId),
  ));
}
