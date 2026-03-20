/**
 * Internal routes — called by machines (agents) and Cloudflare Workers.
 * No API key auth — IP-restricted at the Cloudflare/proxy level.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { machines, apiKeys } from '../../db/schema';
import { validateApiKey } from '../../lib/crypto';
import { cloudflareClient } from '../../lib/cloudflare';
import { config } from '../../lib/config';
import { errorResponse } from '../../lib/route-helpers';
import { eventBus } from '../../lib/event-bus';
import { getLatestDaemonVersion } from '../../lib/daemon-version';
import {
  HeartbeatSchema,
  StageReportSchema,
  AckResponseSchema,
  ValidateKeyResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const internalApp = new OpenAPIHono();

// ─── POST /heartbeat — Agent heartbeat callback ─────────────────────────────

const heartbeatRoute = createRoute({
  method: 'post',
  path: '/heartbeat',
  tags: ['Internal'],
  summary: 'Agent heartbeat',
  description: 'Called by the justavps-agent on each machine every 60s. Authenticated via `machine_token` in body.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: HeartbeatSchema } },
    },
  },
  responses: {
    200: {
      description: 'Acknowledged',
      content: { 'application/json': { schema: AckResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Internal Server Error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

internalApp.openapi(heartbeatRoute, async (c) => {
  const { slug, machine_token, daemon_version, uptime, services, load } = c.req.valid('json');
  try {
    const [machine] = await db.select().from(machines).where(eq(machines.slug, slug));
    if (!machine || machine.machineToken !== machine_token) {
      return errorResponse(c, 401, 'Unauthorized') as any;
    }

    const wasProvisioning = machine.status === 'provisioning';
    await db.update(machines).set({
      lastHeartbeatAt: new Date(),
      lastHeartbeat: { cpu: load.cpu, memory: load.memory, disk: load.disk, services },
      ...(daemon_version ? { daemonVersion: daemon_version } : {}),
      ...(wasProvisioning ? { status: 'ready', readyAt: new Date() } : {}),
    }).where(eq(machines.id, machine.id));

    if (wasProvisioning) {
      await eventBus.emitStatusChange(machine.id, machine.ownerId, 'ready', 'Machine is ready');
    }
    eventBus.emitTransient({
      machineId: machine.id,
      ownerId: machine.ownerId,
      event: 'heartbeat',
      metadata: { uptime, services, load, daemon_version },
      timestamp: new Date().toISOString(),
    });

    if (wasProvisioning && config.isCloudflareConfigured() && machine.ip) {
      cloudflareClient.writeKVMachine(slug, {
        owner_id: machine.ownerId,
        ip: machine.ip,
        origin_hostname: `origin-${slug}.${config.PROXY_DOMAIN}`,
        status: 'ready',
        server_type: machine.serverType,
        platform_url: config.PLATFORM_URL,
      }).catch(() => {});
    }

    // Check if daemon needs updating
    if (daemon_version) {
      const latest = await getLatestDaemonVersion();
      if (latest && latest.version !== daemon_version) {
        return c.json({
          ack: true,
          update: { version: latest.version, url: latest.url },
        });
      }
    }

    return c.json({ ack: true });
  } catch (err) {
    console.error('[HEARTBEAT] error:', err);
    return errorResponse(c, 500, 'Failed to process heartbeat') as any;
  }
});

// ─── POST /stage — Machine reports provisioning stage ───────────────────────

const stageRoute = createRoute({
  method: 'post',
  path: '/stage',
  tags: ['Internal'],
  summary: 'Report provisioning stage',
  description: 'Called by the machine agent to report provisioning progress.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: StageReportSchema } },
    },
  },
  responses: {
    200: {
      description: 'Acknowledged',
      content: { 'application/json': { schema: AckResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Internal Server Error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

internalApp.openapi(stageRoute, async (c) => {
  const { slug, machine_token, stage, message, metadata } = c.req.valid('json');

  try {
    const [machine] = await db.select().from(machines).where(eq(machines.slug, slug));
    if (!machine || machine.machineToken !== machine_token) {
      return errorResponse(c, 401, 'Unauthorized') as any;
    }

    await eventBus.emitStageChange(machine.id, machine.ownerId, stage, message, metadata);

    console.log(`[STAGE] ${slug}: ${stage}${message ? ` — ${message}` : ''}`);
    return c.json({ ack: true });
  } catch (err) {
    console.error('[STAGE] error:', err);
    return errorResponse(c, 500, 'Failed to process stage report') as any;
  }
});

// ─── GET /validate-key — Validate API key ───────────────────────────────────

const validateKeyRoute = createRoute({
  method: 'get',
  path: '/validate-key',
  tags: ['Internal'],
  summary: 'Validate API key',
  description: 'Called by the Cloudflare Worker to validate API keys at the edge.',
  request: {
    query: z.object({
      key: z.string().openapi({ description: 'API key to validate' }),
      machine_slug: z.string().optional().openapi({ description: 'Machine slug to check ownership' }),
    }),
  },
  responses: {
    200: {
      description: 'Valid key',
      content: { 'application/json': { schema: ValidateKeyResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: {
      description: 'Invalid key',
      content: { 'application/json': { schema: ValidateKeyResponseSchema } },
    },
    403: {
      description: 'Key does not own machine',
      content: { 'application/json': { schema: ValidateKeyResponseSchema } },
    },
    503: { description: 'Service Unavailable', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-expect-error — handler returns multiple response shapes with different status codes; spec types are correctly declared above
internalApp.openapi(validateKeyRoute, async (c) => {
  const { key: keyValue, machine_slug: machineSlug } = c.req.valid('query');

  try {
    const keys = await db.select().from(apiKeys);
    for (const key of keys) {
      if (await validateApiKey(keyValue, key.keyHash)) {
        await db.update(apiKeys).set({ lastUsed: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => {});

        if (machineSlug) {
          const [machine] = await db.select().from(machines).where(eq(machines.slug, machineSlug));
          if (!machine || machine.ownerId !== key.ownerId) {
            return c.json({ valid: false, message: 'Key does not own this machine' }, 403);
          }
        }
        return c.json({ valid: true, owner_id: key.ownerId });
      }
    }
    return c.json({ valid: false }, 401);
  } catch (err) {
    return c.json({ valid: false, message: 'DB unavailable' }, 503);
  }
});
