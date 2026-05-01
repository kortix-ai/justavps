'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { ApiError, type InventoryHost } from '@/lib/api';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { RefreshCw, Trash2, Play, RotateCcw, X, ChevronRight, ShoppingCart, ExternalLink } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { toast } from 'sonner';

type NodeRun = {
  id: string;
  clusterId: string;
  status: string;
  currentStep?: string | null;
  lastError?: string | null;
  sshHost?: string | null;
  hetznerServerNumber?: number | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  endedAt?: string | null;
};

type Sku = {
  id: string;
  vcpus: number;
  ramGb: number;
  usableStorageGb: number;
  monthlyEur: number;
  notes?: string;
};
type SkuPayload = { default_sku: string; default_big_sku: string; skus: Sku[] };
type Recommend = { fleet_host_count: number; recommendation: { skuId: string; rationale: string } };
type OrderValidation = {
  ok: boolean;
  charge: false;
  target_cluster?: { id: string; name?: string; region: string };
  target_cluster_selection?: { mode: string; policy: string; selected_cluster_id: string };
};

const LOCATIONS = ['HEL1', 'FSN1', 'NBG1'];

function regionForLocation(location: string) {
  const upper = location.toUpperCase();
  return upper.startsWith('HEL') || upper.startsWith('FSN') || upper.startsWith('NBG') ? 'eu' : 'us';
}

function apiErrorDetail(error: unknown) {
  if (error instanceof ApiError) {
    const data = error.data as { message?: string; action_required?: string; vendor_status?: number; vendor_body?: unknown } | undefined;
    return {
      message: data?.message ?? error.message,
      detail: data?.action_required,
      vendorStatus: data?.vendor_status,
    };
  }
  return { message: error instanceof Error ? error.message : String(error), detail: undefined, vendorStatus: undefined };
}

type FleetTopology = {
  summary?: {
    regions: number;
    clusters: number;
    hosts: number;
    inventory_hosts?: number;
    capacity_hosts?: number;
    pending_hosts?: number;
    online_hosts: number;
    machines: number;
  };
  utilization_model?: { scheduling: string; runtime: string; finance: string; provisioning: string };
  provisioning_model?: string[];
  regions?: Array<{
    code: 'eu' | 'us' | string;
    summary: {
      clusters: number;
      hosts: number;
      inventory_hosts?: number;
      capacity_hosts?: number;
      pending_hosts?: number;
      online_hosts: number;
      machines: number;
      scheduling?: {
        physical_capacity: { vcpu: number; memory_gb: number; disk_gb: number };
        capacity: { vcpu: number; memory_gb: number; disk_gb: number };
        allocated: { vcpu: number; memory_gb: number; disk_gb: number };
        remaining: { vcpu: number; memory_gb: number; disk_gb: number };
      };
    };
    clusters: Array<{
      id: string;
      name: string;
      region: string;
      status: string;
      sku?: string;
      members_online: number;
      members_total: number;
      machines_total: number;
      hosts: Array<{
        name: string;
        status: string;
        url?: string | null;
        links?: { ui_url?: string | null; api_url?: string | null };
        schedulable: boolean;
        lifecycle_state: string;
        fill_pct?: { vcpu?: number | null; memory?: number | null; disk?: number | null };
        physical_fill_pct?: { vcpu?: number | null; memory?: number | null; disk?: number | null };
        remaining?: { vcpu: number; memory_gb: number; disk_gb: number };
        machines?: Array<{ id: string; name: string; status: string; type: string }>;
      }>;
    }>;
  }>;
};

function pct(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(0)}%` : '—';
}

function oneDecimal(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}

function metaString(meta: Record<string, unknown> | undefined, key: string) {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function provisioningBlocker(meta: Record<string, unknown> | undefined) {
  const raw = meta?.provisioning_blocker;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : null;
  const nextAction = typeof record.next_action === 'string' ? record.next_action : null;
  return message || nextAction ? { message, nextAction } : null;
}

function endpointUrl(address?: string | null) {
  const value = address?.trim();
  if (!value) return null;
  const host = value.includes(':') && !value.startsWith('[') && !/^https?:\/\//.test(value) ? `[${value}]` : value;
  try {
    const url = new URL(/^https?:\/\//.test(host) ? host : `https://${host}`);
    if (!url.port) url.port = '8443';
    return url;
  } catch {
    return null;
  }
}

function incusUiLink(address?: string | null) {
  const url = endpointUrl(address);
  return url ? `${url.origin}/ui/` : null;
}

export default function FleetPage() {
  const { state, setState, request, runAction, refreshAll } = useStore();
  const { confirm } = useConfirm();
  const [runs, setRuns] = useState<NodeRun[]>([]);
  const [fleet, setFleet] = useState<FleetTopology | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [targetClusterDialog, setTargetClusterDialog] = useState<{ hostId: string } | null>(null);
  const totalInventoryHosts = fleet?.summary?.inventory_hosts ?? fleet?.summary?.hosts ?? state.inventory.length;
  const capacityHosts = fleet?.summary?.capacity_hosts ?? fleet?.summary?.online_hosts ?? state.inventory.filter((h) => h.schedulable).length;
  const pendingHosts = fleet?.summary?.pending_hosts ?? Math.max(0, totalInventoryHosts - capacityHosts);

  const runForHost = useMemo(() => {
    const map = new Map<string, NodeRun>();
    for (const run of runs) {
      if (run.hetznerServerNumber) map.set(String(run.hetznerServerNumber), run);
      if (run.sshHost) map.set(run.sshHost, run);
    }
    return map;
  }, [runs]);

  const memberUiByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const region of fleet?.regions ?? []) {
      for (const cluster of region.clusters) {
        for (const host of cluster.hosts) {
          const ui = host.links?.ui_url ?? incusUiLink(host.url);
          if (ui) map.set(host.name, ui);
        }
      }
    }
    return map;
  }, [fleet]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await request<{ runs: NodeRun[] }>('/admin/nodes/runs');
        if (!cancelled) setRuns(data.runs ?? []);
      } catch { /* surfaced via store */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    let didInitialSync = false;
    const tick = async () => {
      try {
        const data = didInitialSync
          ? await request<FleetTopology>('/admin/fleet')
          : await request<FleetTopology>('/admin/fleet/sync', { method: 'POST' });
        if (!cancelled) setFleet(data);
        if (!didInitialSync) {
          didInitialSync = true;
          const inventory = await request<{ hosts: InventoryHost[] }>('/admin/hosts/inventory').catch(() => null);
          if (!cancelled && inventory) {
            setState((prev) => ({ ...prev, inventory: inventory.hosts ?? prev.inventory }));
          }
        }
      } catch { /* surfaced via store */ }
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [request, setState]);

  const fire = async (label: string, fn: () => Promise<unknown>) => {
    await runAction(label, async () => {
      const r = await fn();
      await refreshAll();
      return r;
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Regions</span>
            <ChevronRight className="size-3" />
            <span>Clusters</span>
            <ChevronRight className="size-3" />
            <span>Hosts</span>
            <ChevronRight className="size-3" />
            <span>Machines</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fire('sync hetzner', () => request('/admin/vendors/hetzner/sync', { method: 'POST' }))}>
            <RefreshCw className="size-3.5" /> Sync Hetzner
          </Button>
          <Button variant="outline" size="sm" onClick={() => fire('sync fleet', async () => {
            const data = await request<FleetTopology>('/admin/fleet/sync', { method: 'POST' });
            setFleet(data);
            return data;
          })}>
            <RefreshCw className="size-3.5" /> Sync fleet
          </Button>
          <Button size="sm" onClick={() => setAddNodeOpen(true)}>
            <ShoppingCart className="size-3.5" /> Buy node
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Regions" value={fleet?.summary?.regions ?? state.regions.length} sub="eu, us" />
        <StatCard label="Clusters" value={fleet?.summary?.clusters ?? state.clusters.length} sub={state.clusters.map((c) => c.id).join(', ') || 'none'} />
        <StatCard label="Physical hosts" value={totalInventoryHosts} sub={`${capacityHosts} online capacity · ${pendingHosts} pending/not capacity`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Utilization policy</CardTitle>
          <CardDescription>Separate placement reservations, runtime pressure, and finance so the cloud scales without overbooking chaos.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <PolicyBlock title="Scheduling" text={fleet?.utilization_model?.scheduling ?? 'Placement uses allocated/requested capacity with 90% target fill.'} />
          <PolicyBlock title="Runtime" text={fleet?.utilization_model?.runtime ?? 'Live CPU/RAM/IO is an ops signal, not sellable capacity.'} />
          <PolicyBlock title="Finance" text={fleet?.utilization_model?.finance ?? 'Finance is ledger-based cost/revenue, not a separate operator page.'} />
          <PolicyBlock title="Provisioning" text={fleet?.utilization_model?.provisioning ?? 'Hosts become capacity only after Incus member Online verification.'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fleet hierarchy</CardTitle>
          <CardDescription>Regions → clusters → Incus hosts → machines. This is the fleet control plane.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(fleet?.regions ?? []).map((region) => (
            <div key={region.code} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-semibold uppercase tracking-wide">{region.code}</div>
                  <div className="text-xs text-muted-foreground">
                    {region.summary.clusters} clusters · {region.summary.capacity_hosts ?? region.summary.online_hosts}/{region.summary.inventory_hosts ?? region.summary.hosts} hosts capacity · {region.summary.machines} machines
                  </div>
                </div>
                {region.summary.scheduling ? (
                  <div className="mb-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
                    <div className="rounded border bg-background px-3 py-2">vCPU reserved <span className="font-mono text-foreground">{region.summary.scheduling.allocated.vcpu}/{region.summary.scheduling.capacity.vcpu}</span> <span className="text-2xs">sellable ({region.summary.scheduling.physical_capacity.vcpu} physical)</span></div>
                    <div className="rounded border bg-background px-3 py-2">RAM reserved <span className="font-mono text-foreground">{oneDecimal(region.summary.scheduling.allocated.memory_gb)}/{oneDecimal(region.summary.scheduling.capacity.memory_gb)} GB</span></div>
                    <div className="rounded border bg-background px-3 py-2">Schedulable RAM headroom <span className="font-mono text-foreground">{oneDecimal(region.summary.scheduling.remaining.memory_gb)} GB</span></div>
                  </div>
                ) : null}
              {region.clusters.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clusters registered in this region yet.</p>
              ) : (
                <div className="space-y-3">
                  {region.clusters.map((cluster) => (
                    <div key={cluster.id} className="rounded-md bg-muted/40 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="font-mono text-sm font-medium">{cluster.id}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant={cluster.status === 'reachable' ? 'default' : 'destructive'}>{cluster.status}</Badge>
                          <Badge variant="outline">{cluster.members_online}/{cluster.members_total} hosts</Badge>
                          <Badge variant="outline">{cluster.machines_total} machines</Badge>
                          {cluster.sku ? <Badge variant="secondary">{cluster.sku}</Badge> : null}
                        </div>
                      </div>
                      {cluster.hosts.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No Incus members discovered.</p>
                      ) : (
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {cluster.hosts.map((host) => (
                            <div key={host.name} className="rounded border bg-background p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-medium">{host.name}</span>
                                <div className="flex items-center gap-1">
                                  {(host.links?.ui_url ?? incusUiLink(host.url)) ? (
                                    <Button size="xs" variant="ghost" asChild>
                                      <a href={host.links?.ui_url ?? incusUiLink(host.url) ?? '#'} target="_blank" rel="noreferrer">
                                        <ExternalLink className="size-3" /> Incus UI
                                      </a>
                                    </Button>
                                  ) : null}
                                  <Badge variant={host.schedulable ? 'default' : 'secondary'}>{host.schedulable ? 'schedulable' : host.lifecycle_state}</Badge>
                                </div>
                              </div>
                              <div className="mt-1 text-2xs text-muted-foreground">
                                Reserved of sellable CPU {pct(host.fill_pct?.vcpu)} · RAM {pct(host.fill_pct?.memory)} · Disk {pct(host.fill_pct?.disk)}
                              </div>
                              <div className="mt-1 text-2xs text-muted-foreground">
                                CPU physical reservation {pct(host.physical_fill_pct?.vcpu)} · normal cloud overcommit
                              </div>
                              <div className="mt-1 text-2xs text-muted-foreground">
                                Headroom {oneDecimal(host.remaining?.vcpu)} vCPU · {oneDecimal(host.remaining?.memory_gb)} GB RAM · {oneDecimal(host.remaining?.disk_gb)} GB disk
                              </div>
                              <div className="mt-2 space-y-1">
                                {(host.machines ?? []).slice(0, 5).map((machine) => (
                                  <div key={machine.id} className="truncate rounded bg-muted px-2 py-1 text-2xs font-mono">
                                    {machine.name} · {machine.type} · {machine.status}
                                  </div>
                                ))}
                                {(host.machines?.length ?? 0) > 5 ? <div className="text-2xs text-muted-foreground">+{(host.machines?.length ?? 0) - 5} more</div> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Clusters</CardTitle>
              <CardDescription>Live Incus state across configured clusters.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {state.clusters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clusters configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead><TableHead>Region</TableHead>
                  <TableHead>Project</TableHead><TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.clusters.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.id}</TableCell>
                    <TableCell>{c.region}</TableCell>
                    <TableCell>{c.project}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.endpoint}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => fire(`sync ${c.id}`, () => request(`/admin/clusters/${c.id}/sync`, { method: 'POST' }))}>Sync</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hosts</CardTitle>
          <CardDescription>Hetzner inventory + cluster membership + lifecycle ops.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.inventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hosts. Hit &quot;Sync Hetzner&quot; or wait for delivery.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead><TableHead>Bootstrap address</TableHead>
                  <TableHead>Cluster / Member</TableHead><TableHead>Lifecycle</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.inventory.map((host) => {
                  const bootstrapAddress = host.bootstrapAddress ?? host.publicIpv4 ?? host.publicIpv6 ?? null;
                  const targetCluster = metaString(host.metadata, 'target_cluster_id');
                  const targetMember = metaString(host.metadata, 'target_member_name');
                  const blocker = provisioningBlocker(host.metadata);
                  const hostRun = runForHost.get(String(host.providerServerNumber ?? '')) ?? (bootstrapAddress ? runForHost.get(bootstrapAddress) : undefined);
                  const hostIncusUi = (host.incusMemberName ? memberUiByName.get(host.incusMemberName) : null)
                    ?? (targetMember ? memberUiByName.get(targetMember) : null)
                    ?? incusUiLink(bootstrapAddress);
                  return (
                    <TableRow key={host.id}>
                      <TableCell className="align-top font-medium">
                        <div>{host.providerServerNumber ?? host.id}</div>
                        {host.capacityState && host.capacityState !== 'schedulable_capacity' ? (
                          <Badge variant="outline" className="mt-1 text-2xs font-normal">{host.capacityState}</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="break-all font-mono text-xs">{bootstrapAddress ?? '—'}</div>
                          {host.bootstrapAddressFamily ? <Badge variant="outline" className="text-2xs">{host.bootstrapAddressFamily}</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-xs">
                        <div className="font-mono text-muted-foreground">{host.incusClusterId ?? '—'} / {host.incusMemberName ?? '—'}</div>
                        {targetCluster ? (
                          <div className="mt-1 text-2xs text-muted-foreground">
                            target <span className="font-mono text-foreground">{targetCluster}</span>{targetMember ? <> / <span className="font-mono text-foreground">{targetMember}</span></> : null}
                          </div>
                        ) : null}
                        {hostRun ? (
                          <div className="mt-1 text-2xs text-muted-foreground">
                            run <span className="font-mono text-foreground">{hostRun.id.slice(0, 10)}</span> · {hostRun.status}
                          </div>
                        ) : null}
                        {blocker ? (
                          <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-2xs text-amber-700 dark:text-amber-300">
                            <div>{blocker.message ?? 'Provisioning blocked.'}</div>
                            {blocker.nextAction ? <div className="mt-0.5 text-muted-foreground">Next: {blocker.nextAction}</div> : null}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant={host.lifecycleState === 'online' ? 'default' : host.lifecycleState === 'terminated' ? 'destructive' : 'secondary'}>
                          {host.lifecycleState ?? 'unknown'}
                        </Badge>
                        {host.fleetIssue && !blocker ? <div className="mt-1 max-w-xs text-2xs text-muted-foreground">{host.fleetIssue}</div> : null}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {hostIncusUi ? (
                            <Button size="sm" variant="ghost" asChild>
                              <a href={hostIncusUi} target="_blank" rel="noreferrer">
                                <ExternalLink className="size-3.5" /> Incus UI
                              </a>
                            </Button>
                          ) : null}
                          <Button size="sm" variant="ghost" onClick={() => setTargetClusterDialog({ hostId: host.id })}>
                            Set target
                          </Button>
                          {host.lifecycleState === 'online' ? (
                            <Button size="sm" variant="ghost" onClick={() => fire(`cordon ${host.id}`, () => request(`/admin/nodes/${host.id}/cordon`, { method: 'POST' }))}>Cordon</Button>
                          ) : null}
                          {host.lifecycleState === 'cordoned' ? (
                            <Button size="sm" variant="ghost" onClick={() => fire(`uncordon ${host.id}`, () => request(`/admin/nodes/${host.id}/uncordon`, { method: 'POST' }))}>Uncordon</Button>
                          ) : null}
                          {host.lifecycleState === 'online' ? (
                            <Button size="sm" variant="outline" onClick={async () => {
                              if (!await confirm({
                                title: `Drain ${host.id}?`,
                                description: 'Evacuates running instances to other cluster members. Reversible until terminated.',
                                confirmLabel: 'Drain',
                              })) return;
                              fire(`drain ${host.id}`, () => request(`/admin/nodes/${host.id}/drain`, { method: 'POST' }));
                            }}>Drain</Button>
                          ) : null}
                          {host.lifecycleState && host.lifecycleState !== 'terminated' ? (
                            <Button size="sm" variant="destructive" onClick={async () => {
                              if (!await confirm({
                                title: `Terminate ${host.id}?`,
                                description: 'Final. Removes the Incus cluster member. Hetzner cancellation must still be done manually in Robot.',
                                confirmLabel: 'Terminate',
                                destructive: true,
                              })) return;
                              fire(`terminate ${host.id}`, () => request(`/admin/nodes/${host.id}/terminate`, { method: 'POST', body: { confirm: 'TERMINATE NODE' } as never }));
                            }}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provisioning runs</CardTitle>
          <CardDescription>Active and recent host bootstraps.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead><TableHead>Cluster</TableHead>
                  <TableHead>Host</TableHead><TableHead>Status</TableHead>
                  <TableHead>Step / Error</TableHead><TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.slice(0, 30).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id.slice(0, 12)}</TableCell>
                    <TableCell>{r.clusterId}</TableCell>
                    <TableCell className="font-mono text-xs">{r.sshHost ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'succeeded' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                      {r.lastError ?? r.currentStep ?? (r.metadata?.requires_robot_rescue ? 'needs Hetzner Rescue before drive' : '—')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {r.status === 'pending' ? (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          if (r.metadata?.from_rescue || r.metadata?.requires_robot_rescue) {
                            const ok = await confirm({
                              title: `Drive bootstrap ${r.id.slice(0, 10)}?`,
                              description: 'This run is a Rescue/installimage bootstrap. It can wipe/reimage the physical host if SSH reaches Hetzner Rescue. Only drive it after intentionally arming Rescue for this server.',
                              confirmLabel: 'Drive bootstrap',
                              destructive: true,
                            });
                            if (!ok) return;
                          }
                          fire(`drive ${r.id}`, () => request(`/admin/nodes/runs/${r.id}/drive`, { method: 'POST' }));
                        }}>
                          <Play className="size-3.5" />
                        </Button>
                      ) : null}
                      {r.status === 'failed' ? (
                        <Button size="sm" variant="ghost" onClick={() => fire(`retry ${r.id}`, () => request(`/admin/nodes/runs/${r.id}/retry`, { method: 'POST' }))}>
                          <RotateCcw className="size-3.5" />
                        </Button>
                      ) : null}
                      {r.status === 'pending' || r.status === 'running' ? (
                        <Button size="sm" variant="ghost" onClick={() => fire(`cancel ${r.id}`, () => request(`/admin/nodes/runs/${r.id}/cancel`, { method: 'POST' }))}>
                          <X className="size-3.5" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BuyNodeDialog open={addNodeOpen} onOpenChange={setAddNodeOpen} fire={fire} request={request} clusters={state.clusters.map((c) => ({ id: c.id, region: c.region }))} />
      <SetTargetClusterDialog
        host={targetClusterDialog?.hostId ?? null}
        clusters={state.clusters.map((c) => c.id)}
        onClose={() => setTargetClusterDialog(null)}
        fire={fire}
        request={request}
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub ? <CardContent className="text-xs text-muted-foreground">{sub}</CardContent> : null}
    </Card>
  );
}

function PolicyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-1 text-sm font-medium">{title}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function BuyNodeDialog({
  open, onOpenChange, fire, request, clusters,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fire: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  request: ReturnType<typeof useStore>['request'];
  clusters: Array<{ id: string; region: string }>;
}) {
  const { confirmPhrase } = useConfirm();
  const [skus, setSkus] = useState<SkuPayload | null>(null);
  const [recommend, setRecommend] = useState<Recommend | null>(null);
  const [productId, setProductId] = useState('EX44');
  const [location, setLocation] = useState('HEL1');
  const [sshFingerprint, setSshFingerprint] = useState('0a:db:9f:08:87:87:e1:f0:81:9a:07:e1:d0:67:54:56');
  const [validation, setValidation] = useState<OrderValidation | null>(null);
  const [orderError, setOrderError] = useState<{ message: string; detail?: string; vendorStatus?: number } | null>(null);
  const sku = useMemo(() => skus?.skus.find((s) => s.id === productId) ?? null, [skus, productId]);
  const region = regionForLocation(location);
  const candidateClusters = clusters.filter((cluster) => cluster.region === region);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const [skuPayload, recommendation] = await Promise.all([
        request<SkuPayload>('/admin/economics/skus'),
        request<Recommend>('/admin/economics/recommend').catch(() => null),
      ]);
      if (cancelled) return;
      setSkus(skuPayload);
      if (recommendation) {
        setRecommend(recommendation);
        setProductId(recommendation.recommendation.skuId);
      } else {
        setProductId(skuPayload.default_sku);
      }
    };
    load().catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
    return () => { cancelled = true; };
  }, [open, request]);

  const submit = async () => {
    setOrderError(null);
    setValidation(null);
    if (candidateClusters.length === 0) { toast.error(`No cluster registered in ${region}`); return; }
    if (!sku) { toast.error('SKU catalog still loading'); return; }
    let validated: OrderValidation;
    try {
      validated = await request<OrderValidation>('/admin/orders/validate', {
        method: 'POST',
        body: {
          product_id: sku.id,
          location,
          region,
          ssh_key_fingerprints: sshFingerprint ? [sshFingerprint] : [],
        } as never,
      });
      setValidation(validated);
    } catch (error) {
      const detail = apiErrorDetail(error);
      setOrderError(detail);
      toast.error(detail.message);
      return;
    }
    const ok = await confirmPhrase({
      title: `Buy + auto-bootstrap 1 × ${sku.id}?`,
      description: `Preflight passed. This charges €${sku.monthlyEur.toFixed(2)}/mo immediately. Fleet selected ${validated.target_cluster?.id ?? 'a cluster'} in ${region.toUpperCase()}, then handoff bootstraps the delivered host into Incus.`,
      phrase: 'ORDER REAL HOSTS',
      phraseLabel: 'Type to confirm',
      confirmLabel: 'Order + auto-bootstrap',
    });
    if (!ok) return;
    try {
      await fire(`buy fleet node ${sku.id}`, async () => {
        const data = await request('/admin/orders/buy', {
          method: 'POST',
          body: {
            product_id: sku.id,
            location,
            region,
            confirm: 'ORDER REAL HOSTS',
            ssh_key_fingerprints: sshFingerprint ? [sshFingerprint] : [],
            note: 'fleet one-click node add',
          } as never,
        });
        await request('/admin/vendors/hetzner/sync', { method: 'POST' }).catch(() => null);
        await request('/admin/fleet/sync', { method: 'POST' }).catch(() => null);
        onOpenChange(false);
        return data;
      });
    } catch (error) {
      setOrderError(apiErrorDetail(error));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add node to fleet</DialogTitle>
          <DialogDescription>One flow: order the Hetzner host, attach it to a target cluster, then auto-bootstrap it when Robot delivers the server/IP.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {recommend ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Recommended for fleet of {recommend.fleet_host_count}: </span>
                <span className="font-mono font-medium">{recommend.recommendation.skuId}</span>
                <span className="text-muted-foreground"> — {recommend.recommendation.rationale}</span>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground">Region {region.toUpperCase()} inferred from datacenter.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Targeting</Label>
                <div className="rounded-md border px-3 py-2 text-xs">
                  {candidateClusters.length > 0 ? (
                    <>
                      Auto-select least-loaded cluster in {region.toUpperCase()} · candidates: <span className="font-mono">{candidateClusters.map((c) => c.id).join(', ')}</span>
                    </>
                  ) : (
                    <span className="text-destructive">No cluster in {region.toUpperCase()} — register one before ordering.</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>SKU</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(skus?.skus ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.id} · €{s.monthlyEur.toFixed(2)}/mo · {s.vcpus} vCPU · {s.ramGb} GB</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>SSH key fingerprint</Label>
                <Input value={sshFingerprint} onChange={(e) => setSshFingerprint(e.target.value)} className="font-mono text-xs" />
              </div>
            </div>
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No BYO host, no server-number handoff, no target-cluster babysitting. Fleet owns the whole path: Robot order → inventory sync → auto target cluster → handoff run → Incus member verification.
            </div>
            {validation ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                Robot preflight passed. Target cluster: <span className="font-mono">{validation.target_cluster?.id ?? validation.target_cluster_selection?.selected_cluster_id}</span>. No charge happened during preflight.
              </div>
            ) : null}
            {orderError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <div className="font-medium">Order blocked{orderError.vendorStatus ? ` · Robot ${orderError.vendorStatus}` : ''}</div>
                <div className="mt-1">{orderError.message}</div>
                {orderError.detail ? <div className="mt-1 text-muted-foreground">{orderError.detail}</div> : null}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Cost preview</div>
            {sku ? (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">€{sku.monthlyEur.toFixed(2)}<span className="text-base font-normal text-muted-foreground">/mo</span></div>
                  <div className="text-xs text-muted-foreground tabular-nums">€{(sku.monthlyEur * 12).toFixed(2)}/yr</div>
                </div>
                <Separator />
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">vCPU</dt><dd className="tabular-nums">{sku.vcpus}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">RAM</dt><dd className="tabular-nums">{sku.ramGb} GB</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Storage</dt><dd className="tabular-nums">{sku.usableStorageGb >= 1000 ? `${(sku.usableStorageGb / 1000).toFixed(1)} TB` : `${sku.usableStorageGb} GB`}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">€ / sandbox·mo*</dt><dd className="tabular-nums">€{(sku.monthlyEur / Math.floor(sku.ramGb / 4)).toFixed(2)}</dd></div>
                </dl>
                <p className="text-2xs text-muted-foreground">* assumes 4 GB sandboxes, RAM-bound packing</p>
              </div>
            ) : <p className="mt-3 text-sm text-muted-foreground">Loading SKU catalog…</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!sku || candidateClusters.length === 0} onClick={submit}><ShoppingCart className="size-4" /> Order + auto-bootstrap</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetTargetClusterDialog({
  host, clusters, onClose, fire, request,
}: {
  host: string | null;
  clusters: string[];
  onClose: () => void;
  fire: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  request: ReturnType<typeof useStore>['request'];
}) {
  const [val, setVal] = useState(clusters[0] ?? '');
  const submit = async (clusterId: string | null) => {
    if (!host) return;
    await fire(`set target on ${host}`, async () => {
      const data = await request(`/admin/nodes/${host}/target-cluster`, {
        method: 'POST',
        body: { cluster_id: clusterId } as never,
      });
      onClose();
      return data;
    });
  };
  return (
    <Dialog open={Boolean(host)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set target cluster</DialogTitle>
          <DialogDescription>Once delivered, handoff worker auto-creates a NodeProvisioningRun.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Target cluster</Label>
          <Select value={val} onValueChange={setVal}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {clusters.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => submit(null)}>Clear target</Button>
          <Button onClick={() => submit(val)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
