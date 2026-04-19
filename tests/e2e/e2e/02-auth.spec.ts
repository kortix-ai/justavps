/**
 * E2E: Authentication flow — register, login, auth guard, sign out.
 */
import { test, expect } from '@playwright/test';
import { login, registerUser } from './helpers';

test.describe('Authentication', () => {
  test('unauthenticated user is redirected to /login from dashboard pages', async ({ page }) => {
    await page.goto('/machines');
    await page.waitForURL('**/login**', { timeout: 10_000 });
    await expect(page.locator('input#login-email')).toBeVisible();
  });

  test('login page shows sign in form and signup toggle', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input#login-email')).toBeVisible();
    await expect(page.locator('button:has-text("Sign in")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Sign up")').first()).toBeVisible();
  });

  test('registration creates account and logs in', async ({ page }) => {
    const uniqueEmail = `e2e-register-${Date.now()}@example.com`;
    await login(page, uniqueEmail, 'testpassword123');
    await expect(page).toHaveURL(/\/machines/);
  });

  test('login with correct password succeeds', async ({ page }) => {
    await login(page, `login-ok-${Date.now()}@example.com`, 'testpassword123');
    await expect(page).toHaveURL(/\/machines/);
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
  });

  test('login with wrong password fails', async ({ page }) => {
    const email = `wrong-pass-${Date.now()}@example.com`;
    await page.goto('/login');
    await registerUser(page, email, 'testpassword123');
    await page.goto('/login');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'wrongpassword99');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid email or password')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('registration with duplicate email shows error', async ({ page }) => {
    const email = `e2e-dup-${Date.now()}@justavps.com`;
    await registerUser(page, email, 'testpassword123');
    const duplicateRes = await page.request.post('/api/auth/register', {
      data: { email, password: 'anotherpassword1' },
    });
    expect(duplicateRes.status()).toBe(409);
  });

  test('registration with short password shows error', async ({ page }) => {
    const res = await page.request.post('/api/auth/register', {
      data: { email: `short-${Date.now()}@example.com`, password: '1234567' },
    });
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.message).toContain('at least 8 characters');
  });

  test('session persists across page navigations', async ({ page }) => {
    await login(page, `persist-${Date.now()}@example.com`, 'testpassword123');
    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    await page.goto('/billing');
    await expect(page.locator('h1:has-text("Billing")')).toBeVisible();
  });

  test('sign out redirects to landing page', async ({ page }) => {
    const email = `signout-${Date.now()}@example.com`;
    await login(page, email, 'testpassword123');
    const trigger = page.locator(`text=${email}`).first();
    await trigger.click();
    const signOutItem = page.getByRole('menuitem', { name: 'Sign out' });
    await signOutItem.waitFor({ state: 'visible', timeout: 3_000 });
    await signOutItem.click();
    await page.goto('/machines');
    await page.waitForURL('**/login**', { timeout: 20_000 });
  });
});
