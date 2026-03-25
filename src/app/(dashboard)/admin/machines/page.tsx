"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/hooks/api-client";
import { useAccount } from "@/hooks/use-account";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

type AdminMachine = {
  id: string;
  slug: string;
  name: string;
  status: string;
  provisioning_stage: string | null;
  provider: string;
  server_type: string;
  region: string;
  ip: string | null;
  source: string;
  kortix_sandbox_id: string | null;
  price_monthly: number | null;
  backups_enabled: boolean;
  provider_server_id: string | null;
  daemon_version: string | null;
  created_at: string;
  ready_at: string | null;
  deleted_at: string | null;
  last_heartbeat_at: string | null;
  health: { cpu: number; memory: number; disk: number } | null;
  owner: { id: string; email: string | null; name: string | null };
  account: { id: string; name: string | null; slug: string | null; type: string | null } | null;
  subscription: {
    status: string;
    stripe_subscription_id: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
  } | null;
};

type ListResponse = {
  total: number;
  limit: number;
  offset: number;
  summary: {
    by_status: Record<string, number>;
    by_source: Record<string, number>;
  };
  machines: AdminMachine[];
};

type BatchDeleteResponse = {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ machine_id: string; slug: string; ok: boolean; error?: string }>;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "ready":
      return "default" as const;
    case "provisioning":
      return "secondary" as const;
    case "stopped":
      return "outline" as const;
    case "error":
    case "deleted":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminMachinesPage() {
  const qc = useQueryClient();
  const { data: account, isLoading: accountLoading } = useAccount();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [singleDeleteMachine, setSingleDeleteMachine] = useState<AdminMachine | null>(null);

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (includeDeleted) params.set("include_deleted", "true");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    return params.toString();
  }, [search, statusFilter, sourceFilter, includeDeleted, page]);

  const queryKey = ["admin", "machines", search, statusFilter, sourceFilter, includeDeleted, page] as const;

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () => api.get<ListResponse>(`/admin/machines?${buildQueryParams()}`),
    enabled: account?.is_admin === true,
    refetchOnWindowFocus: false,
  });

  // Single delete
  const deleteMutation = useMutation({
    mutationFn: (machineId: string) =>
      api.delete(`/admin/machines/${machineId}`),
    onSuccess: (_data, machineId) => {
      toast.success(`Machine deleted`);
      setSingleDeleteMachine(null);
      setSelected((prev) => { const next = new Set(prev); next.delete(machineId); return next; });
      qc.invalidateQueries({ queryKey: ["admin", "machines"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    },
  });

  // Batch delete
  const batchDeleteMutation = useMutation({
    mutationFn: (machineIds: string[]) =>
      api.post<BatchDeleteResponse>("/admin/machines/batch-delete", { machine_ids: machineIds }),
    onSuccess: (result) => {
      if (result.failed > 0) {
        toast.warning(`${result.succeeded} deleted, ${result.failed} failed`);
      } else {
        toast.success(`${result.succeeded} machines deleted`);
      }
      setDeleteDialogOpen(false);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin", "machines"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Batch delete failed");
    },
  });

  const machines = useMemo(() => data?.machines ?? [], [data?.machines]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === machines.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(machines.map((m) => m.id)));
    }
  };

  const selectedMachines = useMemo(
    () => machines.filter((m) => selected.has(m.id)),
    [machines, selected],
  );

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Admin Machines</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const statusSummary = data?.summary.by_status ?? {};
  const sourceSummary = data?.summary.by_source ?? {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl tracking-tight">Admin — Machines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage all machines across all accounts. Gracefully delete servers from Hetzner, DNS, billing, and DB.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={batchDeleteMutation.isPending}
            >
              <Trash2 className="size-4" />
              Delete {selected.size} selected
            </Button>
          )}
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          {Object.entries(statusSummary).map(([key, count]) => (
            <button
              key={key}
              onClick={() => {
                setStatusFilter((prev) => (prev === key ? "all" : key));
                setPage(0);
              }}
              className={`rounded-2xl border p-4 text-left transition-colors hover:bg-muted/50 ${statusFilter === key ? "ring-2 ring-primary" : ""}`}
            >
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{key}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{count}</p>
            </button>
          ))}
          {Object.entries(sourceSummary).map(([key, count]) => (
            <button
              key={`source-${key}`}
              onClick={() => {
                setSourceFilter((prev) => (prev === key ? "all" : key));
                setPage(0);
              }}
              className={`rounded-2xl border p-4 text-left transition-colors hover:bg-muted/50 ${sourceFilter === key ? "ring-2 ring-primary" : ""}`}
            >
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">source: {key}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{count}</p>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search slug, name, IP, sandbox ID..."
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? "all"); setPage(0); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="provisioning">Provisioning</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v ?? "all"); setPage(0); }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="kortix">Kortix</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => { setIncludeDeleted(e.target.checked); setPage(0); }}
            className="rounded"
          />
          Include deleted
        </label>
      </div>

      {/* Loading / Error */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="inline size-4 mr-2" />
          Failed to load: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : (
        <>
          {/* Select all bar */}
          {machines.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border px-4 py-2 text-sm text-muted-foreground">
              <button onClick={toggleSelectAll} className="flex items-center gap-2 hover:text-foreground transition-colors">
                <div className={`flex size-4 items-center justify-center rounded border transition-colors ${selected.size === machines.length ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                  {selected.size === machines.length && <Check className="size-3" />}
                </div>
                {selected.size === machines.length ? "Deselect all" : "Select all"} ({machines.length})
              </button>
              <span>
                Showing {data!.offset + 1}–{Math.min(data!.offset + machines.length, data!.total)} of {data!.total}
              </span>
            </div>
          )}

          {/* Machine list */}
          <div className="space-y-2">
            {machines.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl border p-4 transition-colors ${selected.has(m.id) ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
              >
                <div className="flex gap-3">
                  {/* Selection checkbox */}
                  <button
                    onClick={() => toggleSelect(m.id)}
                    className="mt-1 shrink-0"
                  >
                    <div className={`flex size-4 items-center justify-center rounded border transition-colors ${selected.has(m.id) ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40 hover:border-foreground"}`}>
                      {selected.has(m.id) && <Check className="size-3" />}
                    </div>
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        {/* Row 1: slug + badges */}
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-lg tracking-tight truncate">{m.slug}</h3>
                          <Badge variant={statusColor(m.status)}>{m.status}</Badge>
                          {m.source === "kortix" && <Badge variant="outline">kortix</Badge>}
                          {m.kortix_sandbox_id && (
                            <Badge variant="secondary" className="font-mono text-xs">
                              sandbox:{m.kortix_sandbox_id.slice(0, 8)}
                            </Badge>
                          )}
                          {m.provisioning_stage && m.status === "provisioning" && (
                            <Badge variant="secondary">{m.provisioning_stage}</Badge>
                          )}
                        </div>

                        {/* Row 2: meta info */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{m.name}</span>
                          <span className="flex items-center gap-1">
                            <Server className="size-3" />
                            {m.server_type} · {m.region}
                          </span>
                          {m.ip && <span>{m.ip}</span>}
                          {m.price_monthly != null && (
                            <span>${m.price_monthly}/mo</span>
                          )}
                          <span>Created {relativeTime(m.created_at)}</span>
                          {m.last_heartbeat_at && (
                            <span>Heartbeat {relativeTime(m.last_heartbeat_at)}</span>
                          )}
                        </div>

                        {/* Row 3: owner + account */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Owner: {m.owner.email ?? m.owner.id.slice(0, 8)}
                            {m.owner.name ? ` (${m.owner.name})` : ""}
                          </span>
                          {m.account && (
                            <span>
                              Account: {m.account.name ?? m.account.slug}
                              {m.account.type === "organization" ? " (org)" : ""}
                            </span>
                          )}
                          {m.subscription && (
                            <span>
                              Sub: {m.subscription.status}
                              {m.subscription.cancel_at_period_end ? " (cancelling)" : ""}
                            </span>
                          )}
                          {m.provider_server_id && (
                            <span className="font-mono">hetzner:{m.provider_server_id}</span>
                          )}
                        </div>

                        {/* Row 4: health */}
                        {m.health && (
                          <div className="flex items-center gap-3 text-xs">
                            <span className="flex items-center gap-1">
                              <Cpu className="size-3" />
                              CPU {m.health.cpu}%
                            </span>
                            <span className="flex items-center gap-1">
                              <MemoryStick className="size-3" />
                              RAM {m.health.memory}%
                            </span>
                            <span className="flex items-center gap-1">
                              <HardDrive className="size-3" />
                              Disk {m.health.disk}%
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {m.status !== "deleted" && (
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteMutation.isPending}
                            onClick={() => setSingleDeleteMachine(m)}
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}

          {/* Empty state */}
          {machines.length === 0 && !isLoading && (
            <div className="rounded-2xl border p-8 text-center text-muted-foreground">
              <Server className="mx-auto mb-3 size-8" />
              <p>No machines found matching your filters.</p>
            </div>
          )}
        </>
      )}

      {/* ── Single delete confirmation dialog ──────────────────────────────── */}
      <Dialog open={!!singleDeleteMachine} onOpenChange={(open) => { if (!open) setSingleDeleteMachine(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete machine</DialogTitle>
            <DialogDescription>
              This will <strong>gracefully</strong> destroy the machine:
            </DialogDescription>
          </DialogHeader>
          {singleDeleteMachine && (
            <div className="space-y-2 text-sm">
              <div className="rounded-xl border p-3 space-y-1">
                <div className="font-medium">{singleDeleteMachine.slug}</div>
                <div className="text-muted-foreground">
                  {singleDeleteMachine.name} · {singleDeleteMachine.server_type} · {singleDeleteMachine.region}
                </div>
                <div className="text-muted-foreground">
                  Owner: {singleDeleteMachine.owner.email ?? singleDeleteMachine.owner.id}
                </div>
                {singleDeleteMachine.provider_server_id && (
                  <div className="text-muted-foreground font-mono text-xs">
                    Hetzner server: {singleDeleteMachine.provider_server_id}
                  </div>
                )}
              </div>
              <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                <li>Delete server on Hetzner</li>
                <li>Remove DNS records &amp; KV routing</li>
                <li>Cancel Stripe subscription</li>
                <li>Mark as deleted in DB</li>
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSingleDeleteMachine(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => singleDeleteMachine && deleteMutation.mutate(singleDeleteMachine.id)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Batch delete confirmation dialog ───────────────────────────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batch delete {selected.size} machines</DialogTitle>
            <DialogDescription>
              This will <strong>gracefully</strong> destroy all selected machines. This is irreversible.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto space-y-1 text-sm">
            {selectedMachines.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <span className="font-medium">{m.slug}</span>
                  <span className="text-muted-foreground"> · {m.server_type}</span>
                </div>
                <Badge variant={statusColor(m.status)} className="text-xs">{m.status}</Badge>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={batchDeleteMutation.isPending}
              onClick={() => batchDeleteMutation.mutate(Array.from(selected))}
            >
              {batchDeleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete {selected.size} machines
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
