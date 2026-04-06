/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
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
});

// @ts-expect-error mixed success/error response typing
snapshotsV2App.openapi(createRoute({
  method: 'get',
  path: '/{machineId}',
  tags: ['Snapshots V2'],
  summary: 'List machine snapshots',
  request: { params: z.object({ machineId: z.string().uuid() }) },
  responses: { 200: { description: 'Snapshots', content: { 'application/json': { schema: z.object({ snapshots: z.array(SnapshotSchema) }) } } } },
}), async (c) => {
  try {
    return c.json({ snapshots: await listSnapshotsV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').machineId }) });
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
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
}), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await createSnapshotV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').machineId, name: body.name }), 202);
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
snapshotsV2App.openapi(createRoute({
  method: 'post',
  path: '/{machineId}/{snapshotId}/restore',
  tags: ['Snapshots V2'],
  summary: 'Restore machine snapshot',
  request: { params: z.object({ machineId: z.string().uuid(), snapshotId: z.string() }) },
  responses: { 200: { description: 'Restored', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
}), async (c) => {
  try {
    const { machineId, snapshotId } = c.req.valid('param');
    return c.json(await restoreSnapshotV2({ accountId: c.get('accountId'), machineId, snapshotId }));
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
snapshotsV2App.openapi(createRoute({
  method: 'delete',
  path: '/{machineId}/{snapshotId}',
  tags: ['Snapshots V2'],
  summary: 'Delete machine snapshot',
  request: { params: z.object({ machineId: z.string().uuid(), snapshotId: z.string() }) },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
}), async (c) => {
  try {
    const { machineId, snapshotId } = c.req.valid('param');
    return c.json(await deleteSnapshotV2({ accountId: c.get('accountId'), machineId, snapshotId }));
  } catch (err) {
    return handleRouteError(c, err, 'SNAPSHOTS-V2') as Response;
  }
});
