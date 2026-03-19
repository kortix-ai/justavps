"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useMachine, useDeleteMachine, useRebootMachine, useBackups, useCreateBackup, useToggleBackups } from "@/hooks/use-machines";
import { useCreateImage } from "@/hooks/use-images";
import { useConfirm } from "@/hooks/use-confirm";
import {
  ArrowLeft, RotateCw, Trash2, Copy, Check, ArrowUp,
  Cpu, MemoryStick, HardDrive, Clock, DollarSign,
  Globe, Server, Loader2, ExternalLink, Code2,
  Terminal as TerminalIcon, Link2,
  AlertTriangle, Camera, Monitor, Archive
} from "lucide-react";
import { RescaleDialog } from "@/components/dashboard/rescale-dialog";
import Link from "next/link";
import { timeAgo, cn } from "@/lib/utils";

const Terminal = dynamic(() => import("@/components/dashboard/terminal"), {
  ssr: false,
  loading: () => <div className="h-[500px] bg-[#09090b] rounded-xl" />,
});

const statusMap: Record<string, { label: string; dotClass: string }> = {
  provisioning: { label: "Provisioning", dotClass: "bg-yellow-500 animate-pulse" },
  ready: { label: "Running", dotClass: "bg-green-500" },
  error: { label: "Error", dotClass: "bg-red-500" },
  stopped: { label: "Stopped", dotClass: "bg-muted-foreground" },
};

/** Click-to-copy code block */
function CodeBlock({ text, label, variant = "default" }: { text: string; label?: string; variant?: "default" | "green" }) {
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
      <pre className={cn(
        "p-3 rounded-lg text-xs font-mono border overflow-x-auto transition-colors",
        "bg-zinc-950 border-zinc-800 hover:border-zinc-700",
        variant === "green" ? "text-green-400" : "text-zinc-300",
      )}>{text}</pre>
      <div className={cn(
        "absolute top-2 right-2 flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-all",
        copied
          ? "bg-green-500/20 text-green-400 opacity-100"
          : "bg-zinc-800 text-zinc-400 opacity-0 group-hover:opacity-100"
      )}>
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </div>
    </div>
  );
}

/** Resource stat card for the stats strip */
function StatCard({ icon: Icon, label, value, suffix, color }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  suffix?: string;
  color?: string;
}) {
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className={cn("size-3.5", color || "text-muted-foreground")} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Resource stat with progress bar */
function ResourceStatCard({ icon: Icon, label, value }: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  const color = value > 80 ? "text-red-500" : value > 60 ? "text-yellow-500" : "text-emerald-500";
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-baseline gap-1 mb-2">
          <span className={cn("text-xl font-semibold tabular-nums tracking-tight", color)}>{Math.round(value)}</span>
          <span className="text-xs text-muted-foreground">%</span>
        </div>
        <Progress value={value} className="h-1" />
      </CardContent>
    </Card>
  );
}

function BackupsPanel({ machineId }: { machineId: string }) {
  const { data, isLoading } = useBackups(machineId);
  const createBackup = useCreateBackup();
  const toggleBackups = useToggleBackups();

  const backups = data?.backups ?? [];
  const enabled = data?.backups_enabled ?? false;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Automatic Backups</CardTitle>
            <Button
              variant={enabled ? "outline" : "default"}
              size="sm"
              className="h-7 text-xs"
              disabled={toggleBackups.isPending}
              onClick={() => toggleBackups.mutate({ machineId, enable: !enabled }, {
                onSuccess: () => toast.success(enabled ? "Backups disabled" : "Backups enabled"),
                onError: (err) => toast.error(err.message),
              })}
            >
              {toggleBackups.isPending ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
              {enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Daily backups enabled. Up to 7 kept."
              : "Enable for daily snapshots (20% of server price)."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Manual Backups</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              disabled={createBackup.isPending}
              onClick={() => createBackup.mutate({ machineId }, {
                onSuccess: () => toast.success("Backup started"),
                onError: (err) => toast.error(err.message),
              })}
            >
              {createBackup.isPending ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
              Run Now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : backups.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">No backups yet.</p>
          ) : (
            <div className="space-y-1.5">
              {backups.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{b.description}</p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(b.created)}{b.size > 0 && ` · ${b.size.toFixed(1)} GB`}</p>
                  </div>
                  <Badge variant="outline" className={cn("text-[10px] shrink-0", b.status === "available" ? "border-green-500/30 text-green-600 dark:text-green-400" : "")}>
                    {b.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProxyPortCard({ slug }: { slug: string }) {
  const [port, setPort] = useState("");
  const url = port ? `https://${port}--${slug}.kortix.cloud` : "";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Port Forwarding</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Port (e.g. 3000)"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-40 font-mono text-sm"
            min={1}
            max={65535}
          />
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              <ExternalLink className="size-3.5" /> Open
            </a>
          )}
        </div>
        {url && <CodeBlock text={url} label="Port URL" />}
        <p className="text-xs text-muted-foreground">
          Format: <code className="bg-muted px-1 rounded">{`{port}--${slug}.kortix.cloud`}</code>
        </p>
      </CardContent>
    </Card>
  );
}

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
        onSuccess: () => { toast.success("Image creation started"); setCreateImageOpen(false); setImageName(""); },
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
      onSuccess: () => { toast.success("Machine deleted"); router.push("/machines"); },
      onError: (err) => toast.error(err.message),
    });
  };

  if (isLoading) return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-[500px] rounded-xl" />
    </div>
  );

  if (error || !machine) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
      <div className="bg-destructive/10 p-4 rounded-full mb-4"><AlertTriangle className="size-8 text-destructive" /></div>
      <h2 className="font-heading text-2xl mb-2">Machine Not Found</h2>
      <p className="text-muted-foreground mb-6 max-w-md">{error?.message || "The machine you are looking for does not exist or has been deleted."}</p>
      <Button variant="outline" onClick={() => router.push("/machines")}><ArrowLeft className="mr-2 size-4" />Back to Machines</Button>
    </div>
  );

  const statusInfo = statusMap[machine.status] || statusMap.stopped;
  const isReady = machine.status === "ready";
  const uptime = machine.ready_at ? timeAgo(machine.ready_at) : null;
  const sshKeyPath = `~/.ssh/justavps_${machine.slug}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com';

  return (
    <div className="space-y-5 max-w-5xl mx-auto p-4 md:p-6 pb-20">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/machines" className="text-muted-foreground hover:text-foreground transition-colors p-1.5 hover:bg-muted rounded-lg -ml-1.5">
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-heading text-xl md:text-2xl tracking-tight">{machine.name || machine.slug}</h1>
              <Badge variant="outline" className="gap-1.5 px-2 py-0.5 h-5 text-[11px]">
                <div className={`size-1.5 rounded-full ${statusInfo.dotClass}`} />
                {statusInfo.label}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <span className="font-mono">{machine.slug}</span>
              <span className="opacity-40">·</span>
              <span>{machine.region.toUpperCase()}</span>
              {machine.ip && <><span className="opacity-40">·</span><span className="font-mono">{machine.ip}</span></>}
              <span className="opacity-40">·</span>
              <span className="font-mono">{machine.server_type}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isReady && (
            <>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setRescaleOpen(true)}>
                <ArrowUp className="size-3.5" />
                Scale Up
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateImageOpen(true)}>
                <Camera className="size-3.5" />
                Snapshot
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleReboot} disabled={!isReady || rebootMachine.isPending}>
            {rebootMachine.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
            Reboot
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20" onClick={handleDelete}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* ── Provisioning Banner ────────────────────────────────────────── */}
      {machine.status === "provisioning" && (
        <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-3">
          <Loader2 className="size-4 animate-spin text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-600 dark:text-yellow-400">
            {machine.provisioning_stage === "resizing"
              ? "Scaling — stops, resizes, and restarts (~60-90s). Page updates automatically."
              : "Provisioning (~60s). Page updates automatically."}
          </p>
        </div>
      )}

      {/* ── Stats Strip ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {machine.health ? (
          <>
            <ResourceStatCard icon={Cpu} label="CPU" value={machine.health.cpu} />
            <ResourceStatCard icon={MemoryStick} label="Memory" value={machine.health.memory} />
            <ResourceStatCard icon={HardDrive} label="Disk" value={machine.health.disk} />
          </>
        ) : (
          <>
            <StatCard icon={Globe} label="Region" value={machine.region.toUpperCase()} />
            <StatCard icon={Server} label="Type" value={machine.server_type} />
            <StatCard icon={HardDrive} label="IP" value={machine.ip || "—"} />
          </>
        )}
        <StatCard
          icon={DollarSign}
          label="Price"
          value={`$${machine.price_monthly ?? 0}`}
          suffix={`/mo${uptime ? ` · up ${uptime}` : ""}`}
        />
      </div>

      {/* ── Full-Width Tabs ────────────────────────────────────────────── */}
      {isReady ? (
        <Tabs defaultValue="connect" className="space-y-4">
          <TabsList>
            <TabsTrigger value="connect" className="gap-1.5 text-xs">
              <Link2 className="size-3.5" />
              Connect
            </TabsTrigger>
            <TabsTrigger value="terminal" className="gap-1.5 text-xs">
              <TerminalIcon className="size-3.5" />
              Terminal
            </TabsTrigger>
            <TabsTrigger value="proxy" className="gap-1.5 text-xs">
              <Globe className="size-3.5" />
              Proxy
            </TabsTrigger>
            <TabsTrigger value="backups" className="gap-1.5 text-xs">
              <Archive className="size-3.5" />
              Backups
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5 text-xs">
              <Code2 className="size-3.5" />
              API
            </TabsTrigger>
          </TabsList>

          {/* ── Connect ──────────────────────────────────────── */}
          <TabsContent value="connect" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Quick Connect */}
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Quick Connect</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">Save the SSH key and connect in one command:</p>
                  {machine.ssh_key?.setup_command && (
                    <CodeBlock text={machine.ssh_key.setup_command} label="Setup command" variant="green" />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Reconnect: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">ssh -i {sshKeyPath} root@{machine.ip}</code>
                  </p>
                </CardContent>
              </Card>

              {/* Cursor / VS Code */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Monitor className="size-3.5 text-muted-foreground" />
                      Cursor / VS Code
                    </CardTitle>
                    <Badge className="text-[10px] font-normal bg-primary/10 text-primary border-primary/20 h-4 px-1.5">Recommended</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <p className="text-xs font-medium">1. Add to SSH config</p>
                    <CodeBlock
                      text={`grep -q "Host ${machine.slug}" ~/.ssh/config 2>/dev/null || printf '\\nHost ${machine.slug}\\n  HostName ${machine.ip}\\n  User root\\n  IdentityFile ${sshKeyPath}\\n  StrictHostKeyChecking no\\n' >> ~/.ssh/config`}
                      label="SSH config command"
                      variant="green"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium">2. Connect</p>
                    <p className="text-xs text-muted-foreground">
                      <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] border">Cmd+Shift+P</kbd> → Remote-SSH: Connect to Host → <code className="bg-muted px-1 rounded">{machine.slug}</code>
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    Port forwarding is automatic — <code className="bg-muted px-1 rounded">localhost:3000</code> works locally.
                  </p>
                </CardContent>
              </Card>

              {/* Plain SSH + AI Agent */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TerminalIcon className="size-3.5 text-muted-foreground" />
                    Plain SSH
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CodeBlock text={`ssh -i ${sshKeyPath} root@${machine.ip}`} label="SSH command" />

                  <details className="group">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                      AI agent prompt
                    </summary>
                    <div className="mt-2">
                      <CodeBlock
                        text={`Set up SSH access to my remote VPS and connect via Remote-SSH.\n\n1. Save the SSH key:\n${machine.ssh_key?.setup_command?.split('&&').slice(0, 2).join('&&').trim() ?? ''}\n\n2. Add to ~/.ssh/config:\nHost ${machine.slug}\n  HostName ${machine.ip}\n  User root\n  IdentityFile ${sshKeyPath}\n  StrictHostKeyChecking no\n\n3. Connect via Remote-SSH to host "${machine.slug}"`}
                        label="AI agent prompt"
                      />
                    </div>
                  </details>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Terminal ─────────────────────────────────────── */}
          <TabsContent value="terminal" className="mt-0">
            <Terminal machineId={machine.id} machineIp={machine.ip} machineSlug={machine.slug} machineStatus={machine.status} ptyUrl={machine.urls?.pty ?? null} />
          </TabsContent>

          {/* ── Proxy ────────────────────────────────────────── */}
          <TabsContent value="proxy" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Web Access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CodeBlock text={`https://${machine.slug}.kortix.cloud`} label="URL" />
                  <a href={`https://${machine.slug}.kortix.cloud`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <ExternalLink className="size-3" /> Open in browser
                  </a>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">API Access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">Authenticate with your API key:</p>
                  <CodeBlock text={`curl https://${machine.slug}.kortix.cloud \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" />
                </CardContent>
              </Card>

              <div className="md:col-span-2">
                <ProxyPortCard slug={machine.slug} />
              </div>
            </div>
          </TabsContent>

          {/* ── Backups ──────────────────────────────────────── */}
          <TabsContent value="backups" className="mt-0">
            <BackupsPanel machineId={machine.id} />
          </TabsContent>

          {/* ── API ──────────────────────────────────────────── */}
          <TabsContent value="api" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Machine ID</CardTitle>
                </CardHeader>
                <CardContent>
                  <CodeBlock text={machine.id} label="Machine ID" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Resources</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Link href="/keys" className="flex items-center gap-2 text-xs text-primary hover:underline">
                    <Code2 className="size-3" /> Generate API Key
                  </Link>
                  <Link href="/api/docs" className="flex items-center gap-2 text-xs text-primary hover:underline">
                    <ExternalLink className="size-3" /> API Reference
                  </Link>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Examples</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Get machine</p>
                      <CodeBlock text={`curl ${appUrl}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Reboot</p>
                      <CodeBlock text={`curl -X POST ${appUrl}/api/v1/machines/${machine.id}/reboot \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Delete</p>
                      <CodeBlock text={`curl -X DELETE ${appUrl}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-4 bg-muted rounded-full mb-4"><Server className="size-8 text-muted-foreground" /></div>
            <h3 className="text-lg font-medium">Machine is not ready</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-2">
              Connection details will appear once the machine is running.
            </p>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog />

      {machine && (
        <RescaleDialog open={rescaleOpen} onOpenChange={setRescaleOpen} machine={machine} />
      )}

      <Dialog open={createImageOpen} onOpenChange={setCreateImageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Create Snapshot</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="image-name">Name</Label>
              <Input id="image-name" placeholder="my-dev-environment" value={imageName} onChange={(e) => setImageName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateImage(); }} />
              <p className="text-xs text-muted-foreground">Saves the current state as a reusable image.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateImageOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateImage} disabled={createImage.isPending || !imageName.trim()}>
              {createImage.isPending ? <><Loader2 className="size-4 animate-spin mr-2" />Creating...</> : "Create Snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
