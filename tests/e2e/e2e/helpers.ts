/**
 * Shared helpers for Playwright E2E tests.
 */
import dotenv from 'dotenv';
import { type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { db } from '@/server/db';
import { users } from '@/server/db/schema';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

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
  const baseUrl = page.url().startsWith('http') ? new URL(page.url()).origin : 'http://localhost:4100';
  let res;
  try {
    res = await page.request.post(`${baseUrl}/api/auth/register`, {
      data: { email, password, name },
    });
  } catch {
    res = await page.request.post(`${baseUrl}/api/auth/register`, {
      data: { email, password, name },
    });
  }
  // 201 = created, 409 = already exists — both OK for test setup
  if (res.status() !== 201 && res.status() !== 409) {
    throw new Error(`Registration failed: ${res.status()} ${await res.text()}`);
  }

  await db.update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.email, email));
}

/**
 * Login as the dev user (credentials-based auth with password).
 * Auto-registers the user first if needed.
 * After login, the session cookie is set and all subsequent requests are authenticated.
 *
 * `beforeFirstAuthedNav` runs after the session cookie is set but before the
 * first authenticated page navigation. Use it to register `page.route` mocks
 * that must intercept the initial /machines render — in particular
 * /api/v1/account, which React Query caches aggressively. Registering the
 * mocks BEFORE login would cause the /login page itself to see is_admin=true
 * without a cookie and bounce the navigation (ERR_ABORTED).
 */
export async function login(
  page: Page,
  email = DEFAULT_EMAIL,
  password = DEFAULT_PASSWORD,
  beforeFirstAuthedNav?: (page: Page) => Promise<void>,
) {
  // Ensure user exists
  await page.goto('/login');
  await registerUser(page, email, password);

  // Prefer direct credential callback to avoid flaky UI form timing in E2E.
  const csrfRes = await page.request.get('/api/auth/csrf');
  if (!csrfRes.ok()) {
    throw new Error(`Failed to fetch CSRF token: ${csrfRes.status()} ${await csrfRes.text()}`);
  }
  const { csrfToken } = await csrfRes.json();
  const signInRes = await page.request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      email,
      password,
      callbackUrl: '/machines',
      json: 'true',
    },
  });

  if (!signInRes.ok()) {
    throw new Error(`Login failed: ${signInRes.status()} ${await signInRes.text()}`);
  }

  if (beforeFirstAuthedNav) {
    await beforeFirstAuthedNav(page);
  }

  await page.goto('/machines');
  await page.waitForURL('**/machines', { timeout: 40_000 });
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

export async function apiJson<T>(
  page: Page,
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<{ status: number; data: T }> {
  const requestPath = path.startsWith('http') ? path : `http://localhost:4100${path}`;
  const method = options?.method ?? 'GET';

  const response = method === 'GET'
    ? await page.request.get(requestPath)
    : method === 'POST'
      ? await page.request.post(requestPath, { data: options?.body })
      : method === 'PATCH'
        ? await page.request.patch(requestPath, { data: options?.body })
        : await page.request.delete(requestPath, { data: options?.body });

  return {
    status: response.status(),
    data: (await response.json()) as T,
  };
}

export async function createOrganization(page: Page, name: string): Promise<string> {
  const created = await apiJson<{ id: string }>(page, '/api/v1/account/organizations', {
    method: 'POST',
    body: { name },
  });

  if (created.status !== 201) {
    throw new Error(`Failed to create organization: ${created.status}`);
  }

  const switched = await apiJson<{ ok: true }>(page, '/api/v1/account/switch', {
    method: 'POST',
    body: { account_id: created.data.id },
  });

  if (switched.status !== 200) {
    throw new Error(`Failed to switch organization context: ${switched.status}`);
  }

  const me = await apiJson<{
    active_account: { id: string; name: string; type: 'personal' | 'organization' };
  }>(page, '/api/v1/account/me');

  if (me.status !== 200 || me.data.active_account.type !== 'organization' || me.data.active_account.name !== name) {
    throw new Error('Failed to switch into newly created organization');
  }

  return created.data.id;
}
