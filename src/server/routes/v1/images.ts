/**
 * Image routes — list, get, delete user images.
 * Uses @hono/zod-openapi: routes declare schemas inline → spec auto-generated.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, or } from 'drizzle-orm';
import { db } from '../../db';
import { images } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { getProvider } from '../../lib/providers';
import { requireOwnedResource, errorResponse } from '../../lib/route-helpers';
import {
  ImageResponseSchema,
  ImageListResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

type ImageRow = typeof images.$inferSelect;

export const imagesApp = new OpenAPIHono<{ Variables: AuthVariables }>();
imagesApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

function serializeImage(img: ImageRow) {
  return {
    id: img.id,
    name: img.name,
    status: img.status,
    is_public: img.isPublic,
    source_machine_id: img.sourceMachineId,
    provider: img.provider,
    provider_image_id: img.providerImageId,
    disk_size_gb: img.diskSizeGb,
    architecture: img.architecture,
    created_at: img.createdAt.toISOString(),
    updated_at: img.updatedAt.toISOString(),
  };
}

// ─── GET / — List Images ────────────────────────────────────────────────────

const listImagesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Images'],
  security: bearerSecurity,
  summary: 'List images',
  description: 'Returns all non-deleted images owned by the authenticated user.',
  responses: {
    200: {
      description: 'List of images',
      content: { 'application/json': { schema: ImageListResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-expect-error — DB returns string status, schema expects enum; runtime values are always valid
imagesApp.openapi(listImagesRoute, async (c) => {
  const ownerId = c.get('userId');
  // Show user's own images + public base images (visible to everyone)
  const result = await db.select().from(images)
    .where(or(eq(images.ownerId, ownerId), eq(images.isPublic, true)))
    .then(rows => rows.filter(r => r.status !== 'deleted'));
  return c.json({ images: result.map(serializeImage) }, 200);
});

// ─── GET /:id — Get Image ───────────────────────────────────────────────────

const getImageRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Images'],
  security: bearerSecurity,
  summary: 'Get an image',
  description: 'Returns image details including status and provider artifact info.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Image ID' }) }),
  },
  responses: {
    200: {
      description: 'Image details',
      content: { 'application/json': { schema: ImageResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

imagesApp.openapi(getImageRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');
  const owned = await requireOwnedResource<ImageRow>(c, images, images.id, id, ownerId, 'Image');
  if (owned.response) return owned.response as any;
  return c.json(serializeImage(owned.resource));
});

// ─── DELETE /:id — Delete Image ─────────────────────────────────────────────

const deleteImageRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Images'],
  security: bearerSecurity,
  summary: 'Delete an image',
  description: 'Deletes the image and its provider-side artifact.',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'Image ID' }) }),
  },
  responses: {
    204: { description: 'Image deleted' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

imagesApp.openapi(deleteImageRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');
  const owned = await requireOwnedResource<ImageRow>(c, images, images.id, id, ownerId, 'Image');
  if (owned.response) return owned.response as any;

  const img = owned.resource;

  // Prevent deletion of public/template images
  if (img.isPublic) {
    return errorResponse(c, 403, 'Cannot delete a public template image') as any;
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
