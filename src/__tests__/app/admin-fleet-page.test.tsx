import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock('@/shared/hooks/use-account', () => ({
  useAccount: () => ({ data: { is_admin: true }, isLoading: false }),
}));

vi.mock('@/shared/hooks/api-client', () => ({
  apiV2: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/shared/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/shared/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/shared/ui/skeleton', () => ({
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

describe('admin fleet page bootstrap visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    useQueryMock.mockImplementation((options: { queryKey: string[]; select?: (data: any) => any }) => {
      const { queryKey, select } = options;
      const key = queryKey.join('/');
      if (key === 'fleet/overview') {
        const overview = {
          hosts: [{
            id: 'host-1',
            vendor: 'hetzner_robot',
            host_class: 'general-small',
            generation: 'gen1',
            region: 'hel1',
            location: 'HEL1',
            cell_id: 'cell-1',
            cell_slug: 'hel1--general-small--gen1',
            cell_name: 'HEL1 general-small gen1',
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
            reconciliation_report: { checked_at: null, instance_count: 0, image_count: 0, stale_machine_ids: [], stale_image_ids: [], orphan_instance_ids: [], warm_pool_instance_ids: ['warm-1'], error: null },
            bootstrap_validation: {
              status: 'passed',
              bootstrap_version: 'bootstrap-baremetal-host.sh@v1',
              runnerd_version: '1.0.0',
              incus_version: '6.0',
              storage_driver: 'dir',
              storage_pool: 'default',
              started_at: '2026-04-11T10:00:00.000Z',
              completed_at: '2026-04-11T10:01:00.000Z',
              smoke_test_machine_id: 'smoke-1',
              smoke_test_result: 'passed',
              warm_pool_result: 'passed',
              triggered_by: 'bootstrap-script',
              notes: ['runner registration succeeded'],
            },
              drift_status: 'blocking_drift',
              scheduler: {
                schedulable: false,
                unschedulable_reason: 'host quarantined after failed bootstrap validation',
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
          }],
          cells: [{
            id: 'cell-1',
            slug: 'hel1--general-small--gen1',
            name: 'HEL1 general-small gen1',
            region: 'hel1',
            host_class: 'general-small',
            generation: 'gen1',
            status: 'active',
            host_count: 1,
            active_host_count: 1,
            active_schedulable_host_count: 0,
            constrained_host_count: 1,
            admission_state: 'open',
            sellability_state: 'sellable',
            admission_reason: null,
            total_vcpu: 12,
            total_memory_gb: 64,
            total_disk_gb: 900,
            used_vcpu: 4,
            used_memory_gb: 12,
            used_disk_gb: 120,
            reserved_vcpu: 0,
            reserved_memory_gb: 0,
            reserved_disk_gb: 0,
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
          }],
        };
        return {
          data: select ? select(overview) : overview,
          isLoading: false,
        };
      }

      return {
        data: key.endsWith('config-audit')
          ? {
              status: 'degraded',
              counts: { ok: 1, warning: 1, error: 1 },
              checks: [
                { key: 'database_url', severity: 'ok', message: 'DATABASE_URL configured' },
                { key: 'fleet_host_blocking_drift', severity: 'error', message: '1 host(s) have blocking bootstrap drift', details: 'bm-host-1' },
                { key: 'fleet_no_schedulable_capacity', severity: 'error', message: 'No schedulable active hosts are available for new placements' },
                { key: 'fleet_cell_no_schedulable_capacity', severity: 'error', message: '1 sellable cell(s) have zero schedulable active hosts', details: 'hel1--general-small--gen1' },
                { key: 'fleet_host_quarantined', severity: 'warning', message: '1 host(s) are quarantined from scheduling', details: 'bm-host-1' },
                { key: 'broker_shared_secret', severity: 'warning', message: 'BROKER_SHARED_SECRET missing' },
              ],
            }
          : key.endsWith('host-audit')
            ? {
                summary: {
                  total_hosts: 1,
                  active_schedulable_hosts: 0,
                  bootstrapping_hosts: 0,
                  pending_validation_hosts: 0,
                  quarantined_hosts: 1,
                  warning_drift_hosts: 0,
                  blocking_drift_hosts: 1,
                },
                pending_validation: [],
                quarantined: [{
                  id: 'host-1',
                  name: 'bm-host-1',
                  status: 'active',
                  quarantined: true,
                  unschedulable_reason: 'host quarantined after failed bootstrap validation',
                  drift_status: 'blocking_drift',
                  validation_status: 'passed',
                }],
                warning_drift: [],
                blocking_drift: [{
                  id: 'host-1',
                  name: 'bm-host-1',
                  status: 'active',
                  quarantined: true,
                  unschedulable_reason: 'host quarantined after failed bootstrap validation',
                  drift_status: 'blocking_drift',
                  validation_status: 'passed',
                }],
              }
          : key.includes('cell-capacity-snapshots')
            ? [{
                id: 'snap-1',
                cell_id: 'cell-1',
                cell_slug: 'hel1--general-small--gen1',
                region: 'hel1',
                host_class: 'general-small',
                generation: 'gen1',
                admission_state: 'open',
                sellability_state: 'sellable',
                host_count: 1,
                active_host_count: 1,
                active_schedulable_host_count: 0,
                constrained_host_count: 1,
                total_vcpu: 12,
                total_memory_gb: 64,
                total_disk_gb: 900,
                used_vcpu: 4,
                used_memory_gb: 12,
                used_disk_gb: 120,
                reserved_vcpu: 0,
                reserved_memory_gb: 0,
                reserved_disk_gb: 0,
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
              }]
          : [],
        isLoading: false,
      };
    });
  });

  it('renders bootstrap validation and drift status for hosts', async () => {
    const Page = (await import('@/app/v2/admin/fleet/page')).default;
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain('validation passed');
    expect(markup).toContain('drift blocking drift');
    expect(markup).toContain('incus ui operator only');
    expect(markup).toContain('scheduler quarantined');
    expect(markup).not.toContain('runnerd ? · incus ?');
    expect(markup).toContain('1.0.0 · 6.0');
    expect(markup).toContain('operator only · https://1.2.3.4:8443');
    expect(markup).toContain('Scheduler state');
    expect(markup).toContain('Scheduler updated');
    expect(markup).toContain('quarantined');
    expect(markup).toContain('Scheduler quarantine reason: host quarantined after failed bootstrap validation');
    expect(markup).toContain('bootstrap-script');
    expect(markup).toContain('Quarantine host');
    expect(markup).toContain('Clear quarantine');
    expect(markup).toContain('Smoke test: passed · machine smoke-1');
    expect(markup).toContain('Warm pool check: passed');
    expect(markup).toContain('runner registration succeeded');
    expect(markup).toContain('Status: degraded');
    expect(markup).toContain('fleet_host_blocking_drift');
    expect(markup).toContain('fleet_no_schedulable_capacity');
    expect(markup).toContain('fleet_cell_no_schedulable_capacity');
    expect(markup).toContain('fleet_host_quarantined');
    expect(markup).toContain('1 host(s) have blocking bootstrap drift');
    expect(markup).toContain('No schedulable active hosts are available for new placements');
    expect(markup).toContain('1 sellable cell(s) have zero schedulable active hosts');
    expect(markup).toContain('hel1--general-small--gen1');
    expect(markup).toContain('1 host(s) are quarantined from scheduling');
    expect(markup).toContain('bm-host-1');
    expect(markup).toContain('Pending Validation');
    expect(markup).toContain('Constrained Hosts');
    expect(markup).toContain('Quarantined Hosts');
    expect(markup).toContain('Blocking Drift');
    expect(markup).toContain('Schedulable Active');
    expect(markup).toContain('Host validation audit');
    expect(markup).not.toContain('All hosts are validated and in policy.');
    expect(markup).toContain('Blocking drift hosts');
    expect(markup).toContain('Quarantined hosts');
    expect(markup).toContain('host quarantined after failed bootstrap validation');
    expect(markup).toContain('Schedulable active');
    expect(markup).toContain('0/1 hosts');
    expect(markup).toContain('Cell capacity snapshots');
    expect(markup).toContain('Schedulable active: 0/1 hosts');
    expect(markup.indexOf('fleet_host_blocking_drift')).toBeLessThan(markup.indexOf('database_url'));
  });
});
