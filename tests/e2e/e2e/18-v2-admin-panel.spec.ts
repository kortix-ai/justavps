import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

type AdminFixtures = {
  hostOverview: unknown;
  configAudit: unknown;
  hostAudit: unknown;
  services: unknown;
  snapshots: unknown;
  recommendations: unknown;
  procurements: unknown;
  adminMachines: unknown;
  routingScan: unknown;
};

function buildFixtures(): AdminFixtures {
  return {
    hostOverview: {
      hosts: [
        {
          id: 'host-1',
          vendor: 'hetzner_robot',
          host_class: 'general-small',
          generation: 'gen1',
          region: 'eu',
          location: 'HEL1-DC4',
          cell_id: 'cell-1',
          cell_slug: 'eu--general-small--gen1',
          cell_name: 'EU general-small gen1',
          cell_admission_state: 'open',
          cell_sellability_state: 'sellable',
          name: 'bm-host-1',
          status: 'active',
          maintenance_state: 'in_service',
          maintenance_requested_at: null,
          maintenance_started_at: null,
          maintenance_completed_at: null,
          provider_server_number: null,
          public_ipv4: '1.2.3.4',
          runner_base_url: 'http://1.2.3.4:7779',
          total_vcpu: 12,
          total_memory_gb: 64,
          total_disk_gb: 900,
          used_vcpu: 4,
          used_memory_gb: 12,
          used_disk_gb: 120,
          last_heartbeat_at: '2026-04-11T10:02:00.000Z',
          drain_report: { active_machines: 1, stopped_machines_retaining_disk: 0, active_reservations: 0, pending_backup_artifacts: 0, blockers_total: 1 },
          reconciliation_report: { checked_at: null, instance_count: 1, image_count: 1, stale_machine_ids: [], stale_image_ids: [], orphan_instance_ids: [], warm_pool_instance_ids: [], error: null },
          bootstrap_validation: {
            status: 'passed',
            bootstrap_version: 'bootstrap-baremetal-host.sh@v1',
            runnerd_version: '1.0.0',
            incus_version: '6.0',
            storage_driver: 'zfs',
            storage_pool: 'local',
            started_at: '2026-04-11T10:00:00.000Z',
            completed_at: '2026-04-11T10:01:00.000Z',
            smoke_test_machine_id: 'smoke-1',
            smoke_test_result: 'passed',
            warm_pool_result: 'passed',
            triggered_by: 'bootstrap-script',
            notes: ['runner registration succeeded'],
          },
          drift_status: 'in_policy',
          scheduler: { schedulable: true, unschedulable_reason: null, updated_at: '2026-04-11T10:02:00.000Z', updated_by: 'bootstrap-script' },
          incus_ui: { exposure: 'operator_only', url: 'https://1.2.3.4:8443', note: 'vpn-only', updated_at: '2026-04-11T10:05:00.000Z' },
          metadata: {},
          created_at: '2026-04-11T10:00:00.000Z',
          updated_at: '2026-04-11T10:01:00.000Z',
        },
      ],
      cells: [
        {
          id: 'cell-1',
          slug: 'eu--general-small--gen1',
          name: 'EU general-small gen1',
          region: 'eu',
          host_class: 'general-small',
          generation: 'gen1',
          status: 'active',
          host_count: 1,
          active_host_count: 1,
          active_schedulable_host_count: 1,
          constrained_host_count: 0,
          admission_state: 'open',
          sellability_state: 'sellable',
          admission_reason: null,
          total_vcpu: 12,
          total_memory_gb: 64,
          total_disk_gb: 900,
          used_vcpu: 4,
          used_memory_gb: 12,
          used_disk_gb: 120,
          reserved_vcpu: 1,
          reserved_memory_gb: 1,
          reserved_disk_gb: 10,
          reserve_budget_vcpu: 1,
          reserve_budget_memory_gb: 2,
          reserve_budget_disk_gb: 20,
          available_vcpu: 8,
          available_memory_gb: 52,
          available_disk_gb: 780,
          sellable_vcpu: 7,
          sellable_memory_gb: 50,
          sellable_disk_gb: 760,
          utilization_score: 0.33,
        },
      ],
    },
    configAudit: {
      status: 'warning',
      counts: { ok: 4, warning: 1, error: 0 },
      checks: [
        { key: 'storage.zfs.pool', severity: 'ok', message: 'zfs pool healthy' },
        { key: 'incus.version', severity: 'warning', message: 'incus version not pinned in production env' },
      ],
    },
    hostAudit: {
      summary: {
        total_hosts: 1,
        active_schedulable_hosts: 1,
        bootstrapping_hosts: 0,
        pending_validation_hosts: 0,
        quarantined_hosts: 0,
        warning_drift_hosts: 0,
        blocking_drift_hosts: 0,
      },
      pending_validation: [],
      quarantined: [],
      warning_drift: [],
      blocking_drift: [],
    },
    services: {
      services: [
        {
          id: 'svc-1',
          service: 'capacity-snapshot',
          scope: 'global',
          critical: false,
          mode: 'periodic',
          description: 'Periodic cell capacity snapshot writer',
          stale: false,
          age_ms_since_completion: 5_000,
          lease_owner: 'runner-1',
          lease_expires_at: '2026-04-11T10:05:00.000Z',
          last_started_at: '2026-04-11T10:00:00.000Z',
          last_completed_at: '2026-04-11T10:01:00.000Z',
          checkpoint: { last_cell: 'eu--general-small--gen1' },
          metadata: {},
          created_at: '2026-04-11T10:00:00.000Z',
          updated_at: '2026-04-11T10:01:00.000Z',
        },
      ],
    },
    snapshots: {
      snapshots: [
        {
          id: 'snap-1',
          cell_id: 'cell-1',
          cell_slug: 'eu--general-small--gen1',
          region: 'eu',
          host_class: 'general-small',
          generation: 'gen1',
          admission_state: 'open',
          sellability_state: 'sellable',
          host_count: 1,
          active_host_count: 1,
          active_schedulable_host_count: 1,
          constrained_host_count: 0,
          total_vcpu: 12,
          total_memory_gb: 64,
          total_disk_gb: 900,
          used_vcpu: 4,
          used_memory_gb: 12,
          used_disk_gb: 120,
          reserved_vcpu: 1,
          reserved_memory_gb: 1,
          reserved_disk_gb: 10,
          reserve_budget_vcpu: 1,
          reserve_budget_memory_gb: 2,
          reserve_budget_disk_gb: 20,
          available_vcpu: 8,
          available_memory_gb: 52,
          available_disk_gb: 780,
          sellable_vcpu: 7,
          sellable_memory_gb: 50,
          sellable_disk_gb: 760,
          utilization_score_basis_points: 3300,
          snapshot_window_start: '2026-04-11T10:00:00.000Z',
          created_at: '2026-04-11T10:00:05.000Z',
        },
      ],
    },
    recommendations: {
      recommendations: [
        {
          id: 'rec-1',
          cell_id: 'cell-1',
          cell_slug: 'eu--general-small--gen1',
          cell_name: 'EU general-small gen1',
          region: 'eu',
          current_host_class: 'general-small',
          current_generation: 'gen1',
          current_role: 'mainstream',
          recommended_host_class: 'general-small',
          recommended_generation: 'gen1',
          recommended_role: 'mainstream',
          procurement_purpose: 'reserve_replenishment',
          minimum_hosts: 1,
          reserve_shortfall_vcpu: 1,
          reserve_shortfall_memory_gb: 2,
          reserve_shortfall_disk_gb: 20,
          summary: 'EU general-small gen1 is below reserve budget.',
          notes: ['Reserve budget shortfall detected'],
        },
      ],
    },
    procurements: {
      procurements: [
        {
          id: 'proc-1',
          vendor: 'hetzner_robot',
          host_class: 'general-small',
          generation: 'gen1',
          target_cell_id: 'cell-1',
          procurement_purpose: 'reserve_replenishment',
          product_id: 'AX41-NVMe',
          region: 'eu',
          location: 'NBG1-DC1',
          status: 'requested',
          host_id: null,
          provider_transaction_id: null,
          requires_approval: true,
          error: null,
          metadata: {},
          approved_at: null,
          ordered_at: null,
          resolved_at: null,
          created_at: '2026-04-11T10:00:00.000Z',
          updated_at: '2026-04-11T10:00:00.000Z',
        },
      ],
    },
    adminMachines: {
      total: 1,
      limit: 100,
      offset: 0,
      summary: { by_status: { ready: 1 }, by_source: { user: 1 } },
      machines: [
        {
          id: 'm-1',
          slug: 'ui-admin-1',
          name: 'Admin Panel Machine',
          status: 'ready',
          provisioning_stage: null,
          provider: 'hetzner',
          server_type: 'cx22',
          region: 'eu',
          ip: '9.9.9.9',
          source: 'user',
          kortix_sandbox_id: null,
          price_monthly: 5,
          backups_enabled: false,
          provider_server_id: '12345',
          daemon_version: '1.0.0',
          created_at: '2026-04-11T10:00:00.000Z',
          ready_at: '2026-04-11T10:01:00.000Z',
          deleted_at: null,
          last_heartbeat_at: '2026-04-11T10:05:00.000Z',
          health: { cpu: 12, memory: 34, disk: 45 },
          owner: { id: 'u-1', email: 'user@example.com', name: 'User One' },
          account: { id: 'acct-1', name: 'Admin Org', slug: 'admin-org', type: 'organization' },
          subscription: null,
        },
      ],
    },
    routingScan: {
      summary: {
        total: 1,
        active: 1,
        deleted: 0,
        drifted: 0,
        missing_kv: 0,
        legacy_machine_dns: 0,
        stale_kv_keys: 0,
        stale_public_dns: 0,
        broker_dns_present: true,
        broker_bypass_route_present: true,
      },
      machines: [
        {
          id: 'm-1',
          slug: 'ui-admin-1',
          status: 'ready',
          owner_id: 'u-1',
          ip: '9.9.9.9',
          kv_present: true,
          machine_dns_count: 0,
          public_record_names: ['ui-admin-1.example'],
          wildcard_record_names: [],
          origin_record_names: [],
          legacy_origin_record_names: [],
          drift: [],
        },
      ],
      stale_kv: [],
      stale_public_dns: [],
      broker: {
        host: 'broker.example',
        dns_present: true,
        bypass_route_present: true,
        bypass_pattern: 'broker.example/*',
      },
    },
  };
}

async function setupAdminRoutes(page: Page, f: AdminFixtures) {
  await page.route('**/api/v1/account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'acct-1',
        name: 'Admin Org',
        slug: 'admin-org',
        billing_email: 'admin@example.com',
        stripe_customer_id: null,
        type: 'organization',
        role: 'owner',
        is_admin: true,
        created_at: '2026-04-11T10:00:00.000Z',
        updated_at: '2026-04-11T10:00:00.000Z',
      }),
    });
  });

  await page.route('**/api/v1/account/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'user-1', email: 'admin@example.com', is_admin: true },
        memberships: [],
        active_account: { id: 'acct-1', name: 'Admin Org', type: 'organization', role: 'owner' },
        is_admin: true,
      }),
    });
  });

  await page.route('**/api/v2/admin/fleet/hosts', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.hostOverview) });
  });
  await page.route('**/api/v2/admin/fleet/config-audit', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.configAudit) });
  });
  await page.route('**/api/v2/admin/fleet/host-audit', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.hostAudit) });
  });
  await page.route('**/api/v2/admin/fleet/control-plane/services', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.services) });
  });
  await page.route('**/api/v2/admin/fleet/cell-capacity-snapshots**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.snapshots) });
  });
  await page.route('**/api/v2/admin/fleet/procurement-recommendations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.recommendations) });
  });
  await page.route('**/api/v2/admin/fleet/procurements', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.procurements) });
  });
  await page.route('**/api/v1/admin/machines**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.adminMachines) });
  });
  await page.route('**/api/v1/admin/routing/scan', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.routingScan) });
  });
}

/**
 * Log in + register route interceptors in the correct window: after the auth
 * cookie is set but BEFORE the first authenticated /machines navigation. This
 * way /login doesn't see a "logged in" account mock (which would bounce the
 * login page mid-load) AND the initial /machines useAccount query already
 * hits the mocked `is_admin: true` response (avoiding React Query caching a
 * stale real response).
 */
async function loginAsAdmin(page: Page, slug: string) {
  await login(
    page,
    `${slug}-${Date.now()}@example.com`,
    'testpassword123',
    async (p) => {
      await setupAdminRoutes(p, buildFixtures());
    },
  );
}

test.describe('V2 unified admin panel', () => {
  test('overview page renders KPIs and admin nav rail', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-overview');

    await page.goto('/v2/admin');

    await expect(page.getByRole('heading', { name: 'Fleet Overview' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' }).first()).toBeVisible();
    await expect(page.getByText('Active hosts').first()).toBeVisible();
    await expect(page.getByText('Blocking drift').first()).toBeVisible();
    await expect(page.getByText('EU general-small gen1').first()).toBeVisible();
  });

  test('/v2/admin/fleet redirects to hosts', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-fleet-redir');

    await page.goto('/v2/admin/fleet');
    await page.waitForURL('**/v2/admin/hosts');
    await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();
    await expect(page.getByText('bm-host-1')).toBeVisible();
  });

  test('hosts page renders inventory with filters', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-hosts');

    await page.goto('/v2/admin/hosts');

    await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();
    await expect(page.getByText('bm-host-1')).toBeVisible();
    await expect(page.getByText('Showing 1 of 1 hosts')).toBeVisible();
    await expect(page.getByPlaceholder('Search host, cell, IP, class')).toBeVisible();
  });

  test('cells page renders with admission controls', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-cells');

    await page.goto('/v2/admin/cells');

    await expect(page.getByRole('heading', { name: 'Cells' })).toBeVisible();
    await expect(page.getByText('EU general-small gen1').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Balanced reserve' })).toBeVisible();
  });

  test('procurements page shows recommendations and history', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-proc');

    await page.goto('/v2/admin/procurements');

    await expect(page.getByRole('heading', { name: 'Procurements' })).toBeVisible();
    await expect(page.getByText('EU general-small gen1 is below reserve budget.')).toBeVisible();
    await expect(page.getByText('AX41-NVMe')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  });

  test('capacity page renders snapshots', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-cap');

    await page.goto('/v2/admin/capacity');

    await expect(page.getByRole('heading', { name: 'Capacity snapshots' })).toBeVisible();
    await expect(page.getByText('eu--general-small--gen1').first()).toBeVisible();
  });

  test('audit page renders both audits', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-audit');

    await page.goto('/v2/admin/audit');

    await expect(page.getByRole('heading', { name: 'Audit', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Config audit' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Host validation audit' })).toBeVisible();
    await expect(page.getByText('storage.zfs.pool')).toBeVisible();
  });

  test('control plane page shows services', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-cp');

    await page.goto('/v2/admin/control-plane');

    await expect(page.getByRole('heading', { name: 'Control plane' })).toBeVisible();
    await expect(page.getByText('capacity-snapshot')).toBeVisible();
    await expect(page.getByText('Periodic cell capacity snapshot writer')).toBeVisible();
  });

  test('user machines page uses /admin/machines API and shows filters', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-users');

    await page.goto('/v2/admin/machines');

    await expect(page.getByRole('heading', { name: 'User machines' })).toBeVisible();
    await expect(page.getByText('ui-admin-1')).toBeVisible();
    await expect(page.getByPlaceholder('Search slug, name, IP, sandbox, owner, account')).toBeVisible();
  });

  test('routing page shows broker and KPIs', async ({ page }) => {
    await loginAsAdmin(page, 'v2-admin-route');

    await page.goto('/v2/admin/routing');

    await expect(page.getByRole('heading', { name: 'Routing' })).toBeVisible();
    await expect(page.getByText('broker.example', { exact: true })).toBeVisible();
    await expect(page.getByText('ui-admin-1').first()).toBeVisible();
  });

  test('non-admin accounts are blocked with gated copy', async ({ page }) => {
    await login(
      page,
      `v2-admin-gate-${Date.now()}@example.com`,
      'testpassword123',
      async (p) => {
        await p.route('**/api/v1/account', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 'acct-2',
              name: 'Regular Org',
              slug: 'regular',
              billing_email: 'user@example.com',
              stripe_customer_id: null,
              type: 'personal',
              role: 'owner',
              is_admin: false,
              created_at: '2026-04-11T10:00:00.000Z',
              updated_at: '2026-04-11T10:00:00.000Z',
            }),
          });
        });
      },
    );

    await page.goto('/v2/admin');
    await expect(page.getByRole('heading', { name: 'Admin access required' })).toBeVisible();
  });
});
