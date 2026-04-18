/**
 * E2E: Landing page.
 */
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders hero with title and CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("AI Sandbox")')).toBeVisible();
    await expect(page.locator('button:has-text("Get a machine")').first()).toBeVisible();
    await expect(page.locator('a:has-text("Docs")').first()).toBeVisible();
  });

  test('renders programmatic control section', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h2:has-text("Programmatic Control.")')).toBeVisible();
    await expect(page.locator('text=Machine').first()).toBeVisible();
    await expect(page.locator('text=Filesystem').first()).toBeVisible();
    await expect(page.locator('text=Coding Agents').first()).toBeVisible();
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

  test('Get a machine CTA is clickable from the hero', async ({ page }) => {
    await page.goto('/');
    await page.locator('button:has-text("Get a machine")').first().click();
    await expect(page.locator('button:has-text("Get a machine")').first()).toBeVisible();
  });
});
