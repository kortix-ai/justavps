'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Flame, Gauge, Pause, Play, Plus, RefreshCw, Search, Trash2, Zap } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { ImageItem, PoolAdminState, PoolPolicy } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/components/confirm';
import { CATALOG_IMAGES, catalogForImage, imageDisplayName, imageIdForCreate, imageMatchesMachineType } from '@/lib/image-sources';

type MachineKind = 'container';
type PoolMode = 'stopped' | 'running';
type ImageChoice = { id: string; label: string; kind: 'template' | 'cached' };
type PoolCreatePrefill = { sourceKind: 'image'; imageId: string; type: MachineKind };

const ACCOUNT_KEY = 'v2-admin:warm-pool-account-id';
const WARM_POOL_TARGET_MAX = 500;

function fmtEur(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(value);
}

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

function poolCreatePrefillFromLocation(): PoolCreatePrefill | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const type: MachineKind = 'container';
  const source = params.get('source');
  const imageId = params.get('image_id')?.trim();
  if (source === 'image' && imageId) return { sourceKind: 'image', imageId, type };
  return null;
}

export default function PoolsPage() {
  const { state, request, runAction, refreshAll } = useStore();
  const { confirm } = useConfirm();
  const [accountId, setAccountId] = useState('system');
  const [policies, setPolicies] = useState<PoolPolicy[]>([]);
  const [adminState, setAdminState] = useState<PoolAdminState | null>(null);
  const [initialCreatePrefill] = useState(() => poolCreatePrefillFromLocation());
  const [createPrefill, setCreatePrefill] = useState<PoolCreatePrefill | null>(initialCreatePrefill);
  const [createOpen, setCreateOpen] = useState(Boolean(initialCreatePrefill));
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
    monthly: policies.reduce((sum, policy) => sum + (policy.billing?.total_eur_month ?? 0), 0),
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
          <Button onClick={() => { setCreatePrefill(null); setCreateOpen(true); }}>
            <Plus className="size-3.5" /> New policy
          </Button>
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
            <Stat label="Measured storage/mo" value={fmtEur(totals.monthly)} />
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
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4" /> Stopped standby billing</CardTitle>
            <CardDescription>Use stopped Pools for cheap fast-start storage, or running Pools when you want instant takeover and accept hot CPU/RAM billing.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Flame className="size-4" /> Exact source + shape</CardTitle>
            <CardDescription>Policies key on account, image, region, type, vCPU, RAM, and disk. User-owned images work without a golden-image requirement.</CardDescription>
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
                <TableHead>Billing</TableHead>
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
                    <div className="font-medium">{fmtEur(policy.billing?.total_eur_month)}/mo</div>
                    <div className="text-2xs text-muted-foreground">{fmtGib(policy.billing?.billable_gib)} actual used</div>
                    {policyPoolMode(policy) === 'running' ? (
                      <div className="text-2xs text-muted-foreground">{fmtEur(policy.billing?.hot_resource_eur_month)} hot CPU/RAM</div>
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

      <CreatePoolPolicyDialog
        key={createPrefill ? `${createPrefill.sourceKind}:${createPrefill.imageId}:${createPrefill.type}` : 'blank'}
        open={createOpen}
        onOpenChange={setCreateOpen}
        prefill={createPrefill}
        accountId={accountId}
        images={state.images}
        regions={state.regions}
        request={request}
        runAction={runAction}
        onCreated={() => load().catch(() => {})}
      />
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

function CreatePoolPolicyDialog({
  open,
  onOpenChange,
  prefill,
  accountId,
  images,
  regions,
  request,
  runAction,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  prefill: PoolCreatePrefill | null;
  accountId: string;
  images: ImageItem[];
  regions: string[];
  request: ReturnType<typeof useStore>['request'];
  runAction: ReturnType<typeof useStore>['runAction'];
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const type: MachineKind = 'container';
  const [region, setRegion] = useState('eu');
  const [imageId, setImageId] = useState(prefill?.sourceKind === 'image' ? prefill.imageId : '');
  const [customImageId, setCustomImageId] = useState(prefill?.sourceKind === 'image' ? prefill.imageId : '');
  const [mode, setMode] = useState<PoolMode>('stopped');
  const [target, setTarget] = useState(1);
  const [vcpu, setVcpu] = useState(2);
  const [memoryGb, setMemoryGb] = useState(2);
  const [diskGb, setDiskGb] = useState(10);
  const [error, setError] = useState<string | null>(null);

  const regionChoices = regions.length ? regions : ['eu'];
  const selectedRegion = regionChoices.includes(region) ? region : regionChoices[0] ?? 'eu';

  const imageChoices = useMemo(() => {
    const choices: ImageChoice[] = [];
    const seen = new Set<string>();
    for (const image of CATALOG_IMAGES.filter((item) => item.type === type)) {
      choices.push({ id: image.id, label: `${image.name} · template`, kind: 'template' });
      seen.add(image.id);
    }
    for (const image of images.filter((item) => imageMatchesMachineType(item, type))) {
      const id = imageIdForCreate(image);
      if (!id || seen.has(id)) continue;
      const catalog = catalogForImage(image);
      choices.push({ id, label: `${imageDisplayName(image)} · ${catalog ? 'template cache' : 'cached image'}`, kind: catalog ? 'template' : 'cached' });
      seen.add(id);
    }
    return choices;
  }, [images, type]);

  const selectedPickerImageId = imageChoices.some((choice) => choice.id === imageId) ? imageId : imageChoices[0]?.id ?? '';
  const selectedImageId = customImageId.trim() || selectedPickerImageId;
  const source = selectedImageId ? { type: 'image', image_id: selectedImageId } : null;

  const monthly = useMemo(() => {
    // UI estimate only. API recomputes from actual measured storage and hot slot count.
    const seconds = 730 * 3600;
    const storageUpperBound = (diskGb * seconds * 0.17) / 1_000_000;
    const hot = mode === 'running' ? ((vcpu * 4.4 + memoryGb * 1.3) * seconds) / 1_000_000 : 0;
    return (storageUpperBound + hot) * target;
  }, [diskGb, memoryGb, mode, target, vcpu]);

  async function submit() {
    setError(null);
    if (!source) return setError('Pick a source first.');
    if (!selectedRegion) return setError('Pick a region first.');
    try {
      await runAction(`create pool ${name || 'image'}`, async () => {
        const result = await request('/warm-pool-policies', {
          method: 'POST',
          headers: { 'X-Account-Id': accountId },
          body: {
            name: name.trim() || undefined,
            region: selectedRegion,
            type,
            mode,
            source,
            target,
            resources: { vcpu, memory_gb: memoryGb, disk_gb: diskGb },
          } as never,
        });
        toast.success('Pool policy created');
        onCreated();
        onOpenChange(false);
        setName('');
        setMode('stopped');
        return result;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create pool policy</DialogTitle>
          <DialogDescription>
            Choose a per-account source, shape, and Pool mode. Stopped Pools are cheap; running Pools are hot and can be taken over immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            Account <span className="font-mono text-foreground">{accountId}</span> will be billed according to the selected Pool mode while this policy is active.
          </div>
          {prefill ? (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs">
              Source prefilled from image/template: <span className="font-mono">{prefill.imageId}</span>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. API worker pool" maxLength={80} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">Container</div>
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select value={selectedRegion} onValueChange={setRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{regionChoices.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Pool mode</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as PoolMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stopped">Stopped standby · cheaper, starts on claim</SelectItem>
                <SelectItem value="running">Running hot standby · instant takeover, hot billing</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">
              Stopped slots bill measured local storage only. Running slots stay live and bill CPU/RAM plus measured local storage until claimed.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <Label>Source</Label>
            <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
              <span className="block font-medium">Image/template</span>
              <span className="text-2xs text-muted-foreground">Pools are image-only for now. Snapshot creates still work outside the Pool feature.</span>
            </div>
            <div className="space-y-1.5">
              <Label>Image</Label>
              <Select value={selectedPickerImageId} onValueChange={(value) => { setImageId(value); setCustomImageId(''); }}>
                <SelectTrigger><SelectValue placeholder="Pick image…" /></SelectTrigger>
                <SelectContent>
                  {imageChoices.map((choice) => <SelectItem key={`${choice.kind}-${choice.id}`} value={choice.id}>{choice.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="space-y-1.5 pt-2">
                <Label>Custom image/template ID</Label>
                <Input
                  value={customImageId}
                  onChange={(event) => setCustomImageId(event.target.value)}
                  placeholder="optional alias, fingerprint, or per-user template id"
                  className="font-mono text-xs"
                />
                <p className="text-2xs text-muted-foreground">
                  Use this when a user-specific/template-marked image is not in the dropdown yet. The reservation still belongs to account {accountId}.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>Target</Label>
              <Input type="number" min={0} max={WARM_POOL_TARGET_MAX} value={target} onChange={(event) => setTarget(Math.max(0, Math.min(WARM_POOL_TARGET_MAX, Number(event.target.value) || 0)))} />
            </div>
            <div className="space-y-1.5">
              <Label>vCPU</Label>
              <Input type="number" min={1} value={vcpu} onChange={(event) => setVcpu(Number(event.target.value) || 1)} />
            </div>
            <div className="space-y-1.5">
              <Label>RAM GB</Label>
              <Input type="number" min={1} value={memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value) || 1)} />
            </div>
            <div className="space-y-1.5">
              <Label>Disk GB</Label>
              <Input type="number" min={1} value={diskGb} onChange={(event) => setDiskGb(Number(event.target.value) || 1)} />
            </div>
          </div>
          <div className="rounded-lg border bg-emerald-500/10 p-3 text-sm">
            <div>Estimated {mode} pool reservation: <span className="font-semibold">{fmtEur(monthly)}/mo</span></div>
            <div className="mt-1 text-xs text-muted-foreground">
              Target {target} means the maintainer keeps {target} primed {mode === 'running' ? 'running' : 'stopped'} machine{target === 1 ? '' : 's'} ready for this image/template. {mode === 'running' ? 'Claims skip Incus start and take over a live slot.' : 'Claims start the stopped slot and wait for usability checks.'}
            </div>
          </div>
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Create and refill</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
