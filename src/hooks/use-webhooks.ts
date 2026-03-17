import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
  secret?: string;
}

export interface CreateWebhookResponse extends Webhook {
  secret: string;
}

export const webhookKeys = {
  all: ["webhooks"] as const,
};

export function useWebhooks() {
  return useQuery({
    queryKey: webhookKeys.all,
    queryFn: () => api.get<{ webhooks: Webhook[] }>("/webhooks").then((d) => d.webhooks),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookInput) =>
      api.post<CreateWebhookResponse>("/webhooks", input),
    onSuccess: (webhook) => {
      qc.setQueryData<Webhook[]>(webhookKeys.all, (old) =>
        old ? [...old, webhook] : [webhook],
      );
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: webhookKeys.all });
      const previous = qc.getQueryData<Webhook[]>(webhookKeys.all);
      qc.setQueryData<Webhook[]>(webhookKeys.all, (old) =>
        old?.filter((w) => w.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(webhookKeys.all, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}
