"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { toast } from "sonner";

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
import { ProxyTokenManager } from "@/components/dashboard/proxy-token-manager";
import {
  useMachine,
  useDeleteMachine,
  useRebootMachine,
  useStopMachine,
  useStartMachine,
  useReactivateMachine,
  useBackups,
  useCreateBackup,
  useRestoreBackup,
  useDeleteBackup,
} from "@/hooks/v2/use-machines-v2";
import { useCreateImage } from "@/hooks/v2/use-images-v2";
import { useConfirm } from "@/hooks/use-confirm";
import type { Machine } from "@/lib/types";
import {
  ArrowLeft,
  RotateCw,
  Copy,
  Check,
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
  Share2,
  AlertTriangle,
  Camera,
  Monitor,
  Archive,
  Clock,
  KeyRound,
  Power,
  PowerOff,
  MapPin,
  CalendarX2,
  Trash2,
  RotateCcw,
  Eye,
  EyeOff,
} from "lucide-react";
import { timeAgo, cn, regionDisplay, PROXY_DOMAIN } from "@/lib/utils";

const Terminal = dynamic(() => import("@/components/dashboard/terminal"), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-[#09090b] rounded-xl animate-pulse" />
  ),
});

/* ═══════════════════════════════════════════════════════════════════════
   STATUS MAP
   ═══════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════
   COPY HELPERS
   ═══════════════════════════════════════════════════════════════════════ */
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
          "p-3 rounded-lg text-xs font-mono border overflow-x-auto transition-colors leading-relaxed max-w-full whitespace-pre-wrap break-all",
          "bg-zinc-950 border-zinc-800 hover:border-zinc-700",
          variant === "green" ? "text-green-400" : "text-zinc-300",
        )}
      >
        {text}
      </pre>
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PROVISIONING PROGRESS — single source of truth
   ═══════════════════════════════════════════════════════════════════════ */
const STAGE_PROGRESS: Record<string, { pct: number; label: string }> = {
  server_creating: { pct: 15, label: "Creating server" },
  server_created: { pct: 60, label: "VM running, waiting for daemon" },
  cloud_init_running: { pct: 70, label: "Injecting machine identity" },
  cloud_init_done: { pct: 85, label: "Identity injected" },
  services_starting: { pct: 92, label: "Starting services" },
  services_ready: { pct: 100, label: "Ready" },
};

function provisioningInfo(machine: Machine): { pct: number; label: string } {
  if (machine.status === "ready") return { pct: 100, label: "Ready" };
  if (machine.status === "error") return { pct: 0, label: "Failed" };
  const stage = machine.provisioning_stage || "";
  return STAGE_PROGRESS[stage] || { pct: 5, label: "Starting…" };
}

/* ═══════════════════════════════════════════════════════════════════════
   HEALTH ROW
   ═══════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════
   BACKUPS PANEL
   ═══════════════════════════════════════════════════════════════════════ */
function BackupsPanel({ machineId, machine }: { machineId: string; machine: { price_monthly: number | null } }) {
  const { data, isLoading } = useBackups(machineId);
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const deleteBackup = useDeleteBackup();
  const [confirm, ConfirmDialog] = useConfirm();
  const backups = data?.backups ?? [];
  const snapshotNote = machine.price_monthly ? `Included with your $${machine.price_monthly.toFixed(0)}/mo machine.` : "Included with this machine.";

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="size-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Archive className="size-3.5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-sm font-medium">Snapshots & restore points</p>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/30 text-primary">
              included
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Create on-demand snapshots, restore the machine to an earlier point, and reuse state safely. {snapshotNote}
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card divide-y overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Camera className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Create snapshot</p>
              <p className="text-xs text-muted-foreground">Capture the current machine state right now.</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            disabled={createBackup.isPending}
            onClick={() =>
              createBackup.mutate(
                { machineId },
                {
                  onSuccess: () => toast.success("Snapshot started"),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            {createBackup.isPending ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
            Snapshot
          </Button>
        </div>
      </div>

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
            <p className="text-sm text-muted-foreground">No snapshots yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {backups.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{b.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {timeAgo(b.created)}{b.size > 0 && ` · ${b.size.toFixed(1)} GB`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {b.status === "creating" ? (
                    <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-600 dark:text-blue-400 gap-1">
                      <Loader2 className="size-2.5 animate-spin" />
                      Creating
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        ["available", "ready"].includes(b.status) ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "",
                      )}
                    >
                      {b.status}
                    </Badge>
                  )}
                  {["available", "ready"].includes(b.status) && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={restoreBackup.isPending}
                        title="Restore snapshot"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Restore snapshot",
                            description: `This will restore the machine from "${b.description}". Current state will be replaced and the machine will restart.`,
                            confirmLabel: "Restore snapshot",
                            variant: "destructive",
                          });
                          if (!ok) return;
                          restoreBackup.mutate(
                            { machineId, backupId: b.id },
                            {
                              onSuccess: () => toast.success("Snapshot restore started"),
                              onError: (err) => toast.error(err.message),
                            },
                          );
                        }}
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        disabled={deleteBackup.isPending}
                        title="Delete snapshot"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Delete snapshot",
                            description: `Delete "${b.description}"? This cannot be undone.`,
                            confirmLabel: "Delete snapshot",
                            variant: "destructive",
                          });
                          if (!ok) return;
                          deleteBackup.mutate(
                            { machineId, backupId: b.id },
                            {
                              onSuccess: () => toast.success("Snapshot deleted"),
                              onError: (err) => toast.error(err.message),
                            },
                          );
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PORT FORWARD CARD
   ═══════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════
   SSH CONNECT PANEL
   ═══════════════════════════════════════════════════════════════════════ */
function SshConnectPanel({ machine }: { machine: Machine }) {
  const [showKey, setShowKey] = useState(false);
  const sshHost = machine.ssh_host;
  const sshPort = machine.ssh_port;
  const sshCommand = machine.connect?.ssh_command ?? machine.ssh ?? null;
  const setupCommand = machine.ssh_setup_command ?? machine.ssh_key?.setup_command ?? null;
  const sshConfigBlock = machine.ssh_config_block ?? null;
  const privateKey = machine.ssh_key?.private_key ?? null;

  if (!sshHost || !sshPort) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <KeyRound className="mx-auto size-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground">SSH not available yet</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          The host port-forward will appear once provisioning completes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Endpoint summary */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b">
          <Globe className="size-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">SSH endpoint</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
          <div className="px-4 py-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">SSH gateway</p>
            <p className="text-sm font-mono">{sshHost}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Port</p>
            <p className="text-sm font-mono">{sshPort}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">User</p>
            <p className="text-sm font-mono">root</p>
          </div>
        </div>
      </div>

      {/* One-line connect (private key inline) */}
      {setupCommand && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b bg-muted/30">
            <span className="size-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
            <span className="text-sm font-medium">Connect now</span>
            <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400 gap-1">
              <KeyRound className="size-2.5" />
              Contains private key
            </Badge>
          </div>
          <div className="p-4 space-y-2.5">
            <p className="text-xs text-muted-foreground">
              Paste this in your terminal — it saves your key to <code className="text-foreground font-mono">~/.ssh/justavps_{machine.slug}</code> and opens the SSH session immediately.
            </p>
            <CodeBlock text={setupCommand} label="Setup command" variant="green" />
          </div>
        </div>
      )}

      {/* Reconnect later */}
      {sshCommand && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b bg-muted/30">
            <span className="size-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
            <span className="text-sm font-medium">Reconnect later</span>
          </div>
          <div className="p-4 space-y-2.5">
            <p className="text-xs text-muted-foreground">
              Once the key is saved, reconnect any time:
            </p>
            <CodeBlock text={sshCommand} label="SSH command" />
          </div>
        </div>
      )}

      {/* Add to ~/.ssh/config (Cursor/VS Code Remote-SSH) */}
      {sshConfigBlock && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b bg-muted/30">
            <span className="size-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
            <Monitor className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Cursor / VS Code Remote-SSH</span>
            <Badge className="ml-auto text-[10px] font-normal bg-primary/10 text-primary border-primary/20 h-4 px-1.5">
              Recommended
            </Badge>
          </div>
          <div className="p-4 space-y-2.5">
            <p className="text-xs text-muted-foreground">Append this block to <code className="text-foreground font-mono">~/.ssh/config</code>:</p>
            <CodeBlock text={sshConfigBlock} label="SSH config" />
            <p className="text-xs text-muted-foreground">
              Then{" "}
              <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] border font-mono">Cmd+Shift+P</kbd>
              {" → "}Remote-SSH: Connect to Host{" → "}
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">{machine.slug}</code>
            </p>
          </div>
        </div>
      )}

      {/* Raw private key (collapsed by default) */}
      {privateKey && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <button
            onClick={() => setShowKey((v) => !v)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b bg-muted/30 hover:bg-muted/50 transition-colors text-left"
          >
            <KeyRound className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Raw private key</span>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {showKey ? "Hide" : "Reveal"}
            </span>
          </button>
          {showKey && (
            <div className="p-4">
              <CodeBlock text={privateKey} label="Private key" />
            </div>
          )}
        </div>
      )}
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
  const [imageName, setImageName] = useState("");
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm();
  const { data: machine, isLoading, error } = useMachine(machineId);
  const deleteMachine = useDeleteMachine();
  const rebootMachine = useRebootMachine();
  const stopMachine = useStopMachine();
  const startMachine = useStartMachine();
  const reactivateMachine = useReactivateMachine();
  const createImage = useCreateImage();

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
        <Button variant="outline" size="sm" onClick={() => router.push("/v2/machines")}>
          <ArrowLeft className="size-3.5" />
          Back to Machines
        </Button>
      </div>
    );

  const statusInfo = statusMap[machine.status] || statusMap.provisioning;
  const isReady = machine.status === "ready";
  const canCreateSnapshot = machine.capabilities?.can_create_image ?? isReady;
  const uptime = machine.ready_at ? timeAgo(machine.ready_at) : null;
  const provisioning = provisioningInfo(machine);

  // V2 resources from the API
  const vcpu = machine.vcpu ?? 0;
  const ramGb = machine.ram_gb ?? 0;
  const diskGb = machine.disk_gb ?? 0;
  const resourceLabel = `${vcpu} vCPU · ${ramGb} GB RAM · ${diskGb} GB SSD`;

  /* Health values — daemon sends 0–1 fractions, normalise to 0–100 here */
  const cpuPct = machine.health ? Math.round(machine.health.cpu * 100) : 0;
  const memPct = machine.health ? Math.round(machine.health.memory * 100) : 0;
  const diskPct = machine.health ? Math.round(machine.health.disk * 100) : 0;
  const memUsedGb = ramGb ? ((memPct / 100) * ramGb).toFixed(1) : null;
  const diskUsedGb = diskGb ? ((diskPct / 100) * diskGb).toFixed(0) : null;
  const cpuColor = cpuPct > 80 ? "text-red-500" : cpuPct > 60 ? "text-yellow-500" : "text-foreground";
  const memColor = memPct > 80 ? "text-red-500" : memPct > 60 ? "text-yellow-500" : "text-foreground";
  const diskColor = diskPct > 80 ? "text-red-500" : diskPct > 60 ? "text-yellow-500" : "text-foreground";

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

  return (
    <div className="max-w-5xl mx-auto pb-20 space-y-5 min-w-0 w-full">

      {/* ═══ HEADER ═══════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Link
            href="/v2/machines"
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
                className={cn("gap-1.5 text-[11px] font-medium h-5 px-2 shrink-0", statusInfo.badgeClass)}
              >
                <span className={cn("size-1.5 rounded-full", statusInfo.dotClass)} />
                {statusInfo.label}
              </Badge>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-semibold tracking-wide shrink-0">
                V2
              </Badge>
              {machine.subscription?.cancel_at_period_end && (
                <Badge variant="outline" className="gap-1 text-[11px] font-medium h-5 px-2 shrink-0 bg-destructive/10 text-destructive border-destructive/20">
                  <CalendarX2 className="size-2.5" />
                  Cancelling
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="font-mono">{machine.slug}</span>
              <span className="opacity-30">·</span>
              <span className="font-mono">{resourceLabel}</span>
              <span className="opacity-30">·</span>
              <span>{regionDisplay(machine.region).label}</span>
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
          {isReady && (
            <>
              {canCreateSnapshot && (
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateImageOpen(true)}>
                  <Camera className="size-3.5" />
                  Snapshot
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleReboot} disabled={rebootMachine.isPending}>
                {rebootMachine.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                Reboot
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleStop} disabled={stopMachine.isPending}>
                {stopMachine.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PowerOff className="size-3.5" />}
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
              {startMachine.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
              Start
            </Button>
          )}
          {machine.subscription?.cancel_at_period_end && (
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
              {reactivateMachine.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
              Reactivate
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 text-red-600 hover:text-red-600 hover:bg-red-500/10 border-red-500/30"
            onClick={async () => {
              const ok = await confirmDelete({
                title: "Delete Machine",
                description: "This will permanently destroy the VM and cancel any active subscription. This cannot be undone.",
                confirmLabel: "Delete Machine",
                variant: "destructive",
              });
              if (!ok) return;
              deleteMachine.mutate(machineId, {
                onSuccess: () => {
                  toast.success("Machine deleted");
                  router.push("/v2/machines");
                },
                onError: (err) => toast.error(err.message),
              });
            }}
            disabled={deleteMachine.isPending}
          >
            {deleteMachine.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete
          </Button>
        </div>
      </div>

      {/* ═══ CANCELLATION BANNER ════════════════════════════════════════ */}
      {machine.subscription?.cancel_at_period_end && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="rounded-lg bg-destructive/10 p-1.5 shrink-0 mt-0.5">
            <CalendarX2 className="size-4 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">Subscription cancelled</p>
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
          </div>
        </div>
      )}

      {/* ═══ PROVISIONING BANNER ════════════════════════════════════════ */}
      {machine.status === "provisioning" && (
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-yellow-500/10 p-2 shrink-0">
              <Loader2 className="size-4 animate-spin text-yellow-500" />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{provisioning.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    First boot takes about 60–90 seconds.
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {provisioning.pct}%
                </span>
              </div>
              <Progress value={provisioning.pct} className="h-1.5" />
            </div>
          </div>
        </div>
      )}

      {/* ═══ ERROR BANNER ════════════════════════════════════════════════ */}
      {machine.status === "error" && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-red-500/10 p-1.5 shrink-0 mt-0.5">
              <AlertTriangle className="size-4 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                Provisioning failed
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Something interrupted setup before the machine became ready. Try deleting it and creating a new one.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TABS (only if ready) ════════════════════════════════════════ */}
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
              Snapshots
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5 text-xs h-7">
              <Code2 className="size-3.5" />
              API
            </TabsTrigger>
          </TabsList>

          {/* ── CONNECT ───────────────────────────────────────────────── */}
          <TabsContent value="connect" className="mt-0 min-w-0">
            <SshConnectPanel machine={machine} />
          </TabsContent>

          {/* ── TERMINAL ──────────────────────────────────────────────── */}
          <TabsContent value="terminal" className="mt-0">
            <Terminal
              machineSlug={machine.slug}
              machineStatus={machine.status}
              machineIp={null}
              terminalUrl={machine.urls?.terminal ?? null}
            />
          </TabsContent>

          {/* ── PROXY ─────────────────────────────────────────────────── */}
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
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">Root URL — port 80 by default</p>
                      <CodeBlock text={proxyUrl} label="URL" />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border/60" />
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Link2 className="size-3" /> Port forwarding
                      </span>
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                    <PortForwardCard slug={machine.slug} portTemplate={portTemplate} />
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border/60" />
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Share2 className="size-3" /> Share access
                      </span>
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                    <ProxyTokenManager machineId={machine.id} machineSlug={machine.slug} compact />
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
                    <HealthRow icon={Cpu} label="CPU" subtitle={vcpu ? `${vcpu} vCPU` : undefined} value={`${cpuPct}%`} progress={cpuPct} colorClass={cpuColor} />
                    <HealthRow icon={MemoryStick} label="Memory" subtitle={ramGb ? `of ${ramGb} GB` : undefined} value={memUsedGb ? `${memUsedGb} GB` : `${memPct}%`} progress={memPct} colorClass={memColor} />
                    <HealthRow icon={HardDrive} label="Disk" subtitle={diskGb ? `of ${diskGb} GB` : undefined} value={diskUsedGb ? `${diskUsedGb} GB` : `${diskPct}%`} progress={diskPct} colorClass={diskColor} />
                  </div>
                  <div className="pt-2 border-t space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><Server className="size-3.5" /><span>Resources</span></div>
                      <span className="font-medium">{resourceLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3.5" /><span>Region</span></div>
                      <span className="font-medium">{regionDisplay(machine.region).label}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground"><Server className="size-3.5" /><span>Resources</span></div>
                    <span className="font-medium">{resourceLabel}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3.5" /><span>Region</span></div>
                    <span className="font-medium">{regionDisplay(machine.region).label}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground"><DollarSign className="size-3.5" /><span>Cost</span></div>
                    <span className="font-medium">${machine.price_monthly ?? 0}/mo</span>
                  </div>
                  <p className="text-xs text-muted-foreground pt-1">Live CPU, memory and disk metrics appear once the machine reports health data.</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── BACKUPS ───────────────────────────────────────────────── */}
          <TabsContent value="backups" className="mt-0">
            <BackupsPanel machineId={machine.id} machine={machine} />
          </TabsContent>

          {/* ── API ───────────────────────────────────────────────────── */}
          <TabsContent value="api" className="mt-0 space-y-3">
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <Server className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">Machine ID</span>
              </div>
              <div className="p-4">
                <CodeBlock text={machine.id} label="Machine ID" />
              </div>
            </div>
            <div className="rounded-xl border bg-card divide-y">
              <Link href="/keys" className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <KeyRound className="size-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Generate API Key</p>
                    <p className="text-xs text-muted-foreground">Create scoped API keys with machine restrictions, permissions, and expiry</p>
                  </div>
                </div>
                <ExternalLink className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
              </Link>
              <Link href="/api/docs/v2" className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors group">
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
        /* ── NOT READY (provisioning) ───────────────────────────────────── */
        <div className="rounded-xl border border-dashed">
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="rounded-2xl bg-muted p-4 mb-4">
              <Loader2 className="size-8 text-muted-foreground/40 animate-spin" strokeWidth={1.5} />
            </div>
            <h3 className="text-sm font-medium mb-1">{provisioning.label}</h3>
            <p className="text-xs text-muted-foreground max-w-xs">
              Terminal, SSH, and tools appear once the machine becomes ready. First boot takes about 60–90 seconds.
            </p>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog />

      <Dialog open={createImageOpen} onOpenChange={setCreateImageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Image</DialogTitle>
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
            <Button onClick={handleCreateImage} disabled={createImage.isPending || !imageName.trim()}>
              {createImage.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Image"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
