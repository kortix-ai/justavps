/**
 * E2E: Settings page, Keys page (SSH + API tabs), Billing page.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('shows page title and account info', async ({ page }) => {
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    await expect(page.locator('text=Active Account')).toBeVisible();
    await expect(page.locator('text=dev@justavps.com').first()).toBeVisible();
  });
});

test.describe('Keys Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/keys');
    await page.waitForLoadState('networkidle');
  });

  test('shows page title and key tabs', async ({ page }) => {
    await expect(page.locator('h1:has-text("Keys")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("API Keys")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Proxy Tokens")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("SSH Keys")')).toBeVisible();
  });

  test('SSH Keys tab: shows keys or empty state', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("SSH Keys")');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('button:has-text("Add SSH Key")')).toBeVisible();
  });

  test('SSH Keys tab: create a key via API and verify it shows', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("SSH Keys")');
    const createRes = await page.request.post('/api/v1/ssh-keys', {
      data: { name: 'PW Browser Key', public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA pw@e2e' },
    });
    expect(createRes.ok()).toBeTruthy();
    await page.reload();
    await page.click('button[role="tab"]:has-text("SSH Keys")');
    await page.waitForFunction(
      () => document.body.textContent?.includes('PW Browser Key'),
      { timeout: 10_000 }
    );
    expect(await page.locator('body').textContent()).toContain('PW Browser Key');
    const keyData = await createRes.json();
    await page.request.delete(`/api/v1/ssh-keys/${keyData.id}`);
  });

  test('API Keys tab: create key via API and verify it shows in list', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("API Keys")');
    const createRes = await page.request.post('/api/v1/api-keys', {
      data: { name: 'PW Browser API Key' },
    });
    expect(createRes.ok()).toBeTruthy();
    const keyData = await createRes.json();
    expect(keyData.key).toMatch(/^sk_live_/);
    await page.reload();
    await page.click('button[role="tab"]:has-text("API Keys")');
    await page.waitForFunction(
      () => document.body.textContent?.includes('PW Browser API Key'),
      { timeout: 10_000 }
    );
    expect(await page.locator('body').textContent()).toContain('PW Browser API Key');
    await page.request.delete(`/api/v1/api-keys/${keyData.id}`);
  });
});

test.describe('Billing Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');
  });

  test('shows billing data', async ({ page }) => {
    await expect(page.locator('h1:has-text("Billing")')).toBeVisible();
    await expect(page.locator('text=Machines').first()).toBeVisible();
    await expect(page.locator('text=Monthly').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  });
});
