/**
 * Shared helpers for Playwright E2E tests.
 */
import { type Page } from '@playwright/test';

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

  const csrfRes = await page.request.get('/api/auth/csrf');
  const { csrfToken } = await csrfRes.json();

  const signInRes = await page.request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      email,
      password,
      callbackUrl: '/machines',
    },
  });

  if (!signInRes.ok()) {
    throw new Error(`Login failed: ${signInRes.status()} ${await signInRes.text()}`);
  }

  await page.goto('/machines');
  await page.waitForURL('**/machines', { timeout: 20_000 });
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
