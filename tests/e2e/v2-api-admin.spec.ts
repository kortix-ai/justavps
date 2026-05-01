import { expect, test } from '@playwright/test';

test.describe('V2 admin web', () => {
  test('drives the live Incus workflow end-to-end across workspace + admin scopes', async ({ page }) => {
    test.skip(process.env.V2_E2E_LIVE !== 'true', 'Set V2_E2E_LIVE=true to run live V2 API UI E2E.');

    const adminToken = process.env.V2_ADMIN_TOKEN;
    const containerImage = process.env.V2_E2E_IMAGE;
    if (!adminToken) throw new Error('V2_ADMIN_TOKEN is required for live V2 API UI E2E.');
    if (!containerImage) throw new Error('V2_E2E_IMAGE is required for live V2 API UI E2E.');

    await page.goto('/admin-ui/');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

    // Workspace → Settings owns API URL + admin token.
    await page.locator('#primary-nav [data-route="settings"]').click();
    await page.locator('#api-url').fill(process.env.V2_API_BASE_URL || process.env.BASE_URL || 'http://localhost:4200');
    await page.locator('#admin-token').fill(adminToken);

    await page.getByTestId('v2-refresh-all').click();
    await expect(page.getByTestId('v2-status')).toContainText('refresh ok', { timeout: 90_000 });

    // Workspace → Images: Pull-from-registry button visible.
    await page.locator('#primary-nav [data-route="images"]').click();
    await expect(page.locator('#open-pull-image')).toBeVisible();

    // Workspace → Machines: Create dialog walkthrough across the four source tabs.
    await page.locator('#primary-nav [data-route="machines"]').click();
    await expect(page.locator('#open-create')).toBeVisible();
    await page.locator('#open-create').click();
    const dialog = page.getByTestId('v2-create-machine-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-source-tab="image"]')).toBeVisible();
    await expect(dialog.locator('[data-source-tab="snapshot"]')).toBeVisible();
    await expect(dialog.locator('[data-source-tab="empty"]')).toBeVisible();
    await expect(dialog.locator('[data-source-tab="backup"]')).toBeVisible();
    await expect(dialog.locator('#create-source-id')).toBeVisible();
    await dialog.locator('[data-source-tab="snapshot"]').click();
    await expect(dialog.locator('#create-snapshot-machine')).toBeVisible();
    await dialog.locator('[data-source-tab="empty"]').click();
    await expect(dialog.getByText('Creates an Incus instance with no rootfs source.')).toBeVisible();
    await dialog.locator('[data-source-tab="backup"]').click();
    await expect(dialog.locator('#create-backup-machine')).toBeVisible();
    await dialog.locator('#create-cancel').click();
    await expect(dialog).toBeHidden();

    // Switch to the Admin scope via the sidebar scope switcher.
    await page.locator('[data-scope="admin"]').click();
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();

    // Admin → Fleet
    await page.locator('#primary-nav [data-route="fleet"]').click();
    await expect(page.getByRole('heading', { name: 'Fleet', level: 1 })).toBeVisible();
    await expect(page.getByText('Regions')).toBeVisible();
    await expect(page.getByText('Clusters')).toBeVisible();
    await expect(page.getByText('Hosts')).toBeVisible();

    // Run the full E2E workflow from the admin scope (where the Run E2E button lives).
    await page.locator('#primary-nav [data-route="admin"]').click();
    await page.getByTestId('v2-run-workflow').click();

    await expect(page.getByTestId('v2-status')).toContainText('workflow ok', { timeout: 360_000 });
    await expect(page.getByTestId('v2-workflow-log')).toContainText('workflow passed and cleanup complete');
  });
});
