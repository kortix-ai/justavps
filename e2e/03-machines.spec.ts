/**
 * E2E: Machines list page.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Machines Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows empty state when no machines exist', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h2:has-text("No machines yet")')).toBeVisible();
    await expect(page.locator('a:has-text("New Machine")').first()).toBeVisible();
  });

  test('has "New Machine" button in header', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    const links = page.locator('a[href="/machines/new"]');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('empty state CTA links to provision wizard', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    const links = page.locator('a[href="/machines/new"]');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('shows page title "Machines"', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
  });
});
