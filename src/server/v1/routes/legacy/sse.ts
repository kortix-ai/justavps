import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { eq, gt, and } from 'drizzle-orm';

import { db } from '@/server/db';
import { machines, machineEvents } from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { getProvider } from "@/server/platform/providers/index";
import { updateProviderMeta } from "@/server/platform/provider-meta";

export const sseApp = new OpenAPIHono<{ Variables: AuthVariables }>();
sseApp.use('*', apiGuard);

const streamMachineStatusRoute = createRoute({
  method: 'get',
  path: '/{id}/status/stream',
  tags: ['Machines'],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }] as const,
  summary: 'Stream machine status (SSE)',
  description: 'Opens a Server-Sent Events stream for real-time provisioning updates.\n\n**Event types:** `status`, `stage`, `done`, `ping`, `error`\n\nAuto-closes on terminal state or after 10 minutes.',
  request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Machine ID' }) }) },
  responses: {
    200: { description: 'SSE stream', content: { 'text/event-stream': { schema: z.string() } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: z.object({ error: z.boolean(), message: z.string(), status: z.number() }) } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: z.object({ error: z.boolean(), message: z.string(), status: z.number() }) } } },
  },
});

function readProgress(meta: Record<string, unknown> | null | undefined) {
  const v = (meta ?? {}) as Record<string, unknown>;
  return {
    provider_progress: typeof v.create_progress === 'number' ? v.create_progress : null,
    provider_status: typeof v.create_status === 'string' ? v.create_status : null,
  };
}

function readActionId(machine: typeof machines.$inferSelect) {
  const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
  return machine.createActionId ?? (typeof meta.create_action_id === 'string' ? meta.create_action_id : null);
}

function isTerminal(status: string) {
  return status === 'ready' || status === 'error' || status === 'deleted';
}

function machineSnapshot(m: typeof machines.$inferSelect) {
  return JSON.stringify({
    status: m.status,
    provisioning_stage: m.provisioningStage,
    ip: m.ip,
    ready_at: m.readyAt?.toISOString() ?? null,
    ...readProgress(m.providerMeta),
  });
}

sseApp.openapi(streamMachineStatusRoute, async (c) => {
  const id = c.req.valid('param').id;
  const accountId = c.get('accountId');

  return streamSSE(c, async (stream) => {
    let machine: typeof machines.$inferSelect | undefined;
    try {
      const [row] = await db.select().from(machines).where(eq(machines.id, id));
      if (!row || row.accountId !== accountId) {
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
        ...readProgress(machine.providerMeta),
      }),
      event: 'status',
    });

    if (isTerminal(machine.status)) {
      await stream.writeSSE({ data: JSON.stringify({ done: true, status: machine.status }), event: 'done' });
      return;
    }

    const POLL_MS = 2_000;
    const MAX_MS = 10 * 60 * 1000;
    const startTime = Date.now();
    let resolved = false;
    let lastEventTime = new Date();
    let lastSnapshot = machineSnapshot(machine);
    const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
    let hetznerDone = meta.create_status === 'success' || (meta.create_progress as number) === 100;

    stream.onAbort(() => { resolved = true; });

    while (!resolved) {
      if (Date.now() - startTime > MAX_MS) {
        await stream.writeSSE({ data: JSON.stringify({ done: true, reason: 'timeout' }), event: 'done' }).catch(() => {});
        break;
      }

      try {
        const newEvents = await db.select().from(machineEvents).where(and(eq(machineEvents.machineId, id), gt(machineEvents.createdAt, lastEventTime))).orderBy(machineEvents.createdAt);
        for (const evt of newEvents) {
          if (resolved) break;
          const isStageChange = evt.event === 'stage_changed';
          await stream.writeSSE({
            data: JSON.stringify({
              id: machine!.id,
              slug: machine!.slug,
              event: evt.event,
              stage: isStageChange ? evt.stage : undefined,
              status: isStageChange ? machine!.status : (evt.stage ?? machine!.status),
              provisioning_stage: isStageChange ? evt.stage : null,
              message: evt.message,
              timestamp: evt.createdAt.toISOString(),
            }),
            event: isStageChange ? 'stage' : 'status',
          });
          lastEventTime = evt.createdAt;

          if (!isStageChange && isTerminal(evt.stage ?? '')) {
            resolved = true;
            await stream.writeSSE({ data: JSON.stringify({ done: true, status: evt.stage }), event: 'done' });
          }
        }

        if (resolved) break;

        if (!hetznerDone && machine!.provider === 'cloud') {
          const actionId = readActionId(machine!);
          if (actionId) {
            try {
              const provider = getProvider(machine!.provider);
              if (provider.getActionProgress) {
                const action = await provider.getActionProgress(actionId);
                if (action.status === 'success' || action.progress === 100) hetznerDone = true;
                await updateProviderMeta(machine!.id, { create_status: action.status, create_progress: action.progress });
              }
            } catch {
              // ignore provider hiccup; try next cycle
            }
          }
        }

        const [current] = await db.select().from(machines).where(eq(machines.id, id));
        if (current) {
          machine = current;
          const snap = machineSnapshot(current);
          if (snap !== lastSnapshot) {
            lastSnapshot = snap;
            await stream.writeSSE({
              data: JSON.stringify({
                id: current.id,
                slug: current.slug,
                status: current.status,
                provisioning_stage: current.provisioningStage,
                ip: current.ip,
                ready_at: current.readyAt?.toISOString() ?? null,
                ...readProgress(current.providerMeta),
              }),
              event: 'status',
            });
          }

          if (isTerminal(current.status)) {
            resolved = true;
            await stream.writeSSE({ data: JSON.stringify({ done: true, status: current.status }), event: 'done' });
          }
        }
      } catch {
        await stream.writeSSE({ data: '', event: 'ping' }).catch(() => { resolved = true; });
      }

      if (!resolved) {
        await stream.writeSSE({ data: '', event: 'ping' }).catch(() => { resolved = true; });
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
  });
});
