import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import type { ProxyToken } from "@/lib/types";

export const proxyTokenKeys = {
  all: ["proxy-tokens"] as const,
  byMachine: (machineId?: string) => ["proxy-tokens", machineId ?? "all"] as const,
};

export interface CreateProxyTokenInput {
  machine_id: string;
  label?: string | null;
  ports?: number[] | null;
  expires_in_seconds?: number;
}

export function useProxyTokens(machineId?: string) {
  return useQuery({
    queryKey: proxyTokenKeys.byMachine(machineId),
    queryFn: () => {
      const qs = machineId ? `?machine_id=${machineId}` : "";
      return api.get<{ proxy_tokens: ProxyToken[] }>(`/proxy-tokens${qs}`).then((d) => d.proxy_tokens);
    },
  });
}

export function useCreateProxyToken(machineId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProxyTokenInput) => api.post<ProxyToken>("/proxy-tokens", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: proxyTokenKeys.all });
      qc.invalidateQueries({ queryKey: proxyTokenKeys.byMachine(machineId) });
    },
  });
}

export function useDeleteProxyToken(machineId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/proxy-tokens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: proxyTokenKeys.all });
      qc.invalidateQueries({ queryKey: proxyTokenKeys.byMachine(machineId) });
    },
  });
}
