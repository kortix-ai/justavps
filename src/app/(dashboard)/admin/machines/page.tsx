"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Square,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { api, ApiError } from "@/shared/hooks/api-client";
import { useAccount } from "@/shared/hooks/use-account";
import { cn } from "@/shared/lib/utils";
import {
  formatMachineHealthPercent,
  getAdminMachinesRangeLabel,
  getAdminMachinesTotalPages,
} from "@/v1/lib/admin-machines";
import {
  useAdminMachine,
  useAdminUserSearch,
  useCreateAdminMachine,
  useMachineLifecycle,
  useUpdateAdminMachine,
  type AdminMachineDetail,
  type AdminUserSearchResult,
  type MachineLifecycleAction,
} from "@/shared/hooks/use-admin-machines";
import { ACTIVE_REGIONS } from "@/shared/lib/regions";
import { toast } from "sonner";

function AdminStatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "danger" | "neutral";
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "danger" && "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
        className,
      )}
    >
      {children}
    </Badge>
  );
}

function AdminMetric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

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
  health: { cpu: number | null; memory: number | null; disk: number | null } | null;
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

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "ready":
      return "success";
    case "provisioning":
      return "warning";
    case "error":
    case "deleted":
      return "danger";
    default:
      return "neutral";
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

function slugFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(value).then(
    () => toast.success("Copied to clipboard"),
    () => toast.error("Failed to copy"),
  );
}

// ─── Create dialog ──────────────────────────────────────────────────────────

function CreateMachineDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [ownerQuery, setOwnerQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUserSearchResult | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState(ACTIVE_REGIONS[0]?.id ?? "eu");
  const [vcpu, setVcpu] = useState(2);
  const [memoryGb, setMemoryGb] = useState(4);
  const [diskGb, setDiskGb] = useState(40);
  const [imageRef, setImageRef] = useState("ubuntu-24.04");
  const [machineMode, setMachineMode] = useState<"vm" | "container">("container");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(ownerQuery), 250);
    return () => clearTimeout(t);
  }, [ownerQuery]);

  const searchEnabled = open && (debouncedQuery.trim().length >= 1 || !selectedUser);
  const { data: searchData, isLoading: searchLoading } = useAdminUserSearch(debouncedQuery, searchEnabled);
  const users = searchData?.users ?? [];

  const create = useCreateAdminMachine();

  // Auto-suggest a name once a user is picked
  useEffect(() => {
    if (selectedUser && !name) {
      const base = slugFromEmail(selectedUser.email);
      if (base) setName(`admin-${base}`);
    }
  }, [selectedUser, name]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setOwnerQuery("");
      setDebouncedQuery("");
      setSelectedUser(null);
      setName("");
      setRegion(ACTIVE_REGIONS[0]?.id ?? "eu");
      setVcpu(2);
      setMemoryGb(4);
      setDiskGb(40);
      setImageRef("ubuntu-24.04");
      setMachineMode("container");
    }
  }, [open]);

  const canSubmit =
    !!selectedUser
    && vcpu > 0
    && memoryGb > 0
    && diskGb >= 10
    && !create.isPending;

  async function submit() {
    if (!selectedUser) return;
    try {
      await create.mutateAsync({
        owner_user_id: selectedUser.id,
        account_id: selectedUser.account?.id ?? selectedUser.default_account_id ?? undefined,
        name: name || undefined,
        region,
        vcpu,
        memory_gb: memoryGb,
        disk_gb: diskGb,
        image_ref: imageRef || null,
        machine_mode: machineMode,
      });
      toast.success("Machine created");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Create failed";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create machine (on behalf of user)</DialogTitle>
          <DialogDescription>
            Admin-only provisioning. Bypasses Stripe/subscription gates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Owner search */}
          <div className="space-y-1.5">
            <Label>Owner</Label>
            {selectedUser ? (
              <div className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{selectedUser.email}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {selectedUser.name ?? "—"}
                    {selectedUser.account ? ` · ${selectedUser.account.name ?? selectedUser.account.slug}` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedUser(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={ownerQuery}
                    onChange={(e) => setOwnerQuery(e.target.value)}
                    placeholder="Search by email, name, or user ID"
                    className="pl-9"
                  />
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border bg-muted/10 p-1">
                  {searchLoading && (
                    <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Searching…
                    </div>
                  )}
                  {!searchLoading && users.length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground">No matching users</div>
                  )}
                  {users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedUser(u)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <UserIcon className="size-3.5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{u.email}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {u.name ?? "—"}
                          {u.account ? ` · ${u.account.name ?? u.account.slug}` : ""}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="admin-create-name">Name</Label>
            <Input
              id="admin-create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. admin-acme-worker"
            />
          </div>

          {/* Region + Mode */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select value={region} onValueChange={(v) => setRegion(v ?? (ACTIVE_REGIONS[0]?.id ?? "eu"))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVE_REGIONS.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label} ({r.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Machine mode</Label>
              <Select value={machineMode} onValueChange={(v) => setMachineMode((v ?? "container") as "vm" | "container")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vm">VM</SelectItem>
                  <SelectItem value="container">Container</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Sizing */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="admin-create-vcpu">vCPU</Label>
              <Input
                id="admin-create-vcpu"
                type="number"
                min={1}
                max={128}
                value={vcpu}
                onChange={(e) => setVcpu(Math.max(1, Math.min(128, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-create-ram">RAM (GB)</Label>
              <Input
                id="admin-create-ram"
                type="number"
                min={1}
                max={512}
                value={memoryGb}
                onChange={(e) => setMemoryGb(Math.max(1, Math.min(512, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-create-disk">Disk (GB)</Label>
              <Input
                id="admin-create-disk"
                type="number"
                min={10}
                max={2000}
                value={diskGb}
                onChange={(e) => setDiskGb(Math.max(10, Math.min(2000, Number(e.target.value) || 10)))}
              />
            </div>
          </div>

          {/* Image */}
          <div className="space-y-1.5">
            <Label htmlFor="admin-create-image">Image (optional)</Label>
            <Input
              id="admin-create-image"
              value={imageRef}
              onChange={(e) => setImageRef(e.target.value)}
              placeholder="ubuntu-24.04 or docker:alpine:3.19"
            />
            <p className="text-xs text-muted-foreground">
              Prefix with <code>docker:</code> or <code>oci:</code> for container machines.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Create machine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail dialog ──────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm">{value}</span>
    </div>
  );
}

function CopyableId({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(value)}
      className="inline-flex items-center gap-1 font-mono text-xs hover:text-foreground"
      title="Click to copy"
    >
      <span className="truncate">{value}</span>
      <Copy className="size-3" />
    </button>
  );
}

function MachineDetailDialog({
  machineId,
  onClose,
}: {
  machineId: string | null;
  onClose: () => void;
}) {
  const open = !!machineId;
  const { data, isLoading, error } = useAdminMachine(machineId);
  const lifecycle = useMachineLifecycle();
  const update = useUpdateAdminMachine();
  const [pendingAction, setPendingAction] = useState<MachineLifecycleAction | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmReboot, setConfirmReboot] = useState(false);

  useEffect(() => {
    if (!open) {
      setPendingAction(null);
      setRenameOpen(false);
      setNewName("");
      setConfirmDelete(false);
      setConfirmStop(false);
      setConfirmReboot(false);
    }
  }, [open]);

  useEffect(() => {
    if (data?.machine?.name && !renameOpen) {
      setNewName(data.machine.name);
    }
  }, [data?.machine?.name, renameOpen]);

  const machine = data?.machine as AdminMachineDetail | undefined;

  async function runLifecycle(action: MachineLifecycleAction) {
    if (!machineId) return;
    setPendingAction(action);
    try {
      await lifecycle.mutateAsync({ id: machineId, action });
      if (action === "start") toast.success("Start requested");
      else if (action === "stop") toast.success("Stop requested");
      else if (action === "reboot") toast.success("Reboot requested");
      else toast.success("Machine deleted");
      if (action === "delete") onClose();
      setConfirmDelete(false);
      setConfirmStop(false);
      setConfirmReboot(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : `${action} failed`;
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function submitRename() {
    if (!machineId) return;
    try {
      await update.mutateAsync({ id: machineId, name: newName });
      toast.success("Renamed");
      setRenameOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Rename failed";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {machine?.slug ?? "Machine detail"}
          </DialogTitle>
          <DialogDescription>
            {machine?.name ?? "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mr-2 inline size-4" />
            {error instanceof Error ? error.message : "Failed to load machine"}
          </div>
        )}

        {data && machine && (
          <div className="space-y-4">
            {/* Header status + lifecycle */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <AdminStatusPill tone={statusTone(machine.status)}>
                {machine.status}
              </AdminStatusPill>
              {machine.provisioning_stage && machine.status === "provisioning" && (
                <Badge variant="secondary">{machine.provisioning_stage}</Badge>
              )}
              <Badge variant="outline" className="font-mono text-xs">{machine.machine_mode}</Badge>
              {machine.source === "kortix" && <Badge variant="outline">kortix</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">
                Created {relativeTime(machine.created_at)}
                {machine.ready_at ? ` · Ready ${relativeTime(machine.ready_at)}` : ""}
              </span>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction !== null || machine.status === "deleted"}
                onClick={() => runLifecycle("start")}
              >
                {pendingAction === "start" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction !== null || machine.status === "deleted"}
                onClick={() => setConfirmStop(true)}
              >
                {pendingAction === "stop" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                Stop
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction !== null || machine.status === "deleted"}
                onClick={() => setConfirmReboot(true)}
              >
                {pendingAction === "reboot" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                Reboot
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction !== null || machine.status === "deleted"}
                onClick={() => { setRenameOpen(true); setNewName(machine.name); }}
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pendingAction !== null || machine.status === "deleted"}
                onClick={() => setConfirmDelete(true)}
              >
                {pendingAction === "delete" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Delete
              </Button>
            </div>

            {/* Inline rename form */}
            {renameOpen && (
              <div className="space-y-2 rounded-xl border p-3">
                <Label htmlFor="rename-input">New name</Label>
                <div className="flex gap-2">
                  <Input
                    id="rename-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
                  <Button size="sm" disabled={update.isPending || !newName.trim() || newName === machine.name} onClick={submitRename}>
                    {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            )}

            {/* Identity */}
            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Identity</div>
              <DetailRow label="Slug" value={<span className="font-mono text-xs">{machine.slug}</span>} />
              <DetailRow label="Name" value={machine.name} />
              <DetailRow label="Machine ID" value={<CopyableId value={machine.id} />} />
              {machine.provider_server_id && (
                <DetailRow label="Provider server" value={<span className="font-mono text-xs">{machine.provider_server_id}</span>} />
              )}
              {machine.kortix_sandbox_id && (
                <DetailRow label="Kortix sandbox" value={<CopyableId value={machine.kortix_sandbox_id} />} />
              )}
            </div>

            {/* Compute */}
            <div className="rounded-xl border p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Compute</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <AdminMetric label="vCPU" value={machine.vcpu ?? "—"} />
                <AdminMetric label="RAM" value={machine.memory_gb != null ? `${machine.memory_gb} GB` : "—"} />
                <AdminMetric label="Disk" value={machine.disk_gb != null ? `${machine.disk_gb} GB` : "—"} />
                <AdminMetric label="Price" value={machine.price_monthly != null ? `$${machine.price_monthly}/mo` : "—"} />
              </div>
            </div>

            {/* Network */}
            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Network</div>
              <DetailRow label="Public IPv4" value={machine.public_ipv4 ?? machine.ip ?? "—"} />
              {machine.public_ipv6 && <DetailRow label="IPv6" value={<span className="font-mono text-xs">{machine.public_ipv6}</span>} />}
              <DetailRow label="SSH port" value={machine.ssh_port ?? "—"} />
              <DetailRow label="HTTP port" value={machine.http_port ?? "—"} />
              <DetailRow label="Region" value={machine.region} />
              {machine.domains.length > 0 && (
                <DetailRow
                  label="Domains"
                  value={
                    <div className="flex flex-wrap justify-end gap-1">
                      {machine.domains.map((d) => (
                        <Badge key={d} variant="outline" className="text-xs">{d}</Badge>
                      ))}
                    </div>
                  }
                />
              )}
            </div>

            {/* Host */}
            {data.host && (
              <div className="rounded-xl border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Host</div>
                </div>
                <DetailRow label="Name" value={data.host.name} />
                <DetailRow label="Region" value={data.host.region} />
                <DetailRow label="Location" value={data.host.location} />
                <DetailRow label="Public IPv4" value={data.host.public_ipv4 ?? "—"} />
              </div>
            )}

            {/* Owner + account */}
            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Owner</div>
              <DetailRow label="Email" value={machine.owner.email ?? "—"} />
              <DetailRow label="Name" value={machine.owner.name ?? "—"} />
              <DetailRow label="User ID" value={<CopyableId value={machine.owner.id} />} />
              {machine.account && (
                <>
                  <DetailRow label="Account" value={`${machine.account.name ?? machine.account.slug ?? "—"}${machine.account.type === "organization" ? " (org)" : ""}`} />
                  <DetailRow label="Account ID" value={<CopyableId value={machine.account.id} />} />
                </>
              )}
            </div>

            {/* Subscription */}
            {machine.subscription && (
              <div className="rounded-xl border p-4 space-y-2">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Subscription</div>
                <DetailRow label="Status" value={machine.subscription.status} />
                <DetailRow label="Stripe sub" value={<span className="font-mono text-xs">{machine.subscription.stripe_subscription_id}</span>} />
                <DetailRow label="Period end" value={machine.subscription.current_period_end ? new Date(machine.subscription.current_period_end).toLocaleDateString() : "—"} />
                <DetailRow label="Cancel scheduled" value={machine.subscription.cancel_at_period_end ? "Yes" : "No"} />
              </div>
            )}

            {/* Events */}
            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent events
              </div>
              {data.events.length === 0 ? (
                <div className="text-xs text-muted-foreground">No events recorded</div>
              ) : (
                <div className="space-y-1">
                  {data.events.slice(0, 10).map((ev) => (
                    <div key={ev.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium">{ev.event}</span>
                        {ev.stage ? <span className="text-muted-foreground"> · {ev.stage}</span> : null}
                        {ev.message ? <span className="text-muted-foreground"> — {ev.message}</span> : null}
                      </div>
                      <span className="shrink-0 text-muted-foreground">{relativeTime(ev.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stop confirmation */}
        <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Stop this machine?</DialogTitle>
              <DialogDescription>
                The runner will power off the instance. Disk state is preserved.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmStop(false)}>Cancel</Button>
              <Button disabled={pendingAction === "stop"} onClick={() => runLifecycle("stop")}>
                {pendingAction === "stop" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                Stop
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reboot confirmation */}
        <Dialog open={confirmReboot} onOpenChange={setConfirmReboot}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reboot this machine?</DialogTitle>
              <DialogDescription>
                The runner will reboot the instance. Expect a few seconds of downtime.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmReboot(false)}>Cancel</Button>
              <Button disabled={pendingAction === "reboot"} onClick={() => runLifecycle("reboot")}>
                {pendingAction === "reboot" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                Reboot
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete machine</DialogTitle>
              <DialogDescription>
                This <strong>gracefully</strong> destroys the machine (instance, DNS, subscription, DB).
                Irreversible.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="destructive" disabled={pendingAction === "delete"} onClick={() => runLifecycle("delete")}>
                {pendingAction === "delete" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminMachinesPage() {
  const qc = useQueryClient();
  const { data: account, isLoading: accountLoading } = useAccount();

  // Filters
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [singleDeleteMachine, setSingleDeleteMachine] = useState<AdminMachine | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailMachineId, setDetailMachineId] = useState<string | null>(null);

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (ownerFilter) params.set("owner_query", ownerFilter);
    if (accountFilter) params.set("account_query", accountFilter);
    if (accountTypeFilter !== "all") params.set("account_type", accountTypeFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (includeDeleted) params.set("include_deleted", "true");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    return params.toString();
  }, [search, ownerFilter, accountFilter, accountTypeFilter, statusFilter, sourceFilter, includeDeleted, page]);

  const queryKey = [
    "admin",
    "machines",
    search,
    ownerFilter,
    accountFilter,
    accountTypeFilter,
    statusFilter,
    sourceFilter,
    includeDeleted,
    page,
  ] as const;

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

  // Batch delete (chunks into batches of 50 to respect API limit)
  const batchDeleteMutation = useMutation({
    mutationFn: async (machineIds: string[]) => {
      const BATCH_LIMIT = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < machineIds.length; i += BATCH_LIMIT) {
        chunks.push(machineIds.slice(i, i + BATCH_LIMIT));
      }
      const results = await Promise.all(
        chunks.map((chunk) =>
          api.post<BatchDeleteResponse>("/admin/machines/batch-delete", { machine_ids: chunk }),
        ),
      );
      return results.reduce<BatchDeleteResponse>(
        (acc, r) => ({
          ok: acc.ok && r.ok,
          total: acc.total + r.total,
          succeeded: acc.succeeded + r.succeeded,
          failed: acc.failed + r.failed,
          results: [...acc.results, ...r.results],
        }),
        { ok: true, total: 0, succeeded: 0, failed: 0, results: [] },
      );
    },
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

  const totalPages = getAdminMachinesTotalPages(data?.total, PAGE_SIZE);
  const statusSummary = data?.summary.by_status ?? {};
  const sourceSummary = data?.summary.by_source ?? {};
  const rangeLabel = getAdminMachinesRangeLabel(data, machines.length);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl tracking-tight">Admin — Machines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage all machines across all accounts. Create, inspect, start/stop/reboot, rename, and gracefully delete.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create machine
          </Button>
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
            placeholder="Search machine, owner, account, IP, sandbox ID..."
            className="pl-9"
          />
        </div>
        <Input
          value={ownerFilter}
          onChange={(e) => { setOwnerFilter(e.target.value); setPage(0); }}
          placeholder="Owner email, name, or user ID"
          className="min-w-[220px] flex-1"
        />
        <Input
          value={accountFilter}
          onChange={(e) => { setAccountFilter(e.target.value); setPage(0); }}
          placeholder="Account / org name, slug, or ID"
          className="min-w-[220px] flex-1"
        />
        <Select value={accountTypeFilter} onValueChange={(v) => { setAccountTypeFilter(v ?? "all"); setPage(0); }}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Account type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All account types</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="organization">Organizations</SelectItem>
          </SelectContent>
        </Select>
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
        {(search || ownerFilter || accountFilter || accountTypeFilter !== "all" || statusFilter !== "all" || sourceFilter !== "all" || includeDeleted) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setOwnerFilter("");
              setAccountFilter("");
              setAccountTypeFilter("all");
              setStatusFilter("all");
              setSourceFilter("all");
              setIncludeDeleted(false);
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
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
                {rangeLabel}
              </span>
            </div>
          )}

          {/* Machine list */}
          <div className="space-y-2">
            {machines.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl border p-4 transition-colors ${selected.has(m.id) ? "ring-2 ring-primary/50 bg-primary/5" : "hover:bg-muted/30"}`}
              >
                <div className="flex gap-3">
                  {/* Selection checkbox */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelect(m.id); }}
                    className="mt-1 shrink-0"
                  >
                    <div className={`flex size-4 items-center justify-center rounded border transition-colors ${selected.has(m.id) ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40 hover:border-foreground"}`}>
                      {selected.has(m.id) && <Check className="size-3" />}
                    </div>
                  </button>

                  {/* Content (clickable to open detail) */}
                  <button
                    type="button"
                    onClick={() => setDetailMachineId(m.id)}
                    className="flex-1 min-w-0 text-left"
                  >
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
                            <span className="font-mono">cloud:{m.provider_server_id}</span>
                          )}
                        </div>

                        {/* Row 4: health */}
                        {m.health && (
                          <div className="flex items-center gap-3 text-xs">
                            <span className="flex items-center gap-1">
                              <Cpu className="size-3" />
                              CPU {formatMachineHealthPercent(m.health.cpu)}
                            </span>
                            <span className="flex items-center gap-1">
                              <MemoryStick className="size-3" />
                              RAM {formatMachineHealthPercent(m.health.memory)}
                            </span>
                            <span className="flex items-center gap-1">
                              <HardDrive className="size-3" />
                              Disk {formatMachineHealthPercent(m.health.disk)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Actions (prevent propagation so row click still opens detail) */}
                  {m.status !== "deleted" && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleteMutation.isPending}
                        onClick={(e) => { e.stopPropagation(); setSingleDeleteMachine(m); }}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  )}
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

      {/* ── Create dialog ──────────────────────────────────────────────────── */}
      <CreateMachineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["admin", "machines"] })}
      />

      {/* ── Detail dialog ──────────────────────────────────────────────────── */}
      <MachineDetailDialog
        machineId={detailMachineId}
        onClose={() => setDetailMachineId(null)}
      />

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
