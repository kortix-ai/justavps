/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db } from "@/server/db/index";
import { controlPlaneJobs, webhookDeliveries, webhooks, type ControlPlaneJobRow } from "@/server/db/schema";
import {
  registerControlPlaneJobHandler,
  type ControlPlaneJobHandlerResult,
} from "@/server/platform/control-plane/jobs";
import { runWebhookDispatcherServicePass } from "@/server/platform/control-plane/webhook-dispatcher";
import type { MachineEvent } from "@/server/core/event-bus";

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [10_000, 60_000, 300_000];
const WEBHOOK_PAYLOAD_VERSION = 1;
const WEBHOOK_DELIVER_JOB_TYPE = 'webhook_deliver' as const;
const WEBHOOK_DELIVERY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function isTestEnvironment() {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

function rowsFromExecute<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

type WebhookJobPayload = {
  deliveryId: string;
};

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function retryDelayForAttempt(attempt: number): number {
  return RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
}

function truncateText(value: string | null, maxLength: number) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated]`;
}

function buildWebhookPayload(event: MachineEvent): Record<string, unknown> {
  return {
    event: `machine.${event.event}`,
    data: event,
    delivered_at: new Date().toISOString(),
  };
}

async function fetchActiveWebhookTargets(accountId: string, eventType: string) {
  const hooks = await db
    .select({ id: webhooks.id, url: webhooks.url, secret: webhooks.secret, events: webhooks.events })
    .from(webhooks)
    .where(and(eq(webhooks.accountId, accountId), eq(webhooks.active, true)));

  return hooks.filter((hook) => {
    const subscribedEvents = hook.events as string[];
    return subscribedEvents.includes('*') || subscribedEvents.includes(eventType);
  });
}

async function markDeliveryAttempting(deliveryId: string, attempt: number, startedAt: Date) {
  await db.update(webhookDeliveries)
    .set({
      status: 'delivering',
      attempt,
      lastAttemptAt: startedAt,
      nextAttemptAt: null,
      deliveredAt: null,
      deadLetteredAt: null,
      success: false,
      error: null,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

async function markDeliveryDelivered(params: {
  deliveryId: string;
  webhookId: string;
  attempt: number;
  statusCode: number | null;
  responseBody: string | null;
  durationMs: number;
  completedAt: Date;
}) {
  await db.update(webhookDeliveries)
    .set({
      status: 'delivered',
      attempt: params.attempt,
      nextAttemptAt: null,
      statusCode: params.statusCode,
      responseBody: params.responseBody,
      durationMs: params.durationMs,
      success: true,
      error: null,
      deliveredAt: params.completedAt,
      deadLetteredAt: null,
    })
    .where(eq(webhookDeliveries.id, params.deliveryId));

  await db.update(webhooks)
    .set({
      failureCount: 0,
      lastDeliveredAt: params.completedAt,
    })
    .where(eq(webhooks.id, params.webhookId))
    .catch(() => {});
}

async function markDeliveryForRetry(params: {
  deliveryId: string;
  webhookId: string;
  attempt: number;
  nextAttemptAt: Date;
  statusCode: number | null;
  responseBody: string | null;
  durationMs: number;
  error: string;
}) {
  await db.update(webhookDeliveries)
    .set({
      status: 'retry_waiting',
      attempt: params.attempt,
      nextAttemptAt: params.nextAttemptAt,
      statusCode: params.statusCode,
      responseBody: params.responseBody,
      durationMs: params.durationMs,
      success: false,
      error: params.error,
      deliveredAt: null,
      deadLetteredAt: null,
    })
    .where(eq(webhookDeliveries.id, params.deliveryId));

  await db.update(webhooks)
    .set({ failureCount: sql`${webhooks.failureCount} + 1` })
    .where(eq(webhooks.id, params.webhookId))
    .catch(() => {});
}

async function markDeliveryDeadLettered(params: {
  deliveryId: string;
  webhookId: string | null;
  attempt: number;
  statusCode: number | null;
  responseBody: string | null;
  durationMs: number;
  error: string;
  completedAt: Date;
}) {
  await db.update(webhookDeliveries)
    .set({
      status: 'dead_lettered',
      attempt: params.attempt,
      nextAttemptAt: null,
      statusCode: params.statusCode,
      responseBody: params.responseBody,
      durationMs: params.durationMs,
      success: false,
      error: params.error,
      deliveredAt: null,
      deadLetteredAt: params.completedAt,
    })
    .where(eq(webhookDeliveries.id, params.deliveryId));

  if (params.webhookId) {
    await db.update(webhooks)
      .set({ failureCount: sql`${webhooks.failureCount} + 1` })
      .where(eq(webhooks.id, params.webhookId))
      .catch(() => {});
  }
}

async function handleWebhookDeliveryJob(job: ControlPlaneJobRow): Promise<ControlPlaneJobHandlerResult> {
  const payload = (job.payload ?? {}) as Partial<WebhookJobPayload>;
  if (!payload.deliveryId) {
    return {
      status: 'dead_lettered',
      error: 'Webhook delivery job missing deliveryId payload',
    };
  }

  const deliveryRows = await db.select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, payload.deliveryId))
    .limit(1);
  const delivery = deliveryRows[0];

  if (!delivery) {
    return {
      status: 'dead_lettered',
      error: `Webhook delivery ${payload.deliveryId} not found`,
    };
  }

  if (delivery.status === 'delivered') {
    return {
      status: 'succeeded',
      result: { noop: true, reason: 'already_delivered' },
    };
  }

  if (delivery.status === 'dead_lettered') {
    return {
      status: 'dead_lettered',
      error: delivery.error ?? 'Webhook delivery already dead-lettered',
      result: { noop: true, reason: 'already_dead_lettered' },
    };
  }

  const webhookRows = await db.select()
    .from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId))
    .limit(1);
  const hook = webhookRows[0];

  if (!hook || !hook.active) {
    const completedAt = new Date();
    await markDeliveryDeadLettered({
      deliveryId: delivery.id,
      webhookId: hook?.id ?? null,
      attempt: job.attempt,
      statusCode: delivery.statusCode,
      responseBody: delivery.responseBody,
      durationMs: delivery.durationMs ?? 0,
      error: 'Webhook no longer exists or is inactive',
      completedAt,
    });

    return {
      status: 'dead_lettered',
      error: 'Webhook no longer exists or is inactive',
    };
  }

  const attempt = job.attempt + 1;
  const startedAt = new Date();
  await markDeliveryAttempting(delivery.id, attempt, startedAt);

  const payloadString = JSON.stringify(delivery.payload);
  const signature = signPayload(payloadString, hook.secret);

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let success = false;
  let error: string | null = null;

  try {
    const response = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JustAVPS-Signature': signature,
        'X-JustAVPS-Event': delivery.eventType,
        'X-JustAVPS-Payload-Version': String(delivery.payloadVersion),
      },
      body: payloadString,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    statusCode = response.status;
    responseBody = truncateText(await response.text().catch(() => null), 2_000);
    success = response.ok;
    if (!response.ok) {
      error = `HTTP ${response.status}`;
    }
  } catch (err: any) {
    error = truncateText(err?.message ?? 'Unknown error', 500);
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  if (success) {
    await markDeliveryDelivered({
      deliveryId: delivery.id,
      webhookId: hook.id,
      attempt,
      statusCode,
      responseBody,
      durationMs,
      completedAt,
    });

    return {
      status: 'succeeded',
      result: {
        deliveryId: delivery.id,
        webhookId: hook.id,
        statusCode,
        durationMs,
      },
    };
  }

  const safeError = error ?? 'Webhook delivery failed';
  if (attempt < job.maxAttempts) {
    const nextAttemptAt = new Date(completedAt.getTime() + retryDelayForAttempt(attempt));
    await markDeliveryForRetry({
      deliveryId: delivery.id,
      webhookId: hook.id,
      attempt,
      nextAttemptAt,
      statusCode,
      responseBody,
      durationMs,
      error: safeError,
    });

    return {
      status: 'retry',
      error: safeError,
      runAfter: nextAttemptAt,
      result: {
        deliveryId: delivery.id,
        webhookId: hook.id,
        statusCode,
        durationMs,
      },
    };
  }

  await markDeliveryDeadLettered({
    deliveryId: delivery.id,
    webhookId: hook.id,
    attempt,
    statusCode,
    responseBody,
    durationMs,
    error: safeError,
    completedAt,
  });

  return {
    status: 'dead_lettered',
    error: safeError,
    result: {
      deliveryId: delivery.id,
      webhookId: hook.id,
      statusCode,
      durationMs,
    },
  };
}

registerControlPlaneJobHandler(WEBHOOK_DELIVER_JOB_TYPE, {
  handle: handleWebhookDeliveryJob,
});

export async function deliverWebhooks(accountId: string, event: MachineEvent): Promise<void> {
  const eventType = `machine.${event.event}`;

  let hooks: Awaited<ReturnType<typeof fetchActiveWebhookTargets>>;
  try {
    hooks = await fetchActiveWebhookTargets(accountId, eventType);
  } catch (err) {
    console.error('[WEBHOOKS] Failed to fetch webhooks:', err);
    return;
  }

  if (hooks.length === 0) return;

  const payload = buildWebhookPayload(event);

  for (const hook of hooks) {
    try {
      await db.transaction(async (tx) => {
        const [delivery] = await tx.insert(webhookDeliveries).values({
          webhookId: hook.id,
          eventType,
          payload,
          payloadVersion: WEBHOOK_PAYLOAD_VERSION,
          status: 'queued',
          attempt: 0,
          nextAttemptAt: new Date(),
          success: false,
        }).returning();

        if (!delivery) {
          throw new Error(`Failed to create webhook delivery row for webhook ${hook.id}`);
        }

        await tx.insert(controlPlaneJobs).values({
          jobType: WEBHOOK_DELIVER_JOB_TYPE,
          subjectType: 'webhook_delivery',
          subjectId: delivery.id,
          status: 'queued',
          priority: 100,
          attempt: 0,
          maxAttempts: MAX_RETRIES,
          runAfter: new Date(),
          idempotencyKey: `webhook_delivery:${delivery.id}`,
          payload: { deliveryId: delivery.id },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
    } catch (err) {
      console.error(`[WEBHOOKS] Failed to enqueue delivery for webhook ${hook.id}:`, err);
    }
  }

  if (!isTestEnvironment()) {
    void runWebhookDispatcherServicePass({ limit: hooks.length }).catch((error) => {
      console.error('[WEBHOOKS] failed to kick webhook dispatcher service pass:', error);
    });
  }
}

export async function pruneTerminalWebhookDeliveries(input?: {
  now?: Date;
  limit?: number;
}) {
  const now = input?.now ?? new Date();
  const limit = input?.limit ?? 1000;
  const cutoff = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_MS).toISOString();

  const result = await db.execute(sql<{ id: string }>`
    with expired as (
      select ${webhookDeliveries.id}
      from ${webhookDeliveries}
      where ${webhookDeliveries.status} in ('delivered', 'dead_lettered')
        and coalesce(${webhookDeliveries.deliveredAt}, ${webhookDeliveries.deadLetteredAt}, ${webhookDeliveries.lastAttemptAt}, ${webhookDeliveries.createdAt}) < ${cutoff}::timestamp
      order by coalesce(${webhookDeliveries.deliveredAt}, ${webhookDeliveries.deadLetteredAt}, ${webhookDeliveries.lastAttemptAt}, ${webhookDeliveries.createdAt}) asc
      limit ${limit}
    )
    delete from ${webhookDeliveries}
    using expired
    where ${webhookDeliveries.id} = expired.id
    returning ${webhookDeliveries.id}
  `);

  const deletedRows = rowsFromExecute<{ id: string }>(result);

  return deletedRows.length;
}

export const webhookDeliveryInternals = {
  buildWebhookPayload,
  handleWebhookDeliveryJob,
  retryDelayForAttempt,
  signPayload,
  truncateText,
};
