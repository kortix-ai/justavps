import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { createImageV2, deleteImageV2, listImagesV2 } from "@/server/v2/services/images";
import { handleRouteError } from "@/server/core/route-helpers";

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

imagesV2App.openapi(createRoute({
  method: 'get',
  path: '/',
  tags: ['Images V2'],
  summary: 'List images',
  responses: { 200: { description: 'Image list', content: { 'application/json': { schema: z.object({ images: z.array(ImageV2Schema) }) } } } },
}), (async (c: unknown) => {
  const ctx = c as { get: (key: string) => string; json: (body: unknown, status?: number) => Response };
  try {
    return ctx.json({ images: await listImagesV2({ accountId: ctx.get('accountId') }) });
  } catch (err) {
    return handleRouteError(c as never, err, 'IMAGES-V2') as Response;
  }
}) as never);

imagesV2App.openapi(createRoute({
  method: 'post',
  path: '/',
  tags: ['Images V2'],
  summary: 'Create image from machine',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ machine_id: z.string().uuid(), name: z.string().min(1).max(128) }) } } } },
  responses: { 202: { description: 'Image creation started', content: { 'application/json': { schema: ImageV2Schema } } } },
}), (async (c: unknown) => {
  const ctx = c as {
    get: ((key: 'accountId' | 'userId') => string) & ((key: 'isAdmin') => boolean);
    req: { valid: (target: 'json') => { machine_id: string; name: string } };
    json: (body: unknown, status?: number) => Response;
  };
  try {
    return ctx.json(await createImageV2({
      accountId: ctx.get('accountId'),
      userId: ctx.get('userId'),
      isAdmin: ctx.get('isAdmin'),
      machineId: ctx.req.valid('json').machine_id,
      name: ctx.req.valid('json').name,
    }), 202);
  } catch (err) {
    return handleRouteError(c as never, err, 'IMAGES-V2') as Response;
  }
}) as never);

imagesV2App.openapi(createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Images V2'],
  summary: 'Delete image',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
}), (async (c: unknown) => {
  const ctx = c as {
    get: (key: string) => string;
    req: { valid: (target: 'param') => { id: string } };
    json: (body: unknown, status?: number) => Response;
  };
  try {
    return ctx.json(await deleteImageV2({ accountId: ctx.get('accountId'), imageId: ctx.req.valid('param').id }));
  } catch (err) {
    return handleRouteError(c as never, err, 'IMAGES-V2') as Response;
  }
}) as never);
