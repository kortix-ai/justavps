/**
 * Admin Billing hooks — React Query bindings for /admin/billing/*.
 *
 * Mirrors the `use-admin-accounts.ts` pattern. Every hook is read-only —
 * Stripe owns the subscription lifecycle.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

// ─── Summary / KPIs ────────────────────────────────────────────────────────

export type AdminBillingSummary = {
  mrr_cents: number;
  mrr_by_status: {
    active: number;
    past_due: number;
    unpaid: number;
    canceled: number;
    incomplete: number;
  };
  active_count: number;
  at_risk_count: number;
  cancelling_count: number;
  cancelled_last_30d: number;
  top_accounts_by_mrr: Array<{
    account_id: string;
    account_name: string | null;
    mrr_cents: number;
    subscription_count: number;
  }>;
  stripe_events_last_24h: number;
};

export function useAdminBillingSummary(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'billing', 'summary'] as const,
    queryFn: () => api.get<AdminBillingSummary>('/admin/billing/summary'),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Subscription list ─────────────────────────────────────────────────────

export type AdminSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete';

export type AdminSubscriptionListItem = {
  id: string;
  stripe_subscription_id: string;
  stripe_subscription_item_id: string | null;
  stripe_price_id: string | null;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  cancelled_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  machine: {
    id: string;
    slug: string;
    name: string;
    status: string;
    region: string;
    server_type: string;
    price_monthly: number | null;
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
  created_at: string;
  updated_at: string;
};

export type AdminSubscriptionListResponse = {
  total: number;
  subscriptions: AdminSubscriptionListItem[];
};

export type AdminSubscriptionListParams = {
  q?: string;
  status?: AdminSubscriptionStatus | 'all';
  limit?: number;
  offset?: number;
  include_cancelled?: boolean;
  enabled?: boolean;
};

function buildSubscriptionQuery(params: AdminSubscriptionListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status && params.status !== 'all') search.set('status', params.status);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  if (params.include_cancelled) search.set('include_cancelled', 'true');
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminSubscriptionList(params: AdminSubscriptionListParams = {}) {
  const {
    q = '',
    status = 'all',
    limit = 100,
    offset = 0,
    include_cancelled = false,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'billing',
      'subscriptions',
      'list',
      { q, status, limit, offset, include_cancelled },
    ] as const,
    queryFn: () =>
      api.get<AdminSubscriptionListResponse>(
        `/admin/billing/subscriptions${buildSubscriptionQuery({
          q,
          status,
          limit,
          offset,
          include_cancelled,
        })}`,
      ),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Subscription detail ───────────────────────────────────────────────────

export type AdminSubscriptionDetail = {
  subscription: {
    id: string;
    stripe_subscription_id: string;
    stripe_subscription_item_id: string | null;
    stripe_checkout_session_id: string | null;
    stripe_price_id: string | null;
    status: string;
    cancel_at_period_end: boolean;
    cancel_at: string | null;
    cancelled_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    created_at: string;
    updated_at: string;
  };
  machine: {
    id: string;
    slug: string;
    name: string;
    status: string;
    region: string;
    server_type: string;
    price_monthly: number | null;
    last_heartbeat_at: string | null;
    created_at: string;
    deleted_at: string | null;
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
  recent_events: Array<{
    id: string;
    event: string;
    stage: string | null;
    message: string | null;
    created_at: string;
  }>;
};

export function useAdminSubscription(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'billing', 'subscriptions', 'detail', id] as const,
    queryFn: () => api.get<AdminSubscriptionDetail>(`/admin/billing/subscriptions/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

// ─── Stripe event log ──────────────────────────────────────────────────────

export type AdminStripeEvent = {
  event_id: string;
  event_type: string;
  processed_at: string;
};

export type AdminStripeEventsResponse = {
  events: AdminStripeEvent[];
};

export type AdminStripeEventsParams = {
  limit?: number;
  since?: string;
  enabled?: boolean;
};

function buildStripeEventsQuery(params: AdminStripeEventsParams) {
  const search = new URLSearchParams();
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (params.since) search.set('since', params.since);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminStripeEvents(params: AdminStripeEventsParams = {}) {
  const { limit = 50, since, enabled = true } = params;
  return useQuery({
    queryKey: ['admin', 'billing', 'stripe-events', { limit, since }] as const,
    queryFn: () =>
      api.get<AdminStripeEventsResponse>(
        `/admin/billing/stripe-events${buildStripeEventsQuery({ limit, since })}`,
      ),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}
