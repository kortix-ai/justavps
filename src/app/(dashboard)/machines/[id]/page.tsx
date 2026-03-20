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
  useStopMachine,
  useStartMachine,
  useCancelMachine,
  useReactivateMachine,
  useBackups,
  useCreateBackup,
  useToggleBackups,
} from "@/hooks/use-machines";
import { useMachineSSE } from "@/hooks/use-machine-sse";
import { useCreateImage } from "@/hooks/use-images";
import { useConfirm } from "@/hooks/use-confirm";
import {
  ArrowLeft,
  RotateCw,
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
  KeyRound,
  Power,
  PowerOff,
  MapPin,
  CalendarX2,
  Trash2,
} from "lucide-react";
import { RescaleDialog } from "@/components/dashboard/rescale-dialog";
import Link from "next/link";
import { timeAgo, cn, regionDisplay, planName, planSpecs, PROXY_DOMAIN } from "@/lib/utils";

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
    badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  stopped: {
    label: "Stopped",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
};

/* ─── Shared copy logic ──────────────────────────────────────────────── */
function useCopy(text: string, label?: string) {
  const [copied, setCopied] = useState(false);
  const copy = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(text);
    if (label) toast.success(`${label} copied`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return { copied, copy };
}

/* ─── Shared hover copy overlay (top-right badge) ────────────────────── */
function CopyOverlay({ copied }: { copied: boolean }) {
  return (
    <div
      className={cn(
        "absolute top-2 right-2 flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md pointer-events-none transition-all",
        copied
          ? "bg-emerald-500/20 text-emerald-400 opacity-100"
          : "bg-zinc-800 text-zinc-400 opacity-0 group-hover:opacity-100",
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </div>
  );
}

/* ─── Standard click-to-copy code block ─────────────────────────────── */
function CodeBlock({
  text,
  label,
  variant = "default",
}: {
  text: string;
  label?: string;
  variant?: "default" | "green";
}) {
  const { copied, copy } = useCopy(text, label);
  return (
    <div className="relative group cursor-pointer min-w-0 w-full" onClick={copy}>
      <pre
        className={cn(
          "p-3 rounded-lg text-xs font-mono border overflow-x-auto transition-colors leading-relaxed max-w-full",
          "bg-zinc-950 border-zinc-800 hover:border-zinc-700",
          variant === "green" ? "text-green-400" : "text-zinc-300",
        )}
      >
        {text}
      </pre>
      <CopyOverlay copied={copied} />
    </div>
  );
}

/* ─── Masked secret block — same hover copy, key never readable ──────── */
function SecretCodeBlock({ text, label }: { text: string; label?: string }) {
  const { copied, copy } = useCopy(text, label);

  // Replace the private key value with bullets — only first 6 chars shown.
  // setup_command: mkdir ... && echo 'KEY' > path && chmod ...
  const masked = text.replace(
    /(echo\s+')([^']{6})[^']*('[^']*)/,
    "$1$2••••••$3",
  );

  return (
    <div className="relative group cursor-pointer min-w-0 w-full" onClick={copy}>
      <div
        className={cn(
          "rounded-lg border overflow-hidden transition-colors",
          "bg-zinc-950 border-zinc-800 hover:border-zinc-700",
        )}
      >
        {/* Single truncated line — never wraps, key stays hidden */}
        <p className="px-3 py-2.5 text-[11px] font-mono text-green-400 truncate leading-relaxed">
          {masked}
        </p>
        {/* Footer hint */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-zinc-800 bg-zinc-900/50">
          <KeyRound className="size-2.5 text-zinc-500 shrink-0" />
          <span className="text-[10px] text-zinc-500">Private key hidden</span>
        </div>
      </div>
      <CopyOverlay copied={copied} />
    </div>
  );
}

/* ─── Inline copy button (for row-level copy actions) ───────────────── */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const { copied, copy } = useCopy(text, label);
  return (
    <button
      onClick={copy}
      className={cn(
        "shrink-0 flex items-center justify-center gap-1.5 text-xs font-medium w-20 py-1.5 rounded-lg border transition-all",
        copied
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-border bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground",
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ─── Health stat row ───────────────────────────────────────────────── */
function HealthRow({
  icon: Icon,
  label,
  value,
  subtitle,
  progress,
  colorClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  progress: number;
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            {subtitle && <span className="text-[10px] text-muted-foreground/60">{subtitle}</span>}
          </div>
          <span className={cn("text-xs font-semibold tabular-nums", colorClass)}>{value}</span>
        </div>
        <Progress
          value={progress}
          className={cn(
            "h-1.5 rounded-full",
            progress > 80
              ? "[&>div]:bg-red-500"
              : progress > 60
                ? "[&>div]:bg-yellow-500"
                : "[&>div]:bg-foreground/20",
          )}
        />
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
  const loaded = !isLoading && data !== undefined;

  return (
    <div className="space-y-3">
      {/* Free perk banner — only shown when disabled */}
      {!enabled && loaded && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <div className="size-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <Shield className="size-3.5 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-medium">Daily backups included — free</p>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">Included</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Up to 7 daily snapshots at no extra cost. Enable it once — we handle the rest.
            </p>
          </div>
        </div>
      )}

      {/* Controls — single card, two rows */}
      <div className="rounded-xl border bg-card divide-y overflow-hidden">
        {/* Automatic backups */}
        <div className="flex items-center justify-between px-4 py-3.5 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "size-7 rounded-md flex items-center justify-center shrink-0",
              enabled ? "bg-emerald-500/10" : "bg-muted",
            )}>
              <Shield className={cn("size-3.5", enabled ? "text-emerald-500" : "text-muted-foreground")} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Daily backups</p>
              <p className="text-xs text-muted-foreground">
                {enabled ? "Active — up to 7 daily snapshots kept" : "Free, included in your plan"}
              </p>
            </div>
          </div>
          <Button
            variant={enabled ? "outline" : "default"}
            size="sm"
            className="h-7 text-xs shrink-0"
            disabled={toggleBackups.isPending}
            onClick={() =>
              toggleBackups.mutate(
                { machineId, enable: !enabled },
                {
                  onSuccess: () => toast.success(enabled ? "Backups disabled" : "Backups enabled"),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            {toggleBackups.isPending && <Loader2 className="size-3 animate-spin mr-1" />}
            {enabled ? "Disable" : "Enable"}
          </Button>
        </div>

        {/* Manual backup — requires backups enabled */}
        <div className="flex items-center justify-between px-4 py-3.5 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Camera className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Manual backup</p>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? "Trigger a one-off backup right now"
                  : "Enable daily backups first to run manual backups"}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            disabled={createBackup.isPending || !enabled}
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
            {createBackup.isPending ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
            Run Now
          </Button>
        </div>
      </div>

      {/* History */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="text-sm font-medium">History</span>
          {!isLoading && <span className="text-xs text-muted-foreground">{backups.length} snapshots</span>}
        </div>
        {isLoading ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
          </div>
        ) : backups.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Archive className="size-7 text-muted-foreground/25 mb-2" />
            <p className="text-sm text-muted-foreground">No backups yet</p>
            {!enabled && (
              <p className="text-xs text-muted-foreground/70 mt-0.5">Enable daily backups above to get started</p>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {backups.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{b.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {timeAgo(b.created)}{b.size > 0 && ` · ${b.size.toFixed(1)} GB`}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] shrink-0 ml-3",
                    b.status === "available" ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "",
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
  );
}

/* ─── Port Forwarding (inline, no wrapper card) ─────────────────────── */
function PortForwardCard({ slug, portTemplate }: { slug: string; portTemplate?: string | null }) {
  const [port, setPort] = useState("");
  const template = portTemplate && portTemplate.includes('{port}')
    ? portTemplate
    : `https://{port}--${slug}.${PROXY_DOMAIN}`;
  const url = port ? template.replace('{port}', port) : "";
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <Input
          type="number"
          placeholder="Port, e.g. 3000"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="w-44 font-mono text-sm h-9"
          min={1}
          max={65535}
        />
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-muted h-9"
          >
            <ExternalLink className="size-3" /> Open
          </a>
        )}
      </div>
      {url ? (
        <CodeBlock text={url} label="Port URL" />
      ) : (
        <p className="text-xs text-muted-foreground">
          Pattern:{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">
            {template}
          </code>
        </p>
      )}
    </div>
  );
}

/* ─── Provisioning stage progress ────────────────────────────────────── */
const PROVISIONING_STAGES = [
  { key: "server_creating", label: "Creating server" },
  { key: "server_created", label: "Server created" },
  { key: "cloud_init_running", label: "Configuring machine" },
  { key: "cloud_init_done", label: "Starting services" },
  { key: "docker_pulling", label: "Pulling Docker image" },
  { key: "docker_running", label: "Docker container started" },
  { key: "services_ready", label: "Services ready" },
] as const;

function ProvisioningProgress({ stage }: { stage: string }) {
  const currentIndex = PROVISIONING_STAGES.findIndex((s) => s.key === stage);
  if (currentIndex === -1) return null;

  return (
    <div className="mt-2.5 flex items-center gap-1">
      {PROVISIONING_STAGES.map((s, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={s.key} className="flex items-center gap-1 min-w-0">
            <div
              className={cn(
                "size-1.5 rounded-full shrink-0 transition-colors",
                isDone
                  ? "bg-emerald-500"
                  : isCurrent
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-zinc-300 dark:bg-zinc-700",
              )}
              title={s.label}
            />
          </div>
        );
      })}
      <span className="ml-1.5 text-[11px] text-muted-foreground truncate">
        {PROVISIONING_STAGES[currentIndex].label}
      </span>
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
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm();
  const { data: machine, isLoading, error } = useMachine(machineId);
  useMachineSSE(machineId, machine?.status);
  const deleteMachine = useDeleteMachine();
  const rebootMachine = useRebootMachine();
  const stopMachine = useStopMachine();
  const startMachine = useStartMachine();
  const cancelMachine = useCancelMachine();
  const reactivateMachine = useReactivateMachine();
  const createImage = useCreateImage();
  const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true";
  const [confirmCancel, ConfirmCancelDialog] = useConfirm();

  const handleReboot = () => {
    rebootMachine.mutate(machineId, {
      onSuccess: () => toast.success("Reboot initiated"),
      onError: (err) => toast.error(err.message),
    });
  };

  const handleStop = () => {
    stopMachine.mutate(machineId, {
      onSuccess: () => toast.success("Machine stopped"),
      onError: (err) => toast.error(err.message),
    });
  };

  const handleStart = () => {
    startMachine.mutate(machineId, {
      onSuccess: () => toast.success("Machine starting…"),
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

  /* ── Loading ───────────────────────────────────────────────────────── */
  if (isLoading)
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-10 w-72 max-w-full rounded-lg" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );

  /* ── Error ─────────────────────────────────────────────────────────── */
  if (error || !machine)
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="rounded-2xl bg-destructive/10 p-5 mb-4">
          <AlertTriangle className="size-8 text-destructive" />
        </div>
        <h2 className="font-heading text-xl mb-1.5">Machine Not Found</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          {error?.message || "This machine does not exist or has been deleted."}
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/machines")}>
          <ArrowLeft className="size-3.5" />
          Back to Machines
        </Button>
      </div>
    );

  const statusInfo = statusMap[machine.status] || statusMap.stopped;
  const isReady = machine.status === "ready";
  const isResizing =
    machine.status === "provisioning" && machine.provisioning_stage === "resizing";
  const uptime = machine.ready_at ? timeAgo(machine.ready_at) : null;
  const sshKeyPath = `~/.ssh/justavps_${machine.slug}`;


  /* Health values — daemon sends 0–1 fractions, normalise to 0–100 here */
  const specs     = planSpecs(machine.server_type);
  const cpuPct    = machine.health ? Math.round(machine.health.cpu    * 100) : 0;
  const memPct    = machine.health ? Math.round(machine.health.memory * 100) : 0;
  const diskPct   = machine.health ? Math.round(machine.health.disk   * 100) : 0;

  /* Absolute usage values derived from plan specs */
  const memUsedGb  = specs ? ((memPct  / 100) * specs.memory).toFixed(1) : null;
  const diskUsedGb = specs ? ((diskPct / 100) * specs.disk  ).toFixed(0) : null;

  const cpuColor  = cpuPct  > 80 ? "text-red-500" : cpuPct  > 60 ? "text-yellow-500" : "text-foreground";
  const memColor  = memPct  > 80 ? "text-red-500" : memPct  > 60 ? "text-yellow-500" : "text-foreground";
  const diskColor = diskPct > 80 ? "text-red-500" : diskPct > 60 ? "text-yellow-500" : "text-foreground";

  return (
    <div className="max-w-5xl mx-auto pb-20 space-y-5 min-w-0 w-full">

      {/* ════════════════════════════════════════════════════════════════
          HEADER
          ════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: back + title */}
        <div className="flex items-start gap-3 min-w-0">
          <Link
            href="/machines"
            className="mt-0.5 shrink-0 size-8 rounded-lg border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-heading text-lg md:text-xl tracking-tight leading-tight">
                {machine.name || machine.slug}
              </h1>
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5 text-[11px] font-medium h-5 px-2 shrink-0",
                  statusInfo.badgeClass,
                )}
              >
                <span className={cn("size-1.5 rounded-full", statusInfo.dotClass)} />
                {statusInfo.label}
              </Badge>
              {machine.subscription?.cancel_at_period_end && (
                <Badge
                  variant="outline"
                  className="gap-1 text-[11px] font-medium h-5 px-2 shrink-0 bg-destructive/10 text-destructive border-destructive/20"
                >
                  <CalendarX2 className="size-2.5" />
                  Cancelling
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="font-mono">{machine.slug}</span>
              <span className="opacity-30">·</span>
              <span className="font-mono">{planName(machine.server_type)}</span>
              <span className="opacity-30">·</span>
              <span>{regionDisplay(machine.region).label}</span>
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
                    {uptime}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {isResizing && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 cursor-default"
              disabled
            >
              <Loader2 className="size-3.5 animate-spin" />
              Scaling…
            </Button>
          )}
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
          {isReady && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={handleReboot}
                disabled={rebootMachine.isPending}
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
                className="h-8 text-xs gap-1.5"
                onClick={handleStop}
                disabled={stopMachine.isPending}
              >
                {stopMachine.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <PowerOff className="size-3.5" />
                )}
                Stop
              </Button>
            </>
          )}
          {machine.status === "stopped" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/10 border-emerald-500/30"
              onClick={handleStart}
              disabled={startMachine.isPending}
            >
              {startMachine.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Power className="size-3.5" />
              )}
              Start
            </Button>
           )}
          {/* Cancel / Reactivate subscription */}
          {machine.subscription?.cancel_at_period_end ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/10 border-emerald-500/30"
              onClick={() => {
                reactivateMachine.mutate(machineId, {
                  onSuccess: () => toast.success("Subscription reactivated"),
                  onError: (err) => toast.error(err.message),
                });
              }}
              disabled={reactivateMachine.isPending}
            >
              {reactivateMachine.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Power className="size-3.5" />
              )}
              Reactivate
            </Button>
          ) : machine.subscription && machine.status !== "deleted" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 text-red-600 hover:text-red-600 hover:bg-red-500/10 border-red-500/30"
              onClick={async () => {
                const ok = await confirmCancel({
                  title: "Cancel Subscription",
                  description: "Your machine will keep running until the end of your billing period, then it will be permanently deleted. You can reactivate at any time before then.",
                  confirmLabel: "Cancel Subscription",
                  variant: "destructive",
                });
                if (!ok) return;
                cancelMachine.mutate(machineId, {
                  onSuccess: () => toast.success("Subscription cancelled — machine will be deleted at the end of your billing period"),
                  onError: (err) => toast.error(err.message),
                });
              }}
              disabled={cancelMachine.isPending}
            >
              {cancelMachine.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CalendarX2 className="size-3.5" />
              )}
              Cancel
            </Button>
          ) : null}
          {isDevMode && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 text-red-600 hover:text-red-600 hover:bg-red-500/10 border-red-500/30"
              onClick={async () => {
                const ok = await confirmDelete({
                  title: "Delete Machine",
                  description: "This will permanently destroy the server, remove DNS records, and cancel any active subscription. This cannot be undone.",
                  confirmLabel: "Delete Machine",
                  variant: "destructive",
                });
                if (!ok) return;
                deleteMachine.mutate(machineId, {
                  onSuccess: () => {
                    toast.success("Machine deleted");
                    router.push("/machines");
                  },
                  onError: (err) => toast.error(err.message),
                });
              }}
              disabled={deleteMachine.isPending}
            >
              {deleteMachine.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
          CANCELLATION BANNER
          ════════════════════════════════════════════════════════════════ */}
      {machine.subscription?.cancel_at_period_end && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="rounded-lg bg-destructive/10 p-1.5 shrink-0 mt-0.5">
            <CalendarX2 className="size-4 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">
              Subscription cancelled
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This machine will be permanently deleted on{" "}
              <span className="font-medium text-foreground">
                {machine.subscription.cancel_at
                  ? new Date(machine.subscription.cancel_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                  : machine.subscription.current_period_end
                    ? new Date(machine.subscription.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                    : "the end of your billing period"}
              </span>
              .
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs gap-1.5"
              onClick={() => {
                reactivateMachine.mutate(machineId, {
                  onSuccess: () => toast.success("Subscription reactivated"),
                  onError: (err) => toast.error(err.message),
                });
              }}
              disabled={reactivateMachine.isPending}
            >
              {reactivateMachine.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Power className="size-3" />
              )}
              Reactivate Subscription
            </Button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          PROVISIONING BANNER
          ════════════════════════════════════════════════════════════════ */}
      {machine.status === "provisioning" && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
          <div className="rounded-lg bg-yellow-500/10 p-1.5 shrink-0 mt-0.5">
            <Loader2 className="size-4 animate-spin text-yellow-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              {machine.provisioning_stage === "resizing"
                ? "Scaling in progress"
                : "Provisioning your machine"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {machine.provisioning_stage === "resizing"
                ? "Stops, resizes, and restarts — usually 60–90s. This page updates automatically."
                : "This usually takes 1–3 minutes. This page updates automatically."}
            </p>
            {machine.provisioning_stage && machine.provisioning_stage !== "resizing" && (
              <ProvisioningProgress stage={machine.provisioning_stage} />
            )}
          </div>
        </div>
      )}

      {machine.status === "error" && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="rounded-lg bg-red-500/10 p-1.5 shrink-0 mt-0.5">
            <AlertTriangle className="size-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              {machine.provisioning_stage === "timeout"
                ? "Provisioning timed out"
                : machine.provisioning_stage === "cloud_init_error"
                  ? "Setup failed"
                  : "Machine error"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {machine.provisioning_stage === "timeout"
                ? "The machine did not report back in time. This can happen if the network or cloud-init script encountered issues. Try deleting and recreating the machine."
                : "Something went wrong during provisioning. Try deleting and recreating the machine, or contact support if the issue persists."}
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          TABS
          ════════════════════════════════════════════════════════════════ */}
      {isReady ? (
        <Tabs defaultValue="connect" className="space-y-4">
          <TabsList className="h-9 p-1 w-full sm:w-auto overflow-x-auto">
            <TabsTrigger value="connect" className="gap-1.5 text-xs h-7">
              <Link2 className="size-3.5" />
              Connect
            </TabsTrigger>
            <TabsTrigger value="terminal" className="gap-1.5 text-xs h-7">
              <TerminalIcon className="size-3.5" />
              Terminal
            </TabsTrigger>
            <TabsTrigger value="proxy" className="gap-1.5 text-xs h-7">
              <Globe className="size-3.5" />
              Proxy
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-1.5 text-xs h-7">
              <Cpu className="size-3.5" />
              Stats
            </TabsTrigger>
            <TabsTrigger value="backups" className="gap-1.5 text-xs h-7">
              <Archive className="size-3.5" />
              Backups
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5 text-xs h-7">
              <Code2 className="size-3.5" />
              API
            </TabsTrigger>
          </TabsList>

           {/* ── CONNECT ────────────────────────────────────────────────── */}
           <TabsContent value="connect" className="mt-0 space-y-3 min-w-0">

            {/* AI Agent shortcut — top of page, primary CTA */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Code2 className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-0.5">Let your AI agent do it</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Copy this prompt and paste it into{" "}
                    <span className="text-foreground font-medium">Claude Code, Cursor, Codex, OpenCode</span>
                    {" "}— whatever you use. It contains your private key so the agent can set everything up automatically.
                    Or do it manually below.
                  </p>
                </div>
                <CopyButton
                  text={`Set up SSH access to my remote VPS and connect via Remote-SSH.\n\n1. Save the SSH key:\n${machine.ssh_key?.setup_command?.split("&&").slice(0, 2).join("&&").trim() ?? "# run step 1 first"}\n\n2. Add to ~/.ssh/config:\nHost ${machine.slug}\n  HostName ${machine.ip}\n  User root\n  IdentityFile ${sshKeyPath}\n  StrictHostKeyChecking no\n\n3. Connect via Remote-SSH to host "${machine.slug}"`}
                  label="AI agent prompt"
                />
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">or manually</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Step 1 — Save SSH key */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-2.5 border-b bg-muted/30">
                <span className="size-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shrink-0 leading-none">1</span>
                <span className="text-sm font-medium">Save SSH key &amp; connect</span>
                <div className="ml-auto flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <KeyRound className="size-3" />
                  <span>Contains private key</span>
                </div>
              </div>
              <div className="p-4 space-y-2.5 min-w-0">
                <p className="text-xs text-muted-foreground">
                  Run once in your terminal — saves your key and opens an SSH session immediately.
                </p>
                {machine.ssh_key?.setup_command ? (
                  <SecretCodeBlock
                    text={machine.ssh_key.setup_command}
                    label="Setup command"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground italic">Not available yet.</p>
                )}
                <p className="text-xs text-muted-foreground">Reconnect later:</p>
                <CodeBlock text={`ssh -i ${sshKeyPath} root@${machine.ip}`} label="SSH command" />
              </div>
            </div>

            {/* Step 2 — Editor methods */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-2.5 border-b bg-muted/30">
                <span className="size-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shrink-0 leading-none">2</span>
                <span className="text-sm font-medium">Open in your editor</span>
              </div>
              <div className="divide-y divide-border/60">

                {/* Cursor / VS Code */}
                <div className="p-4 space-y-2.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <Monitor className="size-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">Cursor / VS Code</span>
                    <Badge className="text-[10px] font-normal bg-primary/10 text-primary border-primary/20 h-4 px-1.5">
                      Recommended
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Add host to SSH config (run once):</p>
                  <CodeBlock
                    text={`grep -q "Host ${machine.slug}" ~/.ssh/config 2>/dev/null || cat >> ~/.ssh/config << 'EOF'\n\nHost ${machine.slug}\n  HostName ${machine.ip}\n  User root\n  IdentityFile ${sshKeyPath}\n  StrictHostKeyChecking no\nEOF`}
                    label="SSH config"
                    variant="green"
                  />
                  <p className="text-xs text-muted-foreground">
                    Then press{" "}
                    <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] border font-mono">Cmd+Shift+P</kbd>
                    {" → "}Remote-SSH: Connect to Host{" → "}
                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px] break-all">{machine.slug}</code>
                  </p>
                </div>

                {/* Plain SSH */}
                <div className="p-4 space-y-2.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <TerminalIcon className="size-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">Terminal / Plain SSH</span>
                  </div>
                  <CodeBlock
                    text={`ssh -i ${sshKeyPath} root@${machine.ip}`}
                    label="SSH command"
                  />
                </div>

              </div>
            </div>
          </TabsContent>

          {/* ── TERMINAL ───────────────────────────────────────────────── */}
          <TabsContent value="terminal" className="mt-0">
            <Terminal
              machineSlug={machine.slug}
              machineStatus={machine.status}
              machineIp={machine.ip}
              terminalUrl={machine.urls?.terminal ?? null}
            />
          </TabsContent>

          {/* ── PROXY ──────────────────────────────────────────────────── */}
          <TabsContent value="proxy" className="mt-0">
            {(() => {
              const proxyUrl = machine.urls?.proxy ?? `https://${machine.slug}.${PROXY_DOMAIN}`;
              const portTemplate = machine.urls?.port_template ?? `https://{port}--${machine.slug}.${PROXY_DOMAIN}`;

              return (
                <div className="rounded-xl border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div className="flex items-center gap-2">
                      <Globe className="size-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">Web Proxy</span>
                    </div>
                    <a
                      href={proxyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="size-3" /> Open
                    </a>
                  </div>
                  <div className="p-4 space-y-4">
                    {/* Root URL */}
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Root URL — port 80 by default</p>
                      <CodeBlock text={proxyUrl} label="URL" />
                    </div>
                    {/* Divider */}
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border/60" />
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Link2 className="size-3" /> Port forwarding
                      </span>
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                    {/* Port forward */}
                    <PortForwardCard slug={machine.slug} portTemplate={portTemplate} />
                  </div>
                </div>
              );
            })()}
          </TabsContent>

          {/* ── STATS ─────────────────────────────────────────────────── */}
          <TabsContent value="stats" className="mt-0">
            <div className="rounded-xl border bg-card p-4 space-y-4">
              {machine.health ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resource Usage</span>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <DollarSign className="size-3" />
                      <span className="font-medium text-foreground">${machine.price_monthly ?? 0}</span>
                      <span>/mo</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <HealthRow icon={Cpu} label="CPU" subtitle={specs ? `${specs.vcpu} vCPU` : undefined} value={`${cpuPct}%`} progress={cpuPct} colorClass={cpuColor} />
                    <HealthRow icon={MemoryStick} label="Memory" subtitle={specs ? `of ${specs.memory} GB` : undefined} value={memUsedGb ? `${memUsedGb} GB` : `${memPct}%`} progress={memPct} colorClass={memColor} />
                    <HealthRow icon={HardDrive} label="Disk" subtitle={specs ? `of ${specs.disk} GB` : undefined} value={diskUsedGb ? `${diskUsedGb} GB` : `${diskPct}%`} progress={diskPct} colorClass={diskColor} />
                  </div>
                  <div className="pt-2 border-t space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><Server className="size-3.5" /><span>Plan</span></div>
                      <span className="font-medium">{planName(machine.server_type)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3.5" /><span>Region</span></div>
                      <span className="font-medium">{regionDisplay(machine.region).label}</span>
                    </div>
                    {machine.ip && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground"><Globe className="size-3.5" /><span>IP</span></div>
                        <span className="font-mono font-medium">{machine.ip}</span>
                      </div>
                    )}
                    {machine.daemon_version && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground"><Code2 className="size-3.5" /><span>Daemon</span></div>
                        <span className="font-mono text-xs text-muted-foreground">{machine.daemon_version}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground"><Server className="size-3.5" /><span>Plan</span></div>
                    <span className="font-medium">{planName(machine.server_type)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3.5" /><span>Region</span></div>
                    <span className="font-medium">{regionDisplay(machine.region).label}</span>
                  </div>
                  {machine.ip && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><Globe className="size-3.5" /><span>IP</span></div>
                      <span className="font-mono font-medium">{machine.ip}</span>
                    </div>
                  )}
                  {machine.daemon_version && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><Code2 className="size-3.5" /><span>Daemon</span></div>
                      <span className="font-mono text-xs text-muted-foreground">{machine.daemon_version}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground"><DollarSign className="size-3.5" /><span>Cost</span></div>
                    <span className="font-medium">${machine.price_monthly ?? 0}/mo</span>
                  </div>
                  <p className="text-xs text-muted-foreground pt-1">Live CPU, memory and disk metrics appear once the machine reports health data.</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── BACKUPS ────────────────────────────────────────────────── */}
          <TabsContent value="backups" className="mt-0">
            <BackupsPanel machineId={machine.id} />
          </TabsContent>

          {/* ── API ────────────────────────────────────────────────────── */}
          <TabsContent value="api" className="mt-0 space-y-3">
            {/* Machine ID */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <Server className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">Machine ID</span>
              </div>
              <div className="p-4">
                <CodeBlock text={machine.id} label="Machine ID" />
              </div>
            </div>

            {/* Links */}
            <div className="rounded-xl border bg-card divide-y">
              <Link
                href="/keys"
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <KeyRound className="size-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Generate API Key</p>
                    <p className="text-xs text-muted-foreground">Create a key to authenticate API requests</p>
                  </div>
                </div>
                <ExternalLink className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
              </Link>
              <Link
                href="/api/docs"
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Code2 className="size-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">API Reference</p>
                    <p className="text-xs text-muted-foreground">Full REST API docs with all endpoints</p>
                  </div>
                </div>
                <ExternalLink className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
              </Link>
            </div>
          </TabsContent>

        </Tabs>
      ) : (
        /* ── NOT READY ─────────────────────────────────────────────────── */
        <div className="rounded-xl border border-dashed">
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="rounded-2xl bg-muted p-4 mb-4">
              <Server className="size-8 text-muted-foreground/40" strokeWidth={1.5} />
            </div>
            <h3 className="text-sm font-medium mb-1">Machine is not ready</h3>
            <p className="text-xs text-muted-foreground max-w-xs">
              Terminal, SSH, and management tools appear once the machine is running.
            </p>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog />
      <ConfirmCancelDialog />

      {machine && (
        <RescaleDialog open={rescaleOpen} onOpenChange={setRescaleOpen} machine={machine} />
      )}

      <Dialog open={createImageOpen} onOpenChange={setCreateImageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Snapshot</DialogTitle>
          </DialogHeader>
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
              Saves the current machine state as a reusable image.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateImageOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateImage}
              disabled={createImage.isPending || !imageName.trim()}
            >
              {createImage.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
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
