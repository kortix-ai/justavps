/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AuthVariables } from "@/server/auth/api-guard";
import { handleRouteError } from "@/server/core/route-helpers";

export function registerAdminFleetHostMutationRoutes(
  app: { openapi: (...args: any[]) => unknown },
  requireAdmin: (c: Context<{ Variables: AuthVariables }>) => Response | null,
  deps: {
    updateValidationArtifact: (id: string, body: any, userId: string | null | undefined) => Promise<any>;
    updateOperatorSettings: (id: string, body: any) => Promise<any>;
    updateSchedulerState: (id: string, body: any, userId: string | null | undefined) => Promise<any>;
    updateMaintenanceState: (id: string, body: any, userId: string | null | undefined) => Promise<any>;
  },
) {
  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/{id}/validation-artifact',
    tags: ['Admin Bare Metal'],
    summary: 'Record a bootstrap validation artifact for a host',
    request: { params: z.object({ id: z.string().uuid() }), body: { required: true, content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } } },
    responses: { 200: { description: 'Host validation artifact recorded', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.updateValidationArtifact(c.req.valid('param').id, c.req.valid('json'), c.get('userId')) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/{id}/operator-settings',
    tags: ['Admin Bare Metal'],
    summary: 'Update operator-only host settings such as Incus UI exposure',
    request: { params: z.object({ id: z.string().uuid() }), body: { required: true, content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } } },
    responses: { 200: { description: 'Host operator settings updated', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.updateOperatorSettings(c.req.valid('param').id, c.req.valid('json')) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/{id}/scheduler-state',
    tags: ['Admin Bare Metal'],
    summary: 'Update host schedulability state',
    request: { params: z.object({ id: z.string().uuid() }), body: { required: true, content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } } },
    responses: { 200: { description: 'Host scheduler state updated', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.updateSchedulerState(c.req.valid('param').id, c.req.valid('json'), c.get('userId')) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/hosts/{id}/maintenance-state',
    tags: ['Admin Bare Metal'],
    summary: 'Update host maintenance state',
    request: { params: z.object({ id: z.string().uuid() }), body: { required: true, content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } } },
    responses: { 200: { description: 'Host maintenance state updated', content: { 'application/json': { schema: z.object({ host: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ host: await deps.updateMaintenanceState(c.req.valid('param').id, c.req.valid('json'), c.get('userId')) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);
}
