import { test, expect } from '@playwright/test';
import { login } from './helpers';

const imagesPayload = {
  images: [
    {
      id: 'img-1',
      name: 'dev-environment',
      status: 'ready',
      created_at: new Date().toISOString(),
      machine_id: 'machine-1',
      provider: 'managed',
      provider_image_id: null,
    },
  ],
};

const machinesPayload = {
  machines: [
    {
      id: 'machine-1',
      slug: 'machine-1',
      name: 'Ready Machine',
      status: 'ready',
      provisioning_stage: null,
      provisioning_stage_updated_at: null,
      api_version: 'v2',
      machine_mode: 'container',
      requested_image_kind: 'docker',
      requested_image_ref: 'nginx:alpine',
      region: 'eu',
      resources: { vcpu: 1, ram_gb: 1, disk_gb: 10 },
      billing: { mode: 'flat_monthly', price_monthly: 12 },
      image: null,
      connectivity: { access: { mode: 'rest_exec', exec_endpoint: '/api/v2/machines/machine-1/exec' }, urls: { proxy: 'https://machine-1.kortix-dev.cloud', terminal: 'https://machine-1.kortix-dev.cloud/_terminal', port_template: 'https://{port}--machine-1.kortix-dev.cloud' } },
      health: null,
      capabilities: { can_start: false, can_stop: true, can_reboot: true, can_resize: false, can_snapshot: true, can_create_image: true },
      provider_progress: null,
      provider_status: 'success',
      callback_expected: true,
      callback_url: 'https://callback.example.com',
      created_at: new Date().toISOString(),
      ready_at: new Date().toISOString(),
    },
  ],
};

test('v2 images page renders image list and create dialog', async ({ page }) => {
  await login(page, `v2-images-ui-${Date.now()}@example.com`, 'testpassword123', async (p) => {
    await p.route('**/api/v1/account', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'acct-1', name: 'Admin Org', slug: 'admin-org', type: 'organization', role: 'owner', billing_email: 'admin@example.com', stripe_customer_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    });
    await p.route('**/api/v1/account/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'user-1', email: 'admin@example.com', is_admin: true }, memberships: [], active_account: { id: 'acct-1', name: 'Admin Org', type: 'organization', role: 'owner' }, is_admin: true }) });
    });
    await p.route('**/api/v1/account/limits', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ limits: { max_images: 10 }, usage: { images: 1 } }) });
    });
    await p.route('**/api/v2/images', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(imagesPayload) });
    });
    await p.route('**/api/v2/machines', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machinesPayload) });
    });
  });

  await page.goto('/v2/images');
  await expect(page.getByRole('heading', { name: 'Images' })).toBeVisible();
  await expect(page.getByText('dev-environment')).toBeVisible();
  await page.getByRole('button', { name: 'Create Image' }).click();
  await expect(page.getByRole('heading', { name: 'Create Image' })).toBeVisible();
  await expect(page.getByText('Source Machine')).toBeVisible();
  await expect(page.getByLabel('Image Name')).toBeVisible();
});
