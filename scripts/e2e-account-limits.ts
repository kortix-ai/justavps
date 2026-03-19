import { randomUUID } from 'crypto';
import { db } from '../src/server/db';
import { apiKeys, accountLimits, machines, users } from '../src/server/db/schema';
import { generateApiKey, generateMachineToken, hashPassword } from '../src/server/lib/crypto';

async function main() {
  const suffix = Date.now();
  const email = `e2e-account-limits-${suffix}@example.com`;
  const password = `LimitsTest!${suffix}`;
  const slug = `limits-e2e-${suffix}`;

  const [user] = await db.insert(users).values({
    email,
    passwordHash: await hashPassword(password),
    name: 'Account Limits E2E',
  }).returning();

  await db.insert(accountLimits).values({
    userId: user.id,
    maxMachines: 0,
    maxImages: 0,
  });

  const [machine] = await db.insert(machines).values({
    ownerId: user.id,
    slug,
    name: 'Limits E2E Machine',
    status: 'ready',
    provider: 'cloud',
    serverType: 'cpx11',
    region: 'hel1',
    providerServerId: `fake-${randomUUID()}`,
    machineToken: generateMachineToken(),
    ip: '127.0.0.1',
  }).returning();

  const { key, hash, prefix } = await generateApiKey();
  await db.insert(apiKeys).values({
    ownerId: user.id,
    name: 'Account Limits E2E',
    keyPrefix: prefix,
    keyHash: hash,
  });

  process.stdout.write(JSON.stringify({
    email,
    password,
    apiKey: key,
    userId: user.id,
    machineId: machine.id,
    slug,
  }));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
