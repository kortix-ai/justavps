/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AuthVariables } from "@/server/auth/api-guard";
import { handleRouteError } from "@/server/core/route-helpers";

const ConfigAuditResponseSchema = z.object({
  status: z.enum(['ok', 'warning', 'degraded']),
  counts: z.object({ ok: z.number(), warning: z.number(), error: z.number() }),
  checks: z.array(z.object({
    key: z.string(),
    severity: z.enum(['ok', 'warning', 'error']),
    message: z.string(),
    details: z.string().optional(),
  })),
});

const FleetHostAuditResponseSchema = z.object({
  summary: z.record(z.string(), z.unknown()),
  pending_validation: z.array(z.record(z.string(), z.unknown())),
  quarantined: z.array(z.record(z.string(), z.unknown())),
  warning_drift: z.array(z.record(z.string(), z.unknown())),
  blocking_drift: z.array(z.record(z.string(), z.unknown())),
});

const CellCapacitySnapshotListResponseSchema = z.object({
  snapshots: z.array(z.record(z.string(), z.unknown())),
});

export function registerAdminFleetAuditRoutes(
  app: { openapi: (...args: any[]) => unknown },
  requireAdmin: (c: Context<{ Variables: AuthVariables }>) => Response | null,
  deps: {
    loadConfigAudit: () => Promise<any>;
    loadHostAudit: () => Promise<any>;
    listCellCapacitySnapshots: (limit?: number) => Promise<Array<any>>;
  },
) {
  app.openapi(createRoute({
    method: 'get',
    path: '/config-audit',
    tags: ['Admin Bare Metal'],
    summary: 'Inspect critical platform configuration readiness',
    responses: { 200: { description: 'Configuration audit', content: { 'application/json': { schema: ConfigAuditResponseSchema } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json(await deps.loadConfigAudit());
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'get',
    path: '/host-audit',
    tags: ['Admin Bare Metal'],
    summary: 'Inspect aggregate host validation and drift state',
    responses: { 200: { description: 'Fleet host audit', content: { 'application/json': { schema: FleetHostAuditResponseSchema } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      return c.json(await deps.loadHostAudit());
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);

  app.openapi(createRoute({
    method: 'get',
    path: '/cell-capacity-snapshots',
    tags: ['Admin Bare Metal'],
    summary: 'List recent cell capacity snapshots',
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }) },
    responses: { 200: { description: 'Recent cell capacity snapshots', content: { 'application/json': { schema: CellCapacitySnapshotListResponseSchema } } } },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;
    try {
      const { limit } = c.req.valid('query');
      return c.json({ snapshots: await deps.listCellCapacitySnapshots(limit) });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);
}
