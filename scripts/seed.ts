/* eslint-disable @typescript-eslint/ban-ts-comment */
/**
 * Seed script — creates a test user, SSH key, and API key for development.
 * Run: npx tsx scripts/seed.ts
 */

import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/server/db/schema';
import { generateApiKey, fingerprintSSHKey } from '../src/server/lib/crypto';

const TEST_SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForDevelopmentOnly000000000000000 dev@justavps';

async function seed() {
  const sql = postgres(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  console.log('Seeding database...');

  // 1. Create test user
  const [user] = await db.insert(schema.users).values({
    email: 'dev@justavps.com',
    name: 'Dev User',
  }).onConflictDoNothing().returning();

  const userId = user?.id;
  if (!userId) {
    const [existing] = await db.select().from(schema.users).where(
      // @ts-ignore
      schema.users.email.equals ? undefined : undefined
    );
    console.log('User already exists. Looking up...');
    const rows = await sql`SELECT id FROM users WHERE email = 'dev@justavps.com'`;
    if (rows.length > 0) {
      const existingId = rows[0].id;
      console.log(`  User ID: ${existingId}`);

      // Check if API key exists
      const apiKeyRows = await sql`SELECT key_prefix FROM api_keys WHERE owner_id = ${existingId}`;
      if (apiKeyRows.length > 0) {
        console.log(`  API Key: ${apiKeyRows[0].key_prefix}`);
      }
      await sql.end();
      return;
    }
  }

  console.log(`  Created user: ${userId} (dev@justavps.com)`);

  // 2. Create SSH key
  let fingerprint: string;
  try {
    fingerprint = fingerprintSSHKey(TEST_SSH_KEY);
  } catch {
    fingerprint = 'SHA256:dev-key-fingerprint';
  }

  const [sshKey] = await db.insert(schema.sshKeys).values({
    ownerId: userId,
    name: 'Dev SSH Key',
    publicKey: TEST_SSH_KEY,
    fingerprint,
  }).returning();

  console.log(`  Created SSH key: ${sshKey.id} (${sshKey.name})`);

  // 3. Create API key
  const { key, hash, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(schema.apiKeys).values({
    ownerId: userId,
    name: 'Dev API Key',
    keyPrefix: prefix,
    keyHash: hash,
  }).returning();

  console.log(`  Created API key: ${apiKey.id}`);
  console.log(`\n  ════════════════════════════════════════════`);
  console.log(`  API KEY (save this, shown only once):`);
  console.log(`  ${key}`);
  console.log(`  ════════════════════════════════════════════\n`);
  console.log(`  SSH Key ID: ${sshKey.id}`);
  console.log(`  User ID: ${userId}`);

  await sql.end();
  console.log('Done!');
}

seed().catch(console.error);
