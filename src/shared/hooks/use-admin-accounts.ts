/**
 * Admin Accounts + Users — React Query hooks backing the Admin
 * "Accounts" page. Source of truth: /admin/accounts[/:id] and
 * /admin/users[/:id].
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

// ─── Accounts ──────────────────────────────────────────────────────────────

export type AdminAccountSummary = {
  id: string;
  name: string;
  slug: string;
  type: 'personal' | 'organization';
  billing_email: string | null;
  created_at: string;
  deleted_at: string | null;
  member_count: number;
  machine_count: number;
  active_subscription_count: number;
  mrr_cents: number;
};

export type AdminAccountListResponse = {
  total: number;
  accounts: AdminAccountSummary[];
  summary: {
    personal_count: number;
    org_count: number;
    total_members: number;
    total_machines: number;
  };
};

export type AdminAccountListParams = {
  q?: string;
  type?: 'personal' | 'organization' | 'all';
  limit?: number;
  offset?: number;
  include_deleted?: boolean;
  enabled?: boolean;
};

function buildAccountQuery(params: AdminAccountListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.type && params.type !== 'all') search.set('type', params.type);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  if (params.include_deleted) search.set('include_deleted', 'true');
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminAccountList(params: AdminAccountListParams = {}) {
  const {
    q = '',
    type = 'all',
    limit = 100,
    offset = 0,
    include_deleted = false,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: ['admin', 'accounts', 'list', { q, type, limit, offset, include_deleted }] as const,
    queryFn: () =>
      api.get<AdminAccountListResponse>(
        `/admin/accounts${buildAccountQuery({ q, type, limit, offset, include_deleted })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminAccountDetail = {
  account: {
    id: string;
    name: string;
    slug: string;
    type: 'personal' | 'organization';
    billing_email: string | null;
    stripe_customer_id: string | null;
    personal_for_user_id: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  members: Array<{
    user_id: string;
    email: string | null;
    name: string | null;
    role: 'owner' | 'admin' | 'member';
    created_at: string;
  }>;
  machines: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    region: string;
    server_type: string;
    price_monthly: number | null;
    created_at: string;
  }>;
  subscriptions: Array<{
    id: string;
    machine_id: string | null;
    stripe_subscription_id: string;
    stripe_price_id: string | null;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
    cancel_at: string | null;
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: 'owner' | 'admin' | 'member';
    invited_by_user_id: string;
    invited_by_email: string | null;
    invited_by_name: string | null;
    expires_at: string;
    created_at: string;
  }>;
  ssh_keys: Array<{
    id: string;
    name: string;
    fingerprint: string;
    owner_id: string;
    account_id: string | null;
    created_at: string;
  }>;
};

export function useAdminAccount(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'accounts', 'detail', id] as const,
    queryFn: () => api.get<AdminAccountDetail>(`/admin/accounts/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

// ─── Users ──────────────────────────────────────────────────────────────────

export type AdminUserListItem = {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  default_account_id: string | null;
  created_at: string;
  account: {
    id: string;
    name: string | null;
    slug: string | null;
    type: string | null;
  } | null;
  machine_count: number;
  active_subscription_count: number;
  last_machine_created_at: string | null;
};

export type AdminUserListResponse = {
  total: number;
  users: AdminUserListItem[];
};

export type AdminUserListParams = {
  q?: string;
  limit?: number;
  offset?: number;
  has_machines?: boolean;
  enabled?: boolean;
};

function buildUserQuery(params: AdminUserListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  if (params.has_machines) search.set('has_machines', 'true');
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminUserList(params: AdminUserListParams = {}) {
  const {
    q = '',
    limit = 100,
    offset = 0,
    has_machines = false,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: ['admin', 'users', 'list', { q, limit, offset, has_machines }] as const,
    queryFn: () =>
      api.get<AdminUserListResponse>(
        `/admin/users${buildUserQuery({ q, limit, offset, has_machines })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminUserDetail = {
  user: {
    id: string;
    email: string;
    name: string | null;
    email_verified: string | null;
    is_admin: boolean;
    default_account_id: string | null;
    stripe_customer_id: string | null;
    github_id: string | null;
    created_at: string;
  };
  memberships: Array<{
    account_id: string;
    account_name: string | null;
    account_slug: string | null;
    account_type: string | null;
    role: 'owner' | 'admin' | 'member';
    created_at: string;
  }>;
  machines: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    region: string;
    server_type: string;
    price_monthly: number | null;
    account_id: string | null;
    created_at: string;
  }>;
  subscriptions: Array<{
    id: string;
    machine_id: string | null;
    stripe_subscription_id: string;
    stripe_price_id: string | null;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
    cancel_at: string | null;
  }>;
  ssh_keys: Array<{
    id: string;
    name: string;
    fingerprint: string;
    account_id: string | null;
    created_at: string;
  }>;
  api_keys: Array<{
    id: string;
    name: string;
    // Only prefix is ever exposed — never the full key, hash, or sha.
    key_prefix: string;
    scope: string;
    permissions: string[];
    account_id: string | null;
    machine_ids: string[] | null;
    expires_at: string | null;
    last_used: string | null;
    created_at: string;
  }>;
};

export function useAdminUser(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'users', 'detail', id] as const,
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}
