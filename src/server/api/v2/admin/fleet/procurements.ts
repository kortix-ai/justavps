/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AuthVariables } from '@/server/lib/api-guard';
import { handleRouteError } from '@/server/lib/route-helpers';

export function registerAdminFleetProcurementRoutes(
  app: { openapi: (...args: any[]) => unknown },
  requireAdmin: (c: Context<{ Variables: AuthVariables }>) => Response | null,
  deps: {
    listProcurements: () => Promise<Array<any>>;
    createProcurement: (body: any, userId: string | null | undefined) => Promise<any>;
    listRecommendations: () => Promise<Array<any>>;
    approveProcurement: (id: string, userId: string | null | undefined) => Promise<{ transactionId: string; hostId: string }>;
    syncProcurement: (id: string) => Promise<any>;
  },
) {
  const ProcurementListResponseSchema = z.object({ procurements: z.array(z.record(z.string(), z.unknown())) });
  const ProcurementRecommendationListSchema = z.object({ recommendations: z.array(z.record(z.string(), z.unknown())) });

  app.openapi(createRoute({
    method: 'get',
    path: '/procurements',
    tags: ['Admin Bare Metal'],
    summary: 'List bare-metal procurement requests',
    responses: { 200: { description: 'Procurements', content: { 'application/json': { schema: ProcurementListResponseSchema } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    return c.json({ procurements: await deps.listProcurements() });
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/procurements',
    tags: ['Admin Bare Metal'],
    summary: 'Create a bare-metal procurement request',
    request: { body: { required: true, content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } } },
    responses: { 201: { description: 'Procurement created', content: { 'application/json': { schema: z.object({ procurement: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      const procurement = await deps.createProcurement(c.req.valid('json'), c.get('userId'));
      return c.json({ procurement }, 201);
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'get',
    path: '/procurement-recommendations',
    tags: ['Admin Bare Metal'],
    summary: 'List reserve-aware procurement recommendations by cell',
    responses: { 200: { description: 'Procurement recommendations', content: { 'application/json': { schema: ProcurementRecommendationListSchema } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json({ recommendations: await deps.listRecommendations() });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/procurements/{id}/approve',
    tags: ['Admin Bare Metal'],
    summary: 'Approve and place a bare-metal procurement order',
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Procurement approved', content: { 'application/json': { schema: z.object({ ok: z.boolean(), transaction_id: z.string(), host_id: z.string().uuid() }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      const result = await deps.approveProcurement(c.req.valid('param').id, c.get('userId'));
      return c.json({ ok: true, transaction_id: result.transactionId, host_id: result.hostId });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL');
    }
  }) as any);

  app.openapi(createRoute({
    method: 'post',
    path: '/procurements/{id}/sync',
    tags: ['Admin Bare Metal'],
    summary: 'Sync a procurement transaction from Hetzner Robot',
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Procurement synced', content: { 'application/json': { schema: z.object({ ok: z.boolean(), procurement: z.record(z.string(), z.unknown()) }) } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError;
    try {
      const procurement = await deps.syncProcurement(c.req.valid('param').id);
      return c.json({ ok: true, procurement });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);
}
