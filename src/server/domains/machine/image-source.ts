import { eq } from 'drizzle-orm';

import { db } from '@/server/db';
import { images, machines } from '@/server/db/schema';
import { resolveRequestedProviderImage } from '@/server/lib/image-catalog';
import { getProvider } from '@/server/lib/providers';

export function normalizeResolvedImageForProvider(providerName: string, resolvedImage: string) {
  if (providerName === 'baremetal') {
    if (resolvedImage === 'ubuntu-24.04') return 'images:ubuntu/noble/cloud';
    if (/^\d+$/.test(resolvedImage)) return 'images:ubuntu/noble/cloud';
  }
  return resolvedImage;
}

export function normalizeDockerImageRef(image?: string | null) {
  const value = image?.trim();
  if (!value) return null;
  return /^(docker|oci):/i.test(value) ? value : `docker:${value}`;
}

export function defaultPlacementImageAlias(imageId?: string | null, dockerImage?: string | null) {
  if (imageId || dockerImage) return null;
  return 'justavps-golden';
}

export async function resolveMachineCreateImage(input: {
  machine: { id: string; imageId: string | null };
  payload: { accountId: string; imageId?: string | null; dockerImage?: string | null };
}) {
  const provider = getProvider('baremetal');
  let resolvedImage = 'justavps-golden';
  let machineImageId = input.machine.imageId;

  if (input.payload.dockerImage) {
    return { resolvedImage: input.payload.dockerImage, machineImageId };
  }

  if (input.payload.imageId) {
    const [img] = await db.select().from(images).where(eq(images.id, input.payload.imageId));
    if (!img || (img.accountId !== input.payload.accountId && !img.isTemplate)) {
      throw new Error('Image not found');
    }

    const resolved = resolveRequestedProviderImage({ explicitImage: img });
    if (!resolved.ok) throw new Error(resolved.message);

    resolvedImage = normalizeResolvedImageForProvider(provider.name, resolved.selection.providerImage);
    machineImageId = resolved.selection.machineImageId;
    if (machineImageId !== input.machine.imageId) {
      await db.update(machines).set({ imageId: machineImageId }).where(eq(machines.id, input.machine.id));
    }
  }

  return { resolvedImage, machineImageId };
}
