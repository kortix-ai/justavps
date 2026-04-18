import { useQuery } from "@tanstack/react-query";
import { apiV2 } from "@/shared/hooks/api-client";

export interface HostCapacity {
  id: string;
  name: string;
  region: string;
  location: string;
  location_label: string;
  public_ipv4: string | null;
  status: string;
  capacity: {
    total_vcpu: number;
    used_vcpu: number;
    free_vcpu: number;
    total_memory_gb: number;
    used_memory_gb: number;
    free_memory_gb: number;
    total_disk_gb: number;
    used_disk_gb: number;
    free_disk_gb: number;
  };
}

export function useAvailableHosts(enabled = true) {
  return useQuery({
    queryKey: ["v2", "catalog", "hosts"],
    queryFn: () =>
      apiV2
        .get<{ hosts: HostCapacity[] }>("/catalog/hosts")
        .then((d) => d.hosts),
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
