import 'dotenv/config';
import { db } from '../src/server/db/index.js';
import { images, users } from '../src/server/db/schema.js';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

const TEMPLATE_OWNER_EMAIL = 'templates@justavps.internal';
const TEMPLATE_OWNER_NAME = 'JustAVPS Templates';
const BASE_TEMPLATE_SNAPSHOT_ID = process.env.HETZNER_BASE_SNAPSHOT_ID || '367950002';
const KORTIX_TEMPLATE_SNAPSHOT_ID = process.env.HETZNER_KORTIX_TEMPLATE_SNAPSHOT_ID || '368326127';

async function main() {
  let [templateOwner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEMPLATE_OWNER_EMAIL));

  if (!templateOwner) {
    [templateOwner] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: TEMPLATE_OWNER_EMAIL,
        name: TEMPLATE_OWNER_NAME,
      })
      .returning({ id: users.id });
  }

  const ownerId = templateOwner.id;
  const existing = await db.select().from(images);
  const desired = [
    { name: 'justavps standard', providerImageId: BASE_TEMPLATE_SNAPSHOT_ID, description: 'Ubuntu 24.04 with the justavps daemon and core machine tooling preinstalled.' },
    { name: 'Kortix', providerImageId: KORTIX_TEMPLATE_SNAPSHOT_ID, description: 'Base justavps template with kortix.com self-hosting preinstalled.' },
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
