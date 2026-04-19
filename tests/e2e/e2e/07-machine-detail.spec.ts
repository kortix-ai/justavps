/**
 * E2E: Machine detail page.
 * Seeds a machine record directly in DB to test detail view.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import postgres from 'postgres';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let testMachineId: string | null = null;
let testSubscriptionId: string | null = null;

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) return match[1].replace(/^['"]|['"]$/g, '');
  }
  return 'postgresql://justavps:justavps123@localhost:54330/justavps';
}

const DB_URL = resolveDatabaseUrl();

async function openReadyMachineDetail(page: import('@playwright/test').Page, machineId: string) {
  await page.goto(`/machines/${machineId}`);
  await expect(page.getByText('Playwright Test Machine')).toBeVisible({ timeout: 30_000 });
}

test.describe('Machine Detail Page', () => {
  test.beforeAll(async () => {
    const sql = postgres(DB_URL);
    const [user] = await sql`SELECT id, email, default_account_id FROM users WHERE email = 'dev@justavps.com'`;
    if (!user) throw new Error('Dev user not found');

    let accountId = user.default_account_id as string | null;
    if (!accountId) {
      const [existingAccount] = await sql`
        SELECT id FROM accounts
        WHERE personal_for_user_id = ${user.id}
        LIMIT 1
      `;

      if (existingAccount) {
        accountId = existingAccount.id;
      } else {
        const slug = `dev-${Date.now()}`;
        const [createdAccount] = await sql`
          INSERT INTO accounts (type, name, slug, personal_for_user_id, billing_email)
          VALUES ('personal', 'dev', ${slug}, ${user.id}, ${user.email})
          RETURNING id
        `;
        accountId = createdAccount.id;
      }

      await sql`UPDATE users SET default_account_id = ${accountId} WHERE id = ${user.id}`;
      await sql`
        INSERT INTO account_memberships (account_id, user_id, role)
        VALUES (${accountId}, ${user.id}, 'owner')
        ON CONFLICT (account_id, user_id) DO NOTHING
      `;
    }

    // Clean up any existing test machines first
    await sql`DELETE FROM subscriptions WHERE stripe_subscription_id = 'sub_pw_test_machine'`;
    await sql`DELETE FROM machines WHERE slug = 'pw-test1'`;

    const [machine] = await sql`
      INSERT INTO machines (owner_id, account_id, slug, name, status, provider, server_type, region, ip, machine_token, code_server_password, provider_server_id, ready_at, last_heartbeat_at, last_heartbeat)
      VALUES (${user.id}, ${accountId}, 'pw-test1', 'Playwright Test Machine', 'ready', 'hetzner', 'cx23', 'nbg1', '10.0.0.99', 'mt_test123', 'testpassword12345678', '99999', NOW(), NOW(),
        '{"cpu": 15, "memory": 42, "disk": 18, "services": {"code_server": true, "caddy": true, "justavps_agent": true}}'::jsonb)
      RETURNING id
    `;
    testMachineId = machine.id;

    const [subscription] = await sql`
      INSERT INTO subscriptions (
        machine_id,
        owner_id,
        account_id,
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
        ${accountId},
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
    test.setTimeout(90_000);
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    try {
      await expect(page.getByText('Playwright Test Machine')).toBeVisible({ timeout: 30_000 });
    } catch {
      await page.reload();
      await expect(page.getByText('Playwright Test Machine')).toBeVisible({ timeout: 30_000 });
    }
    const body = await page.locator('body').textContent();
    expect(body).toContain('Playwright Test Machine');
    expect(body).toContain('Running');
    expect(body).toContain('cx23');
    expect(body).toContain('EU');
  });

  test('machine detail shows SSH connection string', async ({ page }) => {
    await login(page);
    await openReadyMachineDetail(page, testMachineId!);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.waitForFunction(() => document.body.textContent?.includes('10.0.0.99'), { timeout: 20_000 });
        break;
      } catch {
        if (attempt === 2) throw new Error('Machine SSH details did not load');
        await page.reload();
      }
    }
    await expect(page.getByText('10.0.0.99', { exact: true }).first()).toBeVisible();
    const body = await page.locator('body').textContent();
    expect(body).toContain('ssh -i ~/.ssh/justavps_pw-test1');
    expect(body).toContain('pw-test1');
  });

  test('machine detail shows stats tab with IP and region', async ({ page }) => {
    await login(page);
    await openReadyMachineDetail(page, testMachineId!);
    await expect(page.getByRole('tab', { name: 'Stats' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page.getByText('Resource Usage')).toBeVisible();
    await expect(page.getByText('Region')).toBeVisible();
    await expect(page.getByText('EU', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('10.0.0.99', { exact: true }).last()).toBeVisible();
  });

  test('machine detail shows resource usage from heartbeat', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openReadyMachineDetail(page, testMachineId!);
      await expect(page.getByRole('tab', { name: 'Stats' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('tab', { name: 'Stats' }).click();

      try {
        await expect(page.getByText('CPU')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Memory')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Disk')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Plan')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('IP', { exact: true })).toBeVisible({ timeout: 20_000 });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  });

  test('machine detail has reboot button enabled', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await openReadyMachineDetail(page, testMachineId!);
    await expect(page.getByRole('button', { name: 'Reboot' })).toBeEnabled({ timeout: 30_000 });
  });

  test('machine detail shows subscription cancellation state and no delete button', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await openReadyMachineDetail(page, testMachineId!);
    await expect(page.getByRole('button', { name: 'Reboot' })).toBeEnabled({ timeout: 30_000 });

    const body = await page.locator('body').textContent();
    expect(body).toContain('Subscription cancelled');
    expect(body).toContain('Billing');
    await expect(page.locator('button:has-text("Delete")')).toHaveCount(0);
  });

  test('machine detail shows terminal section', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await openReadyMachineDetail(page, testMachineId!);
    await expect(page.getByRole('tab', { name: 'Terminal' })).toBeVisible({ timeout: 30_000 });
    const body = await page.locator('body').textContent();
    expect(body).toContain('Terminal / Plain SSH');
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
