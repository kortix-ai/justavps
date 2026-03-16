/**
 * E2E: Navigation — sidebar links, page transitions, docs, snapshots.
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
    await expect(page.locator('a:has-text("Settings")')).toBeVisible();
    await expect(page.locator('a:has-text("Docs")')).toBeVisible();
  });

  test('navigate to Snapshots via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Snapshots")').click();
    await page.waitForURL('**/snapshots');
    
    await expect(page.locator('h1:has-text("Snapshots")')).toBeVisible();
    await expect(page.locator('text=No snapshots yet')).toBeVisible();
  });

  test('navigate to Settings via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Settings")').click();
    await page.waitForURL('**/settings');
    
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('navigate to Docs via sidebar', async ({ page }) => {
    await page.locator('a:has-text("Docs")').click();
    await page.waitForURL('**/docs');
    
    await expect(page.locator('h1:has-text("Documentation")')).toBeVisible();
  });

  test('navigate back to Machines via sidebar', async ({ page }) => {
    // Go to settings first
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // Click Machines in sidebar
    await page.locator('a:has-text("Machines")').click();
    await page.waitForURL('**/machines');
    
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
  });

  test('JustAVPS logo in sidebar is visible', async ({ page }) => {
    await expect(page.locator('a:has-text("JustAVPS")')).toBeVisible();
  });

  test('header shows Dashboard title', async ({ page }) => {
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible();
  });
});
