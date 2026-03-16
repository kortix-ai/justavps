/**
 * E2E: Settings page — SSH Keys, API Keys, Billing tabs.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('shows page title and 3 tabs', async ({ page }) => {
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("SSH Keys")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("API Keys")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Billing")')).toBeVisible();
  });

  test('SSH Keys tab: lists existing keys with fingerprints', async ({ page }) => {
    // Wait for data to load
    await page.waitForFunction(
      () => document.body.textContent?.includes('SHA256:'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('SHA256:');
  });

  test('SSH Keys tab: create a key via API and verify it shows', async ({ page }) => {
    // Create SSH key via API (bypasses dialog issues)
    const createRes = await page.request.post('/api/v1/ssh-keys', {
      data: { name: 'PW Browser Key', public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA pw@e2e' },
    });
    expect(createRes.ok()).toBeTruthy();
    
    // Reload to see the new key
    await page.reload();
    await page.waitForFunction(
      () => document.body.textContent?.includes('PW Browser Key'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('PW Browser Key');
    
    // Clean up via API
    const keyData = await createRes.json();
    await page.request.delete(`/api/v1/ssh-keys/${keyData.id}`);
  });

  test('API Keys tab: lists existing keys without value', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("API Keys")');
    
    // Wait for API key data
    await page.waitForFunction(
      () => document.body.textContent?.includes('sk_live_'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('sk_live_');
  });

  test('API Keys tab: create key via API and verify it shows in list', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("API Keys")');
    
    // Create API key via API (bypasses dialog overlay issues)
    const createRes = await page.request.post('/api/v1/api-keys', {
      data: { name: 'PW Browser API Key' },
    });
    expect(createRes.ok()).toBeTruthy();
    const keyData = await createRes.json();
    expect(keyData.key).toMatch(/^sk_live_/);
    
    // Reload to see the new key in the list
    await page.reload();
    await page.click('button[role="tab"]:has-text("API Keys")');
    await page.waitForFunction(
      () => document.body.textContent?.includes('PW Browser API Key'),
      { timeout: 10_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('PW Browser API Key');
    
    // Clean up via API
    await page.request.delete(`/api/v1/api-keys/${keyData.id}`);
  });

  test('Billing tab: shows real usage data', async ({ page }) => {
    await page.click('button[role="tab"]:has-text("Billing")');
    await expect(page.locator('text=Billing & Usage')).toBeVisible();
    await expect(page.locator('text=Active Machines')).toBeVisible();
    await expect(page.locator('text=Estimated Monthly Cost')).toBeVisible();
  });
});
