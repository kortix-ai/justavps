"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  Copy,
  Fingerprint,
  KeyRound,
  Key as KeyIcon,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
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
import type { Tone } from "@/v2/components/admin/tones";
import {
  useAdminApiKey,
  useAdminApiKeyList,
  useAdminProxyToken,
  useAdminProxyTokenList,
  useAdminSshKey,
  useAdminSshKeyList,
  useDeleteAdminApiKey,
  useDeleteAdminSshKey,
  useRevokeAdminProxyToken,
  type AdminApiKeyScopeFilter,
  type AdminApiKeySummary,
  type AdminProxyTokenSummary,
  type AdminSshKeySummary,
} from "@/shared/hooks/use-admin-keys";

// ─── Helpers ────────────────────────────────────────────────────────────────

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(value).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Failed to copy"),
  );
}

function CopyButton({ value, truncate = true }: { value: string; truncate?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(value)}
      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
      title="Click to copy"
    >
      <span className={truncate ? "truncate" : ""}>{value}</span>
      <Copy className="size-3 shrink-0" />
    </button>
  );
}

function truncateMiddle(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function ownerLabel(owner: { email: string | null; id: string; name: string | null }): string {
  return owner.email ?? owner.name ?? owner.id.slice(0, 8);
}

function accountLabel(
  account: { name: string | null; slug: string | null } | null,
): string | null {
  if (!account) return null;
  return account.name ?? account.slug ?? null;
}

function portsLabel(ports: number[] | null | undefined): string {
  if (!ports || ports.length === 0) return "all ports";
  return ports.join(", ");
}

function apiKeyStatusTone(row: { is_expired: boolean; last_used: string | null }): Tone {
  if (row.is_expired) return "danger";
  if (!row.last_used) return "warning";
  return "success";
}

function permissionTone(perm: string): Tone {
  if (perm === "*") return "accent";
  if (perm === "delete") return "danger";
  if (perm === "write" || perm === "exec") return "warning";
  return "info";
}

// ═══════════════════════════════════════════════════════════════════════════
// SSH KEYS TAB
// ═══════════════════════════════════════════════════════════════════════════

function SshKeysTab({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const { data, isLoading, error, refetch, isFetching } = useAdminSshKeyList({
    q: q.trim() || undefined,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q);

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Total SSH keys"
          value={data?.summary.total ?? "—"}
          icon={KeyRound}
        />
        <AdminKpiCard
          label="Hetzner-registered"
          value={data?.summary.with_provider_id ?? "—"}
          hint="Have provider_key_id"
          tone="success"
        />
        <AdminKpiCard
          label="Not provider-registered"
          value={data?.summary.without_provider_id ?? "—"}
          tone={data && data.summary.without_provider_id > 0 ? "warning" : "neutral"}
        />
        <AdminKpiCard
          label="Added (7d)"
          value={data?.summary.last_7d ?? "—"}
          hint="Last 7 days"
        />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, fingerprint, owner email, or account"
            className="pl-9"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setQ("")}>
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
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
      ) : !data || data.keys.length === 0 ? (
        <AdminEmptyState
          icon={KeyRound}
          title="No SSH keys found"
          description={hasFilters ? "Try clearing filters." : "No SSH keys registered on the platform."}
        />
      ) : (
        <div className="space-y-2">
          {data.keys.map((k) => (
            <SshKeyRow key={k.id} sshKey={k} onOpen={() => onSelect(k.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SshKeyRow({
  sshKey,
  onOpen,
}: {
  sshKey: AdminSshKeySummary;
  onOpen: () => void;
}) {
  const acct = accountLabel(sshKey.account);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{sshKey.name}</h3>
            {sshKey.provider_key_id ? (
              <AdminStatusPill tone="success">Hetzner-registered</AdminStatusPill>
            ) : (
              <AdminStatusPill tone="warning">local-only</AdminStatusPill>
            )}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Fingerprint className="size-3 shrink-0" />
            <span className="truncate">{truncateMiddle(sshKey.fingerprint, 16, 10)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {ownerLabel(sshKey.owner)}
            {acct ? ` · ${acct}` : ""}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 text-right">
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
            <div className="text-sm font-medium">{relativeShort(sshKey.created_at)}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

function SshKeyDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const open = Boolean(id);
  const { data, isLoading, error, refetch } = useAdminSshKey(id);
  const deleteMutation = useDeleteAdminSshKey();
  const [confirm, ConfirmDialog] = useConfirm();

  async function onDelete() {
    if (!data) return;
    const ok = await confirm({
      title: `Delete SSH key "${data.key.name}"?`,
      description:
        "This permanently removes the record from the database. Any Hetzner-side copy will remain until the next provider sync. New machines can no longer be seeded with this key.",
      confirmLabel: "Delete SSH key",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(data.key.id);
      toast.success("SSH key deleted");
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
              <KeyRound className="size-4 text-muted-foreground" />
              <span className="truncate">{data?.key.name ?? "SSH key"}</span>
              {data?.key.provider_key_id && (
                <AdminStatusPill tone="success">Hetzner-registered</AdminStatusPill>
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              {data && <CopyButton value={data.key.id} />}
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
              {error instanceof Error ? error.message : "Failed to load SSH key"}
            </div>
          )}

          {data && (
            <div className="space-y-4">
              {/* Identity */}
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Identity
                </h3>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Fingerprint: </span>
                  <CopyButton value={data.key.fingerprint} truncate={false} />
                </div>
                {data.key.provider_key_id ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground">Provider key ID: </span>
                    <CopyButton value={data.key.provider_key_id} />
                  </div>
                ) : (
                  <div className="text-xs text-yellow-700 dark:text-yellow-400">
                    Not yet registered with any provider.
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Created: </span>
                  {relativeShort(data.key.created_at)}
                </div>
              </section>

              {/* Ownership */}
              <section className="rounded-xl border p-4 space-y-2 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ownership
                </h3>
                <div>
                  <span className="text-muted-foreground">Owner: </span>
                  {ownerLabel(data.owner)}
                  {data.owner.name ? ` · ${data.owner.name}` : ""}
                </div>
                {data.account && (
                  <div>
                    <span className="text-muted-foreground">Account: </span>
                    <span className="font-medium">{accountLabel(data.account) ?? "—"}</span>
                    {data.account.type && (
                      <Badge variant="outline" className="ml-2 text-xs">{data.account.type}</Badge>
                    )}
                  </div>
                )}
              </section>

              {/* Public key */}
              <section className="rounded-xl border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Public key
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(data.key.public_key)}
                  >
                    <Copy className="size-3.5" />
                    Copy
                  </Button>
                </div>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                  {data.key.public_key}
                </pre>
              </section>

              {/* Actions */}
              <section className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium">Danger zone</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Hard-deletes this SSH key record. There is no soft-delete — the
                      row is permanently removed.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onDelete}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    Delete
                  </Button>
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
// API KEYS TAB
// ═══════════════════════════════════════════════════════════════════════════

function ApiKeysTab({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<AdminApiKeyScopeFilter>("all");
  const [expiredOnly, setExpiredOnly] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useAdminApiKeyList({
    q: q.trim() || undefined,
    scope,
    expired: expiredOnly ? true : "all",
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || scope !== "all" || expiredOnly;

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Total API keys"
          value={data?.summary.total ?? "—"}
          icon={KeyIcon}
        />
        <AdminKpiCard
          label="Active"
          value={data?.summary.active_count ?? "—"}
          tone="success"
        />
        <AdminKpiCard
          label="Expired"
          value={data?.summary.expired_count ?? "—"}
          tone={data && data.summary.expired_count > 0 ? "danger" : "neutral"}
        />
        <AdminKpiCard
          label="Used (7d)"
          value={data?.summary.last_7d_used_count ?? "—"}
          hint={data ? `${data.summary.never_used_count} never used` : undefined}
        />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, key prefix, or owner email"
            className="pl-9"
          />
        </div>
        <Select
          value={scope}
          onValueChange={(v) => setScope(((v ?? "all") as AdminApiKeyScopeFilter))}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scopes</SelectItem>
            <SelectItem value="account">Account</SelectItem>
            <SelectItem value="machine">Machine</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={expiredOnly}
            onChange={(e) => setExpiredOnly(e.target.checked)}
            className="rounded"
          />
          Expired only
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setScope("all");
              setExpiredOnly(false);
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
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
      ) : !data || data.keys.length === 0 ? (
        <AdminEmptyState
          icon={KeyIcon}
          title="No API keys found"
          description={hasFilters ? "Try clearing filters." : "No API keys registered on the platform."}
        />
      ) : (
        <div className="space-y-2">
          {data.keys.map((k) => (
            <ApiKeyRow key={k.id} apiKey={k} onOpen={() => onSelect(k.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApiKeyRow({
  apiKey,
  onOpen,
}: {
  apiKey: AdminApiKeySummary;
  onOpen: () => void;
}) {
  const acct = accountLabel(apiKey.account);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">{apiKey.name}</h3>
            <AdminStatusPill tone={apiKey.scope === "machine" ? "info" : "accent"}>
              {apiKey.scope}
            </AdminStatusPill>
            {apiKey.is_expired && (
              <AdminStatusPill tone="danger">expired</AdminStatusPill>
            )}
            {!apiKey.is_expired && !apiKey.last_used && (
              <AdminStatusPill tone="warning">never used</AdminStatusPill>
            )}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {apiKey.key_prefix}…
          </div>
          <div className="text-xs text-muted-foreground">
            {ownerLabel(apiKey.owner)}
            {acct ? ` · ${acct}` : ""}
          </div>
          {apiKey.permissions.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {apiKey.permissions.slice(0, 6).map((p) => (
                <AdminStatusPill key={p} tone={permissionTone(p)}>
                  {p}
                </AdminStatusPill>
              ))}
              {apiKey.permissions.length > 6 && (
                <Badge variant="outline" className="text-[10px]">
                  +{apiKey.permissions.length - 6}
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last used</div>
            <div className="text-sm font-medium">
              {apiKey.last_used ? relativeShort(apiKey.last_used) : "never"}
            </div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Expires</div>
            <div className={apiKey.is_expired ? "text-sm font-medium text-red-600 dark:text-red-400" : "text-sm font-medium"}>
              {apiKey.expires_at ? relativeShort(apiKey.expires_at) : "never"}
            </div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
            <div className="text-sm font-medium">{relativeShort(apiKey.created_at)}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

function ApiKeyDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const open = Boolean(id);
  const { data, isLoading, error, refetch } = useAdminApiKey(id);
  const deleteMutation = useDeleteAdminApiKey();
  const [confirm, ConfirmDialog] = useConfirm();

  async function onDelete() {
    if (!data) return;
    const ok = await confirm({
      title: `Delete API key "${data.key.name}"?`,
      description:
        "This permanently removes the API key from the database. Any in-flight requests using this key will start receiving 401s on next authentication.",
      confirmLabel: "Delete API key",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(data.key.id);
      toast.success("API key deleted");
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
              <KeyIcon className="size-4 text-muted-foreground" />
              <span className="truncate">{data?.key.name ?? "API key"}</span>
              {data && (
                <AdminStatusPill tone={apiKeyStatusTone(data.key)}>
                  {data.key.is_expired ? "expired" : data.key.last_used ? "active" : "unused"}
                </AdminStatusPill>
              )}
              {data && (
                <AdminStatusPill tone={data.key.scope === "machine" ? "info" : "accent"}>
                  {data.key.scope}
                </AdminStatusPill>
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              {data && <CopyButton value={data.key.id} />}
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
              {error instanceof Error ? error.message : "Failed to load API key"}
            </div>
          )}

          {data && (
            <div className="space-y-4">
              {/* Identity */}
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Identity
                </h3>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Prefix: </span>
                  <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs">
                    {data.key.key_prefix}…
                  </code>
                </div>
                <div>
                  <span className="text-muted-foreground">Scope: </span>
                  <span className="font-medium">{data.key.scope}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Created: </span>
                  {relativeShort(data.key.created_at)}
                </div>
              </section>

              {/* Permissions */}
              <section className="rounded-xl border p-4 space-y-2 text-sm">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Permissions
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {data.key.permissions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">None</span>
                  ) : (
                    data.key.permissions.map((p) => (
                      <AdminStatusPill key={p} tone={permissionTone(p)}>{p}</AdminStatusPill>
                    ))
                  )}
                </div>
                {data.key.permission_breakdown.is_wildcard && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Wildcard key — grants all capabilities (read / write / delete / exec / proxy).
                  </p>
                )}
                {!data.key.permission_breakdown.is_wildcard && (
                  <div className="grid grid-cols-2 gap-1 pt-2 text-xs md:grid-cols-5">
                    {([
                      ["read", data.key.permission_breakdown.read],
                      ["write", data.key.permission_breakdown.write],
                      ["delete", data.key.permission_breakdown.delete],
                      ["exec", data.key.permission_breakdown.exec],
                      ["proxy", data.key.permission_breakdown.proxy],
                    ] as const).map(([label, enabled]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        {enabled ? (
                          <Check className="size-3 text-emerald-600" />
                        ) : (
                          <X className="size-3 text-muted-foreground/50" />
                        )}
                        <span className={enabled ? "" : "text-muted-foreground/60"}>
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Machine scope */}
              {data.key.scope === "machine" && (
                <section className="rounded-xl border p-4 space-y-2 text-sm">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Machine scope ({data.key.machine_ids.length})
                  </h3>
                  {data.key.machine_ids.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No machines pinned.</div>
                  ) : (
                    <div className="space-y-1">
                      {data.key.machine_ids.map((mid) => (
                        <div key={mid} className="flex items-center justify-between gap-2">
                          <CopyButton value={mid} />
                          <Link
                            href={`/v2/admin/machines?highlight=${mid}`}
                            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                          >
                            view
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Timing */}
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Timing
                </h3>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                  <AdminMetric
                    label="Last used"
                    value={data.key.last_used ? relativeShort(data.key.last_used) : "never"}
                  />
                  <AdminMetric
                    label="Expires"
                    value={data.key.expires_at ? relativeShort(data.key.expires_at) : "never"}
                    sub={data.key.is_expired ? "expired" : undefined}
                  />
                  <AdminMetric label="Created" value={relativeShort(data.key.created_at)} />
                </div>
              </section>

              {/* Ownership */}
              <section className="rounded-xl border p-4 space-y-2 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ownership
                </h3>
                <div>
                  <span className="text-muted-foreground">Owner: </span>
                  {ownerLabel(data.owner)}
                  {data.owner.name ? ` · ${data.owner.name}` : ""}
                </div>
                {data.account && (
                  <div>
                    <span className="text-muted-foreground">Account: </span>
                    <span className="font-medium">{accountLabel(data.account) ?? "—"}</span>
                    {data.account.type && (
                      <Badge variant="outline" className="ml-2 text-xs">{data.account.type}</Badge>
                    )}
                  </div>
                )}
              </section>

              {/* Actions */}
              <section className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium">Danger zone</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Hard-deletes this API key. Requests using this credential will
                      be rejected on next authentication. No soft-delete.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onDelete}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    Delete
                  </Button>
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
// PROXY TOKENS TAB
// ═══════════════════════════════════════════════════════════════════════════

function ProxyTokensTab({
  onSelect,
}: {
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [revokedOnly, setRevokedOnly] = useState(false);
  const [expiredOnly, setExpiredOnly] = useState(false);
  const [machineId, setMachineId] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useAdminProxyTokenList({
    q: q.trim() || undefined,
    machine_id: machineId.trim() || undefined,
    revoked: revokedOnly ? true : undefined,
    expired: expiredOnly ? true : undefined,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || revokedOnly || expiredOnly || Boolean(machineId);

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Total proxy tokens"
          value={data?.summary.total ?? "—"}
          icon={ShieldCheck}
        />
        <AdminKpiCard
          label="Active"
          value={data?.summary.active_count ?? "—"}
          tone="success"
        />
        <AdminKpiCard
          label="Revoked"
          value={data?.summary.revoked_count ?? "—"}
          tone={data && data.summary.revoked_count > 0 ? "warning" : "neutral"}
        />
        <AdminKpiCard
          label="Expired"
          value={data?.summary.expired_count ?? "—"}
          tone={data && data.summary.expired_count > 0 ? "danger" : "neutral"}
        />
      </AdminKpiGrid>

      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search label, token prefix, or owner email"
            className="pl-9"
          />
        </div>
        <Input
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
          placeholder="Machine UUID"
          className="w-[260px] font-mono text-xs"
        />
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={revokedOnly}
            onChange={(e) => setRevokedOnly(e.target.checked)}
            className="rounded"
          />
          Revoked only
        </label>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={expiredOnly}
            onChange={(e) => setExpiredOnly(e.target.checked)}
            className="rounded"
          />
          Expired only
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setMachineId("");
              setRevokedOnly(false);
              setExpiredOnly(false);
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
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
      ) : !data || data.tokens.length === 0 ? (
        <AdminEmptyState
          icon={ShieldCheck}
          title="No proxy tokens found"
          description={hasFilters ? "Try clearing filters." : "No proxy tokens issued."}
        />
      ) : (
        <div className="space-y-2">
          {data.tokens.map((t) => (
            <ProxyTokenRow key={t.id} token={t} onOpen={() => onSelect(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProxyTokenRow({
  token,
  onOpen,
}: {
  token: AdminProxyTokenSummary;
  onOpen: () => void;
}) {
  const acct = accountLabel(token.account);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">
              {token.label || <span className="italic text-muted-foreground">unlabeled</span>}
            </h3>
            {token.is_revoked ? (
              <AdminStatusPill tone="warning">revoked</AdminStatusPill>
            ) : token.is_expired ? (
              <AdminStatusPill tone="danger">expired</AdminStatusPill>
            ) : (
              <AdminStatusPill tone="success">active</AdminStatusPill>
            )}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {token.token_prefix}…
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>ports: </span>
            <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[10px]">
              {portsLabel(token.ports)}
            </code>
          </div>
          {token.machine && (
            <div className="text-xs">
              <span className="text-muted-foreground">machine: </span>
              <Link
                href={`/v2/admin/machines?highlight=${token.machine.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {token.machine.slug ?? token.machine.id.slice(0, 8)}
              </Link>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {ownerLabel(token.owner)}
            {acct ? ` · ${acct}` : ""}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 text-right">
          <div className="min-w-[100px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Expires</div>
            <div
              className={
                token.is_expired && !token.is_revoked
                  ? "text-sm font-medium text-red-600 dark:text-red-400"
                  : "text-sm font-medium"
              }
            >
              {relativeShort(token.expires_at)}
            </div>
          </div>
          <div className="min-w-[100px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
            <div className="text-sm font-medium">{relativeShort(token.created_at)}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

function ProxyTokenDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const open = Boolean(id);
  const { data, isLoading, error, refetch } = useAdminProxyToken(id);
  const revokeMutation = useRevokeAdminProxyToken();
  const [confirm, ConfirmDialog] = useConfirm();

  const token = data?.token;

  async function onRevoke() {
    if (!token) return;
    const ok = await confirm({
      title: `Revoke proxy token "${token.label || token.token_prefix}"?`,
      description:
        "Revoked tokens are rejected immediately. This is the terminal state — the record is kept so the audit trail survives.",
      confirmLabel: "Revoke token",
      variant: "destructive",
      icon: <Ban className="size-4 text-destructive" />,
    });
    if (!ok) return;
    try {
      await revokeMutation.mutateAsync(token.id);
      toast.success("Proxy token revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <span className="truncate">{token?.label || "Proxy token"}</span>
              {token && (
                token.is_revoked ? (
                  <AdminStatusPill tone="warning">revoked</AdminStatusPill>
                ) : token.is_expired ? (
                  <AdminStatusPill tone="danger">expired</AdminStatusPill>
                ) : (
                  <AdminStatusPill tone="success">active</AdminStatusPill>
                )
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              {token && <CopyButton value={token.id} />}
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
              {error instanceof Error ? error.message : "Failed to load proxy token"}
            </div>
          )}

          {token && (
            <div className="space-y-4">
              {/* Identity */}
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Identity
                </h3>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">Prefix: </span>
                  <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs">
                    {token.token_prefix}…
                  </code>
                </div>
                {token.machine && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground">Machine: </span>
                    <Link
                      href={`/v2/admin/machines?highlight=${token.machine.id}`}
                      className="font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {token.machine.slug ?? token.machine.id.slice(0, 8)}
                    </Link>
                  </div>
                )}
              </section>

              {/* Ports */}
              <section className="rounded-xl border p-4 space-y-2 text-sm">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ports
                </h3>
                {!token.ports || token.ports.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    All ports (unrestricted).
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {token.ports.map((p) => (
                      <Badge key={p} variant="outline" className="font-mono text-[11px]">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </section>

              {/* Timing */}
              <section className="rounded-xl border p-4 space-y-1.5 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Timing
                </h3>
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                  <AdminMetric
                    label="Expires"
                    value={relativeShort(token.expires_at)}
                    sub={token.is_expired ? "past due" : undefined}
                  />
                  <AdminMetric
                    label="Revoked"
                    value={token.revoked_at ? relativeShort(token.revoked_at) : "—"}
                  />
                  <AdminMetric label="Created" value={relativeShort(token.created_at)} />
                </div>
              </section>

              {/* Ownership */}
              <section className="rounded-xl border p-4 space-y-2 text-sm">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Ownership
                </h3>
                <div>
                  <span className="text-muted-foreground">Owner: </span>
                  {ownerLabel(token.owner)}
                  {token.owner.name ? ` · ${token.owner.name}` : ""}
                </div>
                {token.account && (
                  <div>
                    <span className="text-muted-foreground">Account: </span>
                    <span className="font-medium">{accountLabel(token.account) ?? "—"}</span>
                    {token.account.type && (
                      <Badge variant="outline" className="ml-2 text-xs">{token.account.type}</Badge>
                    )}
                  </div>
                )}
              </section>

              {/* Actions */}
              {!token.is_revoked ? (
                <section className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium">Revoke</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Sets <code>revoked_at = now()</code>. Idempotent — re-running
                        a revoke leaves the original timestamp untouched.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={onRevoke}
                      disabled={revokeMutation.isPending}
                    >
                      {revokeMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Ban className="size-3.5" />
                      )}
                      Revoke
                    </Button>
                  </div>
                </section>
              ) : (
                <section className="rounded-xl border p-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="size-4" />
                    Already revoked {relativeShort(token.revoked_at)}.
                  </div>
                </section>
              )}

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
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminKeysPage() {
  const { data: account, isLoading: accountLoading } = useAccount();
  const [tab, setTab] = useState<"ssh" | "api" | "proxy">("ssh");
  const [selectedSshKeyId, setSelectedSshKeyId] = useState<string | null>(null);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<string | null>(null);
  const [selectedProxyTokenId, setSelectedProxyTokenId] = useState<string | null>(null);

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Admin — Keys & Security</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={KeyRound}
        title="Keys & Security"
        description="Fleet-wide audit of every credential with fleet access."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(((v as string) ?? "ssh") as typeof tab)}>
        <TabsList>
          <TabsTrigger value="ssh">SSH Keys</TabsTrigger>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="proxy">Proxy Tokens</TabsTrigger>
        </TabsList>
        <TabsContent value="ssh" className="mt-4">
          <SshKeysTab onSelect={setSelectedSshKeyId} />
        </TabsContent>
        <TabsContent value="api" className="mt-4">
          <ApiKeysTab onSelect={setSelectedApiKeyId} />
        </TabsContent>
        <TabsContent value="proxy" className="mt-4">
          <ProxyTokensTab onSelect={setSelectedProxyTokenId} />
        </TabsContent>
      </Tabs>

      <SshKeyDetailDialog
        id={selectedSshKeyId}
        onClose={() => setSelectedSshKeyId(null)}
      />
      <ApiKeyDetailDialog
        id={selectedApiKeyId}
        onClose={() => setSelectedApiKeyId(null)}
      />
      <ProxyTokenDetailDialog
        id={selectedProxyTokenId}
        onClose={() => setSelectedProxyTokenId(null)}
      />
    </div>
  );
}
