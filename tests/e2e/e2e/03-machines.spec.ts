/**
 * E2E: Machines list page.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Machines Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, `machines-${Date.now()}@example.com`, 'testpassword123');
  });

  test('shows empty state when no machines exist', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h2:has-text("No machines yet")')).toBeVisible();
    await expect(page.locator('button:has-text("New Machine")').first()).toBeVisible();
  });

  test('has "New Machine" button in header', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('button:has-text("New Machine")').first()).toBeVisible();
  });

  test('empty state CTA opens deploy modal', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("New Machine")').first().click();
    await expect(page.locator('h2:has-text("Deploy a machine")')).toBeVisible();
  });

  test('shows page title "Machines"', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
  });
});
