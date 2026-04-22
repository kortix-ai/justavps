/**
 * Admin Webhooks — React Query hooks backing the Admin "Webhooks" page.
 * Source of truth: /admin/webhooks[/:id] and /admin/webhook-deliveries[/:id].
 *
 * Mirrors the `use-admin-accounts.ts` / `use-admin-images.ts` patterns.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

// ─── Webhooks ──────────────────────────────────────────────────────────────

export type AdminWebhookSummary = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_delivered_at: string | null;
  disabled_at: string | null;
  disable_reason: string | null;
  created_at: string;
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
  delivery_count_24h: number;
  success_count_24h: number;
  failure_count_24h: number;
};

export type AdminWebhookListResponse = {
  total: number;
  webhooks: AdminWebhookSummary[];
  summary: {
    total: number;
    active_count: number;
    disabled_count: number;
    total_deliveries_24h: number;
    total_failures_24h: number;
    dead_lettered_count: number;
  };
};

export type AdminWebhookListParams = {
  q?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildWebhookListQuery(params: AdminWebhookListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (typeof params.active === 'boolean') {
    search.set('active', params.active ? 'true' : 'false');
  }
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminWebhookList(params: AdminWebhookListParams = {}) {
  const {
    q = '',
    active,
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'webhooks',
      'list',
      { q, active, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminWebhookListResponse>(
        `/admin/webhooks${buildWebhookListQuery({ q, active, limit, offset })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminWebhookDeliveryItem = {
  id: string;
  webhook_id: string;
  event_type: string;
  status: string;
  status_code: number | null;
  response_body: string | null;
  duration_ms: number | null;
  attempt: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  success: boolean;
  error: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  created_at: string;
};

export type AdminWebhookDetail = {
  webhook: {
    id: string;
    url: string;
    secret_preview: string;
    events: string[];
    active: boolean;
    failure_count: number;
    last_delivered_at: string | null;
    disabled_at: string | null;
    disable_reason: string | null;
    created_at: string;
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
  deliveries: AdminWebhookDeliveryItem[];
};

export function useAdminWebhook(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'webhooks', 'detail', id] as const,
    queryFn: () => api.get<AdminWebhookDetail>(`/admin/webhooks/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}

// ─── Webhook Deliveries ────────────────────────────────────────────────────

export type AdminDeliveryStatus = 'all' | 'queued' | 'delivered' | 'failed' | 'dead_lettered';

export type AdminWebhookDeliverySummary = {
  id: string;
  webhook_id: string;
  webhook_url: string | null;
  event_type: string;
  status: string;
  status_code: number | null;
  attempt: number;
  success: boolean;
  error: string | null;
  response_body: string | null;
  duration_ms: number | null;
  created_at: string;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
};

export type AdminWebhookDeliveryListResponse = {
  total: number;
  deliveries: AdminWebhookDeliverySummary[];
  summary: {
    delivered_count: number;
    failed_count: number;
    dead_lettered_count: number;
    avg_duration_ms: number;
  };
};

export type AdminWebhookDeliveryListParams = {
  q?: string;
  status?: AdminDeliveryStatus;
  event_type?: string;
  webhook_id?: string;
  since?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildDeliveryListQuery(params: AdminWebhookDeliveryListParams) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status && params.status !== 'all') search.set('status', params.status);
  if (params.event_type) search.set('event_type', params.event_type);
  if (params.webhook_id) search.set('webhook_id', params.webhook_id);
  if (params.since) search.set('since', params.since);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminWebhookDeliveryList(params: AdminWebhookDeliveryListParams = {}) {
  const {
    q = '',
    status = 'all',
    event_type,
    webhook_id,
    since,
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'admin',
      'webhook-deliveries',
      'list',
      { q, status, event_type, webhook_id, since, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminWebhookDeliveryListResponse>(
        `/admin/webhook-deliveries${buildDeliveryListQuery({
          q,
          status,
          event_type,
          webhook_id,
          since,
          limit,
          offset,
        })}`,
      ),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type AdminWebhookDeliveryDetail = {
  delivery: {
    id: string;
    webhook_id: string;
    event_type: string;
    status: string;
    status_code: number | null;
    payload: Record<string, unknown>;
    payload_version: number;
    response_body: string | null;
    duration_ms: number | null;
    attempt: number;
    next_attempt_at: string | null;
    last_attempt_at: string | null;
    success: boolean;
    error: string | null;
    delivered_at: string | null;
    dead_lettered_at: string | null;
    created_at: string;
  };
  webhook: {
    id: string;
    url: string | null;
    active: boolean | null;
    events: string[];
  };
  owner: {
    email: string | null;
    name: string | null;
  } | null;
  account: {
    id: string;
    name: string | null;
    slug: string | null;
    type: string | null;
  } | null;
};

export function useAdminWebhookDelivery(id: string | null | undefined) {
  return useQuery({
    queryKey: ['admin', 'webhook-deliveries', 'detail', id] as const,
    queryFn: () => api.get<AdminWebhookDeliveryDetail>(`/admin/webhook-deliveries/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
}
