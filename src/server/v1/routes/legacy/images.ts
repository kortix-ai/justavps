/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, or } from 'drizzle-orm';

import { db } from '@/server/db';
import { images } from '@/server/db/schema';
import { apiGuard, type AuthVariables } from "@/server/auth/api-guard";
import { getProvider } from "@/server/platform/providers/index";
import { requireAccountResource, errorResponse } from "@/server/core/route-helpers";
import { buildVisibleImageCatalog, serializeImageRow } from "@/server/core/image-catalog";
import {
  ImageResponseSchema,
  ImageListResponseSchema,
  ErrorResponseSchema,
} from '@/shared/lib/schemas';

type ImageRow = typeof images.$inferSelect;

export const imagesApp = new OpenAPIHono<{ Variables: AuthVariables }>();
imagesApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

function serializeImage(img: ImageRow) {
  return serializeImageRow(img);
}

const listImagesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Images'],
  security: bearerSecurity,
  summary: 'List images',
  description: 'Returns all non-deleted images owned by the authenticated user.',
  responses: {
    200: { description: 'List of images', content: { 'application/json': { schema: ImageListResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

imagesApp.openapi(listImagesRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const result = await db.select().from(images).where(or(eq(images.accountId, accountId), eq(images.isTemplate, true))).then((rows) => rows.filter((r) => r.status !== 'deleted'));
  return c.json({ images: buildVisibleImageCatalog(result) }, 200);
}) as any);

const getImageRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Images'],
  security: bearerSecurity,
  summary: 'Get an image',
  description: 'Returns image details including status and provider artifact info.',
  request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Image ID' }) }) },
  responses: {
    200: { description: 'Image details', content: { 'application/json': { schema: ImageResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

imagesApp.openapi(getImageRoute, async (c) => {
  const { id } = c.req.valid('param');
  const accountId = c.get('accountId');
  const owned = await requireAccountResource<ImageRow>(c, images, images.id, id, accountId, 'Image');
  if (owned.response) return owned.response as any;
  return c.json(serializeImage(owned.resource));
});

const deleteImageRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Images'],
  security: bearerSecurity,
  summary: 'Delete an image',
  description: 'Deletes the image and its provider-side artifact.',
  request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Image ID' }) }) },
  responses: {
    204: { description: 'Image deleted' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

imagesApp.openapi(deleteImageRoute, async (c) => {
  const { id } = c.req.valid('param');
  const accountId = c.get('accountId');
  const owned = await requireAccountResource<ImageRow>(c, images, images.id, id, accountId, 'Image');
  if (owned.response) return owned.response as any;

  const img = owned.resource;
  if (img.isTemplate) {
    return errorResponse(c, 403, 'Cannot delete a template image') as any;
  }
  if (img.providerImageId) {
    try {
      const provider = getProvider(img.provider);
      await provider.deleteImage(img.providerImageId);
    } catch (err) {
      console.warn(`[IMAGES] Failed to delete provider image ${img.providerImageId}:`, err);
    }
  }

  await db.update(images).set({ status: 'deleted', updatedAt: new Date() }).where(eq(images.id, id));
  return c.body(null, 204);
});
