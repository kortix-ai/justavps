import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import type { Machine } from "@/lib/types";

export const machineKeys = {
  all: ["machines"] as const,
  detail: (id: string) => ["machines", id] as const,
};

export function useMachines() {
  return useQuery({
    queryKey: machineKeys.all,
    queryFn: () => api.get<{ machines: Machine[] }>("/machines").then((d) => d.machines),
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
}

export function useCreateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMachineInput) => api.post<Machine>("/machines", input),
    onSuccess: (machine) => {
      qc.setQueryData(machineKeys.detail(machine.id), machine);
      qc.invalidateQueries({ queryKey: machineKeys.all });
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
    },
  });
}

export function useRebootMachine() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/machines/${id}/reboot`),
  });
}

interface ResizeInput {
  id: string;
  server_type: string;
}

export function useResizeMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, server_type }: ResizeInput) =>
      api.post(`/machines/${id}/resize`, { server_type }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
    },
  });
}
