/**
 * E2E: Navigation — sidebar links, page transitions.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, `nav-${Date.now()}@example.com`, 'testpassword123');
  });

  test('sidebar has all navigation links', async ({ page }) => {
    await expect(page.locator('a:has-text("Machines")')).toBeVisible();
    await expect(page.locator('a:has-text("Images")')).toBeVisible();
    await expect(page.locator('a:has-text("Keys")')).toBeVisible();
    await expect(page.locator('a:has-text("Billing")')).toBeVisible();
    await expect(page.locator('a:has-text("Docs")')).toBeVisible();
  });

  test('navigate to Images via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Images")').click();
    await page.waitForURL('**/images');
    await expect(page.locator('h1:has-text("Images")')).toBeVisible();
  });

  test('navigate to Keys via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Keys")').click();
    await page.waitForURL('**/keys');
    await expect(page.locator('h1:has-text("Keys")')).toBeVisible();
  });

  test('navigate to Billing via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Billing")').click();
    await page.waitForURL('**/billing', { timeout: 20_000 });
    await expect(page.locator('h1:has-text("Billing")')).toBeVisible({ timeout: 20_000 });
  });

  test('navigate to Docs via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Docs")').click();
    await page.waitForURL('**/docs');
    await expect(page.getByRole('heading', { name: 'JustAVPS Docs' })).toBeVisible();
  });

  test('navigate back to Machines via sidebar', async ({ page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');
    await page.locator('a:has-text("Machines")').click();
    await page.waitForURL('**/machines');
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
  });

  test('JustAVPS branding in sidebar is visible', async ({ page }) => {
    await expect(page.locator('text=justavps').first()).toBeVisible();
  });

  test('settings accessible from sidebar', async ({ page }) => {
    await page.locator('a:has-text("Settings")').click();
    await page.waitForURL('**/settings', { timeout: 20_000 });
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });
});
