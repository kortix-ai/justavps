/**
 * E2E: Landing page.
 */
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders hero with title and dual CTAs', async ({ page }) => {
    await page.goto('/');
    // Hero title
    await expect(page.locator('h1:has-text("Just a VPS")')).toBeVisible();
    // Two CTA buttons
    await expect(page.locator('a:has-text("Get Started")')).toBeVisible();
    await expect(page.locator('a:has-text("Documentation")')).toBeVisible();
  });

  test('renders pricing section with real Hetzner data', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.body.textContent?.includes('/mo'),
      { timeout: 15_000 }
    );
    const startButtons = page.locator('a:has-text("Start Now")');
    const count = await startButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('renders footer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
  });

  test('feature grid shows 6 features', async ({ page }) => {
    await page.goto('/');
    for (const feature of ['1-Click Deploy', 'Browser IDE', 'SSH Ready', 'Port Proxy', 'AI Agent Ready', 'Fair Pricing']) {
      const body = await page.locator('body').textContent();
      expect(body).toContain(feature);
    }
  });

  test('Get Started links to provision wizard', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a:has-text("Get Started")');
    await expect(link).toHaveAttribute('href', '/machines/new');
  });
});
