import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/shared/hooks/api-client';

export type AdminMachineDetail = {
  id: string;
  slug: string;
  name: string;
  status: string;
  provisioning_stage: string | null;
  provider: string;
  server_type: string;
  region: string;
  ip: string | null;
  public_ipv4: string | null;
  public_ipv6: string | null;
  ssh_port: number | null;
  http_port: number | null;
  source: string;
  kortix_sandbox_id: string | null;
  price_monthly: number | null;
  backups_enabled: boolean;
  provider_server_id: string | null;
  baremetal_host_id: string | null;
  daemon_version: string | null;
  machine_mode: string;
  vcpu: number | null;
  memory_gb: number | null;
  disk_gb: number | null;
  domains: string[];
  created_at: string;
  ready_at: string | null;
  deleted_at: string | null;
  last_heartbeat_at: string | null;
  health: { cpu: number | null; memory: number | null; disk: number | null } | null;
  owner: { id: string; email: string | null; name: string | null };
  account: { id: string; name: string | null; slug: string | null; type: string | null } | null;
  subscription: {
    status: string;
    stripe_subscription_id: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
  } | null;
};

type AdminMachineEvent = {
  id: string;
  event: string;
  stage: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type AdminMachineHeartbeat = {
  daemon_version: string | null;
  last_heartbeat_at: string | null;
  last_projected_at: string | null;
  heartbeat_count: number;
  last_ready_at: string | null;
  uptime_sec: number | null;
  services: Record<string, boolean>;
  load: { cpu: number; memory: number; disk: number } | null;
  network: Record<string, number> | null;
  security: Record<string, boolean> | null;
  updated_at: string;
};

type AdminMachinePortAllocation = {
  id: string;
  protocol: string;
  public_port: number;
  target_port: number;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type AdminMachineHost = {
  id: string;
  name: string;
  region: string;
  location: string;
  public_ipv4: string | null;
};

type AdminMachineDetailResponse = {
  machine: AdminMachineDetail;
  events: AdminMachineEvent[];
  heartbeat: AdminMachineHeartbeat | null;
  port_allocations: AdminMachinePortAllocation[];
  host: AdminMachineHost | null;
};

export type AdminUserSearchResult = {
  id: string;
  email: string;
  name: string | null;
  default_account_id: string | null;
  account: {
    id: string;
    name: string | null;
    slug: string | null;
    type: string | null;
  } | null;
};

export function useAdminMachine(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'machine', id],
    queryFn: () => api.get<AdminMachineDetailResponse>(`/admin/machines/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

type CreateAdminMachineInput = {
  owner_user_id: string;
  account_id?: string | null;
  name?: string;
  region: string;
  vcpu: number;
  memory_gb: number;
  disk_gb: number;
  image_ref?: string | null;
  machine_mode?: 'vm' | 'container';
};

export function useCreateAdminMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAdminMachineInput) =>
      api.post<{ machine: AdminMachineDetail }>(`/admin/machines`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'machines'] });
    },
  });
}

type UpdateAdminMachineInput = {
  id: string;
  name?: string;
  vcpu?: number;
  memory_gb?: number;
  disk_gb?: number;
  backups_enabled?: boolean;
};

export function useUpdateAdminMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateAdminMachineInput) =>
      api.patch<{ machine: AdminMachineDetail }>(`/admin/machines/${id}`, patch),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'machines'] });
      qc.invalidateQueries({ queryKey: ['admin', 'machine', vars.id] });
    },
  });
}

export type MachineLifecycleAction = 'start' | 'stop' | 'reboot' | 'delete';

export function useMachineLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: MachineLifecycleAction }) => {
      if (action === 'delete') {
        return api.delete<{ ok: boolean }>(`/admin/machines/${id}`);
      }
      return api.post<{ ok: boolean; machine: AdminMachineDetail }>(`/admin/machines/${id}/${action}`);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'machines'] });
      qc.invalidateQueries({ queryKey: ['admin', 'machine', vars.id] });
    },
  });
}

export function useAdminUserSearch(query: string, enabled = true) {
  const trimmed = (query ?? '').trim();
  return useQuery({
    queryKey: ['admin', 'users', trimmed],
    queryFn: () =>
      api.get<{ users: AdminUserSearchResult[] }>(
        `/admin/users${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ''}`,
      ),
    enabled,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}
