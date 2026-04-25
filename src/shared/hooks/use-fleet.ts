import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiV2 } from '@/shared/hooks/api-client';
import { defaultClusterName, defaultIncusClusterName, deriveClusterRef } from '@/shared/lib/fleet-clusters';

export type FleetHost = {
  id: string;
  vendor: string;
  host_class: string;
  region: string;
  cluster: {
    id: string;
    name: string;
    region: string;
    incus_cluster_name: string;
    incus_member_name: string;
  };
  location: string;
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
  bootstrap_validation: {
    status: 'passed' | 'warning' | 'failed' | null;
    bootstrap_version: string | null;
    runnerd_version: string | null;
    incus_version: string | null;
    storage_driver: string | null;
    storage_pool: string | null;
    started_at: string | null;
    completed_at: string | null;
    smoke_test_machine_id: string | null;
    smoke_test_result: 'passed' | 'failed' | null;
    warm_pool_result: 'passed' | 'failed' | null;
    triggered_by: string | null;
    notes: string[];
  };
  drift_status: 'in_policy' | 'warning_drift' | 'blocking_drift' | null;
  scheduler: {
    schedulable: boolean | null;
    unschedulable_reason: string | null;
    updated_at: string | null;
    updated_by: string | null;
  };
  incus_ui: {
    exposure: 'disabled' | 'operator_only' | 'cluster_console' | null;
    url: string | null;
    note: string | null;
    updated_at: string | null;
  };
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type FleetHostMaintenanceState = FleetHost['maintenance_state'];

export type FleetRegion = {
  id: string;
  label: string;
  continent: string;
  active: boolean;
  admission_state: 'open' | 'restricted' | 'closed';
  sellability_state: 'sellable' | 'reserve_only' | 'unsellable';
  host_count: number;
  active_host_count: number;
  active_schedulable_host_count: number;
  total_vcpu: number;
  total_memory_gb: number;
  total_disk_gb: number;
  used_vcpu: number;
  used_memory_gb: number;
  used_disk_gb: number;
  available_vcpu: number;
  available_memory_gb: number;
  available_disk_gb: number;
  utilization_score: number;
};

export type FleetCluster = {
  id: string;
  name: string;
  region: string;
  region_label: string;
  incus_cluster_name: string;
  host_count: number;
  active_host_count: number;
  active_schedulable_host_count: number;
  total_vcpu: number;
  total_memory_gb: number;
  total_disk_gb: number;
  used_vcpu: number;
  used_memory_gb: number;
  used_disk_gb: number;
  available_vcpu: number;
  available_memory_gb: number;
  available_disk_gb: number;
  admission_state: 'open' | 'restricted' | 'closed';
  sellability_state: 'sellable' | 'reserve_only' | 'unsellable';
  member_names: string[];
};

type FleetOverview = {
  hosts: FleetHost[];
  regions: FleetRegion[];
  clusters: FleetCluster[];
};

function fleetOverviewQueryOptions(enabled: boolean) {
  return {
    queryKey: ['fleet', 'overview'],
    queryFn: async () => apiV2.get<FleetOverview>('/admin/fleet/hosts'),
    enabled,
    refetchInterval: 10_000,
  } as const;
}

function normalizeHost(host: FleetHost): FleetHost {
  const cluster = host.cluster ?? deriveClusterRef({
    region: host.region,
    hostName: host.name,
    metadata: host.metadata,
  });
  return {
    ...host,
    cluster: {
      id: cluster.id,
      name: cluster.name,
      region: cluster.region,
      incus_cluster_name: cluster.incus_cluster_name,
      incus_member_name: cluster.incus_member_name,
    },
  };
}

function deriveClustersFromOverview(data: FleetOverview): FleetCluster[] {
  if (data.clusters && data.clusters.length > 0) return data.clusters;

  const hosts = (data.hosts ?? []).map(normalizeHost);
  const regionLabelById = new Map((data.regions ?? []).map((region) => [region.id, region.label]));
  const regionStatesById = new Map((data.regions ?? []).map((region) => [region.id, region]));
  const grouped = new Map<string, FleetHost[]>();

  for (const host of hosts) {
    const bucket = grouped.get(host.cluster.id) ?? [];
    bucket.push(host);
    grouped.set(host.cluster.id, bucket);
  }

  return Array.from(grouped.entries()).map(([clusterId, clusterHosts]) => {
    const sample = clusterHosts[0]!;
    const region = regionStatesById.get(sample.region);
    const activeHosts = clusterHosts.filter((host) => host.status === 'active' || host.status === 'bootstrapping');
    const activeSchedulableHosts = activeHosts.filter((host) => host.scheduler.schedulable !== false);
    const total_vcpu = clusterHosts.reduce((sum, host) => sum + (host.total_vcpu ?? 0), 0);
    const total_memory_gb = clusterHosts.reduce((sum, host) => sum + (host.total_memory_gb ?? 0), 0);
    const total_disk_gb = clusterHosts.reduce((sum, host) => sum + (host.total_disk_gb ?? 0), 0);
    const used_vcpu = clusterHosts.reduce((sum, host) => sum + host.used_vcpu, 0);
    const used_memory_gb = clusterHosts.reduce((sum, host) => sum + host.used_memory_gb, 0);
    const used_disk_gb = clusterHosts.reduce((sum, host) => sum + host.used_disk_gb, 0);

    return {
      id: clusterId,
      name: sample.cluster?.name ?? defaultClusterName(sample.region),
      region: sample.region,
      region_label: regionLabelById.get(sample.region) ?? sample.region,
      incus_cluster_name: sample.cluster?.incus_cluster_name ?? defaultIncusClusterName(sample.region),
      host_count: clusterHosts.length,
      active_host_count: activeHosts.length,
      active_schedulable_host_count: activeSchedulableHosts.length,
      total_vcpu,
      total_memory_gb,
      total_disk_gb,
      used_vcpu,
      used_memory_gb,
      used_disk_gb,
      available_vcpu: Math.max(total_vcpu - used_vcpu, 0),
      available_memory_gb: Math.max(total_memory_gb - used_memory_gb, 0),
      available_disk_gb: Math.max(total_disk_gb - used_disk_gb, 0),
      admission_state: region?.admission_state ?? 'open',
      sellability_state: region?.sellability_state ?? 'sellable',
      member_names: clusterHosts.map((host) => host.cluster?.incus_member_name ?? host.name),
    };
  });
}

function invalidateFleetViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['fleet', 'overview'] });
  qc.invalidateQueries({ queryKey: ['fleet', 'host-audit'] });
  qc.invalidateQueries({ queryKey: ['fleet', 'config-audit'] });
}

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

type FleetProcurementRecommendation = {
  id: string;
  region: string;
  region_label: string;
  current_host_class: string;
  current_role: 'starter_edge' | 'mainstream' | 'specialized';
  recommended_host_class: string;
  recommended_role: 'starter_edge' | 'mainstream' | 'specialized';
  minimum_hosts: number;
  reserve_shortfall_vcpu: number;
  reserve_shortfall_memory_gb: number;
  reserve_shortfall_disk_gb: number;
  summary: string;
  notes: string[];
};

type FleetControlPlaneServiceState = {
  id: string;
  service: string;
  scope: string;
  critical: boolean;
  mode: 'event_driven' | 'periodic';
  description: string;
  stale: boolean;
  age_ms_since_completion: number | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_started_at: string | null;
  last_completed_at: string | null;
  checkpoint: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type FleetConfigAuditCheck = {
  key: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
};

type FleetConfigAudit = {
  status: 'ok' | 'warning' | 'degraded';
  counts: { ok: number; warning: number; error: number };
  checks: FleetConfigAuditCheck[];
};

type FleetHostAuditEntry = {
  id: string;
  name: string;
  status: string;
  quarantined: boolean;
  unschedulable_reason: string | null;
  drift_status: 'in_policy' | 'warning_drift' | 'blocking_drift' | null;
  validation_status: 'passed' | 'warning' | 'failed' | null;
};

type FleetHostAudit = {
  summary: {
    total_hosts: number;
    active_schedulable_hosts: number;
    bootstrapping_hosts: number;
    pending_validation_hosts: number;
    quarantined_hosts: number;
    warning_drift_hosts: number;
    blocking_drift_hosts: number;
  };
  pending_validation: FleetHostAuditEntry[];
  quarantined: FleetHostAuditEntry[];
  warning_drift: FleetHostAuditEntry[];
  blocking_drift: FleetHostAuditEntry[];
};

export function useFleetHosts(enabled = true) {
  return useQuery({
    ...fleetOverviewQueryOptions(enabled),
    select: (data) => data.hosts.map(normalizeHost),
  });
}

// ─── Host detail (dedicated /v2/admin/hosts/[id] page) ─────────────────────

export type AdminHostDetailMachine = {
  id: string;
  slug: string;
  name: string;
  status: string;
  vcpu: number | null;
  memory_gb: number | null;
  disk_gb: number | null;
  ip: string | null;
  created_at: string;
  last_heartbeat_at: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
};

export type AdminHostDetailReservation = {
  id: string;
  machine_id: string;
  machine_slug: string | null;
  reservation_type: string;
  state: string;
  vcpu: number;
  memory_gb: number;
  disk_gb: number;
  expires_at: string | null;
  committed_at: string | null;
  released_at: string | null;
  created_at: string;
};

export type AdminHostDetailEvent = {
  id: string;
  machine_id: string;
  machine_slug: string | null;
  event: string;
  stage: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminHostDetailBackupArtifact = {
  id: string;
  display_name: string | null;
  source_machine_slug: string | null;
  status: string;
  artifact_type: string;
  size_bytes: number | null;
  created_at: string;
};

export type AdminHostDetailImageCached = {
  id: string;
  image_id: string | null;
  image_alias: string | null;
  image_ref: string;
  image_name: string | null;
  availability_state: string;
  source: string;
  last_seen_at: string | null;
  last_requested_at: string | null;
};

export type AdminHostRunnerProbe = {
  reachable: boolean;
  checked_at: string;
  incus?: {
    status: 'ok' | 'error';
    server_version: string | null;
    instance_count: number;
    image_count: number;
  };
  error?: string;
} | null;

export type AdminHostDetailResponse = {
  host: FleetHost;
  machines: AdminHostDetailMachine[];
  reservations: AdminHostDetailReservation[];
  events: AdminHostDetailEvent[];
  backup_artifacts: AdminHostDetailBackupArtifact[];
  runner_probe: AdminHostRunnerProbe;
  images_cached: AdminHostDetailImageCached[];
};

export function useAdminHostDetail(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'host-detail', id],
    queryFn: async () => apiV2.get<AdminHostDetailResponse>(`/admin/fleet/hosts/${id}`),
    enabled: enabled && Boolean(id),
    refetchInterval: 15_000,
  });
}

export function useFleetRegions(enabled = true) {
  return useQuery({
    ...fleetOverviewQueryOptions(enabled),
    select: (data) => data.regions,
  });
}

export function useFleetClusters(enabled = true) {
  return useQuery({
    ...fleetOverviewQueryOptions(enabled),
    select: (data) => deriveClustersFromOverview({
      ...data,
      hosts: data.hosts.map(normalizeHost),
    }),
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

export function useFleetControlPlaneServices(enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'control-plane-services'],
    queryFn: async () => {
      const data = await apiV2.get<{ services: FleetControlPlaneServiceState[] }>('/admin/fleet/control-plane/services');
      return data.services;
    },
    enabled,
    refetchInterval: 10_000,
  });
}

export function useFleetConfigAudit(enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'config-audit'],
    queryFn: async () => apiV2.get<FleetConfigAudit>('/admin/fleet/config-audit'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useFleetHostAudit(enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'host-audit'],
    queryFn: async () => apiV2.get<FleetHostAudit>('/admin/fleet/host-audit'),
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
      invalidateFleetViews(qc);
    },
  });
}

export function useCleanupFleetHostOrphans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hostId: string) => apiV2.post<{ cleaned_instance_ids: string[]; skipped_instance_ids: string[]; host: FleetHost }>(`/admin/fleet/hosts/${hostId}/cleanup-orphans`),
    onSuccess: () => {
      invalidateFleetViews(qc);
    },
  });
}

export function useUpdateFleetHostOperatorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      hostId,
      incusUiExposure,
      incusUiUrl,
      incusUiNote,
    }: {
      hostId: string;
      incusUiExposure: 'disabled' | 'operator_only' | 'cluster_console';
      incusUiUrl?: string;
      incusUiNote?: string;
    }) => apiV2.post<{ host: FleetHost }>(`/admin/fleet/hosts/${hostId}/operator-settings`, {
      incus_ui_exposure: incusUiExposure,
      ...(incusUiUrl !== undefined ? { incus_ui_url: incusUiUrl } : {}),
      ...(incusUiNote !== undefined ? { incus_ui_note: incusUiNote } : {}),
    }),
    onSuccess: () => {
      invalidateFleetViews(qc);
    },
  });
}

export function useUpdateFleetHostSchedulerState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ hostId, schedulable, reason }: { hostId: string; schedulable: boolean; reason?: string }) => apiV2.post<{ host: FleetHost }>(`/admin/fleet/hosts/${hostId}/scheduler-state`, {
      schedulable,
      ...(reason !== undefined ? { reason } : {}),
    }),
    onSuccess: () => {
      invalidateFleetViews(qc);
    },
  });
}

export function useCreateProcurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      product_id: string;
      // Optional — backend derives from product_id when omitted.
      region?: string;
      host_class?: string;
      location?: string;
      vendor?: string;
      requires_approval?: boolean;
    }) => apiV2.post<{ procurement: FleetProcurement }>("/admin/fleet/procurements", input),
    onSuccess: () => {
      invalidateFleetViews(qc);
      qc.invalidateQueries({ queryKey: ['fleet', 'procurements'] });
    },
  });
}

export type FleetHetznerProduct = {
  id: string;
  name: string;
  location?: string[];
  description?: string[];
  traffic?: string;
  prices?: Array<{
    location: string;
    monthly_net: string;
    monthly_gross: string;
    hourly_net?: string | null;
    hourly_gross?: string | null;
  }>;
};

export function useFleetHetznerProducts(enabled = true) {
  return useQuery({
    queryKey: ['fleet', 'hetzner-products'],
    queryFn: async () => {
      const data = await apiV2.get<{ products: FleetHetznerProduct[] }>('/admin/fleet/products/hetzner');
      return data.products;
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}
