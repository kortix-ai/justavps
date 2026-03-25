#!/usr/bin/env tsx

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';

function loadDotEnv() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const contents = readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

async function main() {
  const [{ db }, { users }, { createAccountInvitation }] = await Promise.all([
    import('../../src/server/db'),
    import('../../src/server/db/schema'),
    import('../../src/server/lib/accounts'),
  ]);

  const [accountId, ownerEmail, invitedEmail, role = 'member'] = process.argv.slice(2);

  if (!accountId || !ownerEmail || !invitedEmail) {
    throw new Error('Usage: create-account-invite <accountId> <ownerEmail> <invitedEmail> [role]');
  }

  const [owner] = await db.select().from(users).where(eq(users.email, ownerEmail)).limit(1);
  if (!owner) {
    throw new Error(`Owner not found for ${ownerEmail}`);
  }

  const { rawToken, invitation } = await createAccountInvitation({
    accountId,
    email: invitedEmail,
    role: role as 'owner' | 'admin' | 'member',
    invitedByUserId: owner.id,
  });

  if (!rawToken) {
    throw new Error('Failed to create invitation token');
  }

  process.stdout.write(JSON.stringify({ rawToken, invitationId: invitation.id }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
