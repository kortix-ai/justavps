/**
 * E2E: Deploy modal — recommended plan + expandable size chooser.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Provision Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, `wizard-${Date.now()}@example.com`, 'testpassword123');
    await page.goto('/machines');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("New Machine")').first().click();
    await expect(page.locator('h2:has-text("Deploy a machine")')).toBeVisible();
  });

  test('shows wizard heading', async ({ page }) => {
    await expect(page.locator('h2:has-text("Deploy a machine")')).toBeVisible();
  });

  test('can close the modal', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('h2:has-text("Deploy a machine")')).toHaveCount(0);
  });

  test('shows recommended plan card', async ({ page }) => {
    await expect(page.locator('text=RECOMMENDED')).toBeVisible({ timeout: 15_000 });
    const body = await page.locator('body').textContent();
    expect(body).toContain('Basic');
    expect(body).toContain('Deploy machine');
  });

  test('shows expandable size chooser', async ({ page }) => {
    const toggle = page.locator('button:has-text("Need a different size?")').or(page.locator('button:has-text("Change plan")'));
    await expect(toggle.first()).toBeVisible();
    await toggle.first().click();
    await expect(page.locator('text=Starter').first()).toBeVisible();
    await expect(page.locator('text=Pro').first()).toBeVisible();
    await expect(page.locator('text=Power').first()).toBeVisible();
  });

  test('shows deploy controls and backups toggle', async ({ page }) => {
    await expect(page.locator('button:has-text("Deploy machine")')).toBeVisible();
    await expect(page.locator('text=Daily backups').first()).toBeVisible();
  });
});
