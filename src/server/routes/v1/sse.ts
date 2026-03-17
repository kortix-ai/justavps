/**
 * SSE endpoint — streams machine provisioning status.
 *
 * Vercel-compatible: polls the DB (machine_events table) instead of
 * relying on in-memory EventEmitter. The frontend also polls via
 * React Query, so this SSE endpoint is a progressive enhancement.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, gt, and } from 'drizzle-orm';
import { db } from '../../db';
import { machines, machineEvents } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';

export const sseApp = new Hono<{ Variables: AuthVariables }>();
sseApp.use('*', apiGuard);

sseApp.get('/:id/status/stream', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  return streamSSE(c, async (stream) => {
    let machine: typeof machines.$inferSelect | undefined;
    try {
      const [row] = await db.select().from(machines).where(eq(machines.id, id));
      if (!row || row.ownerId !== ownerId) {
        await stream.writeSSE({ data: JSON.stringify({ error: 'not_found' }), event: 'error' });
        return;
      }
      machine = row;
    } catch {
      await stream.writeSSE({ data: JSON.stringify({ error: 'db_unavailable' }), event: 'error' });
      return;
    }

    // Send current status
    await stream.writeSSE({
      data: JSON.stringify({
        id: machine.id,
        slug: machine.slug,
        status: machine.status,
        provisioning_stage: machine.provisioningStage,
        ip: machine.ip,
        ready_at: machine.readyAt?.toISOString() ?? null,
      }),
      event: 'status',
    });

    // If already terminal, we're done
    if (machine.status === 'ready' || machine.status === 'error' || machine.status === 'deleted') {
      await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
      return;
    }

    // Poll DB for new events instead of in-memory listener
    let resolved = false;
    let lastEventTime = new Date();
    const POLL_INTERVAL_MS = 2_000;
    const MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes
    const startTime = Date.now();

    stream.onAbort(() => {
      resolved = true;
    });

    while (!resolved) {
      // Timeout guard
      if (Date.now() - startTime > MAX_DURATION_MS) {
        await stream.writeSSE({ data: JSON.stringify({ done: true, reason: 'timeout' }), event: 'done' }).catch(() => {});
        break;
      }

      // Poll for new events since last check
      try {
        const newEvents = await db.select()
          .from(machineEvents)
          .where(
            and(
              eq(machineEvents.machineId, id),
              gt(machineEvents.createdAt, lastEventTime),
            )
          )
          .orderBy(machineEvents.createdAt);

        for (const evt of newEvents) {
          if (resolved) break;

          const sseEvent = evt.event === 'stage_changed' ? 'stage' : 'status';
          await stream.writeSSE({
            data: JSON.stringify({
              id: machine!.id,
              slug: machine!.slug,
              event: evt.event,
              status: evt.stage,
              provisioning_stage: evt.stage,
              message: evt.message,
              timestamp: evt.createdAt.toISOString(),
            }),
            event: sseEvent,
          });

          lastEventTime = evt.createdAt;

          // Check for terminal status
          if (evt.event === 'status_changed' && (evt.stage === 'ready' || evt.stage === 'error' || evt.stage === 'deleted')) {
            resolved = true;
            await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
          }
        }

        // Also check current machine status (may have been updated by heartbeat)
        if (!resolved) {
          const [current] = await db.select({ status: machines.status, ip: machines.ip })
            .from(machines)
            .where(eq(machines.id, id));
          if (current && (current.status === 'ready' || current.status === 'error' || current.status === 'deleted')) {
            resolved = true;
            await stream.writeSSE({ data: JSON.stringify({ done: true, status: current.status }), event: 'done' });
          }
        }
      } catch (err) {
        // DB error during poll — send ping and continue
        await stream.writeSSE({ data: '', event: 'ping' }).catch(() => {
          resolved = true;
        });
      }

      if (!resolved) {
        // Send keepalive ping
        await stream.writeSSE({ data: '', event: 'ping' }).catch(() => {
          resolved = true;
        });
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }
  });
});
