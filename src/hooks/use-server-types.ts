import { useQuery } from "@tanstack/react-query";
import { api } from "./api-client";
import type { Provider, Region, ServerType } from "@/lib/types";

export const serverTypeKeys = {
  providers: ["providers"] as const,
  regions: (provider: string) => ["regions", provider] as const,
  types: (provider: string, region: string) => ["server-types", provider, region] as const,
};

export function useProviders() {
  return useQuery({
    queryKey: serverTypeKeys.providers,
    queryFn: () =>
      api.get<{ providers: Provider[] }>("/server-types/providers").then((d) => d.providers),
    staleTime: 5 * 60_000,
  });
}

export function useRegions(provider: string | undefined) {
  return useQuery({
    queryKey: serverTypeKeys.regions(provider ?? ""),
    queryFn: () =>
      api.get<{ regions: Region[] }>(`/server-types/regions?provider=${provider}`).then((d) => d.regions),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

export function useServerTypes(provider: string | undefined, region: string | undefined) {
  return useQuery({
    queryKey: serverTypeKeys.types(provider ?? "", region ?? ""),
    queryFn: () =>
      api
        .get<{ server_types: ServerType[] }>(`/server-types?provider=${provider}&region=${region}`)
        .then((d) => d.server_types),
    enabled: !!provider && !!region,
    staleTime: 5 * 60_000,
  });
}
