import { db } from '../src/server/db/index.js';
import { images } from '../src/server/db/schema.js';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

async function main() {
  const ownerId = '973d8dc5-8f77-492e-8cd3-4e45eaa8e0b3';
  const existing = await db.select().from(images);
  const desired = [
    { name: 'justavps standard', providerImageId: '367950002', description: 'Ubuntu 24.04 with the justavps daemon and core machine tooling preinstalled.' },
    { name: 'Kortix', providerImageId: '368326049', description: 'Base justavps template with kortix.com self-hosting preinstalled.' },
  ];

  for (const template of desired) {
    const present = existing.find((img) => img.name === template.name);
    if (present) {
      await db.update(images).set({
        description: template.description,
        status: 'ready',
        provider: 'cloud',
        providerImageId: template.providerImageId,
        diskSizeGb: 80,
        isTemplate: true,
        updatedAt: new Date(),
      }).where(eq(images.id, present.id));
      continue;
    }

    await db.insert(images).values({
      id: randomUUID(),
      ownerId,
      name: template.name,
      description: template.description,
      status: 'ready',
      provider: 'cloud',
      providerImageId: template.providerImageId,
      sourceMachineId: null,
      diskSizeGb: 80,
      isTemplate: true,
    });
  }

  const all = await db.select().from(images);
  console.log('Images in DB:', all.length);
  for (const img of all) {
    console.log(`  ${img.id.slice(0, 8)} | ${img.name} | ${img.status} | owner=${img.ownerId.slice(0, 8)} | provider_id=${img.providerImageId}`);
  }
  process.exit(0);
}

main();
