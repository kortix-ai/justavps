/**
 * E2E: Machine detail page.
 * Seeds a machine record directly in DB to test detail view.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import postgres from 'postgres';

let testMachineId: string | null = null;
const DB_URL = 'postgresql://justavps:justavps123@localhost:5433/justavps';

test.describe('Machine Detail Page', () => {
  test.beforeAll(async () => {
    const sql = postgres(DB_URL);
    const [user] = await sql`SELECT id FROM users WHERE email = 'dev@justavps.com'`;
    if (!user) throw new Error('Dev user not found');

    // Clean up any existing test machines first
    await sql`DELETE FROM machines WHERE slug = 'pw-test1'`;

    const [machine] = await sql`
      INSERT INTO machines (owner_id, slug, name, status, server_type, template, region, ip, machine_token, code_server_password, hetzner_id, ready_at, last_heartbeat_at, last_heartbeat)
      VALUES (${user.id}, 'pw-test1', 'Playwright Test Machine', 'ready', 'cx23', 'blank', 'nbg1', '10.0.0.99', 'mt_test123', 'testpassword12345678', 99999, NOW(), NOW(),
        '{"cpu": 15, "memory": 42, "disk": 18, "services": {"code_server": true, "caddy": true, "justavps_agent": true}}'::jsonb)
      RETURNING id
    `;
    testMachineId = machine.id;
    await sql.end();
  });

  test.afterAll(async () => {
    if (testMachineId) {
      const sql = postgres(DB_URL);
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
  });

  test('machine detail shows title, status, server type', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Playwright Test Machine'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('Playwright Test Machine');
    expect(body).toContain('Ready');
    expect(body).toContain('cx23');
    expect(body).toContain('NBG1');
  });

  test('machine detail shows SSH connection string', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('10.0.0.99'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('ssh user@10.0.0.99');
  });

  test('machine detail shows overview card with IP and template', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Overview'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('10.0.0.99');
    expect(body).toContain('blank');
  });

  test('machine detail shows resource usage from heartbeat', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Resource Usage'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('CPU');
    expect(body).toContain('Memory');
    expect(body).toContain('Disk');
    expect(body).toContain('code_server');
    expect(body).toContain('Running');
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

  test('machine detail has delete button with confirmation dialog', async ({ page }) => {
    await login(page);
    await page.goto(`/machines/${testMachineId}`);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Delete'),
      { timeout: 10_000 }
    );
    
    // Click delete (the first visible one, not inside dialog)
    const deleteBtns = page.locator('button:has-text("Delete")');
    await deleteBtns.first().click();
    
    // Dialog should appear
    await page.waitForFunction(
      () => document.body.textContent?.includes('This action cannot be undone'),
      { timeout: 5_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('Delete Machine');
    expect(body).toContain('This action cannot be undone');
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
