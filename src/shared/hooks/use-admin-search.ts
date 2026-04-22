/**
 * Admin Global Search — React Query hook that backs the Cmd-K palette.
 * Source of truth: GET /admin/search?q=&limit=.
 *
 * Debouncing the input is the component's responsibility — this hook just
 * fetches whatever `q` it's given (and is disabled when `q` is shorter than
 * the backend's 2-char minimum to avoid wasting requests).
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

export type AdminSearchResultType =
  | 'machine'
  | 'account'
  | 'user'
  | 'host'
  | 'procurement'
  | 'webhook'
  | 'image'
  | 'subscription'
  | 'ssh_key'
  | 'api_key';

export type AdminSearchResult = {
  type: AdminSearchResultType;
  id: string;
  label: string | null;
  sub_label: string | null;
  href: string;
  slug?: string | null;
};

export type AdminSearchResponse = {
  q: string;
  total: number;
  results: AdminSearchResult[];
  counts_by_type: Partial<Record<AdminSearchResultType, number>>;
};

export function useAdminSearch(q: string, enabled = true) {
  const trimmed = q.trim();
  const hasMinQuery = trimmed.length >= 2;
  return useQuery({
    queryKey: ['admin', 'search', trimmed] as const,
    queryFn: () =>
      api.get<AdminSearchResponse>(
        `/admin/search?q=${encodeURIComponent(trimmed)}`,
      ),
    enabled: enabled && hasMinQuery,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}
