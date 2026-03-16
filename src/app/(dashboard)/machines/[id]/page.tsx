"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { useMachine, useDeleteMachine, useRebootMachine } from "@/hooks/use-machines";
import { useConfirm } from "@/hooks/use-confirm";
import { ArrowLeft, RotateCw, Trash2, Copy, ExternalLink, KeyRound, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";

const Terminal = dynamic(() => import("@/components/dashboard/terminal"), { ssr: false, loading: () => <div className="h-[360px] bg-[#09090b] rounded-lg" /> });

const statusMap: Record<string, { dotClass: string }> = {
  provisioning: { dotClass: "bg-yellow-500 animate-pulse" },
  ready: { dotClass: "bg-green-500" },
  error: { dotClass: "bg-red-500" },
  stopped: { dotClass: "bg-muted-foreground" },
};

export default function MachineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const machineId = params.id as string;
  const [showKey, setShowKey] = useState(false);

  const { data: machine, isLoading, error } = useMachine(machineId);
  const deleteMachine = useDeleteMachine();
  const rebootMachine = useRebootMachine();
  const [confirm, ConfirmDialog] = useConfirm();

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

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  if (isLoading) return (
    <div className="max-w-5xl mx-auto space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-[360px] rounded-lg" />
      <Skeleton className="h-24 rounded-lg" />
    </div>
  );

  if (error || !machine) return (
    <div className="text-center py-20">
      <h2 className="font-heading text-xl mb-2">Machine Not Found</h2>
      <p className="text-sm text-muted-foreground mb-4">{error?.message}</p>
      <Button variant="outline" size="sm" onClick={() => router.push("/machines")}>
        <ArrowLeft className="mr-2 size-4" />
        Back to Machines
      </Button>
    </div>
  );

  const isReady = machine.status === "ready";
  const statusInfo = statusMap[machine.status] || statusMap.stopped;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/machines" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-4" />
          </Link>
          <div className={`size-2 rounded-full ${statusInfo.dotClass}`} />
          <div>
            <h1 className="font-heading text-xl tracking-tight">{machine.name || machine.slug}</h1>
            <div className="text-xs text-muted-foreground font-mono">
              {machine.server_type} &middot; {machine.region.toUpperCase()} &middot; {machine.ip || "assigning..."}
              {machine.price_monthly ? ` · $${machine.price_monthly}/mo` : ""}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReboot} disabled={!isReady || rebootMachine.isPending}>
            {rebootMachine.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Terminal */}
      <Terminal machineId={machine.id} machineIp={machine.ip} machineSlug={machine.slug} machineStatus={machine.status} />

      {/* Connect info */}
      {machine.connect && machine.ip && (
        <div className="space-y-2">
          {/* SSH Setup */}
          {machine.ssh_key?.setup_command && (
            <div className="p-3 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-2">
                  <KeyRound className="size-3.5" />
                  SSH Setup
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">1-click</Badge>
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => copy(machine.ssh_key!.setup_command!, "Setup command")}>
                  <Copy className="size-3 mr-1" /> Copy
                </Button>
              </div>
              <pre className="text-[11px] font-mono text-muted-foreground bg-muted/50 p-2 rounded overflow-x-auto leading-relaxed">{machine.ssh_key.setup_command}</pre>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {/* SSH */}
            {machine.connect.ssh_command && (
              <div className="p-3 rounded-lg border flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">SSH</div>
                  <code className="text-xs font-mono">{machine.connect.ssh_command}</code>
                </div>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => copy(machine.connect!.ssh_command!, "SSH")}>
                  <Copy className="size-3" />
                </Button>
              </div>
            )}

            {/* Browser IDE */}
            <div className="p-3 rounded-lg border flex items-center justify-between">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Browser IDE</div>
                <code className="text-xs font-mono">{machine.connect.vscode_url}</code>
                <div className="text-[10px] text-muted-foreground mt-0.5">pw: <span className="font-mono">{machine.connect.vscode_password}</span></div>
              </div>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => window.open(machine.connect!.vscode_url, "_blank")}>
                <ExternalLink className="size-3" />
              </Button>
            </div>
          </div>

          {/* Private key toggle */}
          {machine.ssh_key?.private_key && (
            <button onClick={() => setShowKey(!showKey)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {showKey ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {showKey ? "Hide" : "Show"} SSH private key
            </button>
          )}
          {showKey && machine.ssh_key?.private_key && (
            <pre className="text-[11px] font-mono text-muted-foreground bg-muted/50 p-2 rounded overflow-x-auto max-h-32">{machine.ssh_key.private_key}</pre>
          )}
        </div>
      )}

      {/* Provisioning state */}
      {machine.status === "provisioning" && (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2 className="mx-auto size-6 animate-spin mb-2" />
          <p className="text-sm">Machine is provisioning... ~60 seconds remaining</p>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
