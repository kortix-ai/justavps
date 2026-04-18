/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';

import { db } from '@/server/db';
import { machines, apiKeys } from '@/server/db/schema';
import { validateApiKey, decryptSecret } from "@/server/core/crypto";
import { config } from "@/server/core/config";
import { errorResponse } from "@/server/core/route-helpers";
import { eventBus } from "@/server/core/event-bus";
import { getLatestDaemonVersion } from "@/server/v1/services/daemon-version";
import { syncRoutingFromHeartbeatReady } from "@/server/platform/control-plane/routing";
import { ingestMachineHeartbeat } from "@/server/platform/control-plane/telemetry";
import { HetznerProvider } from "@/server/platform/providers/hetzner";
import {
  HeartbeatSchema,
  StageReportSchema,
  AckResponseSchema,
  ValidateKeyResponseSchema,
  ErrorResponseSchema,
} from '@/shared/lib/schemas';

export const internalApp = new OpenAPIHono();

const heartbeatRoute = createRoute({
  method: 'post',
  path: '/heartbeat',
  tags: ['Internal'],
  summary: 'Agent heartbeat',
  description: 'Called by the justavps-agent on each machine every 60s. Authenticated via `machine_token` in body.',
  request: { body: { required: true, content: { 'application/json': { schema: HeartbeatSchema } } } },
  responses: {
    200: { description: 'Acknowledged', content: { 'application/json': { schema: AckResponseSchema } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Internal Server Error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

internalApp.openapi(heartbeatRoute, async (c) => {
  const { slug, machine_token, daemon_version, uptime, services, load, network, security } = c.req.valid('json');
  try {
    const [machine] = await db.select().from(machines).where(eq(machines.slug, slug));
    let tokenMatch = false;
    try { tokenMatch = !!machine && decryptSecret(machine.machineToken) === machine_token; } catch {}
    if (!machine || !tokenMatch) return errorResponse(c, 401, 'Unauthorized') as any;

    const shouldMarkReady = machine.status === 'provisioning' || machine.status === 'error';
    const heartbeatAt = new Date();
    const { projectedMachinePatch } = await ingestMachineHeartbeat({
      machine,
      heartbeatAt,
      shouldMarkReady,
      payload: { daemonVersion: daemon_version, uptime, services, load, network, security },
    });

    if (security && !shouldMarkReady) {
      const alerts: string[] = [];
      if (!security.ufw_active) alerts.push('UFW firewall disabled');
      if (!security.fail2ban_active) alerts.push('fail2ban disabled');
      if (!security.ssh_key_only) alerts.push('SSH password auth enabled');
      if (alerts.length > 0) {
        eventBus.emitTransient({ machineId: machine.id, accountId: machine.accountId ?? machine.ownerId, event: 'heartbeat', metadata: { alert: 'security_tamper', details: alerts, uptime, services, load, network, security, daemon_version }, timestamp: new Date().toISOString() });
      }
    }

    if (network && !shouldMarkReady) {
      const RATE_THRESHOLD = 100 * 1024 * 1024;
      const CONN_THRESHOLD = 10_000;
      const alerts: string[] = [];
      if (network.rate_out > RATE_THRESHOLD) alerts.push(`High outbound traffic: ${(network.rate_out / 1024 / 1024).toFixed(1)} MB/s`);
      if (network.rate_in > RATE_THRESHOLD) alerts.push(`High inbound traffic: ${(network.rate_in / 1024 / 1024).toFixed(1)} MB/s`);
      if (network.connections > CONN_THRESHOLD) alerts.push(`High connection count: ${network.connections}`);
      if (alerts.length > 0) {
        eventBus.emitTransient({ machineId: machine.id, accountId: machine.accountId ?? machine.ownerId, event: 'heartbeat', metadata: { alert: 'network_anomaly', details: alerts, uptime, services, load, network, daemon_version }, timestamp: new Date().toISOString() });
      }
    }

    if (shouldMarkReady) {
      await eventBus.emitStageChange(machine.id, machine.accountId ?? machine.ownerId, 'services_starting', 'Daemon connected, services starting');
      await eventBus.emitStageChange(machine.id, machine.accountId ?? machine.ownerId, 'services_ready', 'All services ready');
      await eventBus.emitStatusChange(machine.id, machine.accountId ?? machine.ownerId, 'ready', 'Machine is ready');
    }
    eventBus.emitTransient({ machineId: machine.id, accountId: machine.accountId ?? machine.ownerId, event: 'heartbeat', metadata: { uptime, services, load, network, security, daemon_version }, timestamp: new Date().toISOString() });

    if (shouldMarkReady && config.isCloudflareConfigured() && machine.ip) {
      const providerMeta = {
        ...((machine.providerMeta ?? {}) as Record<string, unknown>),
        ...((projectedMachinePatch?.providerMeta ?? {}) as Record<string, unknown>),
      };
      syncRoutingFromHeartbeatReady({
        machineId: machine.id,
        accountId: machine.accountId ?? machine.ownerId,
        machineSlug: slug,
        machineStatus: 'ready',
        serverType: machine.serverType,
        desiredIp: machine.ip,
        desiredOriginPort: typeof providerMeta.http_port === 'number' ? providerMeta.http_port : null,
        publicIpv4: typeof providerMeta.public_ipv4 === 'string' ? providerMeta.public_ipv4 : machine.ip,
        publicIpv6: typeof providerMeta.public_ipv6 === 'string' ? providerMeta.public_ipv6 : null,
        originHostname: `origin-${slug}.${config.PROXY_DOMAIN}`,
        source: 'heartbeat_ready',
      }).catch(() => {});
    }

    if (daemon_version) {
      const latest = await getLatestDaemonVersion();
      if (latest && latest.version !== daemon_version) {
        return c.json({ ack: true, update: { version: latest.version, url: latest.url } });
      }
    }

    return c.json({ ack: true });
  } catch (err) {
    console.error('[HEARTBEAT] error:', err);
    return errorResponse(c, 500, 'Failed to process heartbeat') as any;
  }
});

const stageRoute = createRoute({
  method: 'post',
  path: '/stage',
  tags: ['Internal'],
  summary: 'Report provisioning stage',
  description: 'Called by the machine agent to report provisioning progress.',
  request: { body: { required: true, content: { 'application/json': { schema: StageReportSchema } } } },
  responses: {
    200: { description: 'Acknowledged', content: { 'application/json': { schema: AckResponseSchema } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: { description: 'Internal Server Error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

internalApp.openapi(stageRoute, async (c) => {
  const { slug, machine_token, stage, message, metadata } = c.req.valid('json');
  try {
    const [machine] = await db.select().from(machines).where(eq(machines.slug, slug));
    let tokenMatch = false;
    try { tokenMatch = !!machine && decryptSecret(machine.machineToken) === machine_token; } catch {}
    if (!machine || !tokenMatch) return errorResponse(c, 401, 'Unauthorized') as any;
    const callbackAt = new Date().toISOString();
    await db.update(machines).set({ providerMeta: { ...((machine.providerMeta ?? {}) as Record<string, unknown>), last_callback_at: callbackAt }, lastCallbackAt: callbackAt }).where(eq(machines.id, machine.id));
    await eventBus.emitStageChange(machine.id, machine.accountId ?? machine.ownerId, stage, message, metadata);
    return c.json({ ack: true });
  } catch (err) {
    console.error('[STAGE] error:', err);
    return errorResponse(c, 500, 'Failed to process stage report') as any;
  }
});

const validateKeyRoute = createRoute({
  method: 'post',
  path: '/validate-key',
  tags: ['Internal'],
  summary: 'Validate API key',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ key: z.string() }) } } } },
  responses: {
    200: { description: 'Validation result', content: { 'application/json': { schema: ValidateKeyResponseSchema } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

internalApp.openapi(validateKeyRoute, async (c) => {
  const { key } = c.req.valid('json');
  try {
    const keyHash = createHash('sha256').update(key).digest('hex');
    const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.keySha256, keyHash));
    const valid = apiKey ? await validateApiKey(key, apiKey.keyHash) : false;
    if (!valid || !apiKey) return c.json({ valid: false, account_id: null, machine_ids: [] });
    return c.json({ valid: true, account_id: apiKey?.accountId ?? null, machine_ids: apiKey?.machineIds ?? [] });
  } catch (err) {
    console.error('[VALIDATE-KEY] error:', err);
    return errorResponse(c, 500, 'Failed to validate key') as any;
  }
});

internalApp.post('/gc/ssh-keys', async (c) => {
  if (!config.HETZNER_API_KEY) return c.json({ deleted: 0, kept: 0, total: 0 }, 200);
  try {
    const provider = new HetznerProvider();
    const result = await provider.gcSSHKeys();
    return c.json(result, 200);
  } catch (err) {
    console.error('[GC SSH KEYS] error:', err);
    return c.json({ deleted: 0, kept: 0, total: 0 }, 500);
  }
});
