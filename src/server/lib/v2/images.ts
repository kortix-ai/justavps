import { and, desc, eq, or } from 'drizzle-orm';
import { db } from '../../db';
import { images, machines } from '../../db/schema';
import { buildVisibleImageCatalog, serializeImageRow } from '../image-catalog';
import { getProvider } from '../providers';
import { checkImageLimit } from '../account-limits';

function inferProviderServerId(machine: typeof machines.$inferSelect) {
  return machine.providerServerId || (machine.provider === 'baremetal' ? `justavps-${machine.slug}` : null);
}

export async function listImagesV2(input: { accountId: string }) {
  const rows = await db.select().from(images)
    .where(or(eq(images.accountId, input.accountId), eq(images.isTemplate, true)));
  return buildVisibleImageCatalog(rows.filter((row) => row.status !== 'deleted')).map((img) => {
    const { provider: _provider, provider_image_id: _providerImageId, ...rest } = img as unknown as Record<string, unknown>;
    void _provider;
    void _providerImageId;
    return rest;
  });
}

export async function createImageV2(input: { accountId: string; userId: string; isAdmin: boolean; machineId: string; name: string }) {
  const [machine] = await db.select().from(machines).where(and(eq(machines.id, input.machineId), eq(machines.accountId, input.accountId)));
  if (!machine || machine.status === 'deleted') throw new Error('Machine not found');
  if (machine.status !== 'ready') throw new Error(`Machine must be ready (current: ${machine.status})`);
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine has no provider server');

  const imageLimit = await checkImageLimit(input.accountId, input.userId, input.isAdmin);
  if (!imageLimit.allowed) throw new Error(`Image limit reached (${imageLimit.current}/${imageLimit.max})`);

  const provider = getProvider(machine.provider);
  const [image] = await db.insert(images).values({
    ownerId: input.userId,
    accountId: input.accountId,
    name: input.name,
    status: 'creating',
    sourceMachineId: machine.id,
    provider: machine.provider,
  }).returning();

  (async () => {
    try {
      const result = await provider.createImage(providerServerId, `justavps-img-${input.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 50)}`);
      await db.update(images).set({
        status: 'ready',
        providerImageId: result.imageId,
        diskSizeGb: result.diskSize,
        architecture: result.architecture,
        updatedAt: new Date(),
      }).where(eq(images.id, image.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(images).set({
        status: 'failed',
        description: `Creation failed: ${message.slice(0, 500)}`,
        updatedAt: new Date(),
      }).where(eq(images.id, image.id));
    }
  })();

  const serialized = serializeImageRow(image);
  const { provider: _provider, provider_image_id: _providerImageId, ...rest } = serialized as unknown as Record<string, unknown>;
  void _provider;
  void _providerImageId;
  return rest;
}

export async function deleteImageV2(input: { accountId: string; imageId: string }) {
  const [image] = await db.select().from(images).where(and(eq(images.id, input.imageId), eq(images.accountId, input.accountId))).orderBy(desc(images.createdAt));
  if (!image) throw new Error('Image not found');
  if (image.isTemplate) throw new Error('Cannot delete a template image');
  if (image.providerImageId) {
    try {
      await getProvider(image.provider).deleteImage(image.providerImageId);
    } catch {
      // non-fatal
    }
  }
  await db.update(images).set({ status: 'deleted', updatedAt: new Date() }).where(eq(images.id, image.id));
  return { ok: true };
}
