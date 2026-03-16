/**
 * E2E: Authentication flow — register, login, auth guard, sign out.
 */
import { test, expect } from '@playwright/test';
import { login, registerUser } from './helpers';

test.describe('Authentication', () => {
  test('unauthenticated user is redirected to /login from dashboard pages', async ({ page }) => {
    // Try to access protected page without login
    await page.goto('/machines');
    
    // Should redirect to login
    await page.waitForURL('**/login**', { timeout: 10_000 });
    await expect(page.locator('text=Welcome back')).toBeVisible();
  });

  test('login page shows Sign In and Register tabs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
    await expect(page.locator('button:has-text("Register")')).toBeVisible();
  });

  test('registration creates account and logs in', async ({ page }) => {
    const uniqueEmail = `e2e-register-${Date.now()}@justavps.com`;
    
    await page.goto('/login');
    
    // Switch to Register tab
    await page.click('button:has-text("Register")');
    
    // Fill registration form
    await page.fill('input#register-email', uniqueEmail);
    await page.fill('input#register-password', 'testpassword123');
    
    // Submit
    await page.click('button:has-text("Create Account")');
    
    // Should redirect to machines after auto-login
    await page.waitForURL('**/machines', { timeout: 10_000 });
  });

  test('login with correct password succeeds', async ({ page }) => {
    await login(page);
    
    // Should be on machines page
    await expect(page).toHaveURL(/\/machines/);
    
    // Dashboard should show user email
    await expect(page.locator('text=dev@justavps.com')).toBeVisible();
  });

  test('login with wrong password fails', async ({ page }) => {
    // Ensure user exists
    await page.goto('/login');
    await registerUser(page, 'dev@justavps.com', 'testpassword123');

    await page.goto('/login');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', 'dev@justavps.com');
    await page.fill('input[type="password"]', 'wrongpassword99');
    await page.click('button[type="submit"]');
    
    // Should show error
    await expect(page.locator('text=Invalid email or password')).toBeVisible({ timeout: 5_000 });
    
    // Should still be on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('registration with duplicate email shows error', async ({ page }) => {
    // Register first
    await page.goto('/login');
    const email = `e2e-dup-${Date.now()}@justavps.com`;
    await registerUser(page, email, 'testpassword123');
    
    // Try to register again with same email via UI
    await page.goto('/login');
    await page.click('button:has-text("Register")');
    await page.fill('input#register-email', email);
    await page.fill('input#register-password', 'anotherpassword1');
    await page.click('button:has-text("Create Account")');
    
    // Should show error about existing account
    await expect(page.locator('text=already exists')).toBeVisible({ timeout: 5_000 });
  });

  test('registration with short password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.click('button:has-text("Register")');
    await page.fill('input#register-email', 'short@test.com');
    await page.fill('input#register-password', '1234567'); // 7 chars, min is 8
    await page.click('button:has-text("Create Account")');
    
    // Should show validation error
    await expect(page.locator('text=at least 8 characters')).toBeVisible({ timeout: 5_000 });
  });

  test('session persists across page navigations', async ({ page }) => {
    await login(page);
    
    // Navigate to settings
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // Should still be logged in (header shows email)
    await expect(page.locator('text=dev@justavps.com')).toBeVisible();
    
    // Navigate to docs
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=dev@justavps.com')).toBeVisible();
  });

  test('sign out redirects to landing page', async ({ page }) => {
    await login(page);
    
    // Open user dropdown menu
    await page.locator('button:has-text("dev@justavps.com")').first().click();
    
    // Click "Sign Out"
    const signOutItem = page.locator('text=Sign Out');
    await signOutItem.waitFor({ state: 'visible', timeout: 3_000 });
    await signOutItem.click();
    
    // Should redirect to landing page
    await page.waitForURL('**/', { timeout: 10_000 });
  });
});
