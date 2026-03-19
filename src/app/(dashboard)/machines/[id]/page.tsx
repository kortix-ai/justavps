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
  Cpu, MemoryStick, HardDrive, Clock,
  Globe, Server, Loader2, ExternalLink, Code2,
  Terminal as TerminalIcon, Link2,
  AlertTriangle, Camera, Shield, Monitor, Archive
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

/** Clipboard copy with visual feedback */
function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      className={cn("h-7 px-2 text-xs gap-1.5 shrink-0", className)}
      onClick={() => {
        navigator.clipboard.writeText(text);
        toast.success(`${label} copied`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function BackupsPanel({ machineId }: { machineId: string }) {
  const { data, isLoading } = useBackups(machineId);
  const createBackup = useCreateBackup();
  const toggleBackups = useToggleBackups();

  const backups = data?.backups ?? [];
  const enabled = data?.backups_enabled ?? false;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Automatic Backups</CardTitle>
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
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "Automatic daily backups are enabled. Up to 7 backups are kept — oldest is replaced when full."
              : "Automatic backups are disabled. Enable to get daily snapshots of your machine (costs 20% of server price)."
            }
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Backups</CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              disabled={createBackup.isPending}
              onClick={() => createBackup.mutate({ machineId }, {
                onSuccess: () => toast.success("Backup started — this may take a few minutes"),
                onError: (err) => toast.error(err.message),
              })}
            >
              {createBackup.isPending ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
              Run Manual Backup
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No backups yet. {!enabled && "Enable automatic backups or run a manual backup."}</p>
          ) : (
            <div className="space-y-2">
              {backups.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.description}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(b.created)} · {b.size > 0 ? `${b.size.toFixed(1)} GB` : "calculating..."}</p>
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
    </>
  );
}

function ProxyPortCard({ slug }: { slug: string }) {
  const [port, setPort] = useState("");
  const url = port ? `https://${port}--${slug}.kortix.cloud` : "";
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Port Forwarding</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Access any port on your machine via subdomain:
        </p>
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
              className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted", "border-zinc-200 dark:border-zinc-800")}
            >
              <ExternalLink className="size-3.5" /> Open
            </a>
          )}
        </div>
        {url && (
          <div className="relative group">
            <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-xs font-mono border border-zinc-800">{url}</pre>
            <CopyButton text={url} label="Port URL" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
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
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-24" /></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6"><Skeleton className="h-[500px] rounded-xl" /></div>
        <div className="space-y-6"><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-48 rounded-xl" /></div>
      </div>
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/machines" className="text-muted-foreground hover:text-foreground transition-colors p-2 hover:bg-muted rounded-full -ml-2">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-heading text-2xl md:text-3xl tracking-tight">{machine.name || machine.slug}</h1>
              <Badge variant="outline" className="gap-1.5 px-2.5 py-0.5 h-6">
                <div className={`size-2 rounded-full ${statusInfo.dotClass}`} />
                {statusInfo.label}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
              <span className="font-mono">{machine.slug}</span>
              <span>•</span>
              <span>{machine.region.toUpperCase()}</span>
              {machine.ip && <><span>•</span><span className="font-mono">{machine.ip}</span></>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isReady && (
            <>
              <Button variant="outline" onClick={() => setRescaleOpen(true)} title="Scale Up">
                <ArrowUp className="size-4" />
                <span className="sr-only sm:not-sr-only sm:ml-2">Scale Up</span>
              </Button>
              <Button variant="outline" onClick={() => setCreateImageOpen(true)} title="Create Image">
                <Camera className="size-4" />
                <span className="sr-only sm:not-sr-only sm:ml-2">Image</span>
              </Button>
            </>
          )}
          <Button variant="outline" onClick={handleReboot} disabled={!isReady || rebootMachine.isPending} title="Reboot">
            {rebootMachine.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            <span className="sr-only sm:not-sr-only sm:ml-2">Reboot</span>
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20" onClick={handleDelete} title="Delete">
            <Trash2 className="size-4" />
            <span className="sr-only sm:not-sr-only sm:ml-2">Delete</span>
          </Button>
        </div>
      </div>

      {/* Provisioning / Resizing Banner */}
      {machine.status === "provisioning" && (
        <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
          <div className="p-2 bg-yellow-500/20 rounded-full"><Loader2 className="size-5 animate-spin text-yellow-500" /></div>
          <div>
            {machine.provisioning_stage === "resizing" ? (
              <>
                <h3 className="font-medium text-yellow-500">Scaling up your machine</h3>
                <p className="text-sm text-yellow-500/80">The machine is being stopped, resized, and restarted. This takes ~60-90 seconds. The page will update automatically.</p>
              </>
            ) : (
              <>
                <h3 className="font-medium text-yellow-500">Machine is provisioning</h3>
                <p className="text-sm text-yellow-500/80">This usually takes about 60 seconds. The page will update automatically.</p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {isReady ? (
            <Tabs defaultValue="connect" className="space-y-4">
              <TabsList>
                <TabsTrigger value="connect" className="gap-2">
                  <Link2 className="size-4" />
                  Connect
                </TabsTrigger>
                <TabsTrigger value="terminal" className="gap-2">
                  <TerminalIcon className="size-4" />
                  Terminal
                </TabsTrigger>
                <TabsTrigger value="proxy" className="gap-2">
                  <Globe className="size-4" />
                  Proxy
                </TabsTrigger>
                <TabsTrigger value="backups" className="gap-2">
                  <Archive className="size-4" />
                  Backups
                </TabsTrigger>
                <TabsTrigger value="api" className="gap-2">
                  <Code2 className="size-4" />
                  API
                </TabsTrigger>
              </TabsList>

              {/* ── Connect Tab ────────────────────────────────────── */}
              <TabsContent value="connect" className="space-y-4 mt-0">
                {/* Quick Connect — 1 command */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      Quick Connect
                      <Badge variant="secondary" className="text-[10px] font-normal">1 command</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Run this once to save the SSH key and connect instantly:
                    </p>
                    {machine.ssh_key?.setup_command && (
                      <div className="relative group flex items-center gap-2">
                        <div className="flex-1 min-w-0 bg-zinc-950 rounded-lg border border-zinc-800 px-4 py-3 overflow-hidden">
                          <pre className="text-green-400 text-xs font-mono whitespace-nowrap overflow-hidden text-ellipsis">{machine.ssh_key.setup_command}</pre>
                        </div>
                        <CopyButton text={machine.ssh_key.setup_command} label="Setup command" className="shrink-0" />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      After setup, reconnect anytime with: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">ssh -i {sshKeyPath} root@{machine.ip}</code>
                    </p>
                  </CardContent>
                </Card>

                {/* IDE Setup — Cursor / VS Code */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Monitor className="size-4 text-muted-foreground" />
                      Connect via Cursor / VS Code
                      <Badge className="text-[10px] font-normal bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">Recommended</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Remote SSH gives you a local-feeling dev experience with automatic port forwarding.
                    </p>

                    {/* 1-click add to SSH config */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Add to SSH config</p>
                      <p className="text-xs text-muted-foreground">Run this to add the host to your SSH config (safe to run multiple times):</p>
                      <div className="relative group">
                        <pre className="bg-zinc-950 text-green-400 p-3 rounded-lg text-xs font-mono leading-relaxed overflow-x-auto border border-zinc-800">{`grep -q "Host ${machine.slug}" ~/.ssh/config 2>/dev/null || printf '\\nHost ${machine.slug}\\n  HostName ${machine.ip}\\n  User root\\n  IdentityFile ${sshKeyPath}\\n  StrictHostKeyChecking no\\n' >> ~/.ssh/config`}</pre>
                        <CopyButton
                          text={`grep -q "Host ${machine.slug}" ~/.ssh/config 2>/dev/null || printf '\\nHost ${machine.slug}\\n  HostName ${machine.ip}\\n  User root\\n  IdentityFile ${sshKeyPath}\\n  StrictHostKeyChecking no\\n' >> ~/.ssh/config`}
                          label="SSH config command"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </div>
                    </div>

                    {/* Connect */}
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Then connect</p>
                      <p className="text-xs text-muted-foreground">
                        <kbd className="bg-muted px-1.5 py-0.5 rounded text-[11px] border">Cmd+Shift+P</kbd> → <strong>Remote-SSH: Connect to Host</strong> → select <code className="bg-muted px-1 rounded">{machine.slug}</code>
                      </p>
                    </div>

                    <div className="pt-3 border-t space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Port forwarding is automatic — start a server on port 3000 and open <code className="bg-muted px-1 rounded">localhost:3000</code> locally.
                      </p>

                      {/* AI Agent Prompt */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Or give this to your AI agent:</p>
                        <div className="relative group">
                          <pre className="bg-zinc-950 text-zinc-400 p-3 rounded-lg text-[11px] font-mono leading-relaxed overflow-x-auto border border-zinc-800 max-h-32">{`Set up SSH access to my remote VPS and connect via Remote-SSH.

1. Save the SSH key:
${machine.ssh_key?.setup_command?.split('&&').slice(0, 2).join('&&').trim()}

2. Add to ~/.ssh/config:
Host ${machine.slug}
  HostName ${machine.ip}
  User root
  IdentityFile ${sshKeyPath}
  StrictHostKeyChecking no

3. Connect via Remote-SSH to host "${machine.slug}"`}</pre>
                          <CopyButton
                            text={`Set up SSH access to my remote VPS and connect via Remote-SSH.\n\n1. Save the SSH key:\n${machine.ssh_key?.setup_command?.split('&&').slice(0, 2).join('&&').trim() ?? ''}\n\n2. Add to ~/.ssh/config:\nHost ${machine.slug}\n  HostName ${machine.ip}\n  User root\n  IdentityFile ${sshKeyPath}\n  StrictHostKeyChecking no\n\n3. Connect via Remote-SSH to host "${machine.slug}"`}
                            label="AI agent prompt"
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Plain Terminal SSH */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TerminalIcon className="size-4 text-muted-foreground" />
                      Plain SSH
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="relative group">
                      <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-sm font-mono border border-zinc-800">
                        {`ssh -i ${sshKeyPath} root@${machine.ip}`}
                      </pre>
                      <CopyButton
                        text={`ssh -i ${sshKeyPath} root@${machine.ip}`}
                        label="SSH command"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Web Terminal Tab ───────────────────────────────── */}
              <TabsContent value="terminal" className="mt-0">
                <Terminal machineId={machine.id} machineIp={machine.ip} machineSlug={machine.slug} machineStatus={machine.status} ptyUrl={machine.urls?.pty ?? null} />
              </TabsContent>

              {/* ── Proxy Tab ──────────────────────────────────────── */}
              <TabsContent value="proxy" className="space-y-4 mt-0">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Web Access</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Your machine is accessible at:
                    </p>
                    <div className="relative group">
                      <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-sm font-mono border border-zinc-800">
                        {`https://${machine.slug}.kortix.cloud`}
                      </pre>
                      <CopyButton text={`https://${machine.slug}.kortix.cloud`} label="URL" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <a href={`https://${machine.slug}.kortix.cloud`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                      <ExternalLink className="size-3" /> Open in browser
                    </a>
                  </CardContent>
                </Card>

                <ProxyPortCard slug={machine.slug} />

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Authentication</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">Two ways to access your machine through the proxy:</p>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</div>
                        <div className="space-y-1 min-w-0">
                          <p className="text-sm font-medium">Browser — automatic</p>
                          <p className="text-xs text-muted-foreground">Log in to justavps.com, then visit any <code className="bg-muted px-1 rounded">.kortix.cloud</code> URL. Auth is handled via session cookie.</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</div>
                        <div className="space-y-1 min-w-0 flex-1">
                          <p className="text-sm font-medium">API key — programmatic</p>
                          <p className="text-xs text-muted-foreground">Pass your API key in the <code className="bg-muted px-1 rounded">Authorization</code> header:</p>
                          <div className="relative group">
                            <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-xs font-mono border border-zinc-800">{`curl https://${machine.slug}.kortix.cloud \\\n  -H "Authorization: Bearer sk_live_xxx"`}</pre>
                            <CopyButton text={`curl https://${machine.slug}.kortix.cloud \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Backups Tab ──────────────────────────────────────── */}
              <TabsContent value="backups" className="space-y-4 mt-0">
                <BackupsPanel machineId={machine.id} />
              </TabsContent>

              {/* ── API Tab ────────────────────────────────────────── */}
              <TabsContent value="api" className="space-y-4 mt-0">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Machine ID</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="relative group">
                      <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-sm font-mono border border-zinc-800">{machine.id}</pre>
                      <CopyButton text={machine.id} label="Machine ID" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Quick Examples</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Get this machine</p>
                      <div className="relative group">
                        <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-xs font-mono border border-zinc-800 overflow-x-auto">{`curl ${process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com'}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`}</pre>
                        <CopyButton text={`curl ${process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com'}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Reboot</p>
                      <div className="relative group">
                        <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-xs font-mono border border-zinc-800 overflow-x-auto">{`curl -X POST ${process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com'}/api/v1/machines/${machine.id}/reboot \\\n  -H "Authorization: Bearer sk_live_xxx"`}</pre>
                        <CopyButton text={`curl -X POST ${process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com'}/api/v1/machines/${machine.id}/reboot \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Delete</p>
                      <div className="relative group">
                        <pre className="bg-zinc-950 text-zinc-300 p-3 rounded-lg text-xs font-mono border border-zinc-800 overflow-x-auto">{`curl -X DELETE ${process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com'}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`}</pre>
                        <CopyButton text={`curl -X DELETE ${process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com'}/api/v1/machines/${machine.id} \\\n  -H "Authorization: Bearer sk_live_xxx"`} label="curl" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Resources</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Link href="/keys" className="flex items-center gap-2 text-sm text-primary hover:underline">
                      <Code2 className="size-3.5" /> Generate API Key
                    </Link>
                    <Link href="/api/docs" className="flex items-center gap-2 text-sm text-primary hover:underline">
                      <ExternalLink className="size-3.5" /> Full API Reference
                    </Link>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <div className="p-4 bg-muted rounded-full mb-4"><Server className="size-8 text-muted-foreground" /></div>
                <h3 className="text-lg font-medium">Machine is not ready</h3>
                <p className="text-sm text-muted-foreground max-w-sm mt-2">
                  The terminal and connection details will be available once the machine is running.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Machine Info */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Machine Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="flex items-center gap-2">
                    <div className={`size-2 rounded-full ${statusInfo.dotClass}`} />
                    <span className="font-medium text-sm">{statusInfo.label}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Uptime</div>
                  <div className="font-medium text-sm">{uptime || "—"}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Region</div>
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <Globe className="size-3 text-muted-foreground" />{machine.region.toUpperCase()}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Type</div>
                  <div className="font-medium text-sm">{machine.server_type}</div>
                </div>
              </div>
              <div className="pt-4 border-t space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IP</span>
                  <code className="font-mono bg-muted/50 px-2 py-0.5 rounded text-xs">{machine.ip || "Assigning..."}</code>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Backups</span>
                  <Badge variant="outline" className={cn("gap-1 py-0.5 text-xs", machine.backups_enabled ? "border-green-500/30 text-green-600 dark:text-green-400" : "")}>
                    <Shield className="size-3" />
                    {machine.backups_enabled ? "Enabled" : "Off"}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-medium">${machine.price_monthly}/mo</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resources */}
          {machine.health && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Resources</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {[
                  { label: "CPU", value: machine.health.cpu, icon: Cpu },
                  { label: "Memory", value: machine.health.memory, icon: MemoryStick },
                  { label: "Disk", value: machine.health.disk, icon: HardDrive },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-2"><Icon className="size-3.5" />{label}</span>
                      <span className="font-medium">{Math.round(value)}%</span>
                    </div>
                    <Progress value={value} className="h-2" />
                  </div>
                ))}
                {machine.health.last_heartbeat_at && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                    <Clock className="size-3" />
                    Updated {timeAgo(machine.health.last_heartbeat_at)}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Metadata</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-xs">{machine.id.substring(0, 8)}...</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(machine.created_at).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Provider</span>
                <span className="capitalize">{machine.provider}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog />

      {/* Rescale Dialog */}
      {machine && (
        <RescaleDialog
          open={rescaleOpen}
          onOpenChange={setRescaleOpen}
          machine={machine}
        />
      )}

      {/* Create Image Dialog */}
      <Dialog open={createImageOpen} onOpenChange={setCreateImageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Create Image</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="image-name">Name</Label>
              <Input id="image-name" placeholder="my-dev-environment" value={imageName} onChange={(e) => setImageName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateImage(); }} />
              <p className="text-xs text-muted-foreground">Saves the current state. Use it to spin up identical machines later.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateImageOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateImage} disabled={createImage.isPending || !imageName.trim()}>
              {createImage.isPending ? <><Loader2 className="size-4 animate-spin mr-2" />Creating...</> : "Create Image"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
