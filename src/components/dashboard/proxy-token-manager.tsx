"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, timeAgo, relativeTime, PROXY_DOMAIN } from "@/lib/utils";
import { useMachines } from "@/hooks/use-machines";
import { useConfirm } from "@/hooks/use-confirm";
import { useCreateProxyToken, useDeleteProxyToken, useProxyTokens } from "@/hooks/use-proxy-tokens";
import { Check, Copy, ExternalLink, Globe, Link2, Loader2, Plus, Share2, Trash2 } from "lucide-react";

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "8 hours", value: 28800 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
];

type MachineOption = {
  id: string;
  slug: string;
  name: string;
};

export function ProxyTokenManager({
  machineId,
  machineSlug,
  compact = false,
}: {
  machineId?: string;
  machineSlug?: string;
  compact?: boolean;
}) {
  const { data: tokens, isLoading } = useProxyTokens(machineId);
  const { data: machines } = useMachines();
  const createProxyToken = useCreateProxyToken(machineId);
  const deleteProxyToken = useDeleteProxyToken(machineId);
  const [confirm, ConfirmDialog] = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState(machineId ?? "");
  const [label, setLabel] = useState("");
  const [portsInput, setPortsInput] = useState(compact ? "3000" : "");
  const [ttl, setTtl] = useState(String(TTL_OPTIONS[0].value));
  const [newProxyUrl, setNewProxyUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const machineOptions = useMemo<MachineOption[]>(() => (
    (machines ?? []).map((m) => ({ id: m.id, slug: m.slug, name: m.name }))
  ), [machines]);

  const resolvedMachine = machineOptions.find((m) => m.id === selectedMachineId)
    ?? (machineId && machineSlug ? { id: machineId, slug: machineSlug, name: machineSlug } : null);

  const parsePorts = () => {
    const raw = portsInput.trim();
    if (!raw) return null;
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 65535)) {
      throw new Error("Ports must be comma-separated integers between 1 and 65535");
    }
    return Array.from(new Set(nums));
  };

  const handleCreate = () => {
    if (!selectedMachineId) {
      toast.error("Select a machine");
      return;
    }
    let ports: number[] | null = null;
    try {
      ports = parsePorts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid ports");
      return;
    }
    createProxyToken.mutate({
      machine_id: selectedMachineId,
      label: label.trim() || null,
      ports,
      expires_in_seconds: Number(ttl),
    }, {
      onSuccess: (token) => {
        setNewProxyUrl(token.proxy_url ?? null);
        setDialogOpen(false);
        setLabel("");
        setPortsInput(compact ? "3000" : "");
        setTtl(String(TTL_OPTIONS[0].value));
        toast.success("Proxy token created");
      },
      onError: (err) => toast.error(err.message),
    });
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Revoke Proxy Token",
      description: `Revoke ${name}? Anyone using that link will lose access immediately.`,
      confirmLabel: "Revoke Token",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    deleteProxyToken.mutate(id, {
      onSuccess: () => toast.success("Proxy token revoked"),
      onError: (err) => toast.error(err.message),
    });
  };

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Proxy URL copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {newProxyUrl && (
        <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-blue-500/10 p-1.5">
              <Share2 className="size-3.5 text-blue-500" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Share link ready</p>
                  <p className="text-xs text-muted-foreground">Shown once. Recipients do not need a JustAVPS account.</p>
                </div>
                <button className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => { setNewProxyUrl(null); setCopied(false); }}>Dismiss</button>
              </div>
              <button
                onClick={() => copyUrl(newProxyUrl)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md bg-background/70 border border-border/60 hover:bg-muted/60 hover:border-border transition-all cursor-pointer group"
              >
                <span className="font-mono text-xs text-foreground truncate text-left">{newProxyUrl}</span>
                <span className="shrink-0 flex items-center gap-1.5 text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                  {copied ? <><Check className="size-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></> : <><Copy className="size-3.5" />Copy</>}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={cn("flex items-center justify-between", compact ? "mb-3" : "mb-4")}>
        <p className="text-sm text-muted-foreground">Share temporary machine access with a short-lived proxy token.</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className={cn(buttonVariants(), compact && "h-8 px-3 text-xs")}>
            <Plus className="size-4" />
            Create Proxy Token
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Proxy Token</DialogTitle>
              <DialogDescription>Share machine access with anyone. No account required, always expires.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {!machineId && (
                <div className="space-y-2">
                  <Label htmlFor="proxy-machine">Machine</Label>
                  <Select value={selectedMachineId} onValueChange={(value) => setSelectedMachineId(value ?? "")}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a machine" />
                    </SelectTrigger>
                    <SelectContent>
                      {machineOptions.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name} <span className="text-muted-foreground">({m.slug})</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {machineId && resolvedMachine && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Machine:</span> <span className="font-medium">{resolvedMachine.name}</span> <span className="text-muted-foreground">({resolvedMachine.slug})</span>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="proxy-label">Label</Label>
                <Input id="proxy-label" placeholder="Design review" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="proxy-ports">Ports</Label>
                <Input id="proxy-ports" placeholder="3000,8080 (leave empty for all)" value={portsInput} onChange={(e) => setPortsInput(e.target.value)} />
                <p className="text-xs text-muted-foreground">Comma-separated. Empty means all ports.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="proxy-ttl">Expires In</Label>
                <Select value={ttl} onValueChange={(value) => setTtl(value ?? String(TTL_OPTIONS[0].value))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TTL_OPTIONS.map((opt) => <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createProxyToken.isPending || !selectedMachineId}>
                {createProxyToken.isPending ? <><Loader2 className="size-4 animate-spin" />Creating...</> : "Create Token"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: compact ? 2 : 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border bg-card space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
        </div>
      ) : tokens?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed bg-card/40">
          <div className="rounded-2xl bg-muted p-4 mb-4"><Share2 className="size-8 text-muted-foreground/50" /></div>
          <h3 className="text-sm font-medium mb-1">No active proxy tokens</h3>
          <p className="text-xs text-muted-foreground text-center max-w-sm">Create a share link for designers, stakeholders, CI health checks, or temporary access.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tokens?.map((token) => {
            const firstPort = token.ports?.[0];
            const baseUrl = firstPort
              ? `https://${firstPort}--${token.machine_slug}.${PROXY_DOMAIN}`
              : `https://${token.machine_slug}.${PROXY_DOMAIN}`;
            const shareUrl = token.proxy_url ?? (token.token ? `${baseUrl}?__proxy_token=${token.token}` : null);
            return (
              <div key={token.id} className="group flex items-center justify-between gap-4 p-4 rounded-xl border bg-card transition-colors hover:bg-muted/40">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-medium">{token.label || "Unnamed token"}</span>
                    <Badge variant="secondary" className="font-mono text-[10px]">{token.token_prefix}</Badge>
                    <Badge variant="outline" className="text-[10px]">{token.machine_slug}</Badge>
                    {token.ports?.length ? <Badge variant="outline" className="text-[10px]">ports {token.ports.join(", ")}</Badge> : <Badge variant="outline" className="text-[10px]">all ports</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span>Created {timeAgo(token.created_at)}</span>
                    <span>&middot;</span>
                    <span>Expires {relativeTime(token.expires_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="size-3 text-muted-foreground shrink-0" />
                    {shareUrl ? (
                      <button onClick={() => copyUrl(shareUrl)} className="text-xs font-mono truncate text-left hover:text-foreground text-muted-foreground transition-colors">{shareUrl}</button>
                    ) : (
                      <span className="text-xs text-muted-foreground truncate">Full share URL is only shown once at creation. Create a new token if you lost it.</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon-sm" onClick={() => shareUrl && copyUrl(shareUrl)} disabled={!shareUrl} title={shareUrl ? "Copy share URL" : "Full share URL only available at creation"}>
                    <Copy className="size-3.5" />
                  </Button>
                  <a
                    href={baseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => handleDelete(token.id, token.label || token.token_prefix)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog />
    </>
  );
}
