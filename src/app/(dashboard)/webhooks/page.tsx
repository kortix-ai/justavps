"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useWebhooks,
  useCreateWebhook,
  useDeleteWebhook,
} from "@/hooks/use-webhooks";
import type { CreateWebhookResponse } from "@/lib/types";
import { useConfirm } from "@/hooks/use-confirm";
import {
  Plus,
  Trash2,
  Copy,
  Webhook,
  Loader2,
  Globe,
  CheckCircle2,
} from "lucide-react";

const AVAILABLE_EVENTS = [
  { value: "*", label: "All events", description: "Receive all machine lifecycle events" },
  { value: "machine.stage_changed", label: "Stage changed", description: "Provisioning stage updates" },
  { value: "machine.status_changed", label: "Status changed", description: "Machine status transitions (ready, error, etc.)" },
  { value: "machine.heartbeat", label: "Heartbeat", description: "Periodic health reports from machines" },
];

export default function WebhooksPage() {
  const { data: webhooks, isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const [confirm, ConfirmDialog] = useConfirm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);
  const [customSecret, setCustomSecret] = useState("");
  const [useCustomSecret, setUseCustomSecret] = useState(false);

  // Shown after creation — contains the secret (only shown once)
  const [newWebhook, setNewWebhook] = useState<CreateWebhookResponse | null>(null);

  const toggleEvent = (value: string) => {
    if (value === "*") {
      setSelectedEvents(["*"]);
      return;
    }
    setSelectedEvents((prev) => {
      const without = prev.filter((e) => e !== "*");
      if (without.includes(value)) {
        const result = without.filter((e) => e !== value);
        return result.length === 0 ? ["*"] : result;
      }
      return [...without, value];
    });
  };

  const handleCreate = () => {
    if (!url) {
      toast.error("Provide a webhook URL");
      return;
    }
    try {
      new URL(url);
    } catch {
      toast.error("Invalid URL");
      return;
    }

    createWebhook.mutate(
      {
        url,
        events: selectedEvents,
        ...(useCustomSecret && customSecret.length >= 16 ? { secret: customSecret } : {}),
      },
      {
        onSuccess: (webhook) => {
          setNewWebhook(webhook);
          setUrl("");
          setSelectedEvents(["*"]);
          setCustomSecret("");
          setUseCustomSecret(false);
          setDialogOpen(false);
          toast.success("Webhook created");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleDelete = async (id: string, webhookUrl: string) => {
    const ok = await confirm({
      title: "Delete Webhook",
      description: `Delete webhook for "${webhookUrl}"? Events will no longer be delivered to this endpoint.`,
      confirmLabel: "Delete",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    deleteWebhook.mutate(id, {
      onSuccess: () => toast.success("Webhook deleted"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Webhooks</h1>

      {/* New webhook banner — shows secret (only visible once) */}
      {newWebhook && (
        <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20">
          <div className="text-sm font-medium text-green-500 mb-2">Webhook Created</div>
          <p className="text-xs text-muted-foreground mb-3">
            Copy the signing secret now &mdash; you won&apos;t see it again. Use it to verify webhook signatures via the{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">X-JustAVPS-Signature</code> header.
          </p>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Endpoint</Label>
            <div className="text-sm font-mono truncate">{newWebhook.url}</div>
            <Label className="text-xs text-muted-foreground">Signing Secret</Label>
            <div className="flex items-center gap-2">
              <Input value={newWebhook.secret} readOnly className="font-mono text-xs" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(newWebhook.secret);
                  toast.success("Secret copied");
                }}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 text-xs text-muted-foreground"
            onClick={() => setNewWebhook(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Receive real-time HTTP callbacks when machine events occur.
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className={cn(buttonVariants())}>
            <Plus className="size-4" />
            Add Webhook
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Webhook</DialogTitle>
              <DialogDescription>
                We&apos;ll send a POST request with a signed JSON payload to your URL when events occur.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* URL */}
              <div className="space-y-2">
                <Label htmlFor="webhook-url">Endpoint URL</Label>
                <Input
                  id="webhook-url"
                  placeholder="https://example.com/webhooks/justavps"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              {/* Events */}
              <div className="space-y-2">
                <Label>Events</Label>
                <div className="space-y-1.5">
                  {AVAILABLE_EVENTS.map((evt) => (
                    <button
                      key={evt.value}
                      type="button"
                      onClick={() => toggleEvent(evt.value)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                        selectedEvents.includes(evt.value)
                          ? "bg-primary/10 border border-primary/20"
                          : "bg-card hover:bg-muted/40 border border-transparent",
                      )}
                    >
                      <div
                        className={cn(
                          "size-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors",
                          selectedEvents.includes(evt.value)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {selectedEvents.includes(evt.value) && (
                          <CheckCircle2 className="size-3" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium">{evt.label}</div>
                        <div className="text-xs text-muted-foreground">{evt.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom secret */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setUseCustomSecret(!useCustomSecret)}
                    className={cn(
                      "size-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors",
                      useCustomSecret
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/30",
                    )}
                  >
                    {useCustomSecret && <CheckCircle2 className="size-3" />}
                  </button>
                  <Label className="cursor-pointer" onClick={() => setUseCustomSecret(!useCustomSecret)}>
                    Use custom signing secret
                  </Label>
                </div>
                {useCustomSecret && (
                  <div className="space-y-1">
                    <Input
                      placeholder="Minimum 16 characters"
                      value={customSecret}
                      onChange={(e) => setCustomSecret(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      If left empty, a secret will be generated for you.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={handleCreate}
                disabled={createWebhook.isPending || !url}
              >
                {createWebhook.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  "Create Webhook"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-card space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : webhooks?.length === 0 ? (
        <div className="text-center py-16">
          <Globe className="mx-auto size-10 text-muted-foreground/40 mb-3" strokeWidth={1} />
          <p className="text-muted-foreground">No webhooks configured</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Add a webhook to receive real-time machine events via HTTP.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {webhooks?.map((webhook) => (
            <div
              key={webhook.id}
              className="group flex items-center justify-between p-4 rounded-xl bg-card transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Globe className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium font-mono truncate">
                    {webhook.url}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <Badge
                      variant={webhook.active ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {webhook.active ? "Active" : "Inactive"}
                    </Badge>
                    <span>&middot;</span>
                    <span>
                      {webhook.events.includes("*")
                        ? "All events"
                        : webhook.events.join(", ")}
                    </span>
                    <span>&middot;</span>
                    <span>{timeAgo(webhook.created_at)}</span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="size-7 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(webhook.id, webhook.url)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
