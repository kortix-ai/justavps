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
  const { slug, machine_token, daemon_version, uptime, services, load, network, security } = c.req.valid('json');
  try {
    const [machine] = await db.select().from(machines).where(eq(machines.slug, slug));
    if (!machine || machine.machineToken !== machine_token) {
      return errorResponse(c, 401, 'Unauthorized') as any;
    }

    const wasProvisioning = machine.status === 'provisioning';
    await db.update(machines).set({
      lastHeartbeatAt: new Date(),
      lastHeartbeat: {
        cpu: load.cpu, memory: load.memory, disk: load.disk, services,
        ...(network ? { network } : {}),
        ...(security ? { security } : {}),
      },
      ...(daemon_version ? { daemonVersion: daemon_version } : {}),
      ...(wasProvisioning ? { status: 'ready', readyAt: new Date() } : {}),
    }).where(eq(machines.id, machine.id));

    // ── Security tamper detection ───────────────────────────────────────
    if (security && !wasProvisioning) {
      const alerts: string[] = [];
      if (!security.ufw_active) alerts.push('UFW firewall disabled');
      if (!security.fail2ban_active) alerts.push('fail2ban disabled');
      if (!security.ssh_key_only) alerts.push('SSH password auth enabled');
      if (alerts.length > 0) {
        console.warn(`[SECURITY] ${slug}: TAMPER DETECTED — ${alerts.join(', ')}`);
        eventBus.emitTransient({
          machineId: machine.id,
          ownerId: machine.ownerId,
          event: 'heartbeat',
          metadata: { alert: 'security_tamper', details: alerts, uptime, services, load, network, security, daemon_version },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ── Network anomaly detection ───────────────────────────────────────
    if (network && !wasProvisioning) {
      const RATE_THRESHOLD = 100 * 1024 * 1024; // 100 MB/s
      const CONN_THRESHOLD = 10_000;
      const alerts: string[] = [];
      if (network.rate_out > RATE_THRESHOLD) alerts.push(`High outbound traffic: ${(network.rate_out / 1024 / 1024).toFixed(1)} MB/s`);
      if (network.rate_in > RATE_THRESHOLD) alerts.push(`High inbound traffic: ${(network.rate_in / 1024 / 1024).toFixed(1)} MB/s`);
      if (network.connections > CONN_THRESHOLD) alerts.push(`High connection count: ${network.connections}`);
      if (alerts.length > 0) {
        console.warn(`[NETWORK] ${slug}: ANOMALY — ${alerts.join(', ')}`);
        eventBus.emitTransient({
          machineId: machine.id,
          ownerId: machine.ownerId,
          event: 'heartbeat',
          metadata: { alert: 'network_anomaly', details: alerts, uptime, services, load, network, daemon_version },
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (wasProvisioning) {
      await eventBus.emitStatusChange(machine.id, machine.ownerId, 'ready', 'Machine is ready');
    }
    eventBus.emitTransient({
      machineId: machine.id,
      ownerId: machine.ownerId,
      event: 'heartbeat',
      metadata: { uptime, services, load, network, security, daemon_version },
      timestamp: new Date().toISOString(),
    });

    if (wasProvisioning && config.isCloudflareConfigured() && machine.ip) {
      cloudflareClient.writeKVMachine(slug, {
        owner_id: machine.ownerId,
        ip: machine.ip,
        origin_hostname: `origin-${slug}.${config.PROXY_DOMAIN}`,
        status: 'ready',
        server_type: machine.serverType,
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

// ─── POST /watchdog — Platform-side machine monitoring ──────────────────────

const watchdogRoute = createRoute({
  method: 'get',
  path: '/watchdog',
  tags: ['Internal'],
  summary: 'Run machine watchdog',
  description: 'Platform-side monitoring: checks heartbeat staleness, security tampering, and Hetzner network metrics. Called via cron every 5 minutes.',
  responses: {
    200: {
      description: 'Watchdog results',
      content: {
        'application/json': {
          schema: z.object({
            checked: z.number(),
            alerts: z.number(),
            details: z.array(z.object({
              slug: z.string(),
              type: z.string(),
              details: z.array(z.string()),
            })),
          }),
        },
      },
    },
    500: { description: 'Internal Server Error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

internalApp.openapi(watchdogRoute, async (c) => {
  try {
    const { runWatchdog } = await import('../../lib/machine-watchdog');
    const alerts = await runWatchdog();

    return c.json({
      checked: true,
      alerts: alerts.length,
      details: alerts.map((a) => ({ slug: a.slug, type: a.type, details: a.details })),
    });
  } catch (err) {
    console.error('[WATCHDOG] error:', err);
    return errorResponse(c, 500, 'Watchdog failed') as any;
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
