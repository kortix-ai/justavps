import { randomUUID } from 'crypto';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { controlPlaneServiceStates, type ControlPlaneServiceStateRow } from '@/server/db/schema';

export const CONTROL_PLANE_SERVICE_IDS = ['allocator', 'provisioner', 'telemetry', 'routing', 'watchdog', 'fleet_auditor', 'webhook_dispatcher', 'auth_cache'] as const;
export type ControlPlaneServiceId = (typeof CONTROL_PLANE_SERVICE_IDS)[number];
export const CONTROL_PLANE_SERVICE_STALE_AFTER_MS = 10 * 60 * 1000;

export const CONTROL_PLANE_SERVICE_PROFILES: Record<ControlPlaneServiceId, { critical: boolean; mode: 'event_driven' | 'periodic'; description: string }> = {
  allocator: {
    critical: false,
    mode: 'event_driven',
    description: 'Makes placement and reservation decisions during machine create requests.',
  },
  provisioner: {
    critical: true,
    mode: 'periodic',
    description: 'Executes durable machine lifecycle jobs from the control-plane queue.',
  },
  telemetry: {
    critical: true,
    mode: 'periodic',
    description: 'Maintains telemetry retention and rollup hygiene.',
  },
  routing: {
    critical: true,
    mode: 'periodic',
    description: 'Repairs machine routing state and public access-plane metadata.',
  },
  watchdog: {
    critical: true,
    mode: 'periodic',
    description: 'Monitors machines for heartbeat and security issues.',
  },
  fleet_auditor: {
    critical: true,
    mode: 'periodic',
    description: 'Reconciles fleet state, orphans, and capacity history.',
  },
  webhook_dispatcher: {
    critical: true,
    mode: 'periodic',
    description: 'Delivers queued webhooks and prunes terminal delivery records.',
  },
  auth_cache: {
    critical: true,
    mode: 'periodic',
    description: 'Repairs Worker-side API key auth cache entries in Cloudflare KV.',
  },
};

type ServiceStateExecutor = Pick<typeof db, 'insert' | 'update' | 'select' | 'execute'>;

function rowsFromExecute<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

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

  const claimedRows = rowsFromExecute<{ id: string }>(result);
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
  lastStartedAt?: Date | null;
  lastCompletedAt?: Date | null;
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
      ...(input.lastStartedAt !== undefined ? { lastStartedAt: input.lastStartedAt } : {}),
      ...(input.lastCompletedAt !== undefined ? { lastCompletedAt: input.lastCompletedAt } : {}),
      updatedAt: at,
    })
    .where(and(
      eq(controlPlaneServiceStates.service, input.service),
      eq(controlPlaneServiceStates.scope, scope),
    ));
}

export async function listControlPlaneServiceStates(input?: {
  service?: ControlPlaneServiceId;
  scope?: string;
  executor?: Pick<typeof db, 'select'>;
}) {
  const executor = input?.executor ?? db;
  const rows = await executor.select().from(controlPlaneServiceStates);
  return rows.filter((row) => {
    if (input?.service && row.service !== input.service) return false;
    if (input?.scope && row.scope !== serviceScope(input.scope)) return false;
    return true;
  });
}

export function isControlPlaneServiceStale(row: Pick<ControlPlaneServiceStateRow, 'leaseOwner' | 'leaseExpiresAt' | 'lastCompletedAt' | 'lastStartedAt'>, now = Date.now()) {
  if (
    row.leaseOwner
    && row.leaseExpiresAt
    && row.leaseExpiresAt.getTime() > now
    && row.lastStartedAt
    && now - row.lastStartedAt.getTime() <= CONTROL_PLANE_SERVICE_STALE_AFTER_MS
  ) {
    return false;
  }
  return !row.lastCompletedAt || now - row.lastCompletedAt.getTime() > CONTROL_PLANE_SERVICE_STALE_AFTER_MS;
}
