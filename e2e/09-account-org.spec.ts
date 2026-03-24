import { test, expect } from '@playwright/test';
import { apiJson, login } from './helpers';

test.describe('Account organizations', () => {
  test('user can create an organization and manage invitations', async ({ page }) => {
    const email = `acct-org-${Date.now()}@example.com`;
    const password = 'TestPass123!';

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

    await expect(page.getByText('Playwright Org').first()).toBeVisible();
    await expect(page.getByText('organization account')).toBeVisible();

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
