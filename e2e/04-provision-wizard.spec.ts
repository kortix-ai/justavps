/**
 * E2E: Provision wizard — simplified 3-step flow.
 * Template → Server Type → Create (SSH key auto-generated)
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Provision Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/machines/new');
    await page.waitForLoadState('networkidle');
  });

  test('shows 3-step progress indicator', async ({ page }) => {
    const body = await page.locator('body').textContent();
    expect(body).toContain('Template');
    expect(body).toContain('Server');
    expect(body).toContain('Create');
  });

  test('step 1: loads and displays templates', async ({ page }) => {
    await page.waitForFunction(
      () => document.body.textContent?.includes('Blank Ubuntu'),
      { timeout: 10_000 }
    );
    for (const t of ['Blank Ubuntu', 'Claude Code', 'OpenCode', 'Docker']) {
      const body = await page.locator('body').textContent();
      expect(body).toContain(t);
    }
  });

  test('step 1: Next disabled until template selected', async ({ page }) => {
    const nextBtn = page.locator('button:has-text("Next")');
    await expect(nextBtn).toBeDisabled();
    await page.waitForFunction(() => document.body.textContent?.includes('Blank Ubuntu'), { timeout: 10_000 });
    await page.locator('div[class*="cursor-pointer"]:has-text("Blank Ubuntu")').first().click();
    await expect(nextBtn).toBeEnabled();
  });

  test('full wizard flow: template → server → create', async ({ page }) => {
    // Step 1
    await page.waitForFunction(() => document.body.textContent?.includes('Blank Ubuntu'), { timeout: 10_000 });
    await page.locator('div[class*="cursor-pointer"]:has-text("Blank Ubuntu")').first().click();
    await page.click('button:has-text("Next")');

    // Step 2
    await expect(page.locator('h2:has-text("Choose Server")')).toBeVisible();
    await page.waitForFunction(() => document.body.textContent?.includes('$'), { timeout: 10_000 });
    await page.locator('div[class*="cursor-pointer"]').first().click();
    await page.click('button:has-text("Next")');

    // Step 3
    await expect(page.locator('h2:has-text("Create Machine")')).toBeVisible();
    await expect(page.locator('text=Auto-generated')).toBeVisible(); // SSH key status
    await expect(page.locator('button:has-text("Create Machine")')).toBeEnabled();
    const body = await page.locator('body').textContent();
    expect(body).toContain('Blank Ubuntu');
    expect(body).toMatch(/\$\d+\/mo/);
  });

  test('back navigation works', async ({ page }) => {
    await page.waitForFunction(() => document.body.textContent?.includes('Blank Ubuntu'), { timeout: 10_000 });
    await page.locator('div[class*="cursor-pointer"]:has-text("Blank Ubuntu")').first().click();
    await page.click('button:has-text("Next")');
    await expect(page.locator('h2:has-text("Choose Server")')).toBeVisible();
    await page.click('button:has-text("Back")');
    await expect(page.locator('h2:has-text("Choose a Template")')).toBeVisible();
  });

  test('Show All server types expands list', async ({ page }) => {
    await page.waitForFunction(() => document.body.textContent?.includes('Blank Ubuntu'), { timeout: 10_000 });
    await page.locator('div[class*="cursor-pointer"]:has-text("Blank Ubuntu")').first().click();
    await page.click('button:has-text("Next")');
    await page.waitForFunction(() => document.body.textContent?.includes('Show All'), { timeout: 10_000 });
    await page.click('button:has-text("Show All")');
    await expect(page.locator('button:has-text("Show All")')).not.toBeVisible({ timeout: 3_000 });
  });
});
