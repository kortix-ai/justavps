import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/hooks/api-client";
import type { Image } from "@/shared/lib/types";

const imageKeys = {
  all: ["images"] as const,
};

export function useImages(enabled = true) {
  return useQuery({
    queryKey: imageKeys.all,
    queryFn: () => api.get<{ images: Image[] }>("/images").then((d) => d.images),
    enabled,
    refetchInterval: (query) => {
      const hasCreating = query.state.data?.some((s) => s.status === "creating");
      return hasCreating ? 5_000 : false;
    },
  });
}

interface CreateImageInput {
  machine_id: string;
  name: string;
}

export function useCreateImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateImageInput) =>
      api.post<Image>(`/machines/${input.machine_id}/image`, { name: input.name }),
    onSuccess: (image) => {
      qc.setQueryData<Image[]>(imageKeys.all, (old) =>
        old ? [image, ...old] : [image],
      );
      qc.invalidateQueries({ queryKey: ["account", "limits"] });
    },
  });
}

export function useDeleteImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/images/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: imageKeys.all });
      const previous = qc.getQueryData<Image[]>(imageKeys.all);
      qc.setQueryData<Image[]>(imageKeys.all, (old) =>
        old?.filter((s) => s.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(imageKeys.all, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: imageKeys.all });
      qc.invalidateQueries({ queryKey: ["account", "limits"] });
    },
  });
}
