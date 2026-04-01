import { test, expect } from '@playwright/test';
import { apiJson, login, waitForDataLoad } from './helpers';

test.describe('Account organizations', () => {
  test('user can create, rename, and manage an organization', async ({ page }) => {
    const email = `acct-org-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const renamedOrg = `Playwright Org Renamed ${Date.now()}`;

    await login(page, email, password);
    const createOrg = await apiJson<{ id: string }>(page, '/api/v1/account/organizations', {
      method: 'POST',
      body: { name: 'Playwright Org' },
    });
    expect(createOrg.status).toBe(201);
    const switchOrg = await apiJson<{ ok: true }>(page, '/api/v1/account/switch', {
      method: 'POST',
      body: { account_id: createOrg.data.id },
    });
    expect(switchOrg.status).toBe(200);

    await page.goto('/settings');
    await waitForDataLoad(page, 20_000);

    await expect(page.getByText('Playwright Org').first()).toBeVisible();
    await expect(page.getByText('Organization').first()).toBeVisible();

    const renameResponse = page.waitForResponse((response) => response.url().includes('/api/v1/account') && response.request().method() === 'PATCH');
    await page.getByLabel('Organization name').fill(renamedOrg);
    await page.getByRole('button', { name: /^save$/i }).click();
    await renameResponse;

    await expect(page.getByLabel('Organization name')).toHaveValue(renamedOrg);
    await expect(page.getByText(renamedOrg).first()).toBeVisible();

    const me = await apiJson<{
      active_account: { id: string; name: string; slug: string; type: 'personal' | 'organization' };
      memberships: Array<{ account: { id: string; name: string; slug: string } }>;
    }>(page, '/api/v1/account/me');
    expect(me.status).toBe(200);
    expect(me.data.active_account.type).toBe('organization');
    expect(me.data.active_account.name).toBe(renamedOrg);
    expect(me.data.active_account.slug).toContain('playwright-org-renamed');
    expect(me.data.memberships.some((membership) => membership.account.id === createOrg.data.id && membership.account.name === renamedOrg)).toBe(true);

    await page.getByRole('tab', { name: /invitations/i }).click();
    await page.fill('#invite-email', 'teammate@example.com');
    await page.selectOption('#invite-role', 'member');
    const inviteResponse = page.waitForResponse((response) => response.url().includes('/api/v1/account/invitations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /send invite/i }).click();
    await inviteResponse;

    const invites = await apiJson<{ invitations: Array<{ email: string }> }>(page, '/api/v1/account/invitations');
    expect(invites.status).toBe(200);
    expect(invites.data.invitations.some((invite) => invite.email === 'teammate@example.com')).toBe(true);
  });
});
