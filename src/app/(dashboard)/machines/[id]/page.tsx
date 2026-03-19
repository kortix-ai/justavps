"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import {
  useMachine,
  useDeleteMachine,
  useRebootMachine,
  useBackups,
  useCreateBackup,
  useToggleBackups,
} from "@/hooks/use-machines";
import { useCreateImage } from "@/hooks/use-images";
import { useConfirm } from "@/hooks/use-confirm";
import {
  ArrowLeft,
  RotateCw,
  Trash2,
  Copy,
  Check,
  ArrowUp,
  Cpu,
  MemoryStick,
  HardDrive,
  DollarSign,
  Globe,
  Server,
  Loader2,
  ExternalLink,
  Code2,
  Terminal as TerminalIcon,
  Link2,
  AlertTriangle,
  Camera,
  Monitor,
  Archive,
  Clock,
  Shield,
  Zap,
} from "lucide-react";
import { RescaleDialog } from "@/components/dashboard/rescale-dialog";
import Link from "next/link";
import { timeAgo, cn } from "@/lib/utils";

const Terminal = dynamic(() => import("@/components/dashboard/terminal"), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-[#09090b] rounded-xl animate-pulse" />
  ),
});

const statusMap: Record<
  string,
  { label: string; dotClass: string; badgeClass: string }
> = {
  provisioning: {
    label: "Provisioning",
    dotClass: "bg-yellow-500 animate-pulse",
    badgeClass:
      "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  },
  ready: {
    label: "Running",
    dotClass: "bg-emerald-500",
    badgeClass:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  error: {
    label: "Error",
    dotClass: "bg-red-500",
    badgeClass:
      "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  stopped: {
    label: "Stopped",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
};

/* ─── Click-to-copy code block ──────────────────────────────────────── */
function CodeBlock({
  text,
  label,
  variant = "default",
}: {
  text: string;
  label?: string;
  variant?: "default" | "green";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="relative group cursor-pointer"
      onClick={() => {
        navigator.clipboard.writeText(text);
        if (label) toast.success(`${label} copied`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <pre
        className={cn(
          "p-3 rounded-lg text-xs font-mono border overflow-x-auto transition-colors",
          "bg-zinc-950 border-zinc-800 hover:border-zinc-700",
          variant === "green" ? "text-green-400" : "text-zinc-300",
        )}
      >
        {text}
      </pre>
      <div
        className={cn(
          "absolute top-2 right-2 flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-all",
          copied
            ? "bg-green-500/20 text-green-400 opacity-100"
            : "bg-zinc-800 text-zinc-400 opacity-0 group-hover:opacity-100",
        )}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </div>
    </div>
  );
}

/* ─── Resource stat with progress bar ───────────────────────────────── */
function ResourceStatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  const color =
    value > 80
      ? "text-red-500"
      : value > 60
        ? "text-yellow-500"
        : "text-emerald-500";
  const progressColor =
    value > 80
      ? "[&>div]:bg-red-500"
      : value > 60
        ? "[&>div]:bg-yellow-500"
        : "[&>div]:bg-emerald-500";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="rounded-lg bg-muted p-1.5">
          <Icon className="size-3.5 text-muted-foreground" />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1 mb-2.5">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums tracking-tight",
            color,
          )}
        >
          {Math.round(value)}
        </span>
        <span className="text-xs text-muted-foreground">%</span>
      </div>
      <Progress
        value={value}
        className={cn("h-1.5 rounded-full", progressColor)}
      />
    </div>
  );
}

/* ─── Info stat card ────────────────────────────────────────────────── */
function InfoStatCard({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="rounded-lg bg-muted p-1.5">
          <Icon className="size-3.5 text-muted-foreground" />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums tracking-tight truncate">
          {value}
        </span>
        {suffix && (
          <span className="text-xs text-muted-foreground shrink-0">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Backups Panel ─────────────────────────────────────────────────── */
function BackupsPanel({ machineId }: { machineId: string }) {
  const { data, isLoading } = useBackups(machineId);
  const createBackup = useCreateBackup();
  const toggleBackups = useToggleBackups();

  const backups = data?.backups ?? [];
  const enabled = data?.backups_enabled ?? false;

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-muted p-1.5">
                <Shield className="size-3.5 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">Automatic Backups</span>
            </div>
            <Button
              variant={enabled ? "outline" : "default"}
              size="sm"
              className="h-7 text-xs"
              disabled={toggleBackups.isPending}
              onClick={() =>
                toggleBackups.mutate(
                  { machineId, enable: !enabled },
                  {
                    onSuccess: () =>
                      toast.success(
                        enabled ? "Backups disabled" : "Backups enabled",
                      ),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              {toggleBackups.isPending ? (
                <Loader2 className="size-3 animate-spin mr-1" />
              ) : null}
              {enabled ? "Disable" : "Enable"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Daily backups enabled. Up to 7 kept automatically."
              : "Enable for daily snapshots (20% of server price)."}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-muted p-1.5">
                <Camera className="size-3.5 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">Manual Backup</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              disabled={createBackup.isPending}
              onClick={() =>
                createBackup.mutate(
                  { machineId },
                  {
                    onSuccess: () => toast.success("Backup started"),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              {createBackup.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Zap className="size-3" />
              )}
              Run Now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Create a point-in-time backup of your machine right now.
          </p>
        </div>
      </div>

      {/* Backup list */}
      <div className="rounded-xl border bg-card">
        <div className="px-5 py-3 border-b">
          <span className="text-sm font-medium">
            Backup History{" "}
            <span className="text-muted-foreground font-normal">
              ({backups.length})
            </span>
          </span>
        </div>
        <div className="p-3">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : backups.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Archive className="size-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No backups yet</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                Enable automatic backups or run one manually.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {backups.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="rounded-lg bg-muted p-1.5 shrink-0">
                      <Archive className="size-3 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs font-medium truncate">
                        {b.description}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {timeAgo(b.created)}
                        {b.size > 0 && ` · ${b.size.toFixed(1)} GB`}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] shrink-0",
                      b.status === "available"
                        ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : "",
                    )}
                  >
                    {b.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Port Forwarding Card ──────────────────────────────────────────── */
function ProxyPortCard({ slug }: { slug: string }) {
  const [port, setPort] = useState("");
  const url = port ? `https://${port}--${slug}.kortix.cloud` : "";
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b">
        <Link2 className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Port Forwarding</span>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Port (e.g. 3000)"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-40 font-mono text-sm h-9"
            min={1}
            max={65535}
          />
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted h-9"
            >
              <ExternalLink className="size-3" /> Open
            </a>
          )}
        </div>
        {url && <CodeBlock text={url} label="Port URL" />}
        <p className="text-xs text-muted-foreground">
          Format:{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{`{port}--${slug}.kortix.cloud`}</code>
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MACHINE DETAIL PAGE
   ═══════════════════════════════════════════════════════════════════════ */

export default function MachineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const machineId = params.id as string;
  const [createImageOpen, setCreateImageOpen] = useState(false);
  const [rescaleOpen, setRescaleOpen] = useState(false);
  const [imageName, setImageName] = useState("");

  const { data: machine, isLoading, error } = useMachine(machineId);
  const deleteMachine = useDeleteMachine();
  const rebootMachine = useRebootMachine();
  const createImage = useCreateImage();
  const [confirm, ConfirmDialog] = useConfirm();

  const handleReboot = () => {
    rebootMachine.mutate(machineId, {
      onSuccess: () => toast.success("Reboot initiated"),
      onError: (err) => toast.error(err.message),
    });
  };

  const handleCreateImage = () => {
    if (!imageName.trim()) return;
    createImage.mutate(
      { machine_id: machineId, name: imageName.trim() },
      {
        onSuccess: () => {
          toast.success("Image creation started");
          setCreateImageOpen(false);
          setImageName("");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete Machine",
      description: `This will permanently destroy ${machine?.slug || "this machine"} and all data on it. This action cannot be undone.`,
      confirmLabel: "Delete Forever",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    deleteMachine.mutate(machineId, {
      onSuccess: () => {
        toast.success("Machine deleted");
        router.push("/machines");
      },
      onError: (err) => toast.error(err.message),
    });
  };

  /* ── Loading skeleton ──────────────────────────────────────────────── */
  if (isLoading)
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-72" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-10 w-80 rounded-lg" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );

  /* ── Error / Not Found ─────────────────────────────────────────────── */
  if (error || !machine)
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="rounded-2xl bg-destructive/10 p-5 mb-5">
          <AlertTriangle className="size-8 text-destructive" />
        </div>
        <h2 className="font-heading text-xl mb-1.5">Machine Not Found</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          {error?.message ||
            "The machine you are looking for does not exist or has been deleted."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/machines")}
        >
          <ArrowLeft className="size-3.5" />
          Back to Machines
        </Button>
      </div>
    );

  const statusInfo = statusMap[machine.status] || statusMap.stopped;
  const isReady = machine.status === "ready";
  const uptime = machine.ready_at ? timeAgo(machine.ready_at) : null;
  const sshKeyPath = `~/.ssh/justavps_${machine.slug}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://justavps.com";

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-20">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/machines"
            className="mt-1 rounded-lg border p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-heading text-xl md:text-2xl tracking-tight truncate">
                {machine.name || machine.slug}
              </h1>
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5 px-2.5 py-0.5 h-6 text-[11px] font-medium shrink-0",
                  statusInfo.badgeClass,
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    statusInfo.dotClass,
                  )}
                />
                {statusInfo.label}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="font-mono">{machine.slug}</span>
              <span className="opacity-30">·</span>
              <span className="font-mono">{machine.server_type}</span>
              <span className="opacity-30">·</span>
              <span>{machine.region.toUpperCase()}</span>
              {machine.ip && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="font-mono">{machine.ip}</span>
                </>
              )}
              {uptime && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    up {uptime}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isReady && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setRescaleOpen(true)}
              >
                <ArrowUp className="size-3.5" />
                Scale Up
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setCreateImageOpen(true)}
              >
                <Camera className="size-3.5" />
                Snapshot
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleReboot}
            disabled={!isReady || rebootMachine.isPending}
          >
            {rebootMachine.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCw className="size-3.5" />
            )}
            Reboot
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
            onClick={handleDelete}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* ── Provisioning Banner ────────────────────────────────────────── */}
      {machine.status === "provisioning" && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
          <div className="rounded-lg bg-yellow-500/10 p-2 shrink-0">
            <Loader2 className="size-4 animate-spin text-yellow-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              {machine.provisioning_stage === "resizing"
                ? "Scaling in progress"
                : "Provisioning your machine"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {machine.provisioning_stage === "resizing"
                ? "Stops, resizes, and restarts (~60-90s). Page updates automatically."
                : "This usually takes about 60 seconds. Page updates automatically."}
            </p>
          </div>
        </div>
      )}

      {/* ── Stats Strip ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {machine.health ? (
          <>
            <ResourceStatCard
              icon={Cpu}
              label="CPU"
              value={machine.health.cpu}
            />
            <ResourceStatCard
              icon={MemoryStick}
              label="Memory"
              value={machine.health.memory}
            />
            <ResourceStatCard
              icon={HardDrive}
              label="Disk"
              value={machine.health.disk}
            />
          </>
        ) : (
          <>
            <InfoStatCard
              icon={Globe}
              label="Region"
              value={machine.region.toUpperCase()}
            />
            <InfoStatCard
              icon={Server}
              label="Type"
              value={machine.server_type}
            />
            <InfoStatCard
              icon={HardDrive}
              label="IP Address"
              value={machine.ip || "—"}
            />
          </>
        )}
        <InfoStatCard
          icon={DollarSign}
          label="Monthly Cost"
          value={`$${machine.price_monthly ?? 0}`}
          suffix="/mo"
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      {isReady ? (
        <Tabs defaultValue="connect" className="space-y-4">
          <TabsList className="h-10 p-1">
            <TabsTrigger value="connect" className="gap-1.5 text-xs h-8">
              <Link2 className="size-3.5" />
              Connect
            </TabsTrigger>
            <TabsTrigger value="terminal" className="gap-1.5 text-xs h-8">
              <TerminalIcon className="size-3.5" />
              Terminal
            </TabsTrigger>
            <TabsTrigger value="proxy" className="gap-1.5 text-xs h-8">
              <Globe className="size-3.5" />
              Proxy
            </TabsTrigger>
            <TabsTrigger value="backups" className="gap-1.5 text-xs h-8">
              <Archive className="size-3.5" />
              Backups
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5 text-xs h-8">
              <Code2 className="size-3.5" />
              API
            </TabsTrigger>
          </TabsList>

          {/* ── Connect Tab ──────────────────────────────────── */}
          <TabsContent value="connect" className="mt-0 space-y-4">
            {/* Quick Connect — hero card */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b bg-emerald-500/5">
                <Zap className="size-3.5 text-emerald-500" />
                <span className="text-sm font-medium">Quick Connect</span>
                <Badge className="text-[10px] font-normal bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 h-4 px-1.5 ml-auto">
                  One command
                </Badge>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Save the SSH key and connect — paste this in your terminal:
                </p>
                {machine.ssh_key?.setup_command && (
                  <CodeBlock
                    text={machine.ssh_key.setup_command}
                    label="Setup command"
                    variant="green"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  Reconnect later:{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono">
                    ssh -i {sshKeyPath} root@{machine.ip}
                  </code>
                </p>
              </div>
            </div>

            {/* Two-column: VS Code + Plain SSH */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cursor / VS Code */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b">
                  <Monitor className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    Cursor / VS Code
                  </span>
                  <Badge className="text-[10px] font-normal bg-primary/10 text-primary border-primary/20 h-4 px-1.5 ml-auto">
                    Recommended
                  </Badge>
                </div>
                <div className="p-5 space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      1. Add to SSH config
                    </p>
                    <CodeBlock
                      text={`grep -q "Host ${machine.slug}" ~/.ssh/config 2>/dev/null || printf '\\nHost ${machine.slug}\\n  HostName ${machine.ip}\\n  User root\\n  IdentityFile ${sshKeyPath}\\n  StrictHostKeyChecking no\\n' >> ~/.ssh/config`}
                      label="SSH config command"
                      variant="green"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      2. Connect
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] border font-mono">
                        Cmd+Shift+P
                      </kbd>{" "}
                      → Remote-SSH: Connect to Host →{" "}
                      <code className="bg-muted px-1 rounded font-mono">
                        {machine.slug}
                      </code>
                    </p>
                  </div>
                  <div className="pt-3 border-t">
                    <p className="text-[11px] text-muted-foreground">
                      Port forwarding is automatic —{" "}
                      <code className="bg-muted px-1 rounded">
                        localhost:3000
                      </code>{" "}
                      works locally.
                    </p>
                  </div>
                </div>
              </div>

              {/* Plain SSH */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b">
                  <TerminalIcon className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">Plain SSH</span>
                </div>
                <div className="p-5 space-y-4">
                  <CodeBlock
                    text={`ssh -i ${sshKeyPath} root@${machine.ip}`}
                    label="SSH command"
                  />

                  <details className="group">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors flex items-center gap-1.5">
                      <Code2 className="size-3" />
                      AI agent prompt
                    </summary>
                    <div className="mt-3">
                      <CodeBlock
                        text={`Set up SSH access to my remote VPS and connect via Remote-SSH.\n\n1. Save the SSH key:\n${machine.ssh_key?.setup_command?.split("&&").slice(0, 2).join("&&").trim() ?? ""}\n\n2. Add to ~/.ssh/config:\nHost ${machine.slug}\n  HostName ${machine.ip}\n  User root\n  IdentityFile ${sshKeyPath}\n  StrictHostKeyChecking no\n\n3. Connect via Remote-SSH to host "${machine.slug}"`}
                        label="AI agent prompt"
                      />
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Terminal Tab ──────────────────────────────────── */}
          <TabsContent value="terminal" className="mt-0">
            <Terminal
              machineId={machine.id}
              machineIp={machine.ip}
              machineSlug={machine.slug}
              machineStatus={machine.status}
              ptyUrl={machine.urls?.pty ?? null}
            />
          </TabsContent>

          {/* ── Proxy Tab ────────────────────────────────────── */}
          <TabsContent value="proxy" className="mt-0 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Web Access */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b">
                  <Globe className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">Web Access</span>
                </div>
                <div className="p-5 space-y-3">
                  <CodeBlock
                    text={`https://${machine.slug}.kortix.cloud`}
                    label="URL"
                  />
                  <a
                    href={`https://${machine.slug}.kortix.cloud`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                  >
                    <ExternalLink className="size-3" /> Open in browser
                  </a>
                </div>
              </div>

              {/* API Access */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b">
                  <Code2 className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">API Access</span>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Authenticate with your API key:
                  </p>
                  <CodeBlock
                    text={`curl https://${machine.slug}.kortix.cloud \\\n  -H "Authorization: Bearer sk_live_xxx"`}
                    label="curl"
                  />
                </div>
              </div>
            </div>

            <ProxyPortCard slug={machine.slug} />
          </TabsContent>

          {/* ── Backups Tab ──────────────────────────────────── */}
          <TabsContent value="backups" className="mt-0">
            <BackupsPanel machineId={machine.id} />
          </TabsContent>

          {/* ── API Tab ──────────────────────────────────────── */}
          <TabsContent value="api" className="mt-0 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Machine ID */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b">
                  <Server className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">Machine ID</span>
                </div>
                <div className="p-5">
                  <CodeBlock text={machine.id} label="Machine ID" />
                </div>
              </div>

              {/* Resources */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b">
                  <Code2 className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">Resources</span>
                </div>
                <div className="p-5 space-y-2.5">
                  <Link
                    href="/keys"
                    className="flex items-center gap-2.5 text-xs text-primary hover:underline font-medium"
                  >
                    <Code2 className="size-3" /> Generate API Key
                  </Link>
                  <Link
                    href="/api/docs"
                    className="flex items-center gap-2.5 text-xs text-primary hover:underline font-medium"
                  >
                    <ExternalLink className="size-3" /> API Reference
                  </Link>
                </div>
              </div>
            </div>

            {/* Examples */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b">
                <TerminalIcon className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">Examples</span>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Get machine
                    </p>
                    <CodeBlock
                      text={`curl ${appUrl}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`}
                      label="curl"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Reboot
                    </p>
                    <CodeBlock
                      text={`curl -X POST ${appUrl}/api/v1/machines/${machine.id}/reboot \\\n  -H "Authorization: Bearer sk_live_xxx"`}
                      label="curl"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Delete
                    </p>
                    <CodeBlock
                      text={`curl -X DELETE ${appUrl}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`}
                      label="curl"
                    />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        /* ── Not Ready State ─────────────────────────────────────────── */
        <div className="rounded-xl border border-dashed bg-card">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-2xl bg-muted p-5 mb-4">
              <Server
                className="size-8 text-muted-foreground/50"
                strokeWidth={1.5}
              />
            </div>
            <h3 className="text-base font-medium">Machine is not ready</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1.5">
              Connection details, terminal, and management tools will appear
              once the machine is running.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog />

      {machine && (
        <RescaleDialog
          open={rescaleOpen}
          onOpenChange={setRescaleOpen}
          machine={machine}
        />
      )}

      <Dialog open={createImageOpen} onOpenChange={setCreateImageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Snapshot</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="image-name">Name</Label>
              <Input
                id="image-name"
                placeholder="my-dev-environment"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateImage();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Saves the current state as a reusable image.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateImageOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateImage}
              disabled={createImage.isPending || !imageName.trim()}
            >
              {createImage.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                "Create Snapshot"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
