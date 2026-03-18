import { db } from '../src/server/db/index.js';
import { images } from '../src/server/db/schema.js';
import { randomUUID } from 'crypto';

async function main() {
  // Insert the base snapshot as a system-level image visible to all users
  await db.insert(images).values({
    id: randomUUID(),
    ownerId: '973d8dc5-8f77-492e-8cd3-4e45eaa8e0b3', // admin user — system base image
    name: 'JustAVPS Base v2',
    status: 'ready',
    provider: 'hetzner',
    providerImageId: '367950002',
    sourceMachineId: null,
    diskSizeGb: 20,
  }).onConflictDoNothing();

  const all = await db.select().from(images);
  console.log('Images in DB:', all.length);
  for (const img of all) {
    console.log(`  ${img.id.slice(0, 8)} | ${img.name} | ${img.status} | owner=${img.ownerId.slice(0, 8)} | provider_id=${img.providerImageId}`);
  }
  process.exit(0);
}

main();
