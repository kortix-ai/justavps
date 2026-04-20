import { test, expect } from '@playwright/test';
import { login } from './helpers';

const fakeV2Machine = {
  id: 'machine-v2-1',
  slug: 'machine-v2-1',
  name: 'Demo V2 Machine',
  status: 'ready',
  provisioning_stage: null,
  provisioning_stage_updated_at: null,
  api_version: 'v2',
  region: 'hel1',
  resources: { vcpu: 2, ram_gb: 4, disk_gb: 80 },
  billing: { mode: 'flat_monthly', price_monthly: 12, current_period_end: null },
  image: null,
  connectivity: {
    access: { mode: 'rest_exec', exec_endpoint: '/api/v2/machines/machine-v2-1/exec' },
    urls: { proxy: 'https://demo.example.com', terminal: 'https://demo.example.com/_terminal', port_template: 'https://{port}--demo.example.com' },
  },
  capabilities: { can_start: false, can_stop: true, can_reboot: true, can_resize: false, can_snapshot: true, can_create_image: true },
  health: null,
  provider_progress: null,
  provider_status: 'success',
  callback_expected: true,
  callback_url: 'https://justavps-callback.ngrok.app',
  created_at: new Date().toISOString(),
  ready_at: new Date().toISOString(),
};

test.describe('V2 flow wiring', () => {
  test('v2 machines page uses v2 APIs and versioned detail links', async ({ page }) => {
    await login(page, `v2-list-${Date.now()}@example.com`, 'testpassword123');

    const seenPaths = new Set<string>();
    page.on('request', (request) => {
      try {
        seenPaths.add(new URL(request.url()).pathname);
      } catch {
        // ignore malformed URLs in test harness
      }
    });

    await page.route('**/api/v2/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ machines: [fakeV2Machine] }),
      });
    });

    seenPaths.clear();

    await page.goto('/v2/machines');
    await expect(page.locator('h1:has-text("Machines")')).toBeVisible();
    await expect(page.locator('a[href="/v2/machines/machine-v2-1"]')).toBeVisible();
    await expect(page.locator('a[href="/v2/machines/machine-v2-1"]')).toContainText('V2');

    expect([...seenPaths].some((path) => path.endsWith('/api/v2/machines'))).toBeTruthy();
  });

  test('v2 machine detail keeps truthful provisioning copy', async ({ page }) => {
    await login(page, `v2-detail-${Date.now()}@example.com`, 'testpassword123');

    const provisioningMachine = {
      ...fakeV2Machine,
      id: 'machine-v2-provisioning',
      slug: 'machine-v2-provisioning',
      status: 'provisioning',
      provisioning_stage: 'server_created',
      provider_progress: 0,
      ready_at: null,
      health: null,
    };

    await page.route('**/api/v2/machines/machine-v2-provisioning', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(provisioningMachine),
      });
    });

    await page.route('**/api/v2/machines/machine-v2-provisioning/status/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: '',
      });
    });

    await page.goto('/v2/machines/machine-v2-provisioning');
    await expect(page.getByText('VM running, waiting for daemon').first()).toBeVisible();
    await expect(page.getByText('First boot takes about 60–90 seconds.').first()).toBeVisible();
    await expect(page.locator('text=60%')).toBeVisible();
    await expect(page.locator('text=Terminal, exec access, and tools appear once the machine becomes ready.')).toBeVisible();
    await expect(page.locator('text=Terminal, SSH, and tools appear in a few seconds.')).toHaveCount(0);
    await expect(page.locator('a[href="/api/docs/v2"]')).toBeVisible();
    await expect(page.locator('h1').locator('..').getByText('V2', { exact: true })).toBeVisible();
  });

  test('dedicated v2 docs page loads the v2 spec', async ({ page }) => {
    const seenPaths = new Set<string>();
    page.on('request', (request) => {
      try {
        seenPaths.add(new URL(request.url()).pathname);
      } catch {
        // ignore malformed URLs in test harness
      }
    });

    await page.goto('/api/docs/v2');
    await expect(page.getByRole('heading', { name: 'JustAVPS API V2' })).toBeVisible();
    expect([...seenPaths].some((path) => path.endsWith('/api/docs/openapi-v2.json'))).toBeTruthy();
  });
});
