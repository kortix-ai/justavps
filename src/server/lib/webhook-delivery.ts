import { createHmac } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { webhooks } from '../db/schema';
import type { MachineEvent } from './event-bus';

const DELIVERY_TIMEOUT_MS = 10_000;

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function deliverWebhooks(ownerId: string, event: MachineEvent): Promise<void> {
  let hooks: Array<{ id: string; url: string; secret: string; events: string[] }>;

  try {
    hooks = await db
      .select({ id: webhooks.id, url: webhooks.url, secret: webhooks.secret, events: webhooks.events })
      .from(webhooks)
      .where(and(eq(webhooks.ownerId, ownerId), eq(webhooks.active, true)));
  } catch (err) {
    console.error('[WEBHOOKS] Failed to fetch webhooks:', err);
    return;
  }

  if (hooks.length === 0) return;

  const eventType = `machine.${event.event}`;
  const payload = JSON.stringify({
    event: eventType,
    data: event,
    delivered_at: new Date().toISOString(),
  });

  const deliveries = hooks
    .filter((hook) => {
      const subscribedEvents = hook.events as string[];
      return subscribedEvents.includes('*') || subscribedEvents.includes(eventType);
    })
    .map(async (hook) => {
      const signature = signPayload(payload, hook.secret);
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

        if (!res.ok) {
          console.warn(`[WEBHOOKS] Delivery to ${hook.url} returned ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[WEBHOOKS] Delivery to ${hook.url} failed: ${err.message?.slice(0, 100)}`);
      }
    });

  await Promise.allSettled(deliveries);
}
