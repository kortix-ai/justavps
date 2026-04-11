import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db';
import { controlPlaneJobs, type ControlPlaneJobRow } from '../db/schema';

export const CONTROL_PLANE_JOB_TYPES = ['webhook_deliver', 'machine_create'] as const;
export type ControlPlaneJobType = (typeof CONTROL_PLANE_JOB_TYPES)[number];

export const CONTROL_PLANE_JOB_STATUSES = [
  'queued',
  'running',
  'retry_waiting',
  'succeeded',
  'dead_lettered',
  'cancelled',
] as const;

export type ControlPlaneJobStatus = (typeof CONTROL_PLANE_JOB_STATUSES)[number];

export interface EnqueueControlPlaneJobInput {
  jobType: ControlPlaneJobType;
  subjectType: string;
  subjectId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
  executor?: Pick<typeof db, 'insert' | 'select'>;
}

export type ControlPlaneJobHandlerResult =
  | { status: 'succeeded'; result?: Record<string, unknown> }
  | { status: 'retry'; error: string; runAfter: Date; result?: Record<string, unknown> }
  | { status: 'dead_lettered'; error: string; result?: Record<string, unknown> };

export interface ControlPlaneJobHandler {
  handle: (job: ControlPlaneJobRow) => Promise<ControlPlaneJobHandlerResult>;
}

const DEFAULT_CLAIM_LIMIT = 10;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

const jobHandlers = new Map<ControlPlaneJobType, ControlPlaneJobHandler>();

let workerStarted = false;
let workerTimer: NodeJS.Timeout | null = null;
let drainInFlight: Promise<void> | null = null;
const workerJobTypes = new Set<ControlPlaneJobType>();

function isControlPlaneJobType(value: string): value is ControlPlaneJobType {
  return (CONTROL_PLANE_JOB_TYPES as readonly string[]).includes(value);
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000) || 'Unknown control-plane job error';
}

function isTestEnvironment() {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

export function registerControlPlaneJobHandler(jobType: ControlPlaneJobType, handler: ControlPlaneJobHandler) {
  jobHandlers.set(jobType, handler);
}

export async function enqueueControlPlaneJob(input: EnqueueControlPlaneJobInput): Promise<ControlPlaneJobRow> {
  const executor = input.executor ?? db;
  const now = new Date();
  const runAfter = input.runAfter ?? now;
  const [inserted] = await executor.insert(controlPlaneJobs)
    .values({
      jobType: input.jobType,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: 'queued',
      priority: input.priority ?? 100,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      runAfter,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [controlPlaneJobs.jobType, controlPlaneJobs.idempotencyKey],
    })
    .returning();

  if (inserted) {
    return inserted;
  }

  const existing = await executor.select()
    .from(controlPlaneJobs)
    .where(and(
      eq(controlPlaneJobs.jobType, input.jobType),
      eq(controlPlaneJobs.idempotencyKey, input.idempotencyKey),
    ))
    .limit(1)
    .then((rows) => rows[0]);
  if (!existing) {
    throw new Error(`Failed to enqueue ${input.jobType} control-plane job`);
  }

  return existing;
}

export async function claimDueControlPlaneJobs(options?: {
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

  const claimedRows = Array.isArray(result)
    ? result
    : Array.isArray(result.rows)
      ? result.rows
      : [];
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

export function kickControlPlaneJobWorker(options?: {
  limit?: number;
  leaseMs?: number;
  jobTypes?: ControlPlaneJobType[];
}) {
  if (isTestEnvironment()) return;
  if (drainInFlight) return;

  options?.jobTypes?.forEach((jobType) => workerJobTypes.add(jobType));
  drainInFlight = processDueControlPlaneJobs(options)
    .catch((error) => {
      console.error('[CONTROL-PLANE-JOBS] Failed to process due jobs:', error);
    })
    .finally(() => {
      drainInFlight = null;
    });
}

export function ensureControlPlaneJobWorker(options?: {
  intervalMs?: number;
  limit?: number;
  leaseMs?: number;
  jobTypes?: ControlPlaneJobType[];
}) {
  if (isTestEnvironment()) return;

  options?.jobTypes?.forEach((jobType) => workerJobTypes.add(jobType));

  if (workerStarted) return;

  workerStarted = true;
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const drainOptions = () => ({
    limit: options?.limit,
    leaseMs: options?.leaseMs,
    jobTypes: workerJobTypes.size > 0 ? [...workerJobTypes] : undefined,
  });

  kickControlPlaneJobWorker(drainOptions());
  workerTimer = setInterval(() => {
    kickControlPlaneJobWorker(drainOptions());
  }, intervalMs);

  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
}

export function resetControlPlaneJobWorkerForTests() {
  if (workerTimer) {
    clearInterval(workerTimer);
  }

  workerStarted = false;
  workerTimer = null;
  drainInFlight = null;
  workerJobTypes.clear();
  jobHandlers.clear();
}
