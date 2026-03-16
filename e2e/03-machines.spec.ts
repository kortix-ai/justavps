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
    await expect(page.locator('text=Create Your First Machine')).toBeVisible();
  });

  test('has "New Machine" button in header', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    
    const newMachineBtn = page.locator('a:has-text("New Machine")');
    await expect(newMachineBtn).toBeVisible();
    await expect(newMachineBtn).toHaveAttribute('href', '/machines/new');
  });

  test('"Create Your First Machine" links to provision wizard', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    
    const link = page.locator('a:has-text("Create Your First Machine")');
    await expect(link).toHaveAttribute('href', '/machines/new');
  });

  test('shows page title "Machines"', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
  });
});
