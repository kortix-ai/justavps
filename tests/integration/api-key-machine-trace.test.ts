import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: () => undefined,
  };
});

vi.mock('@/server/core/route-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/server/core/route-helpers')>('@/server/core/route-helpers');
  return {
    ...actual,
    requireProvider: () => ({
      provider: {
        name: 'cloud',
        displayName: 'Mock Cloud',
      },
    }),
  };
});

vi.mock('@/server/v1/services/machine-lifecycle', async () => {
  const actual = await vi.importActual<typeof import('@/server/v1/services/machine-lifecycle')>('@/server/v1/services/machine-lifecycle');
  return {
    ...actual,
    generateMachineIdentity: vi.fn(async () => ({
      slug: `trace-${Date.now()}`,
      machineToken: 'trace-machine-token',
    })),
    autoGenerateAndSaveSSHKey: vi.fn(async () => ({
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockTraceKey api-key-trace@test',
      privateKey: 'MOCK_PRIVATE_KEY',
      keyId: 'mock-key-id',
    })),
    resolveSSHKeyPublicKeys: vi.fn(async () => []),
    uploadSSHKeyToProvider: vi.fn(async () => 'provider-key-id'),
    buildMachineUserData: vi.fn(() => '#cloud-config'),
    resolveMachineCallbackConfig: vi.fn(() => ({
      url: 'http://localhost:4100/api/v1/internal/machines/callback',
      callbackExpected: false,
    })),
    lookupPriceAndSpecs: vi.fn(async () => ({
      priceMonthly: 24,
      specs: {
        vcpu: 2,
        ram_gb: 4,
        disk_gb: 40,
      },
    })),
    setupProxyDNS: vi.fn(async () => undefined),
  };
});

import { app } from '@/server/app';
import { db } from '@/server/db';
import { accounts, apiKeys, machineEvents, machines, users } from '@/server/db/schema';
import { createOrganizationAccount, ensureUserAccountGraph } from '@/server/auth/accounts';
import { generateApiKey, hashPassword } from '@/server/core/crypto';

let apiKeyValue = '';
let apiKeyId = '';
let orgAccountId = '';
let userId = '';
let machineId = '';

describe('API key machine traceability', () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword('TraceApiKey123!');
    const [user] = await db.insert(users).values({
      email: `api-key-trace-${Date.now()}@example.com`,
      passwordHash,
      name: 'API Key Traceability',
      isAdmin: false,
    }).returning();

    userId = user.id;
    await ensureUserAccountGraph(user);

    const organization = await createOrganizationAccount({
      ownerUserId: user.id,
      ownerEmail: user.email,
      name: 'API Key Traceability Org',
    });
    orgAccountId = organization.id;

    const generatedKey = await generateApiKey();
    apiKeyValue = generatedKey.key;

    const [createdKey] = await db.insert(apiKeys).values({
      ownerId: user.id,
      accountId: organization.id,
      name: 'trace-machine-key',
      keyPrefix: generatedKey.prefix,
      keyHash: generatedKey.hash,
      keySha256: generatedKey.sha256,
      permissions: ['*'],
      scope: 'account',
    }).returning();

    apiKeyId = createdKey.id;
  });

  afterAll(async () => {
    if (machineId) {
      await db.delete(machineEvents).where(eq(machineEvents.machineId, machineId));
      await db.delete(machines).where(eq(machines.id, machineId));
    }
    if (apiKeyId) {
      await db.delete(apiKeys).where(eq(apiKeys.id, apiKeyId));
    }
    if (orgAccountId) {
      await db.delete(accounts).where(eq(accounts.id, orgAccountId));
    }
    if (userId) {
      const [personalAccount] = await db.select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.personalForUserId, userId))
        .limit(1);
      if (personalAccount) {
        await db.delete(accounts).where(eq(accounts.id, personalAccount.id));
      }
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it('persists immutable API key provenance on machine creation', async () => {
    const response = await app.request('/api/v1/machines', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyValue}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'cloud',
        image_id: null,
        server_type: 'cpx11',
        region: 'hel1',
        name: 'Traceable Machine',
      }),
    });

    if (response.status !== 202) {
      throw new Error(`Unexpected create status ${response.status}: ${await response.text()}`);
    }
    const created = await response.json() as {
      id: string;
      account_id?: string;
      created_by_api_key_id: string | null;
      created_by_api_key_name: string | null;
      created_by_api_key_prefix: string | null;
      ssh_key: { private_key: string | null } | null;
    };

    machineId = created.id;

    expect(created.created_by_api_key_id).toBe(apiKeyId);
    expect(created.created_by_api_key_name).toBe('trace-machine-key');
    expect(created.created_by_api_key_prefix).toMatch(/^sk_live_/);
    expect(created.ssh_key?.private_key).toBe('MOCK_PRIVATE_KEY');

    const detailResponse = await app.request(`/api/v1/machines/${machineId}`, {
      headers: { Authorization: `Bearer ${apiKeyValue}` },
    });
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as {
      id: string;
      created_by_api_key_id: string | null;
      created_by_api_key_name: string | null;
      created_by_api_key_prefix: string | null;
    };

    expect(detail.id).toBe(machineId);
    expect(detail.created_by_api_key_id).toBe(apiKeyId);
    expect(detail.created_by_api_key_name).toBe('trace-machine-key');
    expect(detail.created_by_api_key_prefix).toMatch(/^sk_live_/);

    const [machine] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
    expect(machine?.accountId).toBe(orgAccountId);
    expect(machine?.createdByApiKeyId).toBe(apiKeyId);
    expect(machine?.createdByApiKeyName).toBe('trace-machine-key');
    expect(machine?.createdByApiKeyPrefix).toMatch(/^sk_live_/);

    await db.delete(apiKeys).where(eq(apiKeys.id, apiKeyId));
    apiKeyId = '';

    const [machineAfterKeyDeletion] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
    expect(machineAfterKeyDeletion?.createdByApiKeyId).toBe(machine?.createdByApiKeyId);
    expect(machineAfterKeyDeletion?.createdByApiKeyName).toBe('trace-machine-key');
    expect(machineAfterKeyDeletion?.createdByApiKeyPrefix).toBe(machine?.createdByApiKeyPrefix);
  });
});
