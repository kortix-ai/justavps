'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Flame, Gauge, Pause, Play, RefreshCw, Search, Trash2, Zap } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { PoolAdminState, PoolPolicy } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/components/confirm';

type PoolMode = 'stopped' | 'running';

const ACCOUNT_KEY = 'v2-admin:warm-pool-account-id';
const WARM_POOL_TARGET_MAX = 500;

function fmtGib(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 10 ? 1 : 3 }).format(value)} GiB`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'paused') return 'secondary';
  if (status === 'deleted') return 'destructive';
  return 'outline';
}

function sourceLabel(policy: PoolPolicy) {
  if (policy.source.type === 'image') return `image:${policy.source.id}`;
  return `${policy.source.type}:${policy.source.id}`;
}

function policyPoolMode(policy: PoolPolicy): PoolMode {
  return policy.pool_mode === 'running' || policy.mode === 'primed_running_exact' || policy.billing?.pool_mode === 'running' ? 'running' : 'stopped';
}

export default function PoolsPage() {
  const { state, request, runAction, refreshAll } = useStore();
  const { confirm } = useConfirm();
  const [accountId, setAccountId] = useState('system');
  const [policies, setPolicies] = useState<PoolPolicy[]>([]);
  const [adminState, setAdminState] = useState<PoolAdminState | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [targetEdits, setTargetEdits] = useState<Record<string, number>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAccountId(window.localStorage.getItem(ACCOUNT_KEY) || 'system');
  }, []);

  const accountHeaders = useMemo(() => ({ 'X-Account-Id': accountId }), [accountId]);
  const poolRows = useMemo(() => adminState?.machines.filter((machine) => machine.account_id === accountId) ?? [], [accountId, adminState]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [policyData, warmData] = await Promise.all([
        request<{ policies: PoolPolicy[] }>('/warm-pool-policies', { headers: accountHeaders }),
        request<PoolAdminState>('/admin/warm-pool'),
      ]);
      setPolicies(policyData.policies ?? []);
      setAdminState(warmData);
      setTargetEdits(Object.fromEntries((policyData.policies ?? []).map((policy) => [policy.id, policy.target])));
    } finally {
      setLoading(false);
    }
  }, [accountHeaders, request]);

  useEffect(() => {
    if (!state.baseUrl) return;
    load().catch(() => {});
  }, [load, state.baseUrl]);

  useEffect(() => {
    if (!state.baseUrl) return;
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 8000);
    return () => window.clearInterval(timer);
  }, [load, state.baseUrl]);

  const saveAccount = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(ACCOUNT_KEY, accountId.trim() || 'system');
    setAccountId(accountId.trim() || 'system');
    toast.success(`Pool account set to ${accountId.trim() || 'system'}`);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return policies.filter((policy) => {
      if (!q) return true;
      return [policy.name, policy.id, policy.status, policy.type, policy.region, sourceLabel(policy)].join(' ').toLowerCase().includes(q);
    });
  }, [policies, query]);

  const totals = useMemo(() => ({
    active: policies.filter((policy) => policy.status === 'active').length,
    ready: policies.reduce((sum, policy) => sum + (policy.ready ?? 0), 0),
    target: policies.reduce((sum, policy) => sum + policy.target, 0),
  }), [policies]);

  async function action(label: string, fn: () => Promise<unknown>) {
    await runAction(label, async () => {
      const result = await fn();
      await Promise.all([load(), refreshAll()]);
      return result;
    });
  }

  async function refill(policy: PoolPolicy) {
    await action(`refill ${policy.name}`, () => request(`/warm-pool-policies/${encodeURIComponent(policy.id)}/refill`, { method: 'POST', headers: accountHeaders }));
  }

  async function setStatus(policy: PoolPolicy, status: 'active' | 'paused') {
    await action(`${status} ${policy.name}`, () => request(`/warm-pool-policies/${encodeURIComponent(policy.id)}`, {
      method: 'PATCH',
      headers: accountHeaders,
      body: { status } as never,
    }));
  }

  async function saveTarget(policy: PoolPolicy) {
    const target = Math.max(0, Math.min(WARM_POOL_TARGET_MAX, Number(targetEdits[policy.id] ?? policy.target) || 0));
    await action(`set ${policy.name} target`, () => request(`/warm-pool-policies/${encodeURIComponent(policy.id)}`, {
      method: 'PATCH',
      headers: accountHeaders,
      body: { target } as never,
    }));
  }

  async function saveMode(policy: PoolPolicy, mode: PoolMode) {
    await action(`set ${policy.name} mode`, () => request(`/warm-pool-policies/${encodeURIComponent(policy.id)}`, {
      method: 'PATCH',
      headers: accountHeaders,
      body: { mode } as never,
    }));
  }

  async function deletePolicy(policy: PoolPolicy) {
    if (!await confirm({
      title: `Delete pool policy “${policy.name}”?`,
      description: 'This drains unclaimed standby machines for this policy. Claimed customer machines are not touched.',
      confirmLabel: 'Delete policy',
      destructive: true,
    })) return;
    await action(`delete ${policy.name}`, () => request(`/warm-pool-policies/${encodeURIComponent(policy.id)}`, { method: 'DELETE', headers: accountHeaders }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pools</h1>
          <p className="text-sm text-muted-foreground">
            Prime user images once, verify the JustAVPS daemon, then keep stopped standby slots hidden until a matching create claims one.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => load().catch(() => {})} disabled={loading || state.busy}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          <Button asChild><Link href="/templates">Configure on Templates</Link></Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1.5">
            <Label htmlFor="warm-account">Account context</Label>
            <div className="flex gap-2">
              <Input id="warm-account" value={accountId} onChange={(event) => setAccountId(event.target.value)} className="font-mono" placeholder="system or customer id" />
              <Button variant="outline" onClick={saveAccount}>Apply</Button>
            </div>
            <p className="text-xs text-muted-foreground">Policies and pool reservations are per account. This sets the X-Account-Id used by this page.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <Stat label="Active" value={totals.active} />
            <Stat label="Ready" value={`${totals.ready}/${totals.target}`} />
            <Stat label="Measured storage" value={fmtGib(policies.reduce((sum, policy) => sum + (policy.billing?.billable_gib ?? 0), 0))} />
            <Stat label="Hidden rows" value={poolRows.length} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Zap className="size-4" /> Fast usable claims</CardTitle>
            <CardDescription>Each slot is created, started once, daemon-verified, then stopped. Claims wait for toolbox readiness, not just Incus Running.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4" /> Standby resources</CardTitle>
            <CardDescription>Use stopped Pools for fast starts, or running Pools when you want instant takeover. Usage is accounted centrally in Billing API v2.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Flame className="size-4" /> Exact source + shape</CardTitle>
            <CardDescription>Policies key on account, Machine Template, region, type, vCPU, RAM, and disk. Configure them from the Templates page.</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Policies</CardTitle>
              <CardDescription>Manage user-owned pool policies and primed stopped refills.</CardDescription>
            </div>
            <div className="relative w-full lg:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search policies…" className="pl-8" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Shape</TableHead>
                <TableHead>Pool</TableHead>
                <TableHead>Measured resources</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{policy.name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={statusVariant(policy.status)}>{policy.status}</Badge>
                        <Badge variant={policyPoolMode(policy) === 'running' ? 'default' : 'secondary'}>{policyPoolMode(policy)} pool</Badge>
                        <Badge variant="outline" className="font-mono">{policy.region}</Badge>
                        <Badge variant="outline" className="font-mono">{policy.type}</Badge>
                      </div>
                      <div className="font-mono text-2xs text-muted-foreground">{policy.id}</div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <div className="truncate font-mono text-xs">{sourceLabel(policy)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{policy.resources.vcpu}c · {policy.resources.memory_gb}GB · {policy.resources.disk_gb}GB</div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-mono text-xs">ready {policy.ready} / target {policy.target}</div>
                      {policy.claiming ? <div className="text-2xs text-muted-foreground">{policy.claiming} claiming</div> : null}
                      <Select value={policyPoolMode(policy)} onValueChange={(value) => saveMode(policy, value as PoolMode)}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stopped">Stopped</SelectItem>
                          <SelectItem value="running">Running hot</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          value={targetEdits[policy.id] ?? policy.target}
                          onChange={(event) => setTargetEdits((prev) => ({ ...prev, [policy.id]: Number(event.target.value) || 0 }))}
                          min={0}
                          max={WARM_POOL_TARGET_MAX}
                          className="h-8 w-20"
                        />
                        <Button size="sm" variant="outline" onClick={() => saveTarget(policy)}>Save</Button>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-2xs text-muted-foreground">{fmtGib(policy.billing?.billable_gib)} actual used</div>
                    {policyPoolMode(policy) === 'running' ? (
                      <div className="text-2xs text-muted-foreground">hot vCPU/RAM tracked in Billing API v2</div>
                    ) : null}
                    <div className="text-2xs text-muted-foreground">
                      {policy.billing?.measured_instances ?? 0} measured · cap {policy.billing?.disk_limit_gb_total_cap ?? policy.resources.disk_gb * policy.target}GB
                    </div>
                    {policy.billing?.unmeasured_instances ? (
                      <div className="text-2xs text-amber-600">{policy.billing.unmeasured_instances} slot{policy.billing.unmeasured_instances === 1 ? '' : 's'} missing exact storage measurement</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button size="icon-sm" variant="outline" title="Refill" onClick={() => refill(policy)}><RefreshCw className="size-3.5" /></Button>
                      {policy.status === 'active' ? (
                        <Button size="icon-sm" variant="outline" title="Pause" onClick={() => setStatus(policy, 'paused')}><Pause className="size-3.5" /></Button>
                      ) : (
                        <Button size="icon-sm" variant="outline" title="Resume" onClick={() => setStatus(policy, 'active')}><Play className="size-3.5" /></Button>
                      )}
                      <Button size="icon-sm" variant="destructive" title="Delete" onClick={() => deletePolicy(policy)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No pool policies for this account yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
