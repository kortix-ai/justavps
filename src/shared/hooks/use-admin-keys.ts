/**
 * Admin Keys & Security — React Query hooks backing the Admin "Keys" page.
 *
 * Source of truth: /admin/ssh-keys[/:id], /admin/api-keys[/:id],
 * /admin/proxy-tokens[/:id], /admin/proxy-tokens/:id/revoke.
 *
 * Mirrors the `use-admin-webhooks.ts` / `use-admin-images.ts` patterns.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

// ═══════════════════════════════════════════════════════════════════════════
// Shared owner / account shapes
// ═══════════════════════════════════════════════════════════════════════════

export type AdminKeyOwner = {
  id: string;
  email: string | null;
  name: string | null;
};

export type AdminKeyAccount = {
  id: string;
  name: string | null;
  slug: string | null;
  type: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// SSH KEYS
// ═══════════════════════════════════════════════════════════════════════════

export type AdminSshKeySummary = {
  id: string;
  name: string;
  fingerprint: string;
  provider_key_id: string | null;
  created_at: string;
  owner: AdminKeyOwner;
  account: AdminKeyAccount | null;
};

export type AdminSshKeyListResponse = {
  total: number;
  keys: AdminSshKeySummary[];
  summary: {
    total: number;
    with_provider_id: number;
    without_provider_id: number;
    last_7d: number;
  };
};

export type AdminSshKeyListParams = {
  q?: string;
  owner_user_id?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildSshKeyListQuery(params: AdminSshKeyListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.owner_user_id) search.set('owner_user_id', params.owner_user_id);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminSshKeyList(params: AdminSshKeyListParams = {}) {
  const {
    q = '',
    owner_user_id,
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'ssh-keys',
      'list',
      { q, owner_user_id, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminSshKeyListResponse>(
        `/admin/ssh-keys${buildSshKeyListQuery({ q, owner_user_id, limit, offset })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminSshKeyDetail = {
  key: {
    id: string;
    name: string;
    fingerprint: string;
    public_key: string;
    provider_key_id: string | null;
    created_at: string;
  };
  owner: AdminKeyOwner;
  account: AdminKeyAccount | null;
};

export function useAdminSshKey(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'ssh-keys', 'detail', id] as const,
    queryFn: () => api.get<AdminSshKeyDetail>(`/admin/ssh-keys/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useDeleteAdminSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: true; deleted_id: string }>(`/admin/ssh-keys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'ssh-keys', 'list'] });
      qc.invalidateQueries({ queryKey: ['admin', 'ssh-keys', 'detail'] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// API KEYS
// ═══════════════════════════════════════════════════════════════════════════

export type AdminApiKeyScope = 'account' | 'machine';
export type AdminApiKeyScopeFilter = AdminApiKeyScope | 'all';
export type AdminApiKeyExpiredFilter = boolean | 'all';

export type AdminApiKeySummary = {
  id: string;
  name: string;
  key_prefix: string;
  scope: string;
  machine_ids: string[];
  permissions: string[];
  expires_at: string | null;
  last_used: string | null;
  created_at: string;
  is_expired: boolean;
  owner: AdminKeyOwner;
  account: AdminKeyAccount | null;
};

export type AdminApiKeyListResponse = {
  total: number;
  keys: AdminApiKeySummary[];
  summary: {
    total: number;
    expired_count: number;
    active_count: number;
    never_used_count: number;
    last_7d_used_count: number;
  };
};

export type AdminApiKeyListParams = {
  q?: string;
  scope?: AdminApiKeyScopeFilter;
  expired?: AdminApiKeyExpiredFilter;
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildApiKeyListQuery(params: AdminApiKeyListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.scope && params.scope !== 'all') search.set('scope', params.scope);
  if (params.expired === true) search.set('expired', 'true');
  else if (params.expired === false) search.set('expired', 'false');
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminApiKeyList(params: AdminApiKeyListParams = {}) {
  const {
    q = '',
    scope = 'all',
    expired = 'all',
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'api-keys',
      'list',
      { q, scope, expired, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminApiKeyListResponse>(
        `/admin/api-keys${buildApiKeyListQuery({ q, scope, expired, limit, offset })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminApiKeyDetail = {
  key: {
    id: string;
    name: string;
    key_prefix: string;
    scope: string;
    machine_ids: string[];
    permissions: string[];
    permission_breakdown: {
      is_wildcard: boolean;
      read: boolean;
      write: boolean;
      delete: boolean;
      exec: boolean;
      proxy: boolean;
    };
    expires_at: string | null;
    last_used: string | null;
    created_at: string;
    is_expired: boolean;
  };
  owner: AdminKeyOwner;
  account: AdminKeyAccount | null;
};

export function useAdminApiKey(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'api-keys', 'detail', id] as const,
    queryFn: () => api.get<AdminApiKeyDetail>(`/admin/api-keys/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useDeleteAdminApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ ok: true; deleted_id: string }>(`/admin/api-keys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'api-keys', 'list'] });
      qc.invalidateQueries({ queryKey: ['admin', 'api-keys', 'detail'] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PROXY TOKENS
// ═══════════════════════════════════════════════════════════════════════════

export type AdminProxyTokenMachine = {
  id: string;
  slug: string | null;
  name: string | null;
};

export type AdminProxyTokenSummary = {
  id: string;
  token_prefix: string;
  label: string | null;
  ports: number[] | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  is_revoked: boolean;
  is_expired: boolean;
  machine: AdminProxyTokenMachine | null;
  owner: AdminKeyOwner;
  account: AdminKeyAccount | null;
};

export type AdminProxyTokenListResponse = {
  total: number;
  tokens: AdminProxyTokenSummary[];
  summary: {
    total: number;
    active_count: number;
    revoked_count: number;
    expired_count: number;
  };
};

export type AdminProxyTokenListParams = {
  q?: string;
  machine_id?: string;
  revoked?: boolean;
  expired?: boolean;
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildProxyTokenListQuery(params: AdminProxyTokenListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.machine_id) search.set('machine_id', params.machine_id);
  if (typeof params.revoked === 'boolean') search.set('revoked', params.revoked ? 'true' : 'false');
  if (typeof params.expired === 'boolean') search.set('expired', params.expired ? 'true' : 'false');
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminProxyTokenList(params: AdminProxyTokenListParams = {}) {
  const {
    q = '',
    machine_id,
    revoked,
    expired,
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'proxy-tokens',
      'list',
      { q, machine_id, revoked, expired, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminProxyTokenListResponse>(
        `/admin/proxy-tokens${buildProxyTokenListQuery({ q, machine_id, revoked, expired, limit, offset })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminProxyTokenDetail = {
  token: AdminProxyTokenSummary;
};

export function useAdminProxyToken(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'proxy-tokens', 'detail', id] as const,
    queryFn: () => api.get<AdminProxyTokenDetail>(`/admin/proxy-tokens/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useRevokeAdminProxyToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: true; token: AdminProxyTokenSummary }>(
        `/admin/proxy-tokens/${id}/revoke`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'proxy-tokens', 'list'] });
      qc.invalidateQueries({ queryKey: ['admin', 'proxy-tokens', 'detail'] });
    },
  });
}
