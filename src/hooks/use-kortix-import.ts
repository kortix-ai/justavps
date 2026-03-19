import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import { machineKeys } from "./use-machines";

interface KortixLinkStatus {
  linked: boolean;
  kortix_email: string | null;
}

interface ClaimableMachine {
  sandbox_id: string;
  external_id: string;
  name: string;
  status: string;
  created_at: string;
}

interface ClaimResult {
  claimed: string[];
  skipped: { id: string; reason: string }[];
}

export function useKortixLinkStatus() {
  return useQuery({
    queryKey: ["kortix", "status"],
    queryFn: () => api.get<KortixLinkStatus>("/import/kortix/status"),
  });
}

export function useKortixClaimableMachines(enabled: boolean) {
  return useQuery({
    queryKey: ["kortix", "machines"],
    queryFn: () =>
      api
        .get<{ machines: ClaimableMachine[] }>("/import/kortix/machines")
        .then((d) => d.machines),
    enabled,
  });
}

export function useStartKortixImport() {
  return useMutation({
    mutationFn: () =>
      api.get<{ authorize_url: string }>("/import/kortix/start"),
    onSuccess: (data) => {
      window.location.href = data.authorize_url;
    },
  });
}

export function useClaimKortixMachines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineIds: string[]) =>
      api.post<ClaimResult>("/import/kortix/claim", {
        machine_ids: machineIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: machineKeys.all });
      qc.invalidateQueries({ queryKey: ["kortix", "machines"] });
    },
  });
}
