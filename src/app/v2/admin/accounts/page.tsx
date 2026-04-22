"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  User as UserIcon,
  Users,
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
import { useAccount } from "@/shared/hooks/use-account";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminLoadingRows,
  AdminPageHeader,
  AdminStatusPill,
  relativeShort,
} from "@/v2/components/admin/primitives";
import { machineStatusTone } from "@/v2/components/admin/tones";
import {
  useAdminAccount,
  useAdminAccountList,
  useAdminUser,
  useAdminUserList,
  type AdminAccountSummary,
  type AdminUserListItem,
} from "@/shared/hooks/use-admin-accounts";

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

function formatUsd(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "—";
  return `$${(cents / 100).toFixed(2)}/mo`;
}

function typePill(type: "personal" | "organization") {
  if (type === "organization") {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Building2 className="size-3" />
        Organization
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <UserIcon className="size-3" />
      Personal
    </Badge>
  );
}

// ─── Account detail drawer ─────────────────────────────────────────────────

function AccountDetailDialog({
  accountId,
  onClose,
}: {
  accountId: string | null;
  onClose: () => void;
}) {
  const open = Boolean(accountId);
  const { data, isLoading, error } = useAdminAccount(accountId);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{data?.account.name ?? "Account"}</span>
            {data?.account && typePill(data.account.type)}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {data?.account.slug && (
              <span className="font-mono text-xs">/{data.account.slug}</span>
            )}
            {data?.account.id && <CopyButton value={data.account.id} />}
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
            {error instanceof Error ? error.message : "Failed to load account"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Members</div>
                <div className="text-lg font-semibold">{data.members.length}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Machines</div>
                <div className="text-lg font-semibold">{data.machines.length}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active subs</div>
                <div className="text-lg font-semibold">{data.subscriptions.length}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
                <div className="text-sm font-medium">{relativeShort(data.account.created_at)}</div>
              </div>
            </div>

            {/* Billing */}
            {(data.account.billing_email || data.account.stripe_customer_id) && (
              <section className="rounded-xl border p-4 space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Billing</h3>
                {data.account.billing_email && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Email: </span>
                    {data.account.billing_email}
                  </div>
                )}
                {data.account.stripe_customer_id && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Stripe customer: </span>
                    <span className="font-mono text-xs">{data.account.stripe_customer_id}</span>
                  </div>
                )}
              </section>
            )}

            {/* Members */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Users className="size-3.5" />
                Members ({data.members.length})
              </h3>
              {data.members.length === 0 ? (
                <div className="text-xs text-muted-foreground">No members</div>
              ) : (
                <div className="space-y-1.5">
                  {data.members.map((m) => (
                    <div
                      key={m.user_id}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{m.email ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.name ?? "—"} · {m.user_id.slice(0, 8)}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">{m.role}</Badge>
                      <span className="text-xs text-muted-foreground">{relativeShort(m.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Machines */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Machines ({data.machines.length})
              </h3>
              {data.machines.length === 0 ? (
                <div className="text-xs text-muted-foreground">No machines</div>
              ) : (
                <div className="space-y-1.5">
                  {data.machines.map((m) => (
                    <Link
                      key={m.id}
                      href={`/v2/admin/machines?highlight=${m.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium font-mono text-xs">{m.slug}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.name} · {m.server_type} · {m.region}
                        </div>
                      </div>
                      <AdminStatusPill tone={machineStatusTone(m.status)}>{m.status}</AdminStatusPill>
                      <span className="w-16 text-right text-xs">
                        {m.price_monthly != null ? `$${m.price_monthly}/mo` : "—"}
                      </span>
                      <span className="w-14 text-right text-xs text-muted-foreground">
                        {relativeShort(m.created_at)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* Subscriptions */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Active subscriptions ({data.subscriptions.length})
              </h3>
              {data.subscriptions.length === 0 ? (
                <div className="text-xs text-muted-foreground">No active subscriptions</div>
              ) : (
                <div className="space-y-1.5">
                  {data.subscriptions.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{s.stripe_subscription_id}</div>
                        <div className="text-xs text-muted-foreground">status: {s.status}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        period end: {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : "—"}
                      </div>
                      {s.cancel_at_period_end && (
                        <Badge variant="destructive" className="text-xs">cancelling</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Invitations */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pending invitations ({data.invitations.length})
              </h3>
              {data.invitations.length === 0 ? (
                <div className="text-xs text-muted-foreground">No pending invitations</div>
              ) : (
                <div className="space-y-1.5">
                  {data.invitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{inv.email}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          invited by {inv.invited_by_email ?? inv.invited_by_name ?? inv.invited_by_user_id.slice(0, 8)}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">{inv.role}</Badge>
                      <span className="text-xs text-muted-foreground">
                        expires {relativeShort(inv.expires_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* SSH keys */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <KeyRound className="size-3.5" />
                SSH keys ({data.ssh_keys.length})
              </h3>
              {data.ssh_keys.length === 0 ? (
                <div className="text-xs text-muted-foreground">No SSH keys</div>
              ) : (
                <div className="space-y-1.5">
                  {data.ssh_keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{k.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{k.fingerprint}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{relativeShort(k.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Action row — reserved for future */}
            <div className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
              Account-level actions (suspend, reset password, impersonate) — coming soon.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── User detail drawer ────────────────────────────────────────────────────

function UserDetailDialog({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const open = Boolean(userId);
  const { data, isLoading, error } = useAdminUser(userId);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{data?.user.email ?? "User"}</span>
            {data?.user.is_admin && (
              <Badge variant="default" className="gap-1 text-xs">
                <ShieldCheck className="size-3" />
                Admin
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {data?.user.name && <span>{data.user.name}</span>}
            {data?.user.id && <CopyButton value={data.user.id} />}
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
            {error instanceof Error ? error.message : "Failed to load user"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Machines</div>
                <div className="text-lg font-semibold">{data.machines.length}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active subs</div>
                <div className="text-lg font-semibold">{data.subscriptions.length}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Accounts</div>
                <div className="text-lg font-semibold">{data.memberships.length}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Joined</div>
                <div className="text-sm font-medium">{relativeShort(data.user.created_at)}</div>
              </div>
            </div>

            {/* Identity */}
            <section className="rounded-xl border p-4 space-y-1.5 text-sm">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Identity</h3>
              <div><span className="text-muted-foreground">Email: </span>{data.user.email}</div>
              <div><span className="text-muted-foreground">Verified: </span>
                {data.user.email_verified ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="size-3" /> Yes ({relativeShort(data.user.email_verified)})
                  </span>
                ) : "No"}
              </div>
              {data.user.github_id && (
                <div><span className="text-muted-foreground">GitHub ID: </span><span className="font-mono text-xs">{data.user.github_id}</span></div>
              )}
              {data.user.stripe_customer_id && (
                <div><span className="text-muted-foreground">Stripe customer: </span><span className="font-mono text-xs">{data.user.stripe_customer_id}</span></div>
              )}
            </section>

            {/* Memberships */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Memberships ({data.memberships.length})
              </h3>
              {data.memberships.length === 0 ? (
                <div className="text-xs text-muted-foreground">No account memberships</div>
              ) : (
                <div className="space-y-1.5">
                  {data.memberships.map((m) => (
                    <div
                      key={m.account_id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{m.account_name ?? m.account_slug ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.account_type} · {m.account_slug ?? m.account_id.slice(0, 8)}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">{m.role}</Badge>
                      <span className="text-xs text-muted-foreground">{relativeShort(m.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Machines */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Machines ({data.machines.length})
              </h3>
              {data.machines.length === 0 ? (
                <div className="text-xs text-muted-foreground">No machines</div>
              ) : (
                <div className="space-y-1.5">
                  {data.machines.map((m) => (
                    <Link
                      key={m.id}
                      href={`/v2/admin/machines?highlight=${m.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs">{m.slug}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.name} · {m.server_type} · {m.region}
                        </div>
                      </div>
                      <AdminStatusPill tone={machineStatusTone(m.status)}>{m.status}</AdminStatusPill>
                      <span className="text-xs text-muted-foreground">{relativeShort(m.created_at)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* Subscriptions */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Active subscriptions ({data.subscriptions.length})
              </h3>
              {data.subscriptions.length === 0 ? (
                <div className="text-xs text-muted-foreground">No active subscriptions</div>
              ) : (
                <div className="space-y-1.5">
                  {data.subscriptions.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{s.stripe_subscription_id}</div>
                        <div className="text-xs text-muted-foreground">status: {s.status}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        period end: {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* SSH keys */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <KeyRound className="size-3.5" />
                SSH keys ({data.ssh_keys.length})
              </h3>
              {data.ssh_keys.length === 0 ? (
                <div className="text-xs text-muted-foreground">No SSH keys</div>
              ) : (
                <div className="space-y-1.5">
                  {data.ssh_keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{k.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{k.fingerprint}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{relativeShort(k.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* API keys (secret masked) */}
            <section className="rounded-xl border p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <KeyRound className="size-3.5" />
                API keys ({data.api_keys.length})
              </h3>
              {data.api_keys.length === 0 ? (
                <div className="text-xs text-muted-foreground">No API keys</div>
              ) : (
                <div className="space-y-1.5">
                  {data.api_keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{k.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {k.key_prefix}… · scope: {k.scope} · {k.permissions.join("/")}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        last used {k.last_used ? relativeShort(k.last_used) : "never"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Accounts tab ──────────────────────────────────────────────────────────

function AccountsTab({
  onSelectAccount,
}: {
  onSelectAccount: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | "personal" | "organization">("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useAdminAccountList({
    q: q.trim() || undefined,
    type,
    include_deleted: includeDeleted,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || type !== "all" || includeDeleted;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <AdminKpiGrid>
        <AdminKpiCard
          label="Accounts"
          value={data ? data.summary.personal_count + data.summary.org_count : "—"}
          hint={data ? `${data.summary.personal_count} personal · ${data.summary.org_count} org` : undefined}
          icon={Users}
        />
        <AdminKpiCard label="Personal" value={data?.summary.personal_count ?? "—"} icon={UserIcon} />
        <AdminKpiCard label="Organizations" value={data?.summary.org_count ?? "—"} icon={Building2} />
        <AdminKpiCard label="Customer machines" value={data?.summary.total_machines ?? "—"} />
      </AdminKpiGrid>

      {/* Filter bar */}
      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, slug, or account ID"
            className="pl-9"
          />
        </div>
        <Select value={type} onValueChange={(v) => setType((v ?? "all") as typeof type)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="organization">Organization</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => setIncludeDeleted(e.target.checked)}
            className="rounded"
          />
          Include deleted
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setType("all");
              setIncludeDeleted(false);
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

      {/* List */}
      {isLoading ? (
        <AdminLoadingRows count={5} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          <AlertTriangle className="mr-2 inline size-4" />
          Failed to load: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : !data || data.accounts.length === 0 ? (
        <AdminEmptyState
          icon={Users}
          title="No accounts found"
          description={hasFilters ? "Try clearing some filters." : "No accounts in the system yet."}
        />
      ) : (
        <div className="space-y-2">
          {data.accounts.map((a) => (
            <AccountRow key={a.id} account={a} onOpen={() => onSelectAccount(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  onOpen,
}: {
  account: AdminAccountSummary;
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
            <h3 className="truncate font-heading text-base tracking-tight">{account.name}</h3>
            {typePill(account.type)}
            {account.deleted_at && (
              <Badge variant="destructive" className="text-xs">deleted</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">/{account.slug}</span>
            {account.billing_email ? ` · ${account.billing_email}` : ""}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 text-right">
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Members</div>
            <div className="text-sm font-medium">{account.member_count}</div>
          </div>
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Machines</div>
            <div className="text-sm font-medium">{account.machine_count}</div>
          </div>
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Subs</div>
            <div className="text-sm font-medium">{account.active_subscription_count}</div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">MRR est.</div>
            <div className="text-sm font-medium">{formatUsd(account.mrr_cents)}</div>
          </div>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Created {relativeShort(account.created_at)}
      </div>
    </button>
  );
}

// ─── Users tab ─────────────────────────────────────────────────────────────

function UsersTab({
  onSelectUser,
}: {
  onSelectUser: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hasMachines, setHasMachines] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useAdminUserList({
    q: q.trim() || undefined,
    has_machines: hasMachines,
    limit: 100,
    offset: 0,
  });

  const hasFilters = Boolean(q) || hasMachines;

  return (
    <div className="space-y-4">
      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search email, name, or user ID"
            className="pl-9"
          />
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={hasMachines}
            onChange={(e) => setHasMachines(e.target.checked)}
            className="rounded"
          />
          Has machines
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setHasMachines(false);
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
      ) : !data || data.users.length === 0 ? (
        <AdminEmptyState
          icon={UserIcon}
          title="No users found"
          description={hasFilters ? "Try clearing some filters." : "No users in the system yet."}
        />
      ) : (
        <div className="space-y-2">
          {data.users.map((u) => (
            <UserRow key={u.id} user={u} onOpen={() => onSelectUser(u.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  onOpen,
}: {
  user: AdminUserListItem;
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
            <h3 className="truncate font-heading text-base tracking-tight">{user.email}</h3>
            {user.is_admin && (
              <Badge variant="default" className="gap-1 text-xs">
                <ShieldCheck className="size-3" />
                admin
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {user.name ?? "—"}
            {user.account ? ` · ${user.account.name ?? user.account.slug}` : ""}
            {user.account?.type === "organization" ? " (org)" : ""}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Machines</div>
            <div className="text-sm font-medium">{user.machine_count}</div>
          </div>
          <div className="min-w-[60px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Subs</div>
            <div className="text-sm font-medium">{user.active_subscription_count}</div>
          </div>
          <div className="min-w-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last activity</div>
            <div className="text-sm font-medium">
              {user.last_machine_created_at ? relativeShort(user.last_machine_created_at) : "—"}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Joined {relativeShort(user.created_at)}
      </div>
    </button>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AdminAccountsPage() {
  const { data: account, isLoading: accountLoading } = useAccount();
  const [tab, setTab] = useState<"accounts" | "users">("accounts");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Admin — Accounts</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Users}
        title="Accounts"
        description="Customers, organizations, members, and who's paying."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(((v as string) ?? "accounts") as typeof tab)}>
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <AccountsTab onSelectAccount={setSelectedAccountId} />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab onSelectUser={setSelectedUserId} />
        </TabsContent>
      </Tabs>

      <AccountDetailDialog
        accountId={selectedAccountId}
        onClose={() => setSelectedAccountId(null)}
      />
      <UserDetailDialog
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
      />
    </div>
  );
}
