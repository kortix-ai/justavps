"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { useMachine, useDeleteMachine, useRebootMachine } from "@/hooks/use-machines";
import { useConfirm } from "@/hooks/use-confirm";
import {
  ArrowLeft, RotateCw, Trash2, Copy, ExternalLink,
  Cpu, MemoryStick, HardDrive, Activity, Clock,
  Globe, Server, ChevronDown, ChevronRight, Loader2,
  Terminal as TerminalIcon, Link2, KeyRound,
  Power,
  AlertTriangle
} from "lucide-react";
import Link from "next/link";

const Terminal = dynamic(() => import("@/components/dashboard/terminal"), {
  ssr: false,
  loading: () => <div className="h-[400px] bg-[#09090b] rounded-xl" />,
});

const statusMap: Record<string, { label: string; dotClass: string; color: string }> = {
  provisioning: { label: "Provisioning", dotClass: "bg-yellow-500 animate-pulse", color: "text-yellow-500" },
  ready: { label: "Running", dotClass: "bg-green-500", color: "text-green-500" },
  error: { label: "Error", dotClass: "bg-red-500", color: "text-red-500" },
  stopped: { label: "Stopped", dotClass: "bg-muted-foreground", color: "text-muted-foreground" },
};

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function MachineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const machineId = params.id as string;
  const [showKey, setShowKey] = useState(false);

  const { data: machine, isLoading, error } = useMachine(machineId);
  const deleteMachine = useDeleteMachine();
  const rebootMachine = useRebootMachine();
  const [confirm, ConfirmDialog] = useConfirm();

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const handleReboot = () => {
    rebootMachine.mutate(machineId, {
      onSuccess: () => toast.success("Reboot initiated"),
      onError: (err) => toast.error(err.message),
    });
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
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-[400px] rounded-xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    </div>
  );

  if (error || !machine) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
      <div className="bg-destructive/10 p-4 rounded-full mb-4">
        <AlertTriangle className="size-8 text-destructive" />
      </div>
      <h2 className="font-heading text-2xl mb-2">Machine Not Found</h2>
      <p className="text-muted-foreground mb-6 max-w-md">{error?.message || "The machine you are looking for does not exist or has been deleted."}</p>
      <Button variant="outline" onClick={() => router.push("/machines")}>
        <ArrowLeft className="mr-2 size-4" />
        Back to Machines
      </Button>
    </div>
  );

  const statusInfo = statusMap[machine.status] || statusMap.stopped;
  const isReady = machine.status === "ready";
  const uptime = machine.ready_at ? timeAgo(machine.ready_at) : null;

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
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {machine.connect?.vscode_url && (
            <Button variant="outline" onClick={() => window.open(machine.connect!.vscode_url, "_blank")} className="hidden sm:flex">
              <ExternalLink className="mr-2 size-4" />
              Open IDE
            </Button>
          )}
          <Button variant="outline" onClick={handleReboot} disabled={!isReady || rebootMachine.isPending} title="Reboot Machine">
            {rebootMachine.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            <span className="sr-only sm:not-sr-only sm:ml-2">Reboot</span>
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20" onClick={handleDelete} title="Delete Machine">
            <Trash2 className="size-4" />
            <span className="sr-only sm:not-sr-only sm:ml-2">Delete</span>
          </Button>
        </div>
      </div>

      {/* Provisioning Banner */}
      {machine.status === "provisioning" && (
        <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
          <div className="p-2 bg-yellow-500/20 rounded-full">
            <Loader2 className="size-5 animate-spin text-yellow-500" />
          </div>
          <div>
            <h3 className="font-medium text-yellow-500">Machine is provisioning</h3>
            <p className="text-sm text-yellow-500/80">This usually takes about 60 seconds. The page will update automatically.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Main Content Column */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {isReady ? (
            <Tabs defaultValue="terminal" className="space-y-4">
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="terminal">
                    <TerminalIcon className="mr-2 size-4" />
                    Terminal
                  </TabsTrigger>
                  <TabsTrigger value="connect">
                    <Link2 className="mr-2 size-4" />
                    Connect
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="terminal" className="mt-0">
                <Terminal machineId={machine.id} machineIp={machine.ip} machineSlug={machine.slug} machineStatus={machine.status} />
              </TabsContent>

              <TabsContent value="connect" className="space-y-4 mt-0">
                <Card>
                  <CardHeader>
                    <CardTitle>Connection Details</CardTitle>
                    <CardDescription>Methods to connect to your machine</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* SSH Setup */}
                    {machine.ssh_key?.setup_command && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium flex items-center justify-between">
                          <span>SSH Setup (Run once)</span>
                          <Badge variant="secondary" className="text-[10px]">1-click</Badge>
                        </div>
                        <div className="relative group">
                          <pre className="text-xs font-mono text-muted-foreground bg-muted/50 p-4 rounded-lg overflow-x-auto">{machine.ssh_key.setup_command}</pre>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="absolute top-2 right-2 h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => copy(machine.ssh_key!.setup_command!, "Setup command")}
                          >
                            <Copy className="size-3.5 mr-1" /> Copy
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* SSH Command */}
                      {machine.connect?.ssh_command && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">SSH Command</label>
                          <div className="relative group">
                            <div className="text-xs font-mono text-muted-foreground bg-muted/50 p-3 rounded-lg truncate pr-10">
                              {machine.connect.ssh_command}
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="absolute top-1 right-1 h-7 w-7"
                              onClick={() => copy(machine.connect!.ssh_command!, "SSH command")}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Browser IDE */}
                      {machine.connect && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Browser IDE</label>
                          <div className="flex gap-2">
                            <div className="relative group flex-1">
                              <div className="text-xs font-mono text-muted-foreground bg-muted/50 p-3 rounded-lg truncate pr-10">
                                {machine.connect.vscode_url}
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="absolute top-1 right-1 h-7 w-7"
                                onClick={() => copy(machine.connect!.vscode_url, "IDE URL")}
                              >
                                <Copy className="size-3.5" />
                              </Button>
                            </div>
                            <Button variant="outline" size="icon" onClick={() => window.open(machine.connect!.vscode_url, "_blank")}>
                              <ExternalLink className="size-4" />
                            </Button>
                          </div>
                          <div className="text-xs text-muted-foreground">Password: <span className="font-mono">{machine.connect.vscode_password}</span></div>
                        </div>
                      )}
                    </div>

                    {/* Private Key */}
                    {machine.ssh_key?.private_key && (
                      <div className="pt-2">
                        <button onClick={() => setShowKey(!showKey)} className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors">
                          {showKey ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          SSH Private Key
                        </button>
                        {showKey && (
                          <div className="mt-3 relative group">
                            <pre className="text-xs font-mono text-muted-foreground bg-muted/50 p-4 rounded-lg overflow-x-auto max-h-60">{machine.ssh_key.private_key}</pre>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="absolute top-2 right-2 h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => copy(machine.ssh_key!.private_key!, "Private key")}
                            >
                              <Copy className="size-3.5 mr-1" /> Copy
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <div className="p-4 bg-muted rounded-full mb-4">
                  <Server className="size-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium">Machine is not ready</h3>
                <p className="text-sm text-muted-foreground max-w-sm mt-2">
                  The terminal and connection details will be available once the machine is running.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Services / Activity */}
          {machine.health?.services && Object.keys(machine.health.services).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="size-4 text-muted-foreground" />
                  Services Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(machine.health.services).map(([name, running]) => (
                    <Badge key={name} variant={running ? "outline" : "destructive"} className={`gap-1.5 py-1.5 px-3 ${running ? "border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400" : ""}`}>
                      <div className={`size-1.5 rounded-full ${running ? "bg-green-500" : "bg-red-500"}`} />
                      {name}
                    </Badge>
                  ))}
                </div>
                {machine.health.last_heartbeat_at && (
                  <div className="mt-4 text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="size-3" />
                    Last updated {timeAgo(machine.health.last_heartbeat_at)}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar Column */}
        <div className="space-y-6">
          {/* Machine Info Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Machine Details</CardTitle>
            </CardHeader>
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
                    <Globe className="size-3 text-muted-foreground" />
                    {machine.region.toUpperCase()}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Type</div>
                  <div className="font-medium text-sm">{machine.server_type}</div>
                </div>
              </div>

              <div className="pt-4 border-t space-y-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">IP Address</div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-muted/50 px-2 py-0.5 rounded">{machine.ip || "Assigning..."}</code>
                    {machine.ip && (
                      <Button size="icon" variant="ghost" className="size-6" onClick={() => copy(machine.ip!, "IP Address")}>
                        <Copy className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resources Card */}
          {machine.health && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Resources</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2"><Cpu className="size-3.5" /> CPU</span>
                    <span className="font-medium">{Math.round(machine.health.cpu)}%</span>
                  </div>
                  <Progress value={machine.health.cpu} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2"><MemoryStick className="size-3.5" /> Memory</span>
                    <span className="font-medium">{Math.round(machine.health.memory)}%</span>
                  </div>
                  <Progress value={machine.health.memory} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2"><HardDrive className="size-3.5" /> Disk</span>
                    <span className="font-medium">{Math.round(machine.health.disk)}%</span>
                  </div>
                  <Progress value={machine.health.disk} className="h-2" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Metadata Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
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
                <span className="text-muted-foreground">Price</span>
                <span>${machine.price_monthly}/mo</span>
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
    </div>
  );
}
