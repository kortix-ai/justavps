/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq } from 'drizzle-orm';
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import { db } from '@/server/db';
import { controlPlaneServiceStates } from '@/server/db/schema';
import type { AuthVariables } from '@/server/lib/api-guard';
import { handleRouteError } from '@/server/lib/route-helpers';
import { runProvisionerServicePass } from '@/server/lib/control-plane/provisioner';
import { runWebhookDispatcherServicePass } from '@/server/lib/control-plane/webhook-dispatcher';
import { runRoutingRepairServicePass } from '@/server/lib/control-plane/routing';
import { runTelemetryRetentionServicePass } from '@/server/lib/control-plane/telemetry';
import { runWatchdogServicePass } from '@/server/lib/control-plane/watchdog';
import { runFleetAuditorServicePass } from '@/server/lib/control-plane/fleet-auditor';
import { runAuthCacheServicePass } from '@/server/lib/control-plane/auth-cache';

const ControlPlaneRunResponseSchema = z.object({
  checked: z.boolean(),
  alerts: z.number(),
  provisioner: z.object({ acquired: z.boolean(), processed: z.number(), leaseOwner: z.string(), scope: z.string() }),
  webhooks: z.object({ acquired: z.boolean(), processed: z.number(), jobsPruned: z.number().optional(), deliveriesPruned: z.number().optional(), leaseOwner: z.string(), scope: z.string() }),
  auth_cache: z.object({ acquired: z.boolean(), synced: z.number(), syncFailed: z.number().optional(), expiredApiKeysPruned: z.number().optional(), expiredApiKeyKvDeleted: z.number().optional(), expiredApiKeyKvDeleteFailed: z.number().optional(), proxyTokensPruned: z.number().optional(), proxyTokenKvDeleted: z.number().optional(), proxyTokenKvDeleteFailed: z.number().optional(), leaseOwner: z.string(), scope: z.string() }),
  telemetry: z.object({ acquired: z.boolean(), pruned: z.number(), lifecycleEventsPruned: z.number(), leaseOwner: z.string(), scope: z.string() }),
  repaired_routing_states: z.number(),
  routing_repair: z.object({ acquired: z.boolean(), repaired: z.number(), leaseOwner: z.string(), scope: z.string() }),
  watchdog: z.object({ acquired: z.boolean(), alerts: z.number(), alertSummaries: z.array(z.object({ machineId: z.string().uuid(), slug: z.string(), type: z.string(), details: z.array(z.string()) })), leaseOwner: z.string(), scope: z.string() }),
  fleet_auditor: z.object({ acquired: z.boolean(), hostsChecked: z.number(), leaseOwner: z.string(), scope: z.string(), checkedAt: z.string().optional(), snapshotsRecorded: z.number().optional(), snapshotsPruned: z.number().optional(), portAllocationsPruned: z.number().optional() }),
});

const ControlPlaneRunRequestSchema = z.object({
  services: z.array(z.enum(['provisioner', 'webhook_dispatcher', 'auth_cache', 'routing', 'telemetry', 'watchdog', 'fleet_auditor'])).min(1).optional(),
});

const ControlPlaneServiceResetLeaseSchema = z.object({
  service: z.enum(['allocator', 'provisioner', 'telemetry', 'routing', 'watchdog', 'fleet_auditor', 'webhook_dispatcher', 'auth_cache']),
  scope: z.string(),
});

export function registerAdminFleetControlPlaneRoutes(
  app: { openapi: (...args: any[]) => unknown },
  requireAdmin: (c: Context<{ Variables: AuthVariables }>) => Response | null,
) {
  app.openapi(createRoute({
    method: 'post',
    path: '/control-plane/run',
    tags: ['Admin Bare Metal'],
    summary: 'Run one control-plane maintenance pass',
    request: {
      body: {
        required: false,
        content: { 'application/json': { schema: ControlPlaneRunRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'Control-plane maintenance pass result',
        content: { 'application/json': { schema: ControlPlaneRunResponseSchema } },
      },
    },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;

    try {
      const body = await c.req.json().catch(() => ({}));
      const requestedServices: string[] = Array.isArray(body?.services) ? body.services : [];
      const wants = (service: string) => requestedServices.length === 0 || requestedServices.includes(service);

      const provisioner = wants('provisioner')
        ? await runProvisionerServicePass({ limit: 10 })
        : { acquired: false, processed: 0, leaseOwner: 'skipped', scope: 'provisioner:machine_create' };
      const webhooks = wants('webhook_dispatcher')
        ? await runWebhookDispatcherServicePass({ limit: 50 })
        : { acquired: false, processed: 0, jobsPruned: 0, deliveriesPruned: 0, leaseOwner: 'skipped', scope: 'webhook_dispatcher:webhook_deliver' };
      const authCache = wants('auth_cache')
        ? await runAuthCacheServicePass({ limit: 100, leaseMs: 120_000 })
        : { acquired: false, synced: 0, leaseOwner: 'skipped', scope: 'auth_cache:api_keys' };
      const routingRepair = wants('routing')
        ? await runRoutingRepairServicePass(25)
        : { acquired: false, repaired: 0, leaseOwner: 'skipped', scope: 'routing:repair' };
      const telemetry = wants('telemetry')
        ? await runTelemetryRetentionServicePass({ limit: 1000 })
        : { acquired: false, pruned: 0, leaseOwner: 'skipped', scope: 'telemetry:retention' };
      const watchdog = wants('watchdog')
        ? await runWatchdogServicePass()
        : { acquired: false, alerts: 0, alertSummaries: [], leaseOwner: 'skipped', scope: 'watchdog:global' };
      const fleetAuditor = wants('fleet_auditor')
        ? await runFleetAuditorServicePass({ maxHosts: 10 })
        : { acquired: false, hostsChecked: 0, snapshotsPruned: 0, snapshotsRecorded: 0, portAllocationsPruned: 0, leaseOwner: 'skipped', scope: 'fleet_auditor:baremetal' };

      return c.json({
        checked: true,
        alerts: watchdog.alerts,
        provisioner,
        webhooks,
        auth_cache: authCache,
        telemetry,
        repaired_routing_states: routingRepair.repaired,
        routing_repair: routingRepair,
        watchdog,
        fleet_auditor: fleetAuditor,
      });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/control-plane/reset-lease',
    tags: ['Admin Bare Metal'],
    summary: 'Clear a control-plane service lease manually',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: ControlPlaneServiceResetLeaseSchema } },
      },
    },
    responses: {
      200: { description: 'Lease cleared', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;

    try {
      const body = c.req.valid('json');
      await db.update(controlPlaneServiceStates).set({
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
        metadata: {
          forced_reset_at: new Date().toISOString(),
          forced_reset_by_user_id: c.get('userId'),
        },
      }).where(and(
        eq(controlPlaneServiceStates.service, body.service),
        eq(controlPlaneServiceStates.scope, body.scope),
      ));
      return c.json({ ok: true });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);
}
