/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AuthVariables } from "@/server/auth/api-guard";
import { handleRouteError } from "@/server/core/route-helpers";

export function registerAdminFleetHostRoutes(
  app: { openapi: (...args: any[]) => unknown },
  requireAdmin: (c: Context<{ Variables: AuthVariables }>) => Response | null,
  deps: {
    getBootstrapConfig: (id: string) => Promise<any>;
    listHosts: () => Promise<{ hosts: Array<any>; regions: Array<any> }>;
    reconcileHosts: () => Promise<any>;
    cleanupHostOrphans: (id: string) => Promise<any>;
    createHost: (body: any) => Promise<any>;
    registerHost: (id: string, body: any) => Promise<any>;
    heartbeatHost: (id: string, body: any) => Promise<any>;
  },
) {
  app.openapi(createRoute({
    method: 'post',
    path: '/hosts',
    tags: ['Admin Bare Metal'],
    summary: 'Register a pre-existing host directly into inventory (ops/dev only — prefer POST /procurements for ordering new hosts)',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              region: z.string().min(1),
              host_class: z.string().min(1),
              location: z.string().min(1),
              name: z.string().min(1).max(120).optional(),
              vendor: z.string().min(1).max(120).optional(),
              public_ipv4: z.string().optional(),
              public_ipv6: z.string().optional(),
              metadata: z.record(z.string(), z.unknown()).optional(),
            }),
          },
        },
      },
    },
    responses: { 201: { description: 'Host created', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.createHost(c.req.valid('json')) }, 201);
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'get',
    path: '/hosts/{id}/bootstrap-config',
    tags: ['Admin Bare Metal'],
    summary: 'Get bootstrap configuration for a host',
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Bootstrap configuration', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.getBootstrapConfig(c.req.valid('param').id) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'get',
    path: '/hosts',
    tags: ['Admin Bare Metal'],
    summary: 'List bare-metal hosts',
    responses: { 200: { description: 'Hosts', content: { 'application/json': { schema: z.object({ hosts: z.array(z.record(z.string(), z.unknown())), regions: z.array(z.record(z.string(), z.unknown())) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    return c.json(await deps.listHosts());
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/reconcile',
    tags: ['Admin Bare Metal'],
    summary: 'Reconcile DB state against live bare-metal hosts',
    responses: { 200: { description: 'Fleet reconciled', content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json(await deps.reconcileHosts());
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/{id}/cleanup-orphans',
    tags: ['Admin Bare Metal'],
    summary: 'Delete non-warm orphan instances from a host',
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Host orphans cleaned', content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json(await deps.cleanupHostOrphans(c.req.valid('param').id));
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/{id}/register',
    tags: ['Admin Bare Metal'],
    summary: 'Register a bootstrapped host runner and capacity',
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { required: true, content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
    },
    responses: { 200: { description: 'Host registered', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.registerHost(c.req.valid('param').id, c.req.valid('json')) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/{id}/heartbeat',
    tags: ['Admin Bare Metal'],
    summary: 'Record a host heartbeat and derive schedulability',
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              incus_ok: z.boolean(),
              zfs_ok: z.boolean(),
              runner_ok: z.boolean(),
              drift_status: z.enum(['in_policy', 'warning_drift', 'blocking_drift']).default('in_policy'),
              instance_count: z.number().int().min(0).default(0),
              image_count: z.number().int().min(0).default(0),
              alerts: z.array(z.string()).optional(),
            }),
          },
        },
      },
    },
    responses: { 200: { description: 'Host heartbeat recorded', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.heartbeatHost(c.req.valid('param').id, c.req.valid('json')) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);
}
