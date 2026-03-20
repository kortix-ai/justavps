/**
 * E2E: Machine detail page.
 * Seeds a machine record directly in DB to test detail view.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import postgres from 'postgres';

let testMachineId: string | null = null;
let testSubscriptionId: string | null = null;
const DB_URL = process.env.DATABASE_URL || 'postgresql://justavps:justavps123@localhost:54330/justavps';

test.describe('Machine Detail Page', () => {
  test.beforeAll(async () => {
    const sql = postgres(DB_URL);
    const [user] = await sql`SELECT id FROM users WHERE email = 'dev@justavps.com'`;
    if (!user) throw new Error('Dev user not found');

    // Clean up any existing test machines first
    await sql`DELETE FROM subscriptions WHERE stripe_subscription_id = 'sub_pw_test_machine'`;
    await sql`DELETE FROM machines WHERE slug = 'pw-test1'`;

    const [machine] = await sql`
      INSERT INTO machines (owner_id, slug, name, status, provider, server_type, region, ip, machine_token, code_server_password, provider_server_id, ready_at, last_heartbeat_at, last_heartbeat)
      VALUES (${user.id}, 'pw-test1', 'Playwright Test Machine', 'ready', 'hetzner', 'cx23', 'nbg1', '10.0.0.99', 'mt_test123', 'testpassword12345678', '99999', NOW(), NOW(),
        '{"cpu": 15, "memory": 42, "disk": 18, "services": {"code_server": true, "caddy": true, "justavps_agent": true}}'::jsonb)
      RETURNING id
    `;
    testMachineId = machine.id;

    const [subscription] = await sql`
      INSERT INTO subscriptions (
        machine_id,
        owner_id,
        stripe_subscription_id,
        stripe_subscription_item_id,
        status,
        cancel_at_period_end,
        cancel_at,
        cancelled_at,
        current_period_end
      )
      VALUES (
        ${machine.id},
        ${user.id},
        'sub_pw_test_machine',
        'si_pw_test_machine',
        'active',
        true,
        NOW() + INTERVAL '7 days',
        NOW(),
        NOW() + INTERVAL '7 days'
      )
      RETURNING id
    `;
    testSubscriptionId = subscription.id;
    await sql.end();
  });

  test.afterAll(async () => {
    if (testMachineId) {
      const sql = postgres(DB_URL);
      if (testSubscriptionId) {
        await sql`DELETE FROM subscriptions WHERE id = ${testSubscriptionId}`;
      }
      await sql`DELETE FROM machines WHERE id = ${testMachineId}`;
      await sql.end();
    }
  });

  test('machine appears in machines list', async ({ page }) => {
    await login(page);
    await page.goto('/machines');
    await page.waitForFunction(
      () => document.body.textContent?.includes('Playwright Test Machine'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('Playwright Test Machine');
    expect(body).toContain('cx23');
    expect(body).toContain('Cancelling');
  });

  test('machine detail shows title, status, server type', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await expect(page.getByText('Playwright Test Machine')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();
    await expect(page.getByText('cx23')).toBeVisible();
    await expect(page.getByText('EU')).toBeVisible();
  });

  test('machine detail shows SSH connection string', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await expect(page.getByText('10.0.0.99', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ssh -i ~/.ssh/justavps_pw-test1 root@10.0.0.99').first()).toBeVisible();
  });

  test('machine detail shows stats tab with IP and region', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page.getByText('Resource Usage')).toBeVisible();
    await expect(page.getByText('Region')).toBeVisible();
    await expect(page.getByText('EU', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('10.0.0.99', { exact: true }).last()).toBeVisible();
  });

  test('machine detail shows resource usage from heartbeat', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page.getByText('CPU')).toBeVisible();
    await expect(page.getByText('Memory')).toBeVisible();
    await expect(page.getByText('Disk')).toBeVisible();
    await expect(page.getByText('Plan')).toBeVisible();
    await expect(page.getByText('IP', { exact: true })).toBeVisible();
  });

  test('machine detail has reboot button enabled', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Reboot'),
      { timeout: 10_000 }
    );
    await expect(page.locator('button:has-text("Reboot")')).toBeEnabled();
  });

  test('machine detail shows subscription cancellation state and no delete button', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Subscription cancelled'),
      { timeout: 10_000 }
    );

    const body = await page.locator('body').textContent();
    expect(body).toContain('Subscription cancelled');
    expect(body).toContain('Billing');
    await expect(page.locator('button:has-text("Delete")')).toHaveCount(0);
  });

  test('machine detail shows terminal section', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Terminal'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('Terminal');
  });

  test('nonexistent machine shows error page', async ({ page }) => {
    await login(page);
    await page.goto('/machines/00000000-0000-0000-0000-000000000000');
    await page.waitForFunction(
      () => document.body.textContent?.includes('Machine Not Found'),
      { timeout: 10_000 }
    );
    await expect(page.locator('button:has-text("Back to Machines")')).toBeVisible();
  });
});
