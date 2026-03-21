import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import type { APIKey, ApiKeyScope, ApiKeyPermission } from "@/lib/types";

export const apiKeyKeys = {
  all: ["api-keys"] as const,
};

export interface CreateAPIKeyInput {
  name: string;
  scope?: ApiKeyScope;
  machine_ids?: string[];
  permissions?: ApiKeyPermission[];
  expires_in_seconds?: number | null;
}

export function useAPIKeys() {
  return useQuery({
    queryKey: apiKeyKeys.all,
    queryFn: () => api.get<{ api_keys: APIKey[] }>("/api-keys").then((d) => d.api_keys),
  });
}

export function useCreateAPIKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAPIKeyInput) => api.post<APIKey>("/api-keys", input),
    onSuccess: (key) => {
      qc.setQueryData<APIKey[]>(apiKeyKeys.all, (old) => (old ? [...old, key] : [key]));
    },
  });
}

export function useDeleteAPIKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: apiKeyKeys.all });
      const previous = qc.getQueryData<APIKey[]>(apiKeyKeys.all);
      qc.setQueryData<APIKey[]>(apiKeyKeys.all, (old) => old?.filter((k) => k.id !== id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(apiKeyKeys.all, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: apiKeyKeys.all });
    },
  });
}
