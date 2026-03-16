import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import type { Snapshot } from "@/lib/types";

export const snapshotKeys = {
  all: ["snapshots"] as const,
};

export function useSnapshots() {
  return useQuery({
    queryKey: snapshotKeys.all,
    queryFn: () => api.get<{ snapshots: Snapshot[] }>("/snapshots").then((d) => d.snapshots),
    refetchInterval: (query) => {
      const hasBuilding = query.state.data?.some((s) => s.status === "building");
      return hasBuilding ? 5_000 : false;
    },
  });
}

interface CreateSnapshotInput {
  name: string;
  docker_image: string;
  provider: string;
}

export function useCreateSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSnapshotInput) => api.post<Snapshot>("/snapshots", input),
    onSuccess: (snapshot) => {
      qc.setQueryData<Snapshot[]>(snapshotKeys.all, (old) =>
        old ? [snapshot, ...old] : [snapshot],
      );
    },
  });
}

export function useDeleteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/snapshots/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: snapshotKeys.all });
      const previous = qc.getQueryData<Snapshot[]>(snapshotKeys.all);
      qc.setQueryData<Snapshot[]>(snapshotKeys.all, (old) =>
        old?.filter((s) => s.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(snapshotKeys.all, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: snapshotKeys.all });
    },
  });
}
