import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { createSnapshotV2, deleteSnapshotV2, listSnapshotsV2, restoreSnapshotV2 } from "@/server/v2/services/snapshots";
import { handleRouteError } from "@/server/core/route-helpers";

export const snapshotsV2App = new OpenAPIHono<{ Variables: AuthVariables }>();
snapshotsV2App.use('*', apiGuard);

const SnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  status: z.string(),
  artifact_id: z.string().nullable().optional(),
  artifact_status: z.string().nullable().optional(),
  inventory_source: z.enum(['provider', 'database', 'merged']).optional(),
  backup_kind: z.string().nullable().optional(),
  inventory_scope: z.string().nullable().optional(),
  storage_scope: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  storage_url: z.string().nullable().optional(),
  retention_until: z.string().nullable().optional(),
  source_host_id: z.string().nullable().optional(),
  restore_count: z.number().optional(),
  last_restore_at: z.string().nullable().optional(),
  latest_restore: z.object({
    id: z.string(),
    artifact_id: z.string(),
    snapshot_id: z.string().nullable(),
    snapshot_name: z.string().nullable(),
    status: z.string(),
    trigger_source: z.string(),
    started_at: z.string(),
    completed_at: z.string().nullable(),
    duration_ms: z.number().nullable(),
    error: z.string().nullable(),
    requested_by_user_id: z.string().nullable(),
    source_host_id: z.string().nullable(),
    target_host_id: z.string().nullable(),
  }).nullable().optional(),
});

const RestoreExecutionSchema = z.object({
  id: z.string(),
  artifact_id: z.string(),
  snapshot_id: z.string().nullable(),
  snapshot_name: z.string().nullable(),
  status: z.string(),
  trigger_source: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  error: z.string().nullable(),
  requested_by_user_id: z.string().nullable(),
  source_host_id: z.string().nullable(),
  target_host_id: z.string().nullable(),
});

const SnapshotInventorySchema = z.object({
  snapshots: z.array(SnapshotSchema),
  restore_executions: z.array(RestoreExecutionSchema),
  summary: z.object({
    total_snapshots: z.number(),
    ready_snapshots: z.number(),
    deleted_snapshots: z.number(),
    snapshots_with_restore_history: z.number(),
    total_restores: z.number(),
    failed_restores: z.number(),
    last_restore_at: z.string().nullable(),
  }),
});

snapshotsV2App.openapi(createRoute({
  method: 'get',
  path: '/{machineId}',
  tags: ['Snapshots V2'],
  summary: 'List machine snapshots',
  request: { params: z.object({ machineId: z.string().uuid() }) },
  responses: { 200: { description: 'Snapshots', content: { 'application/json': { schema: SnapshotInventorySchema } } } },
}), (async (c: unknown) => {
  const ctx = c as { get: (key: string) => string; req: { valid: (target: 'param') => { machineId: string } }; json: (body: unknown, status?: number) => Response };
  try {
    return ctx.json(await listSnapshotsV2({ accountId: ctx.get('accountId'), machineId: ctx.req.valid('param').machineId }));
  } catch (err) {
    return handleRouteError(c as never, err, 'SNAPSHOTS-V2') as Response;
  }
}) as never);

snapshotsV2App.openapi(createRoute({
  method: 'post',
  path: '/{machineId}',
  tags: ['Snapshots V2'],
  summary: 'Create machine snapshot',
  request: {
    params: z.object({ machineId: z.string().uuid() }),
    body: { required: false, content: { 'application/json': { schema: z.object({ name: z.string().optional() }) } } },
  },
  responses: { 202: { description: 'Snapshot started', content: { 'application/json': { schema: SnapshotSchema } } } },
}), (async (c: unknown) => {
  const ctx = c as {
    get: (key: string) => string;
    req: { valid: (target: 'param') => { machineId: string }; json: () => Promise<{ name?: string }> };
    json: (body: unknown, status?: number) => Response;
  };
  try {
    const body = (await ctx.req.json().catch(() => ({ name: undefined }))) as { name?: string };
    return ctx.json(await createSnapshotV2({ accountId: ctx.get('accountId'), machineId: ctx.req.valid('param').machineId, name: body.name, requestedByUserId: ctx.get('userId') }), 202);
  } catch (err) {
    return handleRouteError(c as never, err, 'SNAPSHOTS-V2') as Response;
  }
}) as never);

snapshotsV2App.openapi(createRoute({
  method: 'post',
  path: '/{machineId}/{snapshotId}/restore',
  tags: ['Snapshots V2'],
  summary: 'Restore machine snapshot',
  request: { params: z.object({ machineId: z.string().uuid(), snapshotId: z.string() }) },
  responses: { 200: { description: 'Restored', content: { 'application/json': { schema: z.object({ ok: z.boolean(), restore_execution_id: z.string().uuid() }) } } } },
}), (async (c: unknown) => {
  const ctx = c as { get: (key: string) => string; req: { valid: (target: 'param') => { machineId: string; snapshotId: string } }; json: (body: unknown, status?: number) => Response };
  try {
    const { machineId, snapshotId } = ctx.req.valid('param');
    return ctx.json(await restoreSnapshotV2({ accountId: ctx.get('accountId'), machineId, snapshotId, requestedByUserId: ctx.get('userId') }));
  } catch (err) {
    return handleRouteError(c as never, err, 'SNAPSHOTS-V2') as Response;
  }
}) as never);

snapshotsV2App.openapi(createRoute({
  method: 'delete',
  path: '/{machineId}/{snapshotId}',
  tags: ['Snapshots V2'],
  summary: 'Delete machine snapshot',
  request: { params: z.object({ machineId: z.string().uuid(), snapshotId: z.string() }) },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
}), (async (c: unknown) => {
  const ctx = c as { get: (key: string) => string; req: { valid: (target: 'param') => { machineId: string; snapshotId: string } }; json: (body: unknown, status?: number) => Response };
  try {
    const { machineId, snapshotId } = ctx.req.valid('param');
    return ctx.json(await deleteSnapshotV2({ accountId: ctx.get('accountId'), machineId, snapshotId }));
  } catch (err) {
    return handleRouteError(c as never, err, 'SNAPSHOTS-V2') as Response;
  }
}) as never);
