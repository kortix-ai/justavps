/* eslint-disable @typescript-eslint/ban-ts-comment */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { createSnapshotV2, deleteSnapshotV2, listSnapshotsV2, restoreSnapshotV2 } from '../../lib/v2/snapshots';
import { handleRouteError } from '../../lib/route-helpers';

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
}), (async (c: any) => {
  try {
    return c.json(await listSnapshotsV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').machineId }));
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
}) as any);

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
}), (async (c: any) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await createSnapshotV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').machineId, name: body.name, requestedByUserId: c.get('userId') }), 202);
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
}) as any);

snapshotsV2App.openapi(createRoute({
  method: 'post',
  path: '/{machineId}/{snapshotId}/restore',
  tags: ['Snapshots V2'],
  summary: 'Restore machine snapshot',
  request: { params: z.object({ machineId: z.string().uuid(), snapshotId: z.string() }) },
  responses: { 200: { description: 'Restored', content: { 'application/json': { schema: z.object({ ok: z.boolean(), restore_execution_id: z.string().uuid() }) } } } },
}), (async (c: any) => {
  try {
    const { machineId, snapshotId } = c.req.valid('param');
    return c.json(await restoreSnapshotV2({ accountId: c.get('accountId'), machineId, snapshotId, requestedByUserId: c.get('userId') }));
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
}) as any);

snapshotsV2App.openapi(createRoute({
  method: 'delete',
  path: '/{machineId}/{snapshotId}',
  tags: ['Snapshots V2'],
  summary: 'Delete machine snapshot',
  request: { params: z.object({ machineId: z.string().uuid(), snapshotId: z.string() }) },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
}), (async (c: any) => {
  try {
    const { machineId, snapshotId } = c.req.valid('param');
    return c.json(await deleteSnapshotV2({ accountId: c.get('accountId'), machineId, snapshotId }));
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
}) as any);
