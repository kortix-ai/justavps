#!/usr/bin/env npx tsx
/**
 * One-off backfill: enable Hetzner backups for machines that have
 * `backups_enabled = true` in DB but never had the Hetzner action called
 * on them (due to a bug where POST /servers `enable_backup` was silently
 * ignored by the Hetzner API).
 *
 * Idempotent: re-enabling already-enabled backups returns a 4xx from Hetzner
 * which we treat as success.
 *
 * Usage:
 *   DATABASE_URL=postgres://... HETZNER_API_TOKEN=xxx npx tsx scripts/backfill-hetzner-backups.ts
 *
 * Dry-run (no API calls, just list affected machines):
 *   DRY_RUN=1 DATABASE_URL=postgres://... npx tsx scripts/backfill-hetzner-backups.ts
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { and, eq, ne, isNotNull } from 'drizzle-orm';

// ─── Config ─────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
const HETZNER_API_TOKEN = process.env.HETZNER_API_TOKEN;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is required');
  process.exit(1);
}
if (!DRY_RUN && !HETZNER_API_TOKEN) {
  console.error('❌ HETZNER_API_TOKEN is required (or set DRY_RUN=1)');
  process.exit(1);
}

// ─── Minimal machines schema (only columns we need) ────────────────────────

const machines = pgTable('machines', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  status: text('status').notNull(),
  provider: text('provider').notNull(),
  providerServerId: text('provider_server_id'),
  backupsEnabled: boolean('backups_enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ─── Hetzner action ─────────────────────────────────────────────────────────

async function enableHetznerBackup(serverId: string): Promise<{ ok: boolean; status: number; detail: string }> {
  const res = await fetch(`https://api.hetzner.cloud/v1/servers/${serverId}/actions/enable_backup`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HETZNER_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, detail: text.slice(0, 300) };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const sql = neon(DATABASE_URL!);
  const db = drizzle(sql);

  const rows = await db
    .select()
    .from(machines)
    .where(
      and(
        eq(machines.backupsEnabled, true),
        ne(machines.status, 'deleted'),
        isNotNull(machines.providerServerId),
      ),
    );

  // Only cloud machines have a Hetzner-reachable providerServerId.
  // Local/docker or other providers won't — skip them.
  const hetznerRows = rows.filter((r) => r.providerServerId && /^\d+$/.test(r.providerServerId));
  const skipped = rows.length - hetznerRows.length;

  console.log(`Found ${rows.length} machines with backupsEnabled=true`);
  if (skipped > 0) console.log(`  Skipping ${skipped} non-Hetzner rows (no numeric provider_server_id)`);
  console.log(`  Will act on ${hetznerRows.length} Hetzner machines\n`);

  if (DRY_RUN) {
    for (const m of hetznerRows) {
      console.log(`  [dry-run] ${m.slug}  (provider=${m.provider}, serverId=${m.providerServerId}, status=${m.status})`);
    }
    console.log('\nDry run complete. Re-run without DRY_RUN=1 to apply.');
    return;
  }

  let ok = 0, alreadyOn = 0, failed = 0;
  for (const m of hetznerRows) {
    const { ok: success, status, detail } = await enableHetznerBackup(m.providerServerId!);
    if (success) {
      console.log(`  ✓ ${m.slug}  enabled`);
      ok++;
    } else if (status === 409 || /already.*enabled|backup.*enabled/i.test(detail)) {
      console.log(`  • ${m.slug}  already enabled`);
      alreadyOn++;
    } else {
      console.log(`  ✗ ${m.slug}  ${status}: ${detail}`);
      failed++;
    }
    // Small throttle to stay under Hetzner's rate limit (3600/hr)
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\nDone. enabled=${ok}  already_on=${alreadyOn}  failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
