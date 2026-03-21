import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import type { Webhook, WebhookDelivery, WebhookTestResult, CreateWebhookInput, CreateWebhookResponse } from "@/lib/types";

export const webhookKeys = {
  all: ["webhooks"] as const,
  deliveries: (webhookId: string) => ["webhooks", webhookId, "deliveries"] as const,
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

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; url?: string; events?: string[]; active?: boolean }) =>
      api.patch<Webhook>(`/webhooks/${id}`, data),
    onSuccess: (updated) => {
      qc.setQueryData<Webhook[]>(webhookKeys.all, (old) =>
        old?.map((w) => (w.id === updated.id ? updated : w)),
      );
    },
  });
}

export function useWebhookDeliveries(webhookId: string | null) {
  return useQuery({
    queryKey: webhookKeys.deliveries(webhookId || ""),
    queryFn: () =>
      api.get<{ deliveries: WebhookDelivery[] }>(`/webhooks/${webhookId}/deliveries`).then((d) => d.deliveries),
    enabled: !!webhookId,
  });
}

export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (webhookId: string) =>
      api.post<WebhookTestResult>(`/webhooks/${webhookId}/test`),
    onSuccess: (_, webhookId) => {
      qc.invalidateQueries({ queryKey: webhookKeys.deliveries(webhookId) });
    },
  });
}
