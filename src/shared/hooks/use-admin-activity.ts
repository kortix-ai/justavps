/**
 * Admin Activity — React Query hook backing the Admin "Activity Timeline"
 * page. Source of truth: /admin/activity.
 *
 * When `source='all'` the timeline is used as a live incident feed so we
 * refetch every 15s. When the feed is filtered down to a specific source
 * we relax to 30s — the merge is cheaper but cache invalidation also
 * matters less for post-incident review.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

export type AdminActivitySource =
  | 'all'
  | 'machines'
  | 'procurements'
  | 'webhooks'
  | 'restores'
  | 'maintenance'
  | 'backups'
  | 'bootstrap_validations';

export type AdminActivitySeverity = 'info' | 'warn' | 'error';

export type AdminActivityEvent = {
  id: string;
  source:
    | 'machine'
    | 'procurement'
    | 'webhook'
    | 'restore'
    | 'maintenance'
    | 'backup'
    | 'bootstrap_validation';
  event_type: string;
  subject: Record<string, unknown>;
  message: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  severity: AdminActivitySeverity;
};

export type AdminActivityResponse = {
  total: number;
  events: AdminActivityEvent[];
  summary: {
    counts_by_source: Record<string, number>;
    counts_by_severity: Record<string, number>;
    time_range: {
      since: string;
      until: string;
    };
  };
};

export type AdminActivityParams = {
  since?: string;
  until?: string;
  source?: AdminActivitySource;
  q?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

function buildQuery(params: AdminActivityParams): string {
  const search = new URLSearchParams();
  if (params.since) search.set('since', params.since);
  if (params.until) search.set('until', params.until);
  if (params.source && params.source !== 'all') search.set('source', params.source);
  if (params.q) search.set('q', params.q);
  if (typeof params.limit === 'number') search.set('limit', String(params.limit));
  if (typeof params.offset === 'number') search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function useAdminActivity(params: AdminActivityParams = {}) {
  const {
    since,
    until,
    source = 'all',
    q = '',
    limit = 100,
    offset = 0,
    enabled = true,
  } = params;

  return useQuery({
    queryKey: [
      'admin',
      'activity',
      { since, until, source, q, limit, offset },
    ] as const,
    queryFn: () =>
      api.get<AdminActivityResponse>(
        `/admin/activity${buildQuery({ since, until, source, q, limit, offset })}`,
      ),
    enabled,
    // Live incident feel when viewing the merged stream; relax when the
    // operator has narrowed to a specific source (post-incident review).
    refetchInterval: source === 'all' ? 15_000 : 30_000,
    refetchOnWindowFocus: false,
  });
}
