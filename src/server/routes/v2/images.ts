/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { createImageV2, deleteImageV2, listImagesV2 } from '../../lib/v2/images';
import { handleRouteError } from '../../lib/route-helpers';

export const imagesV2App = new OpenAPIHono<{ Variables: AuthVariables }>();
imagesV2App.use('*', apiGuard);

const ImageV2Schema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['creating', 'ready', 'failed', 'deleted']),
  kind: z.enum(['template', 'snapshot']),
  is_template: z.boolean(),
  source_machine_id: z.string().nullable(),
  disk_size_gb: z.number().nullable(),
  architecture: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// @ts-expect-error mixed success/error response typing
imagesV2App.openapi(createRoute({
  method: 'get',
  path: '/',
  tags: ['Images V2'],
  summary: 'List images',
  responses: { 200: { description: 'Image list', content: { 'application/json': { schema: z.object({ images: z.array(ImageV2Schema) }) } } } },
}), async (c) => {
  try {
    return c.json({ images: await listImagesV2({ accountId: c.get('accountId') }) });
  } catch (err) {
    return handleRouteError(c, err, 'IMAGES-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
imagesV2App.openapi(createRoute({
  method: 'post',
  path: '/',
  tags: ['Images V2'],
  summary: 'Create image from machine',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ machine_id: z.string().uuid(), name: z.string().min(1).max(128) }) } } } },
  responses: { 202: { description: 'Image creation started', content: { 'application/json': { schema: ImageV2Schema } } } },
}), async (c) => {
  try {
    return c.json(await createImageV2({
      accountId: c.get('accountId'),
      userId: c.get('userId'),
      isAdmin: c.get('isAdmin'),
      machineId: c.req.valid('json').machine_id,
      name: c.req.valid('json').name,
    }), 202);
  } catch (err) {
    return handleRouteError(c, err, 'IMAGES-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
imagesV2App.openapi(createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Images V2'],
  summary: 'Delete image',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
}), async (c) => {
  try {
    return c.json(await deleteImageV2({ accountId: c.get('accountId'), imageId: c.req.valid('param').id }));
  } catch (err) {
    return handleRouteError(c, err, 'IMAGES-V2') as Response;
  }
});
