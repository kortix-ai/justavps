import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

const fleetOverview = {
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
      public_ipv6: null,
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
      scheduler: {
        schedulable: true,
        unschedulable_reason: null,
        updated_at: '2026-04-11T10:02:00.000Z',
        updated_by: 'bootstrap-script',
      },
      incus_ui: {
        exposure: 'operator_only',
        url: 'https://1.2.3.4:8443',
        note: 'vpn-only',
        updated_at: '2026-04-11T10:05:00.000Z',
      },
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
};

test.describe('V2 admin fleet dashboard', () => {
  test('renders clusters, hosts, and fleet capacity insight', async ({ page }) => {
    await login(page, `v2-admin-fleet-${Date.now()}@example.com`, 'testpassword123', async (p) => {
      await registerFleetRoutes(p);
    });

    await page.goto('/v2/admin/fleet');
    await page.waitForURL('**/v2/admin/hosts');

    await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();
    await expect(page.getByText('bm-host-1')).toBeVisible();
    await expect(page.getByText('eu--general-small--gen1').first()).toBeVisible();
  });
});

async function registerFleetRoutes(page: Page) {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fleetOverview) });
    });
    await page.route('**/api/v2/admin/fleet/config-audit', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', counts: { ok: 5, warning: 0, error: 0 }, checks: [] }) });
    });
    await page.route('**/api/v2/admin/fleet/host-audit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: { total_hosts: 1, active_schedulable_hosts: 1, bootstrapping_hosts: 0, pending_validation_hosts: 0, quarantined_hosts: 0, warning_drift_hosts: 0, blocking_drift_hosts: 0 }, pending_validation: [], quarantined: [], warning_drift: [], blocking_drift: [] }),
      });
    });
    await page.route('**/api/v2/admin/fleet/control-plane/services', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [] }) });
    });
    await page.route('**/api/v2/admin/fleet/cell-capacity-snapshots**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ snapshots: [{ id: 'snap-1', cell_id: 'cell-1', cell_slug: 'eu--general-small--gen1', region: 'eu', host_class: 'general-small', generation: 'gen1', admission_state: 'open', sellability_state: 'sellable', host_count: 1, active_host_count: 1, active_schedulable_host_count: 1, constrained_host_count: 0, total_vcpu: 12, total_memory_gb: 64, total_disk_gb: 900, used_vcpu: 4, used_memory_gb: 12, used_disk_gb: 120, reserved_vcpu: 1, reserved_memory_gb: 1, reserved_disk_gb: 10, reserve_budget_vcpu: 1, reserve_budget_memory_gb: 2, reserve_budget_disk_gb: 20, available_vcpu: 8, available_memory_gb: 52, available_disk_gb: 780, sellable_vcpu: 7, sellable_memory_gb: 50, sellable_disk_gb: 760, utilization_score_basis_points: 3300, snapshot_window_start: '2026-04-11T10:00:00.000Z', created_at: '2026-04-11T10:00:05.000Z' }] }),
      });
    });
    await page.route('**/api/v2/admin/fleet/procurement-recommendations', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recommendations: [{ id: 'rec-1', cell_id: 'cell-1', cell_slug: 'eu--general-small--gen1', cell_name: 'EU general-small gen1', region: 'eu', current_host_class: 'general-small', current_generation: 'gen1', current_role: 'mainstream', recommended_host_class: 'general-small', recommended_generation: 'gen1', recommended_role: 'mainstream', procurement_purpose: 'reserve_replenishment', minimum_hosts: 1, reserve_shortfall_vcpu: 1, reserve_shortfall_memory_gb: 2, reserve_shortfall_disk_gb: 20, summary: 'EU general-small gen1 is below reserve budget and should add capacity.', notes: [] }] }) });
    });
  await page.route('**/api/v2/admin/fleet/procurements', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ procurements: [{ id: 'proc-1', vendor: 'hetzner_robot', host_class: 'general-small', generation: 'gen1', target_cell_id: 'cell-1', procurement_purpose: 'reserve_replenishment', product_id: 'AX41-NVMe', region: 'eu', location: 'NBG1-DC1', status: 'requested', host_id: null, provider_transaction_id: null, requires_approval: true, error: null, metadata: {}, approved_at: null, ordered_at: null, resolved_at: null, created_at: '2026-04-11T10:00:00.000Z', updated_at: '2026-04-11T10:00:00.000Z' }] }) });
  });
}
