import { test, expect } from '@playwright/test';
import { apiJson, createOrganization, login } from './helpers';

test.describe('Account resource scope', () => {
  test('org resources stay isolated and org API keys force org account context', async ({ page }) => {
    const email = `scope-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const sshKeyName = `org-key-${Date.now()}`;
    const apiKeyName = `org-api-${Date.now()}`;

    await login(page, email, password);

    const membershipsBefore = await apiJson<{
      memberships: Array<{ account: { id: string; type: 'personal' | 'organization' } }>;
    }>(page, '/api/v1/account/memberships');
    const personalAccountId = membershipsBefore.data.memberships.find((membership) => membership.account.type === 'personal')!.account.id;

    await createOrganization(page, 'Scoped Resources Org');

    const createSshKey = await apiJson<{ id: string; name: string }>(page, '/api/v1/ssh-keys', {
      method: 'POST',
      body: {
        name: sshKeyName,
        public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForScopedOrgTesting0000000000000000000 scoped@test',
      },
    });
    expect(createSshKey.status).toBe(201);

    const createApiKey = await apiJson<{ id: string; key: string; name: string }>(page, '/api/v1/api-keys', {
      method: 'POST',
      body: { name: apiKeyName },
    });
    expect(createApiKey.status).toBe(201);
    expect(createApiKey.data.key).toMatch(/^sk_live_/);

    const switchPersonal = await apiJson<{ ok: true }>(page, '/api/v1/account/switch', {
      method: 'POST',
      body: { account_id: personalAccountId },
    });
    expect(switchPersonal.status).toBe(200);

    const personalKeys = await apiJson<{ ssh_keys: Array<{ name: string }> }>(page, '/api/v1/ssh-keys');
    expect(personalKeys.status).toBe(200);
    expect(personalKeys.data.ssh_keys.some((key) => key.name === sshKeyName)).toBe(false);

    const orgApiKeysRes = await fetch('http://localhost:4100/api/v1/ssh-keys', {
      headers: {
        Authorization: `Bearer ${createApiKey.data.key}`,
      },
    });
    expect(orgApiKeysRes.status).toBe(200);
    const orgApiKeysData = await orgApiKeysRes.json() as { ssh_keys: Array<{ name: string }> };
    expect(orgApiKeysData.ssh_keys.some((key) => key.name === sshKeyName)).toBe(true);

    const mismatchedAccountRes = await fetch('http://localhost:4100/api/v1/ssh-keys', {
      headers: {
        Authorization: `Bearer ${createApiKey.data.key}`,
        'X-Account-Id': personalAccountId,
      },
    });
    expect(mismatchedAccountRes.status).toBe(403);
  });
});
