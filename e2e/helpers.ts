/**
 * Shared helpers for Playwright E2E tests.
 */
import { type Page, expect } from '@playwright/test';

const DEFAULT_EMAIL = 'dev@justavps.com';
const DEFAULT_PASSWORD = 'testpassword123';

/**
 * Register a new user account via the API.
 * Silently ignores 409 (user already exists).
 */
export async function registerUser(
  page: Page,
  email = DEFAULT_EMAIL,
  password = DEFAULT_PASSWORD,
  name?: string,
) {
  const baseUrl = page.url().startsWith('http') ? new URL(page.url()).origin : 'http://localhost:3000';
  const res = await page.request.post(`${baseUrl}/api/auth/register`, {
    data: { email, password, name },
  });
  // 201 = created, 409 = already exists — both OK for test setup
  if (res.status() !== 201 && res.status() !== 409) {
    throw new Error(`Registration failed: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Login as the dev user (credentials-based auth with password).
 * Auto-registers the user first if needed.
 * After login, the session cookie is set and all subsequent requests are authenticated.
 */
export async function login(
  page: Page,
  email = DEFAULT_EMAIL,
  password = DEFAULT_PASSWORD,
) {
  // Ensure user exists
  await page.goto('/login');
  await registerUser(page, email, password);

  await page.goto('/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Wait for redirect to /machines
  await page.waitForURL('**/machines', { timeout: 10_000 });
}

/**
 * Ensure we're on the dashboard (logged in).
 */
export async function ensureLoggedIn(page: Page) {
  // Check if already on a dashboard page
  const url = page.url();
  if (url.includes('/machines') || url.includes('/settings') || url.includes('/snapshots')) {
    return;
  }
  await login(page);
}

/**
 * Wait for API data to load (skeleton elements to disappear).
 */
export async function waitForDataLoad(page: Page, timeout = 10_000) {
  // Wait for any skeleton elements to disappear
  await page.waitForFunction(() => {
    const skeletons = document.querySelectorAll('[class*="skeleton"], [class*="Skeleton"]');
    return skeletons.length === 0;
  }, { timeout }).catch(() => {
    // Some pages may not have skeletons — that's fine
  });
}
