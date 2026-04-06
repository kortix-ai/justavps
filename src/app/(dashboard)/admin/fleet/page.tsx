"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/hooks/use-account";
import { useApproveProcurement, useFleetHosts, useFleetProcurements, useSyncProcurement } from "@/hooks/use-fleet";
import { cn } from "@/lib/utils";
import { Cpu, HardDrive, Loader2, MemoryStick, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function percent(used: number, total: number | null) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function statusTone(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    case "ordering":
    case "bootstrapping":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "error":
    case "failed":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export default function AdminFleetPage() {
  const { data: account, isLoading: accountLoading } = useAccount();
  const enabled = account?.is_admin === true;
  const { data: hosts = [], isLoading: hostsLoading } = useFleetHosts(enabled);
  const { data: procurements = [], isLoading: procurementsLoading } = useFleetProcurements(enabled);
  const approveProcurement = useApproveProcurement();
  const syncProcurement = useSyncProcurement();

  if (accountLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Fleet Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page is restricted to admin accounts.</p>
      </div>
    );
  }

  const totalHosts = hosts.length;
  const activeHosts = hosts.filter((host) => host.status === "active").length;
  const totalVcpu = hosts.reduce((sum, host) => sum + (host.total_vcpu ?? 0), 0);
  const usedVcpu = hosts.reduce((sum, host) => sum + host.used_vcpu, 0);
  const totalRam = hosts.reduce((sum, host) => sum + (host.total_memory_gb ?? 0), 0);
  const usedRam = hosts.reduce((sum, host) => sum + host.used_memory_gb, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Fleet Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dedicated host inventory, procurement state, and current bare-metal capacity.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Hosts", value: `${activeHosts}/${totalHosts} active`, icon: Server },
          { label: "vCPU", value: `${usedVcpu}/${totalVcpu}`, icon: Cpu },
          { label: "RAM", value: `${usedRam}/${totalRam} GB`, icon: MemoryStick },
          { label: "Procurements", value: String(procurements.length), icon: HardDrive },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <card.icon className="size-4" />
              {card.label}
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">{card.value}</div>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Hosts</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {hostsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {hosts.map((host) => (
                <div key={host.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{host.name}</div>
                      <div className="text-xs text-muted-foreground">{host.vendor} · {host.location} · {host.host_class}</div>
                    </div>
                    <Badge variant="outline" className={cn("capitalize", statusTone(host.status))}>{host.status}</Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Compute</div>
                      <div>{host.used_vcpu}/{host.total_vcpu ?? 0} vCPU ({percent(host.used_vcpu, host.total_vcpu)}%)</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Memory</div>
                      <div>{host.used_memory_gb}/{host.total_memory_gb ?? 0} GB ({percent(host.used_memory_gb, host.total_memory_gb)}%)</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Disk</div>
                      <div>{host.used_disk_gb}/{host.total_disk_gb ?? 0} GB ({percent(host.used_disk_gb, host.total_disk_gb)}%)</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground break-all">
                    {host.public_ipv4 ? `IP: ${host.public_ipv4}` : "No IP yet"}
                    {host.runner_base_url ? ` · Runner: ${host.runner_base_url}` : " · Runner not registered yet"}
                  </div>
                </div>
              ))}
              {hosts.length === 0 && <div className="p-6 text-sm text-muted-foreground">No hosts yet.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Procurements</h2>
        </div>
        <div className="rounded-2xl border overflow-hidden">
          {procurementsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-border">
              {procurements.map((procurement) => (
                <div key={procurement.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{procurement.product_id}</div>
                    <div className="text-xs text-muted-foreground">{procurement.location} · {procurement.host_class}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="outline" className={cn("capitalize", statusTone(procurement.status))}>{procurement.status}</Badge>
                    <div className="text-xs text-muted-foreground break-all text-right">
                      {procurement.provider_transaction_id ?? procurement.id}
                    </div>
                    <div className="flex gap-2">
                      {procurement.status === "requested" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={approveProcurement.isPending}
                          onClick={() => approveProcurement.mutate(procurement.id, {
                            onSuccess: () => toast.success("Procurement approved"),
                            onError: (error: Error) => toast.error(error.message),
                          })}
                        >
                          {approveProcurement.isPending ? <Loader2 className="size-3 animate-spin" /> : "Approve"}
                        </Button>
                      )}
                      {procurement.provider_transaction_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={syncProcurement.isPending}
                          onClick={() => syncProcurement.mutate(procurement.id, {
                            onSuccess: () => toast.success("Procurement synced"),
                            onError: (error: Error) => toast.error(error.message),
                          })}
                        >
                          {syncProcurement.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                          Sync
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {procurements.length === 0 && <div className="p-6 text-sm text-muted-foreground">No procurements yet.</div>}
            </div>
          )}
        </div>
      </section>

      <div className="rounded-2xl border bg-card p-5 space-y-2 text-sm">
        <div className="font-medium">Scaling model</div>
        <p className="text-muted-foreground text-sm">
          Machines are pinned to a single host. Capacity scales horizontally by adding more bare-metal nodes and letting the scheduler place new machines onto active hosts.
        </p>
        <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
          <li>Procurement is slower than VM placement, so spare capacity and warm-pool headroom matter.</li>
          <li>Stopped machines free runtime resources on the node, but their persistent disk footprint remains allocated.</li>
          <li>The initial model avoids live migration and distributed storage to keep the platform operationally simple.</li>
        </ul>
      </div>
    </div>
  );
}
