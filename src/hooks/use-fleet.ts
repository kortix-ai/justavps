import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiV2 } from './api-client';

export type FleetHost = {
  id: string;
  vendor: string;
  host_class: string;
  region: string;
  location: string;
  name: string;
  status: string;
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
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type FleetProcurement = {
  id: string;
  vendor: string;
  host_class: string;
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

export function useFleetHosts(enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'hosts'],
    queryFn: async () => {
      const data = await apiV2.get<{ hosts: FleetHost[] }>('/admin/fleet/hosts');
      return data.hosts;
    },
    enabled,
    refetchInterval: 10_000,
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

export function useApproveProcurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (procurementId: string) => apiV2.post<{ ok: boolean }>(`/admin/fleet/procurements/${procurementId}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'procurements'] });
      qc.invalidateQueries({ queryKey: ['fleet', 'hosts'] });
    },
  });
}

export function useSyncProcurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (procurementId: string) => apiV2.post<{ ok: boolean }>(`/admin/fleet/procurements/${procurementId}/sync`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet', 'procurements'] });
      qc.invalidateQueries({ queryKey: ['fleet', 'hosts'] });
    },
  });
}
