/**
 * E2E: Landing page.
 */
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders hero with title and CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("AI Sandbox")')).toBeVisible();
    await expect(page.locator('a:has-text("Get a machine")')).toBeVisible();
    await expect(page.locator('a:has-text("Read the docs")')).toBeVisible();
  });

  test('renders code demo with tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button:has-text("REST API")')).toBeVisible();
    await expect(page.locator('button:has-text("SSH + Claude Code")')).toBeVisible();
    await expect(page.locator('button:has-text("Agent Worker")')).toBeVisible();
  });

  test('renders pricing comparison', async ({ page }) => {
    await page.goto('/');
    const body = await page.locator('body').textContent();
    expect(body).toContain('E2B');
    expect(body).toContain('Daytona');
    expect(body).toContain('JustAVPS');
    expect(body).toContain('$12');
  });

  test('renders footer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
  });

  test('Get a machine links to provision wizard', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a:has-text("Get a machine")');
    await expect(link).toHaveAttribute('href', '/machines/new');
  });
});
