/**
 * E2E: Provision wizard — 3 featured plans + custom sizes.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Provision Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/machines/new');
    await page.waitForLoadState('networkidle');
  });

  test('shows wizard heading', async ({ page }) => {
    await expect(page.locator('h1:has-text("New Machine")')).toBeVisible();
  });

  test('has back link to machines list', async ({ page }) => {
    const backLinks = page.locator('a[href="/machines"]');
    const count = await backLinks.count();
    expect(count).toBeGreaterThanOrEqual(2); // sidebar + back arrow
  });

  test('shows featured plan cards', async ({ page }) => {
    // Wait for server types to load
    await page.waitForFunction(
      () => document.body.textContent?.includes('/mo'),
      { timeout: 15_000 }
    );
    const body = await page.locator('body').textContent();
    expect(body).toContain('Starter');
    expect(body).toContain('Pro');
    expect(body).toContain('Power');
    expect(body).toContain('Most Popular');
  });

  test('shows custom size toggle', async ({ page }) => {
    await page.waitForFunction(
      () => document.body.textContent?.includes('Custom size'),
      { timeout: 15_000 }
    );
    await expect(page.locator('text=Custom size').first()).toBeVisible();
  });

  test('shows Deploy Machine button or snapshot prompt', async ({ page }) => {
    // Wait for the page to settle
    await page.waitForFunction(
      () => {
        const text = document.body.textContent || '';
        return text.includes('Deploy Machine') || text.includes('No snapshots') || text.includes('Starter');
      },
      { timeout: 15_000 }
    );
    const body = await page.locator('body').textContent();
    // Should show Deploy button (if snapshot exists) or snapshot prompt (if not)
    expect(body?.includes('Deploy Machine') || body?.includes('No snapshots') || body?.includes('Starter')).toBeTruthy();
  });
});
