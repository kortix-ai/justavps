/**
 * E2E: Landing page.
 */
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders hero with title and dual CTAs', async ({ page }) => {
    await page.goto('/');
    // Hero title
    await expect(page.locator('h1:has-text("Your Machine")')).toBeVisible();
    // Two CTA buttons
    await expect(page.locator('a:has-text("Deploy a Machine")')).toBeVisible();
    await expect(page.locator('a:has-text("Read the Docs")')).toBeVisible();
  });

  test('renders pricing section with real Hetzner data', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.body.textContent?.includes('/mo'),
      { timeout: 15_000 }
    );
    const deployButtons = page.locator('a:has-text("Deploy Now")');
    const count = await deployButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('renders footer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
  });

  test('feature grid shows 6 features', async ({ page }) => {
    await page.goto('/');
    for (const feature of ['Claude Code', 'OpenCode', 'Browser IDE', 'Full SSH Access', 'Docker Ready', 'Daily Backups']) {
      const body = await page.locator('body').textContent();
      expect(body).toContain(feature);
    }
  });

  test('Deploy a Machine links to provision wizard', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a:has-text("Deploy a Machine")');
    await expect(link).toHaveAttribute('href', '/machines/new');
  });
});
