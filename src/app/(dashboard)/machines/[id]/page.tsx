"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api";

const Terminal = dynamic(() => import("@/components/dashboard/terminal"), { ssr: false, loading: () => <div className="h-[360px] bg-[#09090b] rounded-lg animate-pulse" /> });

interface Machine {
  id: string; slug: string; name: string; status: string; server_type: string;
  region: string; ip: string | null; price_monthly: number | null;
  created_at: string; ready_at: string | null;
  urls: { vscode: string; pty: string } | null;
  ssh: string | null;
  ssh_key: { private_key: string | null; public_key: string | null; setup_command: string | null; key_path: string } | null;
  connect: { ssh_command: string | null; setup_command: string | null; vscode_url: string; vscode_password: string; cursor_ssh: string | null; claude_code: string | null } | null;
  health: { cpu: number; memory: number; disk: number; services: Record<string, boolean>; last_heartbeat_at: string | null } | null;
}

export default function MachineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const machineId = params.id as string;
  const [machine, setMachine] = useState<Machine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    async function fetch() {
      try {
        const r = await apiFetch(`/machines/${machineId}`);
        if (!r.ok) throw new Error(r.status === 404 ? 'Machine not found' : 'Failed to load');
        setMachine(await r.json());
      } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
      finally { setLoading(false); }
    }
    fetch();
    const interval = setInterval(fetch, 10000);
    return () => clearInterval(interval);
  }, [machineId]);

  const handleAction = async (action: string) => {
    if (!machine) return;
    setActionLoading(action);
    try {
      const r = await apiFetch(`/machines/${machine.id}/${action}`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).message || 'Failed');
      toast.success(`${action} initiated`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setActionLoading(null); }
  };

  const handleDelete = async () => {
    if (!machine) return;
    setActionLoading('delete');
    try {
      const r = await apiFetch(`/machines/${machine.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Failed to delete');
      toast.success('Machine deleted');
      router.push('/machines');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); setActionLoading(null); }
  };

  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} copied`); };

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-[360px]" /><Skeleton className="h-32" /></div>;

  if (error || !machine) return (
    <div className="text-center py-16">
      <h2 className="text-xl font-semibold mb-2">Machine Not Found</h2>
      <p className="text-muted-foreground mb-4">{error}</p>
      <Button onClick={() => router.push('/machines')}>Back to Machines</Button>
    </div>
  );

  const isReady = machine.status === 'ready';
  const statusColor = { provisioning: 'bg-yellow-500', ready: 'bg-green-500', error: 'bg-red-500', stopped: 'bg-gray-500' }[machine.status] || 'bg-gray-500';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header — compact */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColor} ${machine.status === 'provisioning' ? 'animate-pulse' : ''}`} />
          <div>
            <h1 className="text-xl font-bold">{machine.name || machine.slug}</h1>
            <div className="text-sm text-muted-foreground">
              {machine.server_type} · {machine.region.toUpperCase()} · {machine.ip || 'assigning...'}
              {machine.price_monthly ? ` · $${machine.price_monthly}/mo` : ''}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleAction('reboot')} disabled={!isReady || actionLoading === 'reboot'}>
            {actionLoading === 'reboot' ? '...' : 'Reboot'}
          </Button>
          <Dialog>
            <DialogTrigger className={cn(buttonVariants({ variant: "destructive", size: "sm" }))}>Delete</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Machine</DialogTitle>
                <DialogDescription>This will permanently destroy {machine.slug} and all data on it.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={actionLoading === 'delete'}>
                  {actionLoading === 'delete' ? 'Deleting...' : 'Delete Forever'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Terminal — the main event */}
      <Terminal machineId={machine.id} machineIp={machine.ip} machineSlug={machine.slug} machineStatus={machine.status} />

      {/* Connect info — compact grid */}
      {machine.connect && machine.ip && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* SSH Setup */}
          {machine.ssh_key?.setup_command && (
            <div className="col-span-full p-4 rounded-lg border bg-card/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">SSH Setup <Badge variant="secondary" className="ml-2 text-xs">1-click</Badge></span>
                <Button size="sm" variant="outline" onClick={() => copy(machine.ssh_key!.setup_command!, 'Setup command')}>Copy</Button>
              </div>
              <pre className="text-xs font-mono text-muted-foreground bg-[#09090b] p-2 rounded overflow-x-auto leading-relaxed">{machine.ssh_key.setup_command}</pre>
            </div>
          )}

          {/* SSH */}
          {machine.connect.ssh_command && (
            <div className="p-3 rounded-lg border bg-card/50 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground mb-1">SSH</div>
                <code className="text-sm font-mono">{machine.connect.ssh_command}</code>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copy(machine.connect!.ssh_command!, 'SSH')}>Copy</Button>
            </div>
          )}

          {/* Browser IDE */}
          <div className="p-3 rounded-lg border bg-card/50 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Browser IDE</div>
              <code className="text-sm font-mono">{machine.connect.vscode_url}</code>
              <div className="text-xs text-muted-foreground mt-0.5">pw: {machine.connect.vscode_password}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => window.open(machine.connect!.vscode_url, '_blank')}>Open</Button>
          </div>

          {/* Private key toggle */}
          {machine.ssh_key?.private_key && (
            <div className="col-span-full">
              <button onClick={() => setShowKey(!showKey)} className="text-xs text-muted-foreground hover:text-foreground">
                {showKey ? '▾ Hide' : '▸ Show'} SSH private key
              </button>
              {showKey && (
                <pre className="mt-2 text-xs font-mono text-muted-foreground bg-[#09090b] p-2 rounded overflow-x-auto max-h-32">{machine.ssh_key.private_key}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Provisioning state */}
      {machine.status === 'provisioning' && (
        <div className="text-center py-8 text-muted-foreground">
          <div className="animate-pulse text-2xl mb-2">⏳</div>
          <p className="text-sm">Machine is provisioning... ~60 seconds remaining</p>
        </div>
      )}
    </div>
  );
}
