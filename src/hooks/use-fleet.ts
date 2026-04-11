import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiV2 } from './api-client';

export type FleetHost = {
  id: string;
  vendor: string;
  host_class: string;
  generation: string;
  region: string;
  location: string;
  cell_id: string | null;
  cell_slug: string;
  cell_name: string;
  cell_admission_state: 'open' | 'restricted' | 'closed';
  cell_sellability_state: 'sellable' | 'reserve_only' | 'unsellable';
  name: string;
  status: string;
  maintenance_state: 'in_service' | 'drain_requested' | 'draining' | 'drained' | 'maintenance';
  maintenance_requested_at: string | null;
  maintenance_started_at: string | null;
  maintenance_completed_at: string | null;
  provider_server_number: string | null;
  public_ipv4: string | null;
  runner_base_url: string | null;
  total_vcpu: number | null;
  total_memory_gb: number | null;
  total_disk_gb: number | null;
  used_vcpu: number;
  used_memory_gb: number;
  used_disk_gb: number;
  last_heartbeat_at: string | null;
  drain_report: {
    active_machines: number;
    stopped_machines_retaining_disk: number;
    active_reservations: number;
    pending_backup_artifacts: number;
    blockers_total: number;
  };
  reconciliation_report: {
    checked_at: string | null;
    instance_count: number;
    image_count: number;
    stale_machine_ids: string[];
    stale_image_ids: string[];
    orphan_instance_ids: string[];
    warm_pool_instance_ids: string[];
    error: string | null;
  };
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type FleetHostMaintenanceState = FleetHost['maintenance_state'];

export type FleetCell = {
  id: string | null;
  slug: string;
  name: string;
  region: string;
  host_class: string;
  generation: string;
  status: string;
  host_count: number;
  active_host_count: number;
  constrained_host_count: number;
  admission_state: 'open' | 'restricted' | 'closed';
  sellability_state: 'sellable' | 'reserve_only' | 'unsellable';
  admission_reason: string | null;
  total_vcpu: number;
  total_memory_gb: number;
  total_disk_gb: number;
  used_vcpu: number;
  used_memory_gb: number;
  used_disk_gb: number;
  reserved_vcpu: number;
  reserved_memory_gb: number;
  reserved_disk_gb: number;
  reserve_budget_vcpu: number;
  reserve_budget_memory_gb: number;
  reserve_budget_disk_gb: number;
  available_vcpu: number;
  available_memory_gb: number;
  available_disk_gb: number;
  sellable_vcpu: number;
  sellable_memory_gb: number;
  sellable_disk_gb: number;
  utilization_score: number;
};

export type FleetCellAdmissionState = FleetCell['admission_state'];
export type FleetCellSellabilityState = FleetCell['sellability_state'];

type FleetOverview = {
  hosts: FleetHost[];
  cells: FleetCell[];
};

function fleetOverviewQueryOptions(enabled: boolean) {
  return {
    queryKey: ['fleet', 'overview'],
    queryFn: async () => apiV2.get<FleetOverview>('/admin/fleet/hosts'),
    enabled,
    refetchInterval: 10_000,
  } as const;
}

export type FleetProcurement = {
  id: string;
  vendor: string;
  host_class: string;
  generation: string;
  target_cell_id: string | null;
  procurement_purpose: 'capacity_growth' | 'reserve_replenishment' | 'bootstrap' | 'specialization';
  product_id: string;
  region: string;
  location: string;
  status: string;
  host_id: string | null;
  provider_transaction_id: string | null;
  requires_approval: boolean;
  error: string | null;
  metadata: Record<string, unknown>;
  approved_at: string | null;
  ordered_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FleetProcurementRecommendation = {
  id: string;
  cell_id: string | null;
  cell_slug: string;
  cell_name: string;
  region: string;
  current_host_class: string;
  current_generation: string;
  current_role: 'starter_edge' | 'mainstream' | 'specialized';
  recommended_host_class: string;
  recommended_generation: string;
  recommended_role: 'starter_edge' | 'mainstream' | 'specialized';
  procurement_purpose: 'capacity_growth' | 'reserve_replenishment' | 'bootstrap' | 'specialization';
  minimum_hosts: number;
  reserve_shortfall_vcpu: number;
  reserve_shortfall_memory_gb: number;
  reserve_shortfall_disk_gb: number;
  summary: string;
  notes: string[];
};

export function useFleetHosts(enabled = true) {
  return useQuery({
    ...fleetOverviewQueryOptions(enabled),
    select: (data) => data.hosts,
  });
}

export function useFleetCells(enabled = true) {
  return useQuery({
    ...fleetOverviewQueryOptions(enabled),
    select: (data) => data.cells,
  });
}

export function useFleetProcurements(enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'procurements'],
    queryFn: async () => {
      const data = await apiV2.get<{ procurements: FleetProcurement[] }>('/admin/fleet/procurements');
      return data.procurements;
    },
    enabled,
    refetchInterval: 10_000,
  });
}

export function useFleetProcurementRecommendations(enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'procurement-recommendations'],
    queryFn: async () => {
      const data = await apiV2.get<{ recommendations: FleetProcurementRecommendation[] }>('/admin/fleet/procurement-recommendations');
      return data.recommendations;
    },
    enabled,
    refetchInterval: 10_000,
  });
}

export function useApproveProcurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (procurementId: string) => apiV2.post<{ ok: boolean }>(`/admin/fleet/procurements/${procurementId}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'procurements'] });
      qc.invalidateQueries({ queryKey: ['fleet', 'overview'] });
    },
  });
}

export function useSyncProcurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (procurementId: string) => apiV2.post<{ ok: boolean }>(`/admin/fleet/procurements/${procurementId}/sync`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'procurements'] });
      qc.invalidateQueries({ queryKey: ['fleet', 'overview'] });
    },
  });
}

export function useUpdateFleetHostMaintenanceState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ hostId, state, note }: { hostId: string; state: FleetHostMaintenanceState; note?: string }) => apiV2.post<{ host: FleetHost }>(`/admin/fleet/hosts/${hostId}/maintenance-state`, {
      state,
      ...(note ? { note } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'overview'] });
    },
  });
}

export function useCleanupFleetHostOrphans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hostId: string) => apiV2.post<{ cleaned_instance_ids: string[]; skipped_instance_ids: string[]; host: FleetHost }>(`/admin/fleet/hosts/${hostId}/cleanup-orphans`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'overview'] });
    },
  });
}

export function useUpdateFleetCellAdmissionState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      cellId,
      admissionState,
      sellabilityState,
      reason,
    }: {
      cellId: string;
      admissionState: FleetCellAdmissionState;
      sellabilityState: FleetCellSellabilityState;
      reason?: string | null;
    }) => apiV2.post<{ cell: FleetCell }>(`/admin/fleet/cells/${cellId}/admission-state`, {
      admission_state: admissionState,
      sellability_state: sellabilityState,
      ...(reason !== undefined ? { reason } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'overview'] });
    },
  });
}

export function useUpdateFleetCellReservePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      cellId,
      warmReserve,
      failureReserve,
      procurementReserve,
    }: {
      cellId: string;
      warmReserve: { vcpu: number; memory_gb: number; disk_gb: number };
      failureReserve: { vcpu: number; memory_gb: number; disk_gb: number };
      procurementReserve: { vcpu: number; memory_gb: number; disk_gb: number };
    }) => apiV2.post<{ cell: FleetCell }>(`/admin/fleet/cells/${cellId}/reserve-policy`, {
      warm_reserve: warmReserve,
      failure_reserve: failureReserve,
      procurement_reserve: procurementReserve,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'overview'] });
    },
  });
}
