/**
 * E2E: Authentication flow — register, login, auth guard, sign out.
 */
import { test, expect } from '@playwright/test';
import { login, registerUser } from './helpers';

test.describe('Authentication', () => {
  test('unauthenticated user is redirected to /login from dashboard pages', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForURL('**/login**', { timeout: 10_000 });
    await expect(page.locator('text=Welcome back')).toBeVisible();
  });

  test('login page shows Sign In and Register tabs', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Welcome back')).toBeVisible();
    await expect(page.locator('button:has-text("Sign In")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Register")').first()).toBeVisible();
  });

  test('registration creates account and logs in', async ({ page }) => {
    const uniqueEmail = `e2e-register-${Date.now()}@justavps.com`;
    await page.goto('/login');
    await page.click('button:has-text("Register")');
    await page.fill('input#register-email', uniqueEmail);
    await page.fill('input#register-password', 'testpassword123');
    await page.click('button:has-text("Create Account")');
    await page.waitForURL('**/machines', { timeout: 10_000 });
  });

  test('login with correct password succeeds', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/machines/);
    await expect(page.locator('text=dev@justavps.com')).toBeVisible();
  });

  test('login with wrong password fails', async ({ page }) => {
    await page.goto('/login');
    await registerUser(page, 'dev@justavps.com', 'testpassword123');
    await page.goto('/login');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'dev@justavps.com');
    await page.fill('input[type="password"]', 'wrongpassword99');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid email or password')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('registration with duplicate email shows error', async ({ page }) => {
    await page.goto('/login');
    const email = `e2e-dup-${Date.now()}@justavps.com`;
    await registerUser(page, email, 'testpassword123');
    await page.goto('/login');
    await page.click('button:has-text("Register")');
    await page.fill('input#register-email', email);
    await page.fill('input#register-password', 'anotherpassword1');
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('text=already exists')).toBeVisible({ timeout: 5_000 });
  });

  test('registration with short password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.click('button:has-text("Register")');
    await page.fill('input#register-email', 'short@test.com');
    await page.fill('input#register-password', '1234567');
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('text=at least 8 characters')).toBeVisible({ timeout: 5_000 });
  });

  test('session persists across page navigations', async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=dev@justavps.com').first()).toBeVisible();
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=dev@justavps.com').first()).toBeVisible();
  });

  test('sign out redirects to landing page', async ({ page }) => {
    await login(page);
    const trigger = page.locator('text=dev@justavps.com').first();
    await trigger.click();
    const signOutItem = page.locator('text=Sign out');
    await signOutItem.waitFor({ state: 'visible', timeout: 3_000 });
    await signOutItem.click();
    await page.waitForURL('**/', { timeout: 10_000 });
  });
});
