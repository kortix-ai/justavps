import { db } from '../src/server/db/index.js';
import { images } from '../src/server/db/schema.js';
import { randomUUID } from 'crypto';

async function main() {
  const ownerId = '973d8dc5-8f77-492e-8cd3-4e45eaa8e0b3';
  const existing = await db.select().from(images);
  const desired = [
    { name: 'justavps standard', providerImageId: '367950002' },
    { name: 'Kortix', providerImageId: '367950002' },
  ];

  for (const template of desired) {
    const present = existing.find((img) => img.name === template.name);
    if (present) continue;

    await db.insert(images).values({
      id: randomUUID(),
      ownerId,
      name: template.name,
      description: template.name === 'Kortix'
        ? 'Base justavps template with kortix.com self-hosting preinstalled.'
        : 'Ubuntu 24.04 with the justavps daemon and core machine tooling preinstalled.',
      status: 'ready',
      provider: 'cloud',
      providerImageId: template.providerImageId,
      sourceMachineId: null,
      diskSizeGb: 20,
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
