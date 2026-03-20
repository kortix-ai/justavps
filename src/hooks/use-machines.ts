import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api-client";
import type { Machine, CheckoutRequired } from "@/lib/types";

export const machineKeys = {
  all: ["machines"] as const,
  detail: (id: string) => ["machines", id] as const,
};

export function useMachines(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: machineKeys.all,
    queryFn: () => api.get<{ machines: Machine[] }>("/machines").then((d) => d.machines),
    refetchInterval: options?.refetchInterval,
  });
}

export function useMachine(id: string) {
  return useQuery({
    queryKey: machineKeys.detail(id),
    queryFn: () => api.get<Machine>(`/machines/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "provisioning") return 5_000;
      if (status === "ready") return 10_000;
      return false;
    },
  });
}

interface CreateMachineInput {
  image_id?: string | null;
  provider: string;
  server_type: string;
  region: string;
  name?: string;
  docker_image?: string;
  entrypoint?: string;
  command?: string;
  ssh_key_ids?: string[];
  billing_interval?: "monthly" | "yearly" | "2year";
}

/** Result of createMachine — either a Machine (provisioned) or a checkout redirect (needs payment) */
export type CreateMachineResult =
  | { kind: "machine"; machine: Machine }
  | { kind: "checkout"; checkout: CheckoutRequired };

/**
 * Create a machine. If the user has no payment method on file, the API returns
 * 402 with a Stripe Checkout URL. The hook catches this and returns a typed
 * result so the caller can redirect — no second request needed.
 */
export function useCreateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMachineInput): Promise<CreateMachineResult> => {
      try {
        const machine = await api.post<Machine>("/machines", input);
        return { kind: "machine", machine };
      } catch (err) {
        if (err instanceof ApiError && err.status === 402 && err.data) {
          // The API returns { requires_checkout, checkout_url, message }
          return { kind: "checkout", checkout: err.data as unknown as CheckoutRequired };
        }
        throw err;
      }
    },
    onSuccess: (result) => {
      if (result.kind === "machine") {
        qc.setQueryData(machineKeys.detail(result.machine.id), result.machine);
        qc.invalidateQueries({ queryKey: machineKeys.all });
        qc.invalidateQueries({ queryKey: ["account", "limits"] });
      }
    },
  });
}

export function useDeleteMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/machines/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: machineKeys.all });
      const previous = qc.getQueryData<Machine[]>(machineKeys.all);
      qc.setQueryData<Machine[]>(machineKeys.all, (old) =>
        old?.filter((m) => m.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(machineKeys.all, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: machineKeys.all });
      qc.invalidateQueries({ queryKey: ["account", "limits"] });
    },
  });
}

export function useRebootMachine() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/machines/${id}/reboot`),
  });
}

export function useStopMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/machines/${id}/stop`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

export function useStartMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/machines/${id}/start`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

/** Cancel a machine subscription at the end of the current billing period */
export function useCancelMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/machines/${id}/cancel`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

/** Reactivate a machine subscription (reverse scheduled cancellation) */
export function useReactivateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/machines/${id}/reactivate`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

interface ResizeInput {
  id: string;
  server_type: string;
}

interface ResizeResponse {
  action: 'resize';
  old_type: string;
  new_type: string;
  status: string;
}

export function useResizeMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, server_type }: ResizeInput) =>
      api.post<ResizeResponse>(`/machines/${id}/resize`, { server_type }),
    onSuccess: (_data, { id }) => {
      // Optimistically mark the machine as provisioning/resizing so the UI
      // immediately shows the "Scaling in progress" banner without waiting for refetch.
      qc.setQueryData<Machine>(machineKeys.detail(id), (old) =>
        old
          ? {
              ...old,
              status: "provisioning",
              provisioning_stage: "resizing",
              provisioning_stage_updated_at: new Date().toISOString(),
            }
          : old,
      );
      qc.setQueryData<Machine[]>(machineKeys.all, (old) =>
        old?.map((m) =>
          m.id === id
            ? { ...m, status: "provisioning", provisioning_stage: "resizing" }
            : m,
        ),
      );
      // Then invalidate so both caches refresh from the server
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

// ─── Backups ────────────────────────────────────────────────────────────────

interface Backup {
  id: string;
  description: string;
  created: string;
  size: number;
  status: string;
}

export function useBackups(machineId: string) {
  return useQuery({
    queryKey: ["backups", machineId] as const,
    queryFn: () => api.get<{ backups: Backup[]; backups_enabled: boolean }>(`/machines/${machineId}/backups`),
    refetchInterval: 30_000,
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, description }: { machineId: string; description?: string }) =>
      api.post<{ backup_id: string; status: string }>(`/machines/${machineId}/backups`, description ? { description } : {}),
    onSuccess: (_data, { machineId }) => {
      qc.invalidateQueries({ queryKey: ["backups", machineId] });
    },
  });
}

export function useToggleBackups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, enable }: { machineId: string; enable: boolean }) =>
      api.post(`/machines/${machineId}/backups/${enable ? 'enable' : 'disable'}`),
    onSuccess: (_data, { machineId }) => {
      qc.invalidateQueries({ queryKey: ["backups", machineId] });
      qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
    },
  });
}
