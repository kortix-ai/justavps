/**
 * Image routes — list, get, delete user images.
 * Images are created via POST /machines/:id/image (in machines routes).
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { images } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { getProvider } from '../../lib/providers';
import { requireOwnedResource } from '../../lib/route-helpers';

type ImageRow = typeof images.$inferSelect;

export const imagesApp = new Hono<{ Variables: AuthVariables }>();
imagesApp.use('*', apiGuard);

function serializeImage(img: ImageRow) {
  return {
    id: img.id,
    name: img.name,
    status: img.status,
    source_machine_id: img.sourceMachineId,
    provider: img.provider,
    provider_image_id: img.providerImageId,
    disk_size_gb: img.diskSizeGb,
    architecture: img.architecture,
    created_at: img.createdAt.toISOString(),
    updated_at: img.updatedAt.toISOString(),
  };
}

// GET / — List Images
imagesApp.get('/', async (c) => {
  const ownerId = c.get('userId');
  const result = await db.select().from(images)
    .where(eq(images.ownerId, ownerId))
    .then(rows => rows.filter(r => r.status !== 'deleted'));
  return c.json({ images: result.map(serializeImage) });
});

// GET /:id — Get Image
imagesApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const owned = await requireOwnedResource<ImageRow>(c, images, images.id, id, ownerId, 'Image');
  if (owned.response) return owned.response;
  return c.json(serializeImage(owned.resource));
});

// DELETE /:id — Delete Image
imagesApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const owned = await requireOwnedResource<ImageRow>(c, images, images.id, id, ownerId, 'Image');
  if (owned.response) return owned.response;

  const img = owned.resource;
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
