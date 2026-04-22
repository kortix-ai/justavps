import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('v2 billing page renders payment state and comparison cards', async ({ page }) => {
  await login(page, `v2-billing-ui-${Date.now()}@example.com`, 'testpassword123', async (p) => {
    await p.route('**/api/v1/account', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'acct-1', name: 'Admin Org', slug: 'admin-org', type: 'organization', role: 'owner', billing_email: 'admin@example.com', stripe_customer_id: 'cus_123', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    });
    await p.route('**/api/v1/account/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'user-1', email: 'admin@example.com', is_admin: true }, memberships: [], active_account: { id: 'acct-1', name: 'Admin Org', type: 'organization', role: 'owner' }, is_admin: true }) });
    });
    await p.route('**/api/v1/account/usage', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current_period: { estimated_cost: 24 } }) });
    });
    await p.route('**/api/v1/account/billing', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_payment_method: true, can_manage_billing: true }) });
    });
    await p.route('**/api/v2/machines', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ machines: [] }) });
    });
    await p.route('**/api/v2/billing/overview', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modes: [{ id: 'flat_monthly', available: true, default: true, description: 'Flat monthly' }], current_period: { machines: 0, estimated_cost: 24 }, usage: { compute_seconds: 1000, storage_gb_seconds: 2000 }, plans: [{ id: 'basic', price_monthly: 12 }] }) });
    });
    await p.route('**/api/v2/billing/compare**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: 'basic', monthly_price: 12, hours_per_day: 24, competitors: { e2b_monthly_equivalent: 30, daytona_monthly_equivalent: 42 } }) });
    });
  });

  await page.goto('/v2/billing');
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
  await expect(page.getByText('Payment method on file')).toBeVisible();
  await expect(page.getByText('JustAVPS').first()).toBeVisible();
  await expect(page.getByText('E2B equivalent')).toBeVisible();
  await expect(page.getByText('Daytona equivalent')).toBeVisible();
});
