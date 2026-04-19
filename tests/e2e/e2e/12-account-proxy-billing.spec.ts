import { test, expect } from '@playwright/test';
import { apiJson, createOrganization, login } from './helpers';

function decodeJwtPayload(token: string) {
  const [, payload] = token.split('.');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64').toString('utf8');
  return JSON.parse(json) as { sub: string; account_id: string; exp: number };
}

test.describe('Account proxy and billing scope', () => {
  test('active account controls proxy token account scope and billing context', async ({ page }) => {
    const email = `proxy-billing-${Date.now()}@example.com`;
    const password = 'TestPass123!';

    await login(page, email, password);

    const membershipsBefore = await apiJson<{
      memberships: Array<{ account: { id: string; type: 'personal' | 'organization' } }>;
    }>(page, '/api/v1/account/memberships');
    const personalAccountId = membershipsBefore.data.memberships.find((membership) => membership.account.type === 'personal')!.account.id;

    const orgAccountId = await createOrganization(page, 'Proxy Billing Org');

    const orgBilling = await apiJson<{ can_manage_billing: boolean }>(page, '/api/v1/account/billing');
    expect(orgBilling.status).toBe(200);
    expect(orgBilling.data.can_manage_billing).toBe(true);

    const orgProxyAuth = await apiJson<{ token: string }>(page, '/api/proxy-auth', { method: 'POST' });
    expect(orgProxyAuth.status).toBe(200);
    const orgPayload = decodeJwtPayload(orgProxyAuth.data.token);
    expect(orgPayload.account_id).toBe(orgAccountId);

    const switchPersonal = await apiJson<{ ok: true }>(page, '/api/v1/account/switch', {
      method: 'POST',
      body: { account_id: personalAccountId },
    });
    expect(switchPersonal.status).toBe(200);

    const personalBilling = await apiJson<{ can_manage_billing: boolean }>(page, '/api/v1/account/billing');
    expect(personalBilling.status).toBe(200);
    expect(personalBilling.data.can_manage_billing).toBe(true);

    const personalProxyAuth = await apiJson<{ token: string }>(page, '/api/proxy-auth', { method: 'POST' });
    expect(personalProxyAuth.status).toBe(200);
    const personalPayload = decodeJwtPayload(personalProxyAuth.data.token);
    expect(personalPayload.account_id).toBe(personalAccountId);
    expect(personalPayload.account_id).not.toBe(orgAccountId);
  });
});
