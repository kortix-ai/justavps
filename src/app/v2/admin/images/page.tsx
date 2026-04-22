"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { toast } from "sonner";
import { useConfirm } from "@/shared/hooks/use-confirm";
import { useAccount } from "@/shared/hooks/use-account";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminLoadingRows,
  AdminMetric,
  AdminPageHeader,
  AdminStatusPill,
  relativeShort,
} from "@/v2/components/admin/primitives";
import { machineStatusTone } from "@/v2/components/admin/tones";
import type { Tone } from "@/v2/components/admin/tones";
import {
  useAdminBackupArtifact,
  useAdminBackupArtifactList,
  useAdminImage,
  useAdminImageList,
  useDeleteAdminImage,
  type AdminBackupArtifactSummary,
  type AdminImageSummary,
} from "@/shared/hooks/use-admin-images";

// ─── Helpers ────────────────────────────────────────────────────────────────

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(value).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Failed to copy"),
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(value)}
      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
      title="Click to copy"
    >
      <span className="truncate">{value}</span>
      <Copy className="size-3" />
    </button>
  );
}

function imageStatusTone(status: string): Tone {
  switch (status) {
    case "ready":
      return "success";
    case "creating":
      return "warning";
    case "failed":
      return "danger";
    case "deleted":
      return "neutral";
    default:
      return "neutral";
  }
}

function localityStateTone(state: string): Tone {
  switch (state) {
    case "local":
      return "success";
    case "warming":
      return "warning";
    case "remote":
      return "info";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

function backupKindTone(kind: string): Tone {
  switch (kind) {
    case "user_snapshot":
      return "info";
    case "operator_dr_export":
      return "accent";
    default:
      return "neutral";
  }
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  const tb = gb * 1024;
  if (bytes >= tb) return `${(bytes / tb).toFixed(2)} TB`;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${(bytes / kb).toFixed(0)} KB`;
}

function humanKind(kind: string): string {
  if (kind === "user_snapshot") return "User snapshot";
  if (kind === "operator_dr_export") return "Operator DR";
  return kind;
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE DETAIL DIALOG
// ═══════════════════════════════════════════════════════════════════════════

function ImageDetailDialog({
  imageId,
  onClose,
}: {
  imageId: string | null;
  onClose: () => void;
}) {
  const open = Boolean(imageId);
  const { data, isLoading, error, refetch } = useAdminImage(imageId);
  const deleteMutation = useDeleteAdminImage();
  const [confirm, ConfirmDialog] = useConfirm();

  const runningCount = data?.recent_machines.filter(
    (m) => m.status !== "deleted" && m.status !== "error",
  ).length ?? 0;
  const inUse = runningCount > 0;

  async function onDelete() {
    if (!data) return;
    const ok = await confirm({
      title: `Delete image "${data.image.name}"?`,
      description:
        "This soft-deletes the image (status=deleted). Actual Hetzner / disk garbage collection is a separate background job — nothing is removed from disk by this action.",
      confirmLabel: "Delete image",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(data.image.id);
      toast.success("Image marked as deleted");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" />
              <span className="truncate">{data?.image.name ?? "Image"}</span>
              {data && (
                <AdminStatusPill tone={imageStatusTone(data.image.status)}>
                  {data.image.status}
                </AdminStatusPill>
              )}
              {data?.image.is_template && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Sparkles className="size-3" />
                  Template
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              {data && <CopyButton value={data.image.id} />}
            </DialogDescription>
          </DialogHeader>

          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="mr-2 inline size-4" />
              {error instanceof Error ? error.message : "Failed to load image"}
            </div>
          )}

          {data && (
            <div className="space-y-4">
              {/* Summary metrics */}
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <AdminMetric label="Provider" value={data.image.provider} />
                <AdminMetric
                  label="Disk"
                  value={data.image.disk_size_gb ? `${data.image.disk_size_gb} GB` : "—"}
                />
                <AdminMetric label="Architecture" value={data.image.architecture ?? "—"} />
                <AdminMetric
                  label="Created"
                  value={relativeShort(data.image.created_at)}
                />
              </div>

              {/* Identity */}
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Identity
                </h3>
                {data.image.description && (
                  <div><span className="text-muted-foreground">Description: </span>{data.image.description}</div>
                )}
                {data.image.provider_image_id && (
                  <div>
                    <span className="text-muted-foreground">Provider image ID: </span>
                    <span className="font-mono text-xs">{data.image.provider_image_id}</span>
                  </div>
                )}
              </section>

              {/* Owner + account */}
              <section className="rounded-xl border p-4 space-y-2 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ownership
                </h3>
                <div>
                  <span className="text-muted-foreground">Owner: </span>
                  {data.owner.email ?? data.owner.id.slice(0, 8)}
                  {data.owner.name ? ` · ${data.owner.name}` : ""}
                </div>
                {data.account && (
                  <Link
                    href={`/v2/admin/accounts?highlight=${data.account.id}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground">Account: </span>
                    <span className="font-medium">{data.account.name ?? data.account.slug ?? "—"}</span>
                    <Badge variant="outline" className="text-xs">{data.account.type}</Badge>
                  </Link>
                )}
              </section>

              {/* Source machine */}
              {data.source_machine && (
                <section className="rounded-xl border p-4 space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Source machine
                  </h3>
                  <Link
                    href={`/v2/admin/machines?highlight=${data.source_machine.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{data.source_machine.slug}</div>
                      <div className="truncate text-xs text-muted-foreground">{data.source_machine.name}</div>
                    </div>
                    <AdminStatusPill tone={machineStatusTone(data.source_machine.status)}>
                      {data.source_machine.status}
                    </AdminStatusPill>
                  </Link>
                </section>
              )}

              {/* Host localities */}
              <section className="rounded-xl border p-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <HardDrive className="size-3.5" />
                  Fleet localities ({data.localities.length})
                </h3>
                {data.localities.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No hosts currently track this image.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {data.localities.map((l) => (
                      <div
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{l.host_name ?? l.host_id.slice(0, 8)}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {l.region}{l.location ? ` · ${l.location}` : ""}{l.source ? ` · ${l.source}` : ""}
                          </div>
                        </div>
                        <AdminStatusPill tone={localityStateTone(l.availability_state)}>
                          {l.availability_state}
                        </AdminStatusPill>
                        <span className="text-xs text-muted-foreground">
                          {l.last_seen_at ? relativeShort(l.last_seen_at) : "never"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent boots */}
              <section className="rounded-xl border p-4">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Recent boots from this image ({data.recent_machines.length})
                </h3>
                {data.recent_machines.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No machines booted from this image yet.</div>
                ) : (
                  <div className="space-y-1.5">
                    {data.recent_machines.map((m) => (
                      <Link
                        key={m.id}
                        href={`/v2/admin/machines?highlight=${m.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-xs">{m.slug}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {m.name} · {m.region}
                          </div>
                        </div>
                        <AdminStatusPill tone={machineStatusTone(m.status)}>{m.status}</AdminStatusPill>
                        <span className="w-16 text-right text-xs text-muted-foreground">
                          {relativeShort(m.created_at)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              {/* Danger zone */}
              <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-destructive">Delete image</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Soft-deletes the image (status = <code>deleted</code>). Hetzner / disk
                      cleanup is a separate background GC job — this action does NOT
                      reclaim bytes.
                    </p>
                  </div>
                  <TooltipProvider delay={200}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={onDelete}
                            disabled={inUse || deleteMutation.isPending || data.image.status === "deleted"}
                          >
                            {deleteMutation.isPending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                            Delete
                          </Button>
                        }
                      />
                      {inUse && (
                        <TooltipContent>
                          In use by {runningCount} running machine(s).
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </section>

              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="size-3.5" />
                  Refresh
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKUP ARTIFACT DETAIL DIALOG
// ═══════════════════════════════════════════════════════════════════════════

function BackupArtifactDetailDialog({
  artifactId,
  onClose,
}: {
  artifactId: string | null;
  onClose: () => void;
}) {
  const open = Boolean(artifactId);
  const { data, isLoading, error } = useAdminBackupArtifact(artifactId);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Archive className="size-4 text-muted-foreground" />
            <span className="truncate">{data?.artifact.display_name ?? "Backup artifact"}</span>
            {data && (
              <AdminStatusPill tone={imageStatusTone(data.artifact.status)}>
                {data.artifact.status}
              </AdminStatusPill>
            )}
            {data && (
              <AdminStatusPill tone={backupKindTone(data.artifact.backup_kind)}>
                {humanKind(data.artifact.backup_kind)}
              </AdminStatusPill>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {data && <CopyButton value={data.artifact.id} />}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mr-2 inline size-4" />
            {error instanceof Error ? error.message : "Failed to load artifact"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Summary metrics */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <AdminMetric label="Size" value={formatBytes(data.artifact.size_bytes)} />
              <AdminMetric label="Provider" value={data.artifact.provider} />
              <AdminMetric label="Storage" value={data.artifact.storage_scope} />
              <AdminMetric label="Restores" value={data.artifact.restore_count} />
            </div>

            {/* Identity */}
            <section className="rounded-xl border p-4 space-y-1.5 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Identity
              </h3>
              <div><span className="text-muted-foreground">Type: </span>{data.artifact.artifact_type}</div>
              <div><span className="text-muted-foreground">Scope: </span>{data.artifact.inventory_scope}</div>
              {data.artifact.provider_artifact_id && (
                <div>
                  <span className="text-muted-foreground">Provider artifact ID: </span>
                  <span className="font-mono text-xs">{data.artifact.provider_artifact_id}</span>
                </div>
              )}
              {data.artifact.checksum && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Checksum: </span>
                  <CopyButton value={data.artifact.checksum} />
                </div>
              )}
              {data.artifact.source_machine_slug && (
                <div>
                  <span className="text-muted-foreground">Source machine slug: </span>
                  <span className="font-mono text-xs">{data.artifact.source_machine_slug}</span>
                </div>
              )}
              <div><span className="text-muted-foreground">Retention until: </span>{data.artifact.retention_until ? new Date(data.artifact.retention_until).toLocaleDateString() : "—"}</div>
              {data.artifact.last_verified_at && (
                <div>
                  <span className="text-muted-foreground">Last verified: </span>
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="size-3" /> {relativeShort(data.artifact.last_verified_at)}
                  </span>
                </div>
              )}
            </section>

            {/* Source host */}
            {data.source_host && (
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <HardDrive className="size-3.5" />
                  Source host
                </h3>
                <Link
                  href={`/v2/admin/hosts?highlight=${data.source_host.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{data.source_host.name ?? data.source_host.id.slice(0, 8)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {data.source_host.region}{data.source_host.location ? ` · ${data.source_host.location}` : ""}
                    </div>
                  </div>
                </Link>
              </section>
            )}

            {/* Source machine */}
            {data.source_machine && (
              <section className="rounded-xl border p-4 space-y-1.5">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Source machine
                </h3>
                <Link
                  href={`/v2/admin/machines?highlight=${data.source_machine.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs">{data.source_machine.slug}</div>
                    <div className="truncate text-xs text-muted-foreground">{data.source_machine.name}</div>
                  </div>
                  {data.source_machine.status && (
                    <AdminStatusPill tone={machineStatusTone(data.source_machine.status)}>
                      {data.source_machine.status}
                    </AdminStatusPill>
                  )}
                </Link>
              </section>
            )}

            {/* Associated image */}
            {data.image && (
              <section className="rounded-xl border p-4 space-y-1.5">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Associated image
                </h3>
                <Link
                  href={`/v2/admin/images?highlight=${data.image.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{data.image.name ?? data.image.id.slice(0, 8)}</div>
                  </div>
                  {data.image.status && (
                    <AdminStatusPill tone={imageStatusTone(data.image.status)}>
                      {data.image.status}
                    </AdminStatusPill>
                  )}
                </Link>
              </section>
            )}

            {/* Restore executions */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Restore executions ({data.restore_executions.length})
              </h3>
              {data.restore_executions.length === 0 ? (
                <div className="text-xs text-muted-foreground">No restores yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.restore_executions.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs">{r.id.slice(0, 8)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.execution_type} · trigger: {r.trigger_source}
                        </div>
                      </div>
                      <AdminStatusPill tone={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "warning"}>
                        {r.status}
                      </AdminStatusPill>
                      <span className="text-xs text-muted-foreground">
                        {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {relativeShort(r.started_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
              Backup artifacts are precious — no delete action is exposed in this iteration.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGES TAB
// ═══════════════════════════════════════════════════════════════════════════

function ImagesTab({
  onSelectImage,
}: {
  onSelectImage: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "creating" | "ready" | "failed" | "deleted">("all");
  const [templatesOnly, setTemplatesOnly] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useAdminImageList({
    q: q.trim() || undefined,
    status,
    is_template: templatesOnly ? true : undefined,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || status !== "all" || templatesOnly;

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Total images"
          value={data?.summary.total_images ?? "—"}
          icon={ImageIcon}
        />
        <AdminKpiCard
          label="Templates"
          value={data?.summary.template_count ?? "—"}
          hint="Golden bootable templates"
          icon={Sparkles}
          tone="accent"
        />
        <AdminKpiCard
          label="User snapshots"
          value={data?.summary.user_snapshot_count ?? "—"}
          hint="Customer-owned captures"
        />
        <AdminKpiCard
          label="Total disk"
          value={data ? `${data.summary.total_disk_gb} GB` : "—"}
          icon={HardDrive}
        />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or image ID"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus((v ?? "all") as typeof status)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="creating">Creating</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={templatesOnly}
            onChange={(e) => setTemplatesOnly(e.target.checked)}
            className="rounded"
          />
          Templates only
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setStatus("all");
              setTemplatesOnly(false);
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
      </AdminFilterBar>

      {isLoading ? (
        <AdminLoadingRows count={5} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline size-4" />
          Failed to load: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : !data || data.images.length === 0 ? (
        <AdminEmptyState
          icon={ImageIcon}
          title="No images found"
          description={hasFilters ? "Try clearing some filters." : "No images in the system yet."}
        />
      ) : (
        <div className="space-y-2">
          {data.images.map((img) => (
            <ImageRow key={img.id} image={img} onOpen={() => onSelectImage(img.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ImageRow({
  image,
  onOpen,
}: {
  image: AdminImageSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-heading text-base tracking-tight">{image.name}</h3>
            <AdminStatusPill tone={imageStatusTone(image.status)}>{image.status}</AdminStatusPill>
            {image.is_template && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Sparkles className="size-3" />
                Template
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {image.owner.email ?? image.owner.id.slice(0, 8)}
            {image.source_machine?.slug ? ` · from ${image.source_machine.slug}` : ""}
            {image.provider ? ` · ${image.provider}` : ""}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Disk</div>
            <div className="text-sm font-medium">{image.disk_size_gb != null ? `${image.disk_size_gb} GB` : "—"}</div>
          </div>
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hosts</div>
            <div className="text-sm font-medium">{image.host_locality_count}</div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
            <div className="text-sm font-medium">{relativeShort(image.created_at)}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKUP ARTIFACTS TAB
// ═══════════════════════════════════════════════════════════════════════════

function BackupArtifactsTab({
  onSelectArtifact,
}: {
  onSelectArtifact: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "creating" | "ready" | "failed" | "deleted">("all");
  const [kind, setKind] = useState<"all" | "user_snapshot" | "operator_dr_export">("all");

  const { data, isLoading, error, refetch, isFetching } = useAdminBackupArtifactList({
    q: q.trim() || undefined,
    status,
    kind,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || status !== "all" || kind !== "all";

  const totalGb = data
    ? (data.summary.total_size_bytes / (1024 * 1024 * 1024)).toFixed(2)
    : "—";

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Total artifacts"
          value={data?.summary.total_count ?? "—"}
          icon={Archive}
        />
        <AdminKpiCard label="Ready" value={data?.summary.ready_count ?? "—"} tone="success" />
        <AdminKpiCard
          label="Failed"
          value={data?.summary.failed_count ?? "—"}
          tone={data && data.summary.failed_count > 0 ? "danger" : "neutral"}
        />
        <AdminKpiCard label="Total size" value={data ? `${totalGb} GB` : "—"} icon={HardDrive} />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search display name or source slug"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus((v ?? "all") as typeof status)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="creating">Creating</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => setKind((v ?? "all") as typeof kind)}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="user_snapshot">User snapshot</SelectItem>
            <SelectItem value="operator_dr_export">Operator DR</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setStatus("all");
              setKind("all");
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
      </AdminFilterBar>

      {isLoading ? (
        <AdminLoadingRows count={5} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline size-4" />
          Failed to load: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : !data || data.artifacts.length === 0 ? (
        <AdminEmptyState
          icon={Archive}
          title="No backup artifacts found"
          description={hasFilters ? "Try clearing some filters." : "No artifacts in the system yet."}
        />
      ) : (
        <div className="space-y-2">
          {data.artifacts.map((art) => (
            <BackupArtifactRow key={art.id} artifact={art} onOpen={() => onSelectArtifact(art.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BackupArtifactRow({
  artifact,
  onOpen,
}: {
  artifact: AdminBackupArtifactSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-heading text-base tracking-tight">
              {artifact.display_name ?? artifact.id.slice(0, 8)}
            </h3>
            <AdminStatusPill tone={imageStatusTone(artifact.status)}>{artifact.status}</AdminStatusPill>
            <AdminStatusPill tone={backupKindTone(artifact.backup_kind)}>
              {humanKind(artifact.backup_kind)}
            </AdminStatusPill>
          </div>
          <div className="text-xs text-muted-foreground">
            {artifact.source_machine_slug ? `from ${artifact.source_machine_slug}` : "—"}
            {artifact.source_host?.name ? ` · ${artifact.source_host.name}` : ""}
            {artifact.source_host?.region ? ` (${artifact.source_host.region})` : ""}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Size</div>
            <div className="text-sm font-medium">{formatBytes(artifact.size_bytes)}</div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Retention</div>
            <div className="text-sm font-medium">
              {artifact.retention_until ? relativeShort(artifact.retention_until) : "—"}
            </div>
          </div>
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Restores</div>
            <div className="text-sm font-medium">{artifact.restore_count}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminImagesPage() {
  const { data: account, isLoading: accountLoading } = useAccount();
  const [tab, setTab] = useState<"images" | "backups">("images");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Admin — Images</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={ImageIcon}
        title="Images"
        description="User snapshots, golden templates, per-host localities, and backup artifacts across the fleet."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(((v as string) ?? "images") as typeof tab)}>
        <TabsList>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="backups">Backup artifacts</TabsTrigger>
        </TabsList>
        <TabsContent value="images" className="mt-4">
          <ImagesTab onSelectImage={setSelectedImageId} />
        </TabsContent>
        <TabsContent value="backups" className="mt-4">
          <BackupArtifactsTab onSelectArtifact={setSelectedArtifactId} />
        </TabsContent>
      </Tabs>

      <ImageDetailDialog
        imageId={selectedImageId}
        onClose={() => setSelectedImageId(null)}
      />
      <BackupArtifactDetailDialog
        artifactId={selectedArtifactId}
        onClose={() => setSelectedArtifactId(null)}
      />
    </div>
  );
}

