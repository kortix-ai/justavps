import { test, expect } from '@playwright/test';
import { apiJson, login, waitForDataLoad } from './helpers';

test.describe('Account organizations', () => {
  test('user can create, rename, and manage an organization', async ({ page }) => {
    const email = `acct-org-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const renamedOrg = `Playwright Org Renamed ${Date.now()}`;
    const teammateEmail = `teammate-${Date.now()}@example.com`;

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
    await page.fill('#invite-email', teammateEmail);
    await page.selectOption('#invite-role', 'member');
    const inviteResponse = page.waitForResponse((response) => response.url().includes('/api/v1/account/invitations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /send invite/i }).click();
    await inviteResponse;

    const invites = await apiJson<{ invitations: Array<{ email: string }> }>(page, '/api/v1/account/invitations');
    expect(invites.status).toBe(200);
    expect(invites.data.invitations.some((invite) => invite.email === teammateEmail)).toBe(true);

    const teammateContext = await page.context().browser()!.newContext({ baseURL: 'http://localhost:4100' });
    const teammatePage = await teammateContext.newPage();
    await login(teammatePage, teammateEmail, password);

    const pendingInvitations = await apiJson<{
      invitations: Array<{ id: string; account_name: string }>;
    }>(teammatePage, '/api/v1/account/me/invitations');
    expect(pendingInvitations.status).toBe(200);
    expect(pendingInvitations.data.invitations.some((invite) => invite.account_name === renamedOrg)).toBe(true);

    const invitationId = pendingInvitations.data.invitations.find((invite) => invite.account_name === renamedOrg)?.id;
    expect(invitationId).toBeTruthy();

    const acceptInvite = await apiJson<{ ok: true; account_id: string }>(teammatePage, `/api/v1/account/me/invitations/${invitationId}/accept`, {
      method: 'POST',
    });
    expect(acceptInvite.status).toBe(200);

    const switchAcceptedOrg = await apiJson<{ ok: true }>(teammatePage, '/api/v1/account/switch', {
      method: 'POST',
      body: { account_id: acceptInvite.data.account_id },
    });
    expect(switchAcceptedOrg.status).toBe(200);

    await teammatePage.goto('/settings');
    await waitForDataLoad(teammatePage, 20_000);
    await expect(teammatePage.getByText(renamedOrg).first()).toBeVisible();
    await teammateContext.close();

    await page.getByRole('tab', { name: /members/i }).click();
    page.once('dialog', (dialog) => dialog.accept());
    const removeMemberResponse = page.waitForResponse((response) => response.url().includes('/api/v1/account/members/') && response.request().method() === 'DELETE');
    await page.getByLabel(`Manage ${teammateEmail}`).click();
    await page.getByRole('menuitem', { name: /remove member/i }).click();
    await removeMemberResponse;

    const members = await apiJson<{ members: Array<{ user: { email: string } }> }>(page, '/api/v1/account/members');
    expect(members.status).toBe(200);
    expect(members.data.members).toHaveLength(1);
    expect(members.data.members.some((member) => member.user.email === teammateEmail)).toBe(false);

    await page.getByRole('tab', { name: /^general$/i }).click();
    page.once('dialog', (dialog) => dialog.accept());
    const deleteOrgResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/account') && response.request().method() === 'DELETE');
    await page.locator('#delete-organization-button').click();
    await deleteOrgResponse;
    await waitForDataLoad(page, 20_000);

    const meAfterDelete = await apiJson<{
      active_account: { type: 'personal' | 'organization' };
      memberships: Array<{ account: { id: string } }>;
    }>(page, '/api/v1/account/me');
    expect(meAfterDelete.status).toBe(200);
    expect(meAfterDelete.data.active_account.type).toBe('personal');
    expect(meAfterDelete.data.memberships.some((membership) => membership.account.id === createOrg.data.id)).toBe(false);
  });
});
