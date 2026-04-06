import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiV2 } from "@/hooks/api-client";
import type { Image } from "@/lib/types";

type V2Image = Omit<Image, 'provider' | 'provider_image_id'>;

function mapV2Image(image: V2Image): Image {
  return {
    ...image,
    provider: 'managed',
    provider_image_id: null,
  };
}

export const imageKeys = {
  all: ["v2", "images"] as const,
};

export function useImages(enabled = true) {
  return useQuery({
    queryKey: imageKeys.all,
    queryFn: () => apiV2.get<{ images: V2Image[] }>("/images").then((d) => d.images.map(mapV2Image)),
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
      apiV2.post<V2Image>(`/images`, { machine_id: input.machine_id, name: input.name }).then(mapV2Image),
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
    mutationFn: (id: string) => apiV2.delete(`/images/${id}`),
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
