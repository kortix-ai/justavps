import { test, expect } from '@playwright/test';
import { login } from './helpers';

const machine = {
  id: 'machine-v2-ui-1',
  slug: 'machine-v2-ui-1',
  name: 'UI Machine',
  status: 'ready',
  provisioning_stage: null,
  provisioning_stage_updated_at: null,
  api_version: 'v2',
  machine_mode: 'container',
  requested_image_kind: 'docker',
  requested_image_ref: 'nginx:alpine',
  region: 'eu',
  resources: { vcpu: 2, ram_gb: 4, disk_gb: 40 },
  billing: { mode: 'flat_monthly', price_monthly: 12 },
  image: null,
  connectivity: {
    access: { mode: 'rest_exec', exec_endpoint: '/api/v2/machines/machine-v2-ui-1/exec' },
    urls: { proxy: 'https://machine-v2-ui-1.kortix-dev.cloud', terminal: 'https://machine-v2-ui-1.kortix-dev.cloud/_terminal', port_template: 'https://{port}--machine-v2-ui-1.kortix-dev.cloud' },
  },
  health: { cpu_percent: 10, memory_percent: 22, disk_percent: 35, last_heartbeat_at: new Date().toISOString() },
  capabilities: { can_start: false, can_stop: true, can_reboot: true, can_resize: false, can_snapshot: true, can_create_image: true },
  provider_progress: null,
  provider_status: 'success',
  callback_expected: true,
  callback_url: 'https://callback.example.com',
  created_at: new Date().toISOString(),
  ready_at: new Date().toISOString(),
};

const machineList = Array.from({ length: 4 }).map((_, index) => ({
  ...machine,
  id: `machine-v2-ui-${index + 1}`,
  slug: `machine-v2-ui-${index + 1}`,
  name: index === 0 ? 'UI Machine' : `UI Machine ${index + 1}`,
  connectivity: {
    access: { mode: 'rest_exec', exec_endpoint: `/api/v2/machines/machine-v2-ui-${index + 1}/exec` },
    urls: {
      proxy: `https://machine-v2-ui-${index + 1}.kortix-dev.cloud`,
      terminal: `https://machine-v2-ui-${index + 1}.kortix-dev.cloud/_terminal`,
      port_template: `https://{port}--machine-v2-ui-${index + 1}.kortix-dev.cloud`,
    },
  },
}));

test.describe('V2 machines UI', () => {
  test('machines list renders cards and search', async ({ page }) => {
    await login(page, `v2-machines-ui-${Date.now()}@example.com`, 'testpassword123', async (p) => {
      await p.route('**/api/v1/account', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'acct-1', name: 'Admin Org', slug: 'admin-org', type: 'organization', role: 'owner', billing_email: 'admin@example.com', stripe_customer_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      });
      await p.route('**/api/v1/account/me', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'user-1', email: 'admin@example.com', is_admin: true }, memberships: [], active_account: { id: 'acct-1', name: 'Admin Org', type: 'organization', role: 'owner' }, is_admin: true }) });
      });
      await p.route('**/api/v1/account/limits', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ limits: { max_machines: 5, max_images: 10 }, usage: { machines: 1, images: 0 } }) });
      });
      await p.route('**/api/v2/machines', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ machines: machineList }) });
      });
    });

    await page.goto('/v2/machines');
    await expect(page.getByRole('heading', { name: 'Machines' })).toBeVisible();
    await expect(page.locator('a[href="/v2/machines/machine-v2-ui-1"]').first()).toBeVisible();
    await expect(page.getByText('4 running')).toBeVisible();
    await page.getByPlaceholder('Search by name, IP, region…').fill('ui machine');
    await expect(page.locator('a[href="/v2/machines/machine-v2-ui-1"]').first()).toBeVisible();
  });

  test('machine detail renders runtime and connectivity sections', async ({ page }) => {
    await login(page, `v2-machine-detail-ui-${Date.now()}@example.com`, 'testpassword123', async (p) => {
      await p.route('**/api/v1/account', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'acct-1', name: 'Admin Org', slug: 'admin-org', type: 'organization', role: 'owner', billing_email: 'admin@example.com', stripe_customer_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      });
      await p.route('**/api/v1/account/me', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'user-1', email: 'admin@example.com', is_admin: true }, memberships: [], active_account: { id: 'acct-1', name: 'Admin Org', type: 'organization', role: 'owner' }, is_admin: true }) });
      });
      await p.route('**/api/v2/machines/machine-v2-ui-1/status/stream', async (route) => {
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' });
      });
      await p.route('**/api/v2/machines/machine-v2-ui-1/backups', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ backups: [] }) });
      });
      await p.route('**/api/v2/machines/machine-v2-ui-1', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machine) });
      });
    });

    await page.goto('/v2/machines/machine-v2-ui-1');
    await expect(page.getByText('UI Machine')).toBeVisible();
    await expect(page.getByText('Running')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Connect/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Proxy/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /API/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Snapshot' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reboot' })).toBeVisible();
  });
});
