import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';

import { db } from "@/server/db/index";
import { controlPlaneJobs, type ControlPlaneJobRow } from "@/server/db/schema";

const CONTROL_PLANE_JOB_TYPES = ['webhook_deliver', 'machine_create'] as const;
type ControlPlaneJobType = (typeof CONTROL_PLANE_JOB_TYPES)[number];

export type ControlPlaneJobHandlerResult =
  | { status: 'succeeded'; result?: Record<string, unknown> }
  | { status: 'retry'; error: string; runAfter: Date; result?: Record<string, unknown> }
  | { status: 'dead_lettered'; error: string; result?: Record<string, unknown> };

interface ControlPlaneJobHandler {
  handle: (job: ControlPlaneJobRow) => Promise<ControlPlaneJobHandlerResult>;
}

const DEFAULT_CLAIM_LIMIT = 10;
const DEFAULT_LEASE_MS = 30_000;
const CONTROL_PLANE_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function rowsFromExecute<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

const jobHandlers = new Map<ControlPlaneJobType, ControlPlaneJobHandler>();

function isControlPlaneJobType(value: string): value is ControlPlaneJobType {
  return (CONTROL_PLANE_JOB_TYPES as readonly string[]).includes(value);
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000) || 'Unknown control-plane job error';
}

export function registerControlPlaneJobHandler(jobType: ControlPlaneJobType, handler: ControlPlaneJobHandler) {
  jobHandlers.set(jobType, handler);
}

async function claimDueControlPlaneJobs(options?: {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
  jobTypes?: ControlPlaneJobType[];
}): Promise<ControlPlaneJobRow[]> {
  const now = new Date();
  const nowSql = now.toISOString();
  const limit = options?.limit ?? DEFAULT_CLAIM_LIMIT;
  const leaseMs = options?.leaseMs ?? DEFAULT_LEASE_MS;
  const leaseOwner = options?.leaseOwner ?? `control-plane-worker:${randomUUID()}`;
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const leaseExpiresAtSql = leaseExpiresAt.toISOString();
  const jobTypes = options?.jobTypes ?? [];
  const typeFilter = jobTypes.length > 0
    ? sql`and ${controlPlaneJobs.jobType} in (${sql.join(jobTypes.map((jobType) => sql`${jobType}`), sql`, `)})`
    : sql``;

  const result = await db.execute(sql<{ id: string }>`
    with due_jobs as (
      select ${controlPlaneJobs.id}
      from ${controlPlaneJobs}
      where ${controlPlaneJobs.status} in ('queued', 'retry_waiting')
        and ${controlPlaneJobs.runAfter} <= ${nowSql}::timestamp
        and (${controlPlaneJobs.leaseExpiresAt} is null or ${controlPlaneJobs.leaseExpiresAt} <= ${nowSql}::timestamp)
        ${typeFilter}
      order by ${controlPlaneJobs.priority} desc, ${controlPlaneJobs.runAfter} asc, ${controlPlaneJobs.createdAt} asc
      limit ${limit}
      for update skip locked
    )
    update ${controlPlaneJobs}
    set
      status = 'running',
      lease_owner = ${leaseOwner},
      lease_expires_at = ${leaseExpiresAtSql}::timestamp,
      updated_at = ${nowSql}::timestamp
    from due_jobs
    where ${controlPlaneJobs.id} = due_jobs.id
    returning ${controlPlaneJobs.id}
  `);

  const claimedRows = rowsFromExecute<{ id: string }>(result);
  const claimedIds = claimedRows.map((row) => row.id);
  if (claimedIds.length === 0) return [];

  return db.select()
    .from(controlPlaneJobs)
    .where(inArray(controlPlaneJobs.id, claimedIds));
}

async function markControlPlaneJobSucceeded(
  job: ControlPlaneJobRow,
  attempt: number,
  result?: Record<string, unknown>,
) {
  const now = new Date();
  await db.update(controlPlaneJobs)
    .set({
      status: 'succeeded',
      attempt,
      result: result ?? null,
      error: null,
      lastAttemptAt: now,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(controlPlaneJobs.id, job.id));
}

async function rescheduleControlPlaneJob(
  job: ControlPlaneJobRow,
  attempt: number,
  error: string,
  runAfter: Date,
  result?: Record<string, unknown>,
) {
  const now = new Date();
  await db.update(controlPlaneJobs)
    .set({
      status: 'retry_waiting',
      attempt,
      error,
      result: result ?? null,
      runAfter,
      lastAttemptAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(controlPlaneJobs.id, job.id));
}

async function deadLetterControlPlaneJob(
  job: ControlPlaneJobRow,
  attempt: number,
  error: string,
  result?: Record<string, unknown>,
) {
  const now = new Date();
  await db.update(controlPlaneJobs)
    .set({
      status: 'dead_lettered',
      attempt,
      error,
      result: result ?? null,
      lastAttemptAt: now,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(controlPlaneJobs.id, job.id));
}

export async function processDueControlPlaneJobs(options?: {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
  jobTypes?: ControlPlaneJobType[];
}): Promise<ControlPlaneJobRow[]> {
  const claimed = await claimDueControlPlaneJobs(options);

  for (const job of claimed) {
    const attempt = job.attempt + 1;
    const jobType = job.jobType;

    if (!isControlPlaneJobType(jobType)) {
      await deadLetterControlPlaneJob(job, attempt, `Unknown control-plane job type: ${jobType}`);
      continue;
    }

    const handler = jobHandlers.get(jobType);
    if (!handler) {
      await deadLetterControlPlaneJob(job, attempt, `No handler registered for control-plane job type: ${jobType}`);
      continue;
    }

    try {
      const result = await handler.handle(job);
      if (result.status === 'succeeded') {
        await markControlPlaneJobSucceeded(job, attempt, result.result);
        continue;
      }

      if (result.status === 'retry') {
        await rescheduleControlPlaneJob(job, attempt, result.error, result.runAfter, result.result);
        continue;
      }

      await deadLetterControlPlaneJob(job, attempt, result.error, result.result);
    } catch (error) {
      const errorMessage = sanitizeErrorMessage(error);
      if (attempt < job.maxAttempts) {
        await rescheduleControlPlaneJob(job, attempt, errorMessage, new Date(), { crashed: true });
      } else {
        await deadLetterControlPlaneJob(job, attempt, errorMessage, { crashed: true });
      }
    }
  }

  return claimed;
}

export function resetControlPlaneJobWorkerForTests() {
  jobHandlers.clear();
}

export async function pruneTerminalControlPlaneJobs(input?: {
  now?: Date;
  limit?: number;
}) {
  const now = input?.now ?? new Date();
  const limit = input?.limit ?? 1000;
  const cutoff = new Date(now.getTime() - CONTROL_PLANE_JOB_RETENTION_MS).toISOString();

  const result = await db.execute(sql<{ id: string }>`
    with expired as (
      select ${controlPlaneJobs.id}
      from ${controlPlaneJobs}
      where ${controlPlaneJobs.status} in ('succeeded', 'dead_lettered', 'cancelled')
        and coalesce(${controlPlaneJobs.completedAt}, ${controlPlaneJobs.updatedAt}) < ${cutoff}::timestamp
      order by coalesce(${controlPlaneJobs.completedAt}, ${controlPlaneJobs.updatedAt}) asc
      limit ${limit}
    )
    delete from ${controlPlaneJobs}
    using expired
    where ${controlPlaneJobs.id} = expired.id
    returning ${controlPlaneJobs.id}
  `);

  const deletedRows = rowsFromExecute<{ id: string }>(result);

  return deletedRows.length;
}
