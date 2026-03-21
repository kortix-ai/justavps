/**
 * SSE endpoint — streams machine provisioning status.
 *
 * Vercel-compatible: polls the DB (machine_events table) instead of
 * relying on in-memory EventEmitter. The frontend also polls via
 * React Query, so this SSE endpoint is a progressive enhancement.
 *
 * NOTE: SSE routes cannot be expressed as full OpenAPIHono typed routes
 * (the response is a stream, not a typed JSON body). We register the
 * route description separately via openAPIRegistry and keep the handler
 * as a plain Hono route.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { eq, gt, and } from 'drizzle-orm';
import { db } from '../../db';
import { machines, machineEvents } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { syncMachineStatus } from '../../lib/machine-lifecycle';

export const sseApp = new OpenAPIHono<{ Variables: AuthVariables }>();
sseApp.use('*', apiGuard);

// Register the route in the OpenAPI spec (without full body typing — it's a stream)
const streamMachineStatusRoute = createRoute({
  method: 'get',
  path: '/{id}/status/stream',
  tags: ['Machines'],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }] as const,
  summary: 'Stream machine status (SSE)',
  description: 'Opens a Server-Sent Events stream for real-time provisioning updates.\n\n**Event types:** `status`, `stage`, `done`, `ping`, `error`\n\nAuto-closes on terminal state or after 10 minutes.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }),
  },
  responses: {
    200: {
      description: 'SSE stream',
      content: { 'text/event-stream': { schema: z.string() } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: z.object({ error: z.boolean(), message: z.string(), status: z.number() }) } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: z.object({ error: z.boolean(), message: z.string(), status: z.number() }) } } },
  },
});

// Use openapi() for spec registration but return a stream response
sseApp.openapi(streamMachineStatusRoute, async (c) => {
  const id = c.req.valid('param').id;
  const ownerId = c.get('userId');

  const readProvisionMeta = (meta: Record<string, unknown> | null | undefined) => {
    const value = (meta ?? {}) as Record<string, unknown>;
    return {
      provider_progress: typeof value.create_progress === 'number' ? value.create_progress : null,
      provider_status: typeof value.create_status === 'string' ? value.create_status : null,
    };
  };

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
        ...readProvisionMeta(machine.providerMeta),
      }),
      event: 'status',
    });

    if (machine.status === 'ready' || machine.status === 'error' || machine.status === 'deleted') {
      await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
      return;
    }

    let resolved = false;
    let lastEventTime = new Date();
    let lastSnapshot = JSON.stringify({
      status: machine.status,
      provisioning_stage: machine.provisioningStage,
      ip: machine.ip,
      ready_at: machine.readyAt?.toISOString() ?? null,
      ...readProvisionMeta(machine.providerMeta),
    });
    const POLL_INTERVAL_MS = 2_000;
    const MAX_DURATION_MS = 10 * 60 * 1000;
    const startTime = Date.now();

    stream.onAbort(() => {
      resolved = true;
    });

    while (!resolved) {
      if (Date.now() - startTime > MAX_DURATION_MS) {
        await stream.writeSSE({ data: JSON.stringify({ done: true, reason: 'timeout' }), event: 'done' }).catch(() => {});
        break;
      }

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

          if (evt.event === 'status_changed' && (evt.stage === 'ready' || evt.stage === 'error' || evt.stage === 'deleted')) {
            resolved = true;
            await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
          }
        }

        if (!resolved) {
          const [currentRow] = await db.select().from(machines).where(eq(machines.id, id));
          if (currentRow) {
            const current = await syncMachineStatus(currentRow);
            const snapshot = JSON.stringify({
              status: current.status,
              provisioning_stage: current.provisioningStage,
              ip: current.ip,
              ready_at: current.readyAt?.toISOString() ?? null,
              ...readProvisionMeta(current.providerMeta),
            });
            if (snapshot !== lastSnapshot) {
              lastSnapshot = snapshot;
              await stream.writeSSE({ data: snapshot, event: 'status' });
            }

            if (current.status === 'ready' || current.status === 'error' || current.status === 'deleted') {
              resolved = true;
              await stream.writeSSE({ data: JSON.stringify({ done: true, status: current.status }), event: 'done' });
            }
          }
        }
      } catch {
        await stream.writeSSE({ data: '', event: 'ping' }).catch(() => {
          resolved = true;
        });
      }

      if (!resolved) {
        await stream.writeSSE({ data: '', event: 'ping' }).catch(() => {
          resolved = true;
        });
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }
  });
});
