/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac } from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { webhooks, webhookDeliveries } from '../db/schema';
import type { MachineEvent } from './event-bus';

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [10_000, 60_000, 300_000];
// Auto-disable removed — webhooks stay active regardless of failures.
// Failures are still tracked in failureCount for observability.

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

async function deliverSingle(
  hook: { id: string; url: string; secret: string },
  eventType: string,
  payloadObj: Record<string, unknown>,
  attempt: number,
): Promise<void> {
  const payload = JSON.stringify(payloadObj);
  const signature = signPayload(payload, hook.secret);
  const start = Date.now();

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let success = false;
  let error: string | null = null;

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JustAVPS-Signature': signature,
        'X-JustAVPS-Event': eventType,
      },
      body: payload,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    statusCode = res.status;
    responseBody = await res.text().catch(() => null);
    if (responseBody && responseBody.length > 2000) {
      responseBody = responseBody.slice(0, 2000) + '...[truncated]';
    }
    success = res.ok;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err: any) {
    error = err.message?.slice(0, 500) || 'Unknown error';
  }

  const durationMs = Date.now() - start;

  try {
    await db.insert(webhookDeliveries).values({
      webhookId: hook.id,
      eventType,
      payload: payloadObj,
      statusCode,
      responseBody,
      durationMs,
      attempt,
      success,
      error,
    });
  } catch (dbErr) {
    console.error('[WEBHOOKS] Failed to log delivery:', dbErr);
  }

  if (success) {
    await db.update(webhooks).set({
      failureCount: 0,
      lastDeliveredAt: new Date(),
    }).where(eq(webhooks.id, hook.id)).catch(() => {});
    return;
  }

  try {
    await db.update(webhooks)
      .set({ failureCount: sql`${webhooks.failureCount} + 1` })
      .where(eq(webhooks.id, hook.id));
  } catch (dbErr) {
    console.error('[WEBHOOKS] Failed to update failure count:', dbErr);
  }

  if (attempt < MAX_RETRIES) {
    const delay = RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    setTimeout(() => {
      deliverSingle(hook, eventType, payloadObj, attempt + 1).catch(() => {});
    }, delay);
  }
}

export async function deliverWebhooks(accountId: string, event: MachineEvent): Promise<void> {
  let hooks: Array<{ id: string; url: string; secret: string; events: string[] }>;

  try {
    hooks = await db
      .select({ id: webhooks.id, url: webhooks.url, secret: webhooks.secret, events: webhooks.events })
      .from(webhooks)
      .where(and(eq(webhooks.accountId, accountId), eq(webhooks.active, true)));
  } catch (err) {
    console.error('[WEBHOOKS] Failed to fetch webhooks:', err);
    return;
  }

  if (hooks.length === 0) return;

  const eventType = `machine.${event.event}`;
  const payloadObj: Record<string, unknown> = {
    event: eventType,
    data: event,
    delivered_at: new Date().toISOString(),
  };

  const deliveries = hooks
    .filter((hook) => {
      const subscribedEvents = hook.events as string[];
      return subscribedEvents.includes('*') || subscribedEvents.includes(eventType);
    })
    .map((hook) => deliverSingle(hook, eventType, payloadObj, 1));

  await Promise.allSettled(deliveries);
}
