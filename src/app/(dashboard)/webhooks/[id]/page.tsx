"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";
import { JsonViewer } from "@/shared/ui/json-viewer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { timeAgo } from "@/shared/lib/utils";
import { toast } from "sonner";
import {
  useWebhooks,
  useUpdateWebhook,
  useDeleteWebhook,
  useWebhookDeliveries,
  useTestWebhook,
} from "@/v1/hooks/use-webhooks";
import type { WebhookDelivery } from "@/shared/lib/types";
import { useConfirm } from "@/shared/hooks/use-confirm";
import {
  ArrowLeft,
  Send,
  Trash2,
  Play,
  Pause,
  Loader2,
  AlertTriangle,
  Copy,
  RefreshCw,
} from "lucide-react";

function statusVariant(code: number | null): "default" | "destructive" | "secondary" {
  if (!code) return "secondary";
  if (code >= 200 && code < 300) return "default";
  return "destructive";
}

export default function WebhookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: webhooks, isLoading: loadingWebhooks } = useWebhooks();
  const { data: deliveries, isLoading: loadingDeliveries, refetch } = useWebhookDeliveries(id);
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const testWebhook = useTestWebhook();
  const [confirm, ConfirmDialog] = useConfirm();
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDelivery | null>(null);

  const webhook = webhooks?.find((w) => w.id === id);

  if (loadingWebhooks) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!webhook) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => router.push("/webhooks")}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <p className="text-muted-foreground">Webhook not found</p>
      </div>
    );
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete Webhook",
      description: "Delete this webhook? Events will no longer be delivered.",
      confirmLabel: "Delete",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    deleteWebhook.mutate(id, {
      onSuccess: () => { toast.success("Webhook deleted"); router.push("/webhooks"); },
      onError: (err) => toast.error(err.message),
    });
  };

  const handleTest = () => {
    testWebhook.mutate(id, {
      onSuccess: (result) => {
        if (result.success) toast.success(`Delivered (${result.status_code}, ${result.duration_ms}ms)`);
        else toast.error(`Failed: ${result.error || `HTTP ${result.status_code}`}`);
        refetch();
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/webhooks")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-heading text-2xl tracking-tight">Deliveries</h1>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-mono break-all">{webhook.url}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={webhook.disabled_at ? "destructive" : webhook.active ? "default" : "secondary"}
                className="text-[10px] px-1.5 py-0"
              >
                {webhook.disabled_at ? "Disabled" : webhook.active ? "Active" : "Paused"}
              </Badge>
              {webhook.events.map((evt) => (
                <Badge key={evt} variant="outline" className="text-[10px] px-1.5 py-0">
                  {evt === "*" ? "All events" : evt}
                </Badge>
              ))}
              {webhook.failure_count > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{webhook.failure_count} failures</Badge>
              )}
            </div>
            {webhook.last_delivered_at && (
              <p className="text-xs text-muted-foreground">Last delivered {timeAgo(webhook.last_delivered_at)}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testWebhook.isPending}>
              {testWebhook.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Test
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateWebhook.mutate({ id, active: !webhook.active }, {
                onSuccess: () => toast.success(webhook.active ? "Paused" : "Enabled"),
                onError: (err) => toast.error(err.message),
              })}
            >
              {webhook.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        {webhook.disable_reason && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {webhook.disable_reason}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg tracking-tight">Event Log</h2>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-muted-foreground">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {loadingDeliveries ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border bg-card space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      ) : !deliveries?.length ? (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">No deliveries yet. Send a test event to get started.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {deliveries.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelectedDelivery(d)}
              className="w-full group flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-muted/40 transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Badge variant={statusVariant(d.status_code)} className="text-[10px] px-2 py-0.5 shrink-0 tabular-nums">
                  {d.status_code ?? "ERR"}
                </Badge>
                <div className="min-w-0">
                  <span className="text-sm font-medium">{d.event_type}</span>
                  {d.error && <p className="text-xs text-destructive mt-0.5 truncate">{d.error}</p>}
                </div>
                {d.attempt > 1 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">Retry #{d.attempt - 1}</Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                {d.duration_ms != null && <span className="tabular-nums hidden sm:block">{d.duration_ms}ms</span>}
                <span>{timeAgo(d.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selectedDelivery} onOpenChange={(open) => !open && setSelectedDelivery(null)}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
          {selectedDelivery && (
            <div className="max-h-[85vh] overflow-y-auto">
              <div className="p-6 space-y-5">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <Badge variant={statusVariant(selectedDelivery.status_code)} className="text-xs px-2 py-0.5 tabular-nums">
                      {selectedDelivery.status_code ?? "ERR"}
                    </Badge>
                    {selectedDelivery.event_type}
                  </DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <p className="font-medium mt-0.5">{selectedDelivery.success ? "Delivered" : "Failed"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration</span>
                    <p className="font-medium mt-0.5 tabular-nums">{selectedDelivery.duration_ms ?? "—"}ms</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Attempt</span>
                    <p className="font-medium mt-0.5">{selectedDelivery.attempt} of 3</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Delivered</span>
                    <p className="font-medium mt-0.5">{timeAgo(selectedDelivery.created_at)}</p>
                  </div>
                </div>

                {selectedDelivery.error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm text-destructive">
                    <AlertTriangle className="size-4 shrink-0" />
                    {selectedDelivery.error}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Request Payload</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => { navigator.clipboard.writeText(JSON.stringify(selectedDelivery.payload, null, 2)); toast.success("Copied"); }}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                  <JsonViewer data={selectedDelivery.payload} className="max-h-72" defaultExpanded />
                </div>

                {selectedDelivery.response_body && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Body</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        onClick={() => { navigator.clipboard.writeText(selectedDelivery.response_body!); toast.success("Copied"); }}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                    <pre className="font-mono text-xs rounded-xl bg-muted/30 border p-4 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                      {selectedDelivery.response_body}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
}
