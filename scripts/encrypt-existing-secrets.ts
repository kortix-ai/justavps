#!/usr/bin/env npx tsx
/**
 * One-time migration: encrypt existing plaintext secrets in the machines table.
 *
 * Encrypts `machine_token` and `ssh_private_key` columns using AES-256-GCM
 * with the DATA_ENCRYPTION_KEY environment variable.
 *
 * Safe to run multiple times — already-encrypted values are skipped.
 *
 * Usage:
 *   DATA_ENCRYPTION_KEY=your-secret-key DATABASE_URL=postgres://... npx tsx scripts/encrypt-existing-secrets.ts
 *
 * Dry-run (shows what would be encrypted without writing):
 *   DRY_RUN=1 DATA_ENCRYPTION_KEY=your-secret-key DATABASE_URL=postgres://... npx tsx scripts/encrypt-existing-secrets.ts
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { pgTable, uuid, text, timestamp, integer, jsonb, boolean } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes, createCipheriv } from 'crypto';

// ─── Config ─────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
const DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is required');
  process.exit(1);
}
if (!DATA_ENCRYPTION_KEY) {
  console.error('❌ DATA_ENCRYPTION_KEY is required');
  process.exit(1);
}

// ─── Inline encryption (no import from src/ to avoid config loading) ────────

const ENC_PREFIX = 'enc:v1:';

function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

function encryptSecret(plaintext: string): string {
  if (isEncrypted(plaintext)) return plaintext;
  const key = createHash('sha256').update(DATA_ENCRYPTION_KEY!).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// ─── DB schema (minimal, just what we need) ─────────────────────────────────

const machines = pgTable('machines', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  machineToken: text('machine_token').notNull(),
  sshPrivateKey: text('ssh_private_key'),
  status: text('status').notNull(),
  deletedAt: timestamp('deleted_at'),
});

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const sql = neon(DATABASE_URL!);
  const db = drizzle(sql);

  console.log(DRY_RUN ? '🔍 DRY RUN — no writes' : '🔐 Encrypting secrets...');

  const allMachines = await db.select().from(machines);
  console.log(`Found ${allMachines.length} machines`);

  let encryptedTokens = 0;
  let encryptedKeys = 0;
  let skippedTokens = 0;
  let skippedKeys = 0;

  for (const m of allMachines) {
    const updates: Partial<{ machineToken: string; sshPrivateKey: string }> = {};

    // Machine token
    if (isEncrypted(m.machineToken)) {
      skippedTokens++;
    } else {
      updates.machineToken = encryptSecret(m.machineToken);
      encryptedTokens++;
    }

    // SSH private key
    if (m.sshPrivateKey) {
      if (isEncrypted(m.sshPrivateKey)) {
        skippedKeys++;
      } else {
        updates.sshPrivateKey = encryptSecret(m.sshPrivateKey);
        encryptedKeys++;
      }
    }

    if (Object.keys(updates).length > 0) {
      if (DRY_RUN) {
        console.log(`  [DRY] ${m.slug} (${m.status}): would encrypt ${Object.keys(updates).join(', ')}`);
      } else {
        await db.update(machines).set(updates).where(eq(machines.id, m.id));
        console.log(`  ✅ ${m.slug}: encrypted ${Object.keys(updates).join(', ')}`);
      }
    } else {
      console.log(`  ⏭️  ${m.slug}: already encrypted`);
    }
  }

  console.log('\n── Summary ──');
  console.log(`Machine tokens: ${encryptedTokens} encrypted, ${skippedTokens} already encrypted`);
  console.log(`SSH private keys: ${encryptedKeys} encrypted, ${skippedKeys} already encrypted`);
  if (DRY_RUN) console.log('\n💡 Remove DRY_RUN=1 to apply changes');
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
