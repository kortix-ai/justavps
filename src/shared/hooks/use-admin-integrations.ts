/**
 * Admin Integrations — React Query hooks backing the Admin "Integrations" page.
 * Source of truth: /admin/integrations and /admin/integrations/:id.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/hooks/api-client';

export type IntegrationId =
  | 'stripe'
  | 'hetzner_robot'
  | 'hetzner_cloud'
  | 'cloudflare_kv'
  | 'cloudflare_dns'
  | 'database'
  | 'smtp';

export type IntegrationStatus = 'ok' | 'degraded' | 'down' | 'not_configured';

export type AdminIntegrationBlock = {
  id: IntegrationId;
  label: string;
  status: IntegrationStatus;
  configured: boolean;
  probe_ms: number | null;
  checked_at: string | null;
  error: string | null;
  context: Record<string, unknown>;
};

export type AdminIntegrationHealthResponse = {
  probed_at: string;
  integrations: AdminIntegrationBlock[];
};

export function useAdminIntegrationHealth(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'integrations', 'health'] as const,
    queryFn: () => api.get<AdminIntegrationHealthResponse>('/admin/integrations'),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useProbeAdminIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: IntegrationId) =>
      api.get<AdminIntegrationBlock>(`/admin/integrations/${id}`),
    onSuccess: (fresh) => {
      // Patch the fresh block into the list cache so the UI updates without
      // a round-trip on the list endpoint.
      qc.setQueryData<AdminIntegrationHealthResponse | undefined>(
        ['admin', 'integrations', 'health'] as const,
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            probed_at: new Date().toISOString(),
            integrations: prev.integrations.map((b) => (b.id === fresh.id ? fresh : b)),
          };
        },
      );
    },
  });
}
