/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AuthVariables } from '@/server/lib/api-guard';
import { handleRouteError } from '@/server/lib/route-helpers';

const ControlPlaneServiceStateSchema = z.object({
  id: z.string().uuid(),
  service: z.string(),
  scope: z.string(),
  critical: z.boolean(),
  mode: z.enum(['event_driven', 'periodic']),
  description: z.string(),
  stale: z.boolean(),
  age_ms_since_completion: z.number().nullable(),
  lease_owner: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  last_started_at: z.string().nullable(),
  last_completed_at: z.string().nullable(),
  checkpoint: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

const ControlPlaneServiceStateListResponseSchema = z.object({
  services: z.array(ControlPlaneServiceStateSchema),
});

export function registerAdminFleetServiceStateRoutes(
  app: { openapi: (...args: any[]) => unknown },
  requireAdmin: (c: Context<{ Variables: AuthVariables }>) => Response | null,
  deps: {
    listServices: () => Promise<Array<any>>;
  },
) {
  app.openapi(createRoute({
    method: 'get',
    path: '/control-plane/services',
    tags: ['Admin Bare Metal'],
    summary: 'List control-plane service states',
    responses: {
      200: {
        description: 'Control-plane service states',
        content: { 'application/json': { schema: ControlPlaneServiceStateListResponseSchema } },
      },
    },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;

    try {
      return c.json({ services: await deps.listServices() });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);
}
