/**
 * E2E: Navigation — sidebar links, page transitions.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('sidebar has all navigation links', async ({ page }) => {
    await expect(page.locator('a:has-text("Machines")')).toBeVisible();
    await expect(page.locator('a:has-text("Snapshots")')).toBeVisible();
    await expect(page.locator('a:has-text("Keys")')).toBeVisible();
    await expect(page.locator('a:has-text("Billing")')).toBeVisible();
    await expect(page.locator('a:has-text("Docs")')).toBeVisible();
  });

  test('navigate to Snapshots via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Snapshots")').click();
    await page.waitForURL('**/snapshots');
    await expect(page.locator('h1:has-text("Snapshots")')).toBeVisible();
  });

  test('navigate to Keys via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Keys")').click();
    await page.waitForURL('**/keys');
    await expect(page.locator('h1:has-text("Keys")')).toBeVisible();
  });

  test('navigate to Billing via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Billing")').click();
    await page.waitForURL('**/billing');
    await expect(page.locator('h1:has-text("Billing")')).toBeVisible();
  });

  test('navigate to Docs via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Docs")').click();
    await page.waitForURL('**/docs');
    await expect(page.locator('h1:has-text("Documentation")')).toBeVisible();
  });

  test('navigate back to Machines via sidebar', async ({ page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');
    await page.locator('a:has-text("Machines")').click();
    await page.waitForURL('**/machines');
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
  });

  test('JustAVPS branding in sidebar is visible', async ({ page }) => {
    await expect(page.locator('text=JustAVPS.').first()).toBeVisible();
  });

  test('settings accessible from user dropdown', async ({ page }) => {
    const trigger = page.locator('text=dev@justavps.com').first();
    await trigger.click();
    const settingsItem = page.locator('text=Settings').first();
    await settingsItem.waitFor({ state: 'visible', timeout: 3_000 });
    await settingsItem.click();
    await page.waitForURL('**/settings', { timeout: 10_000 });
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });
});
