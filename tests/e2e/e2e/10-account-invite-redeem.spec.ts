import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { apiJson, login } from './helpers';

function createInviteToken(accountId: string, ownerEmail: string, invitedEmail: string) {
  const output = execFileSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/test/create-account-invite.ts', accountId, ownerEmail, invitedEmail, 'member'],
    {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf8',
    },
  );

  return JSON.parse(output) as { rawToken: string; invitationId: string };
}

test.describe('Account invitation redemption', () => {
  test('invitee can sign up from invite and lands in the organization as member', async ({ browser, page }) => {
    const ownerEmail = `owner-${Date.now()}@example.com`;
    const inviteeEmail = `invitee-${Date.now()}@example.com`;
    const password = 'TestPass123!';

    await login(page, ownerEmail, password);
    const createOrg = await apiJson<{ id: string }>(page, '/api/v1/account/organizations', {
      method: 'POST',
      body: { name: 'Invite Redemption Org' },
    });
    expect(createOrg.status).toBe(201);
    const orgId = createOrg.data.id;
    await apiJson(page, '/api/v1/account/switch', { method: 'POST', body: { account_id: orgId } });

    const { rawToken } = createInviteToken(orgId, ownerEmail, inviteeEmail);
    expect(rawToken).toBeTruthy();

    const inviteeContext = await browser.newContext({ baseURL: 'http://localhost:4100' });
    const inviteePage = await inviteeContext.newPage();

    await inviteePage.goto(`/invite/${rawToken}`);
    await inviteePage.waitForURL('**/login**', { timeout: 10000 });
    await inviteePage.getByRole('button', { name: /sign up/i }).click();
    await inviteePage.fill('input#register-email', inviteeEmail);
    await inviteePage.fill('input#register-password', password);
    await inviteePage.getByRole('button', { name: /create account/i }).click();

    await expect.poll(async () => {
      const me = await apiJson<{
        active_account: { id: string; role: string };
      }>(inviteePage, '/api/v1/account/me');
      return me.status === 200 ? me.data.active_account.id : null;
    }, { timeout: 45_000 }).toBe(orgId);

    const me = await apiJson<{
      memberships: Array<{ role: string; account: { id: string; type: string; name: string } }>;
      active_account: { id: string; type: string; role: string };
    }>(inviteePage, '/api/v1/account/me');
    expect(me.status).toBe(200);
    expect(me.data.active_account.id).toBe(orgId);
    expect(me.data.active_account.role).toBe('member');
    expect(me.data.memberships.some((membership) => membership.account.id === orgId)).toBe(true);

    const billing = await apiJson<{ can_manage_billing: boolean }>(inviteePage, '/api/v1/account/billing');
    expect(billing.status).toBe(200);
    expect(billing.data.can_manage_billing).toBe(false);

    const members = await apiJson<{ members: Array<{ user: { email: string }; role: string }> }>(page, '/api/v1/account/members');
    expect(members.status).toBe(200);
    expect(members.data.members.some((member) => member.user.email === inviteeEmail && member.role === 'member')).toBe(true);

    await inviteeContext.close();
  });

  test('invite redemption fails for the wrong signed-in email', async ({ browser, page }) => {
    const ownerEmail = `owner-mismatch-${Date.now()}@example.com`;
    const wrongEmail = `wrong-${Date.now()}@example.com`;
    const invitedEmail = `invited-${Date.now()}@example.com`;
    const password = 'TestPass123!';

    await login(page, ownerEmail, password);
    const createOrg = await apiJson<{ id: string }>(page, '/api/v1/account/organizations', {
      method: 'POST',
      body: { name: 'Invite Mismatch Org' },
    });
    expect(createOrg.status).toBe(201);
    const orgId = createOrg.data.id;
    await apiJson(page, '/api/v1/account/switch', { method: 'POST', body: { account_id: orgId } });

    const { rawToken } = createInviteToken(orgId, ownerEmail, invitedEmail);

    const wrongContext = await browser.newContext({ baseURL: 'http://localhost:4100' });
    const wrongPage = await wrongContext.newPage();
    await login(wrongPage, wrongEmail, password);

    const me = await apiJson<{ user: { email: string } }>(wrongPage, '/api/v1/account/me');
    expect(me.status).toBe(200);
    expect(me.data.user.email).toBe(wrongEmail);

    const redeem = await apiJson<{ message: string }>(wrongPage, '/api/v1/account/invitations/redeem', {
      method: 'POST',
      body: { token: rawToken },
    });
    expect(redeem.status).toBe(400);
    expect(redeem.data.message).toContain('does not match invitation email');

    await wrongContext.close();
  });
});
