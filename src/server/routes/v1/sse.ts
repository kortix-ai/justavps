import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { machines } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { eventBus, type MachineEvent } from '../../lib/event-bus';

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

    if (machine.status === 'ready' || machine.status === 'error' || machine.status === 'deleted') {
      await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
      return;
    }

    let resolved = false;

    const listener = async (event: MachineEvent) => {
      if (resolved) return;
      try {
        await stream.writeSSE({
          data: JSON.stringify({
            id: machine!.id,
            slug: machine!.slug,
            event: event.event,
            status: event.status,
            provisioning_stage: event.stage,
            message: event.message,
            ip: machine!.ip,
            timestamp: event.timestamp,
          }),
          event: event.event === 'stage_changed' ? 'stage' : 'status',
        });

        if (event.event === 'status_changed' && (event.status === 'ready' || event.status === 'error' || event.status === 'deleted')) {
          resolved = true;
          await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
          cleanup();
        }
      } catch {
        resolved = true;
        cleanup();
      }
    };

    const cleanup = () => {
      eventBus.offMachine(id, listener);
    };

    eventBus.onMachine(id, listener);

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stream.writeSSE({ data: JSON.stringify({ done: true, reason: 'timeout' }), event: 'done' }).catch(() => {});
        cleanup();
      }
    }, 10 * 60 * 1000);

    const keepalive = setInterval(() => {
      if (resolved) {
        clearInterval(keepalive);
        return;
      }
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => {
        resolved = true;
        cleanup();
      });
    }, 30_000);

    stream.onAbort(() => {
      resolved = true;
      clearTimeout(timeout);
      clearInterval(keepalive);
      cleanup();
    });

    while (!resolved) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    clearTimeout(timeout);
    clearInterval(keepalive);
  });
});
