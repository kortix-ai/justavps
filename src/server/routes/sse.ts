/**
 * Server-Sent Events — provisioning status push.
 * Dashboard subscribes to GET /v1/machines/:id/status/stream
 * and receives events as the machine transitions provisioning → ready.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { machines } from '../db/schema';
import { apiGuard, type AuthVariables } from '../lib/api-guard';

export const sseApp = new Hono<{ Variables: AuthVariables }>();
sseApp.use('*', apiGuard);

sseApp.get('/:id/status/stream', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  return streamSSE(c, async (stream) => {
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5s intervals)

    while (attempts < maxAttempts) {
      try {
        const [machine] = await db.select().from(machines).where(eq(machines.id, id));

        if (!machine || machine.ownerId !== ownerId) {
          await stream.writeSSE({ data: JSON.stringify({ error: 'not_found' }), event: 'error' });
          break;
        }

        await stream.writeSSE({
          data: JSON.stringify({
            id: machine.id,
            slug: machine.slug,
            status: machine.status,
            ip: machine.ip,
            ready_at: machine.readyAt?.toISOString() ?? null,
          }),
          event: 'status',
        });

        if (machine.status === 'ready' || machine.status === 'error' || machine.status === 'deleted') {
          break;
        }
      } catch (err) {
        // DB not available — emit placeholder
        await stream.writeSSE({
          data: JSON.stringify({ status: 'provisioning', message: 'Waiting for DB...' }),
          event: 'status',
        });
      }

      await new Promise(r => setTimeout(r, 5000));
      attempts++;
    }

    await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
  });
});
