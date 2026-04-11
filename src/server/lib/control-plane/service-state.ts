import { randomUUID } from 'crypto';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { controlPlaneServiceStates, type ControlPlaneServiceStateRow } from '@/server/db/schema';

export const CONTROL_PLANE_SERVICE_IDS = ['allocator', 'provisioner', 'telemetry', 'routing'] as const;
export type ControlPlaneServiceId = (typeof CONTROL_PLANE_SERVICE_IDS)[number];

type ServiceStateExecutor = Pick<typeof db, 'insert' | 'update' | 'select' | 'execute'>;

export interface ControlPlaneLeaseTarget {
  service: ControlPlaneServiceId;
  scope?: string;
}

export interface ControlPlaneLeaseResult {
  acquired: boolean;
  row: ControlPlaneServiceStateRow | null;
  leaseOwner: string;
}

function serviceScope(scope?: string) {
  return scope?.trim() || 'global';
}

export function buildControlPlaneServiceKey(target: ControlPlaneLeaseTarget) {
  return `${target.service}:${serviceScope(target.scope)}`;
}

async function ensureServiceStateRow(target: ControlPlaneLeaseTarget, executor: ServiceStateExecutor) {
  const now = new Date();
  await executor.insert(controlPlaneServiceStates)
    .values({
      service: target.service,
      scope: serviceScope(target.scope),
      checkpoint: {},
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [controlPlaneServiceStates.service, controlPlaneServiceStates.scope],
    });
}

export async function acquireControlPlaneServiceLease(input: ControlPlaneLeaseTarget & {
  leaseMs?: number;
  leaseOwner?: string;
  executor?: ServiceStateExecutor;
}) : Promise<ControlPlaneLeaseResult> {
  const executor = input.executor ?? db;
  const now = new Date();
  const scope = serviceScope(input.scope);
  const leaseOwner = input.leaseOwner ?? `${input.service}:${randomUUID()}`;
  const leaseMs = input.leaseMs ?? 30_000;
  const nowSql = now.toISOString();
  const leaseExpiresAtSql = new Date(now.getTime() + leaseMs).toISOString();

  await ensureServiceStateRow({ service: input.service, scope }, executor);

  const result = await executor.execute(sql<{ id: string }>`
    update ${controlPlaneServiceStates}
    set
      lease_owner = ${leaseOwner},
      lease_expires_at = ${leaseExpiresAtSql}::timestamp,
      last_started_at = ${nowSql}::timestamp,
      updated_at = ${nowSql}::timestamp
    where ${controlPlaneServiceStates.service} = ${input.service}
      and ${controlPlaneServiceStates.scope} = ${scope}
      and (
        ${controlPlaneServiceStates.leaseExpiresAt} is null
        or ${controlPlaneServiceStates.leaseExpiresAt} <= ${nowSql}::timestamp
        or ${controlPlaneServiceStates.leaseOwner} = ${leaseOwner}
      )
    returning ${controlPlaneServiceStates.id}
  `);

  const claimedRows = Array.isArray(result)
    ? result
    : Array.isArray(result.rows)
      ? result.rows
      : [];
  if (claimedRows.length === 0) {
    return { acquired: false, row: null, leaseOwner };
  }

  const [row] = await executor.select().from(controlPlaneServiceStates).where(and(
    eq(controlPlaneServiceStates.service, input.service),
    eq(controlPlaneServiceStates.scope, scope),
  ));

  return { acquired: true, row: row ?? null, leaseOwner };
}

export async function releaseControlPlaneServiceLease(input: ControlPlaneLeaseTarget & {
  leaseOwner: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  executor?: ServiceStateExecutor;
  completedAt?: Date;
}) {
  const executor = input.executor ?? db;
  const completedAt = input.completedAt ?? new Date();
  const scope = serviceScope(input.scope);

  await ensureServiceStateRow({ service: input.service, scope }, executor);

  const [existing] = await executor.select().from(controlPlaneServiceStates).where(and(
    eq(controlPlaneServiceStates.service, input.service),
    eq(controlPlaneServiceStates.scope, scope),
  ));

  await executor.update(controlPlaneServiceStates)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      lastCompletedAt: completedAt,
      checkpoint: input.checkpoint ? { ...((existing?.checkpoint ?? {}) as Record<string, unknown>), ...input.checkpoint } : existing?.checkpoint ?? {},
      metadata: input.metadata ? { ...((existing?.metadata ?? {}) as Record<string, unknown>), ...input.metadata } : existing?.metadata ?? {},
      updatedAt: completedAt,
    })
    .where(and(
      eq(controlPlaneServiceStates.service, input.service),
      eq(controlPlaneServiceStates.scope, scope),
      eq(controlPlaneServiceStates.leaseOwner, input.leaseOwner),
    ));
}

export async function recordControlPlaneServiceCheckpoint(input: ControlPlaneLeaseTarget & {
  checkpoint: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  executor?: ServiceStateExecutor;
  at?: Date;
}) {
  const executor = input.executor ?? db;
  const at = input.at ?? new Date();
  const scope = serviceScope(input.scope);

  await ensureServiceStateRow({ service: input.service, scope }, executor);
  const [existing] = await executor.select().from(controlPlaneServiceStates).where(and(
    eq(controlPlaneServiceStates.service, input.service),
    eq(controlPlaneServiceStates.scope, scope),
  ));

  await executor.update(controlPlaneServiceStates)
    .set({
      checkpoint: { ...((existing?.checkpoint ?? {}) as Record<string, unknown>), ...input.checkpoint },
      metadata: input.metadata ? { ...((existing?.metadata ?? {}) as Record<string, unknown>), ...input.metadata } : existing?.metadata ?? {},
      updatedAt: at,
    })
    .where(and(
      eq(controlPlaneServiceStates.service, input.service),
      eq(controlPlaneServiceStates.scope, scope),
    ));
}
