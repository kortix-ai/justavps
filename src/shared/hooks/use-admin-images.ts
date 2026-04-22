/**
 * Admin Images + Backup Artifacts — React Query hooks backing the Admin
 * "Images" page. Source of truth: /admin/images[/:id] and
 * /admin/backup-artifacts[/:id].
 *
 * Mirrors the `use-admin-accounts.ts` / `use-admin-billing.ts` patterns.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

// ─── Images ────────────────────────────────────────────────────────────────

export type AdminImageStatus = 'creating' | 'ready' | 'failed' | 'deleted';

export type AdminImageSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  is_template: boolean;
  provider: string;
  provider_image_id: string | null;
  disk_size_gb: number | null;
  architecture: string | null;
  source_machine: {
    id: string;
    slug: string | null;
    name: string | null;
  } | null;
  owner: {
    id: string;
    email: string | null;
    name: string | null;
  };
  account: {
    id: string;
    name: string | null;
    slug: string | null;
    type: string | null;
  } | null;
  host_locality_count: number;
  created_at: string;
  updated_at: string;
};

export type AdminImageListResponse = {
  total: number;
  images: AdminImageSummary[];
  summary: {
    total_images: number;
    template_count: number;
    user_snapshot_count: number;
    ready_count: number;
    failed_count: number;
    total_disk_gb: number;
  };
};

export type AdminImageListParams = {
  q?: string;
  status?: AdminImageStatus | 'all';
  is_template?: boolean;
  provider?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildImageListQuery(params: AdminImageListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status && params.status !== 'all') search.set('status', params.status);
  if (typeof params.is_template === 'boolean') {
    search.set('is_template', params.is_template ? 'true' : 'false');
  }
  if (params.provider) search.set('provider', params.provider);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminImageList(params: AdminImageListParams = {}) {
  const {
    q = '',
    status = 'all',
    is_template,
    provider,
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'images',
      'list',
      { q, status, is_template, provider, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminImageListResponse>(
        `/admin/images${buildImageListQuery({ q, status, is_template, provider, limit, offset })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminImageDetail = {
  image: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    is_template: boolean;
    provider: string;
    provider_image_id: string | null;
    disk_size_gb: number | null;
    architecture: string | null;
    created_at: string;
    updated_at: string;
  };
  owner: {
    id: string;
    email: string | null;
    name: string | null;
  };
  account: {
    id: string;
    name: string | null;
    slug: string | null;
    type: string | null;
  } | null;
  source_machine: {
    id: string;
    slug: string;
    name: string;
    status: string;
  } | null;
  localities: Array<{
    id: string;
    host_id: string;
    host_name: string | null;
    region: string | null;
    location: string | null;
    availability_state: string;
    source: string;
    last_seen_at: string | null;
  }>;
  recent_machines: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    region: string;
    account_id: string | null;
    owner_id: string;
    created_at: string;
    deleted_at: string | null;
  }>;
};

export function useAdminImage(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'images', 'detail', id] as const,
    queryFn: () => api.get<AdminImageDetail>(`/admin/images/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useDeleteAdminImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/admin/images/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'images', 'list'] });
      qc.invalidateQueries({ queryKey: ['admin', 'images', 'detail'] });
    },
  });
}

// ─── Backup Artifacts ──────────────────────────────────────────────────────

export type AdminBackupArtifactStatus = 'creating' | 'ready' | 'failed' | 'deleted';
export type AdminBackupArtifactKind = 'user_snapshot' | 'operator_dr_export';

export type AdminBackupArtifactSummary = {
  id: string;
  display_name: string | null;
  backup_kind: string;
  inventory_scope: string;
  storage_scope: string;
  provider: string;
  provider_artifact_id: string | null;
  size_bytes: number | null;
  checksum: string | null;
  status: string;
  source_machine_slug: string | null;
  source_host: {
    id: string;
    name: string | null;
    region: string | null;
  } | null;
  machine: {
    id: string;
    slug: string | null;
  } | null;
  image: {
    id: string;
    name: string | null;
  } | null;
  retention_until: string | null;
  last_verified_at: string | null;
  restore_count: number;
  last_restore_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export type AdminBackupArtifactListResponse = {
  total: number;
  artifacts: AdminBackupArtifactSummary[];
  summary: {
    total_count: number;
    ready_count: number;
    failed_count: number;
    total_size_bytes: number;
    user_snapshot_count: number;
    operator_dr_count: number;
  };
};

export type AdminBackupArtifactListParams = {
  q?: string;
  status?: AdminBackupArtifactStatus | 'all';
  kind?: AdminBackupArtifactKind | 'all';
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildBackupArtifactQuery(params: AdminBackupArtifactListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status && params.status !== 'all') search.set('status', params.status);
  if (params.kind && params.kind !== 'all') search.set('kind', params.kind);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminBackupArtifactList(params: AdminBackupArtifactListParams = {}) {
  const {
    q = '',
    status = 'all',
    kind = 'all',
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'backup-artifacts',
      'list',
      { q, status, kind, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminBackupArtifactListResponse>(
        `/admin/backup-artifacts${buildBackupArtifactQuery({ q, status, kind, limit, offset })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminBackupArtifactDetail = {
  artifact: {
    id: string;
    display_name: string | null;
    artifact_type: string;
    backup_kind: string;
    inventory_scope: string;
    storage_scope: string;
    provider: string;
    provider_artifact_id: string | null;
    source_machine_slug: string | null;
    storage_url: string | null;
    size_bytes: number | null;
    checksum: string | null;
    status: string;
    retention_until: string | null;
    last_verified_at: string | null;
    restore_count: number;
    last_restore_at: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  };
  source_host: {
    id: string;
    name: string | null;
    region: string | null;
    location: string | null;
  } | null;
  source_machine: {
    id: string;
    slug: string | null;
    name: string | null;
    status: string | null;
  } | null;
  image: {
    id: string;
    name: string | null;
    status: string | null;
  } | null;
  restore_executions: Array<{
    id: string;
    status: string;
    execution_type: string;
    trigger_source: string;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    requested_by_user_id: string | null;
    target_host_id: string | null;
    error: string | null;
  }>;
};

export function useAdminBackupArtifact(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'backup-artifacts', 'detail', id] as const,
    queryFn: () => api.get<AdminBackupArtifactDetail>(`/admin/backup-artifacts/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}
