'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import {
  Boxes,
  CheckCircle2,
  FilterX,
  Flame,
  Gauge,
  HardDrive,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import type { BackupItem, Machine, MachineTemplate, PoolPolicy, SnapshotItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfirm } from '@/components/confirm';
import { ResourceList, ResourceStatCard, type ResourceColumn } from '@/components/resource-list';
import { formatBytes } from '@/lib/utils';

type PoolMode = 'stopped' | 'running';
type PoolEdit = Record<PoolMode, { target: number }>;
type StartStrategy = 'auto' | 'running_pool' | 'stopped_pool' | 'cold';
type TemplateSource = 'simplestreams' | 'docker' | 'image' | 'machine' | 'snapshot' | 'backup';
type StatusFilter = 'all' | 'active' | 'preparing' | 'other';
type VisibilityFilter = 'all' | 'catalog' | 'private';
type TemplateDetailTab = 'overview' | 'pools' | 'launch' | 'danger';

type BrowseTemplatePreset = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  source: 'simplestreams' | 'docker';
  ref: string;
  server?: string;
  availability: 'verified' | 'candidate' | 'planned';
  sourceNote?: string;
  default_resources: MachineTemplate['default_resources'];
  tags: string[];
};

type BrowseRow = {
  preset: BrowseTemplatePreset;
  installed: MachineTemplate | null;
};

const ACCOUNT_KEY = 'v2-admin:template-account-id';

const BROWSE_TEMPLATES: BrowseTemplatePreset[] = [
  {
    id: 'ubuntu-24-04',
    name: 'Ubuntu 24.04',
    slug: 'justavps-ubuntu-24.04-template',
    description: 'Default JustAVPS Ubuntu base. Public catalog Template, daemon baked, second-boot verified.',
    category: 'Linux',
    source: 'simplestreams',
    ref: 'ubuntu/24.04',
    availability: 'verified',
    default_resources: { vcpu: 2, memory_gb: 2, disk_gb: 10 },
    tags: ['catalog', 'recommended', 'apt'],
  },
  {
    id: 'debian-12',
    name: 'Debian 12',
    slug: 'debian-12',
    description: 'Small stable Debian base for general workloads. Needs one JustAVPS bake/second-boot verification before we call it supported.',
    category: 'Linux',
    source: 'simplestreams',
    ref: 'debian/12',
    availability: 'candidate',
    default_resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
    tags: ['candidate', 'apt'],
  },
  {
    id: 'alpine-3-20',
    name: 'Alpine 3.20',
    slug: 'alpine-3-20',
    description: 'Tiny Docker/OCI Alpine base. Useful for smoke tests and minimal agents.',
    category: 'Docker / OCI',
    source: 'docker',
    ref: 'alpine:3.20',
    availability: 'verified',
    default_resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
    tags: ['tested', 'apk', 'minimal'],
  },
];

function fmtEur(value: number | null | undefined, max = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: max }).format(value);
}

function fmtGib(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 10 ? 1 : 3 }).format(value)} GiB`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function poolFor(template: MachineTemplate, mode: PoolMode): PoolPolicy | null {
  return template.pools?.[mode] ?? (template.pool && poolMode(template.pool) === mode ? template.pool : null);
}

function poolMode(policy?: PoolPolicy | null): PoolMode {
  if (!policy) return 'stopped';
  return policy.pool_mode === 'running' || policy.mode === 'primed_running_exact' ? 'running' : 'stopped';
}

function poolTarget(template: MachineTemplate, mode: PoolMode) {
  return poolFor(template, mode)?.target ?? 0;
}

function poolEditFor(template: MachineTemplate): PoolEdit {
  return {
    stopped: { target: poolTarget(template, 'stopped') },
    running: { target: poolTarget(template, 'running') },
  };
}

function resourceLabel(resources: MachineTemplate['default_resources']) {
  return `${resources.vcpu}c · ${resources.memory_gb}GB RAM · ${resources.disk_gb}GB disk`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'preparing') return 'secondary';
  if (status === 'failed' || status === 'deleted') return 'destructive';
  return 'outline';
}

function templateText(template: MachineTemplate) {
  return [
    template.name,
    template.slug,
    template.id,
    template.status,
    template.visibility,
    template.region,
    template.source?.type,
    template.source?.ref,
    template.image?.alias,
  ].filter(Boolean).join(' ').toLowerCase();
}

function presetText(row: BrowseRow) {
  const p = row.preset;
  return [p.name, p.slug, p.description, p.category, p.source, p.ref, ...p.tags].join(' ').toLowerCase();
}

function installedForPreset(templates: MachineTemplate[], preset: BrowseTemplatePreset) {
  return templates.find((template) => template.slug === preset.slug || template.image?.alias === preset.slug || template.name.toLowerCase() === preset.name.toLowerCase()) ?? null;
}

function browseBadge(row: BrowseRow) {
  if (row.installed) return 'installed';
  if (row.preset.availability === 'verified') return 'verified';
  if (row.preset.availability === 'candidate') return 'test candidate';
  return 'planned';
}

function canCreateFromPreset(row: BrowseRow) {
  return !row.installed && row.preset.availability !== 'planned';
}

function templateDetailFromHash(): { ref: string; tab: TemplateDetailTab } | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.startsWith('#template-') ? window.location.hash.slice('#template-'.length) : '';
  if (!raw) return null;
  const [encodedRef, rawTab] = raw.split(':');
  const tab = ['overview', 'pools', 'launch', 'danger'].includes(rawTab) ? rawTab as TemplateDetailTab : 'overview';
  return { ref: decodeURIComponent(encodedRef), tab };
}

function templateHash(template: MachineTemplate, tab: TemplateDetailTab = 'overview') {
  return `#template-${encodeURIComponent(template.id)}${tab === 'overview' ? '' : `:${tab}`}`;
}

export default function TemplatesPage() {
  const { state, request, runAction, refreshAll } = useStore();
  const { confirm } = useConfirm();
  const [accountId, setAccountId] = useState('system');
  const [templates, setTemplates] = useState<MachineTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPreset, setCreatePreset] = useState<BrowseTemplatePreset | null>(null);
  const [detailState, setDetailState] = useState<{ ref: string; tab: TemplateDetailTab } | null>(() => templateDetailFromHash());
  const [poolEdits, setPoolEdits] = useState<Record<string, PoolEdit>>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');

  useEffect(() => {
    if (typeof window !== 'undefined') setAccountId(window.localStorage.getItem(ACCOUNT_KEY) || 'system');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => setDetailState(templateDetailFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const accountHeaders = useMemo(() => ({ 'X-Account-Id': accountId }), [accountId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<{ templates: MachineTemplate[] }>('/machine-templates', { headers: accountHeaders });
      const rows = data.templates ?? [];
      setTemplates(rows);
      setPoolEdits(Object.fromEntries(rows.map((template) => [template.id, poolEditFor(template)])));
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
    const timer = window.setInterval(() => load().catch(() => {}), 8000);
    return () => window.clearInterval(timer);
  }, [load, state.baseUrl]);

  function saveAccount() {
    const next = accountId.trim() || 'system';
    if (typeof window !== 'undefined') window.localStorage.setItem(ACCOUNT_KEY, next);
    setAccountId(next);
    toast.success(`Template account set to ${next}`);
  }

  function openCreate(preset: BrowseTemplatePreset | null = null) {
    setCreatePreset(preset);
    setCreateOpen(true);
  }

  async function action<T>(label: string, fn: () => Promise<T>) {
    return runAction(label, async () => {
      const result = await fn();
      await Promise.all([load(), refreshAll()]);
      return result;
    });
  }

  async function savePool(template: MachineTemplate, mode: PoolMode, status: 'active' | 'paused' = poolFor(template, mode)?.status === 'paused' ? 'paused' : 'active') {
    const edit = poolEdits[template.id]?.[mode] ?? { target: poolTarget(template, mode) };
    await action(`save ${template.name} ${mode} pool`, () => request(`/machine-templates/${encodeURIComponent(template.id)}/pool`, {
      method: 'PUT',
      headers: accountHeaders,
      body: { target: edit.target, mode, status } as never,
    }));
  }

  async function refill(template: MachineTemplate, mode: PoolMode) {
    await action(`refill ${template.name} ${mode} pool`, () => request(`/machine-templates/${encodeURIComponent(template.id)}/pool/refill?mode=${mode}`, { method: 'POST', headers: accountHeaders }));
  }

  async function deletePool(template: MachineTemplate, mode: PoolMode) {
    if (!await confirm({
      title: `Delete ${template.name} ${mode} Pool?`,
      description: `Unclaimed ${mode} standby rows for this Template will be drained. Claimed Machines are untouched.`,
      confirmLabel: 'Delete Pool',
      destructive: true,
    })) return;
    await action(`delete ${template.name} ${mode} pool`, () => request(`/machine-templates/${encodeURIComponent(template.id)}/pool?mode=${mode}`, { method: 'DELETE', headers: accountHeaders }));
  }

  async function deleteTemplate(template: MachineTemplate) {
    if (!await confirm({
      title: `Delete Machine Template “${template.name}”?`,
      description: 'This removes the Template from the product catalog and drains its unclaimed Pool rows. Existing Machines are not deleted.',
      confirmLabel: 'Delete Template',
      destructive: true,
    })) return false;
    await action(`delete ${template.name}`, () => request(`/machine-templates/${encodeURIComponent(template.id)}`, { method: 'DELETE', headers: accountHeaders }));
    return true;
  }

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === detailState?.ref || template.slug === detailState?.ref) ?? null, [detailState?.ref, templates]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTemplates = useMemo(() => templates.filter((template) => {
    if (normalizedQuery && !templateText(template).includes(normalizedQuery)) return false;
    if (statusFilter === 'active' && template.status !== 'active') return false;
    if (statusFilter === 'preparing' && template.status !== 'preparing') return false;
    if (statusFilter === 'other' && ['active', 'preparing'].includes(template.status)) return false;
    if (visibilityFilter !== 'all' && template.visibility !== visibilityFilter) return false;
    return true;
  }), [normalizedQuery, statusFilter, templates, visibilityFilter]);
  const browseRows = useMemo(() => BROWSE_TEMPLATES.map((preset) => ({ preset, installed: installedForPreset(templates, preset) })), [templates]);
  const filteredBrowseRows = useMemo(() => browseRows.filter((row) => !normalizedQuery || presetText(row).includes(normalizedQuery)), [browseRows, normalizedQuery]);
  const hasActiveFilters = Boolean(normalizedQuery) || statusFilter !== 'all' || visibilityFilter !== 'all';

  const totals = useMemo(() => ({
    active: templates.filter((template) => template.status === 'active').length,
    catalog: templates.filter((template) => template.visibility === 'catalog').length,
    readyPool: templates.reduce((sum, template) => sum + (poolFor(template, 'running')?.ready ?? 0) + (poolFor(template, 'stopped')?.ready ?? 0), 0),
    targetPool: templates.reduce((sum, template) => sum + (poolFor(template, 'running')?.target ?? 0) + (poolFor(template, 'stopped')?.target ?? 0), 0),
    poolMonthly: templates.reduce((sum, template) => sum + (poolFor(template, 'running')?.billing?.total_eur_month ?? 0) + (poolFor(template, 'stopped')?.billing?.total_eur_month ?? 0), 0),
  }), [templates]);

  const templateColumns = useMemo<ResourceColumn<MachineTemplate>[]>(() => [
    {
      key: 'template',
      header: 'Template',
      className: 'min-w-[300px] whitespace-normal',
      cell: (template) => (
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Boxes className="size-4" /></div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-medium">{template.name}</span>
              <Badge variant={statusVariant(template.status)}>{template.status}</Badge>
              <Badge variant={template.visibility === 'catalog' ? 'default' : 'secondary'}>{template.visibility}</Badge>
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground">{template.slug}</div>
            <div className="truncate text-2xs text-muted-foreground">{template.source?.type ?? 'unknown'} · {template.source?.ref ?? template.image?.alias ?? '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'size',
      header: 'Default size',
      cell: (template) => <div className="font-mono text-xs text-muted-foreground">{resourceLabel(template.default_resources)}</div>,
    },
    {
      key: 'readiness',
      header: 'Readiness',
      cell: (template) => (
        <div className="space-y-1 text-xs">
          <Badge variant={template.readiness?.ready ? 'default' : 'secondary'}>{template.readiness?.ready ? 'ready' : 'not ready'}</Badge>
          <div className="text-muted-foreground">2nd boot {template.readiness?.daemon_second_boot_verified ? 'verified' : 'pending'}</div>
        </div>
      ),
    },
    {
      key: 'pools',
      header: 'Pools',
      cell: (template) => {
        const running = poolFor(template, 'running');
        const stopped = poolFor(template, 'stopped');
        return (
          <div className="space-y-1 font-mono text-xs text-muted-foreground">
            <div>hot {running?.ready ?? 0}/{running?.target ?? 0}</div>
            <div>stopped {stopped?.ready ?? 0}/{stopped?.target ?? 0}</div>
          </div>
        );
      },
    },
    {
      key: 'storage',
      header: 'Storage',
      cell: (template) => {
        const storageBytes = template.storage?.metered_bytes ?? (template.image?.size == null ? null : Number(template.image.size));
        return <div className="text-xs text-muted-foreground">{storageBytes ? formatBytes(storageBytes) : fmtGib(template.storage?.billable_gib)}<br />{fmtEur(template.storage?.eur_per_month)}/mo</div>;
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'w-44 text-right',
      className: 'text-right whitespace-nowrap',
      cell: (template) => (
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          <Button size="sm" variant="outline" asChild><a href={templateHash(template)}>Open</a></Button>
          <Button size="sm" asChild aria-disabled={template.status !== 'active' || !template.readiness?.ready}><a href={templateHash(template, 'launch')}>Launch</a></Button>
        </div>
      ),
    },
  ], []);

  const browseColumns = useMemo<ResourceColumn<BrowseRow>[]>(() => [
    {
      key: 'template',
      header: 'Catalog Template',
      className: 'min-w-[340px] whitespace-normal',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Sparkles className="size-4" /></div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-medium">{row.preset.name}</span>
              <Badge variant={row.installed || row.preset.availability === 'verified' ? 'default' : 'outline'}>{browseBadge(row)}</Badge>
              <Badge variant="secondary">{row.preset.category}</Badge>
            </div>
            <div className="line-clamp-2 text-xs text-muted-foreground">{row.preset.description}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      cell: (row) => <div className="max-w-44 whitespace-normal text-xs text-muted-foreground"><div className="font-mono">{row.preset.source}<br />{row.preset.ref}</div>{row.preset.sourceNote ? <div className="mt-1 text-2xs">{row.preset.sourceNote}</div> : null}</div>,
    },
    {
      key: 'size',
      header: 'Default size',
      cell: (row) => <div className="font-mono text-xs text-muted-foreground">{resourceLabel(row.preset.default_resources)}</div>,
    },
    {
      key: 'tags',
      header: 'Tags',
      className: 'whitespace-normal',
      cell: (row) => <div className="flex max-w-64 flex-wrap gap-1">{row.preset.tags.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}</div>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'w-44 text-right',
      className: 'text-right whitespace-nowrap',
      cell: (row) => (
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {row.installed ? (
            <Button size="sm" variant="outline" asChild><a href={templateHash(row.installed)}>Open installed</a></Button>
          ) : row.preset.availability === 'planned' ? (
            <Button size="sm" variant="outline" disabled>Coming soon</Button>
          ) : (
            <Button size="sm" onClick={() => openCreate(row.preset)}><Plus className="size-3.5" /> Add</Button>
          )}
        </div>
      ),
    },
  ], []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Machine Templates</h1>
          <p className="text-sm text-muted-foreground">
            Installed Templates are a list. Click a row to open details, launch Machines, and manage Running Hot + Stopped Pools.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => load().catch(() => {})} disabled={loading || state.busy}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus className="size-3.5" /> New Template
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <ResourceStatCard icon={Boxes} label="Installed" value={templates.length} sub={`${totals.active} active`} />
        <ResourceStatCard icon={Sparkles} label="Public catalog" value={totals.catalog} sub="Visible to every account" />
        <ResourceStatCard icon={Zap} label="Pool ready" value={`${totals.readyPool}/${totals.targetPool}`} sub="hot + stopped slots" />
        <ResourceStatCard icon={Gauge} label="Pool estimate" value={`${fmtEur(totals.poolMonthly)}/mo`} sub="measured storage + hot" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1.5">
            <Label htmlFor="template-account">Account context</Label>
            <div className="flex gap-2">
              <Input id="template-account" value={accountId} onChange={(event) => setAccountId(event.target.value)} className="font-mono" placeholder="system or customer id" />
              <Button variant="outline" onClick={saveAccount}>Apply</Button>
            </div>
            <p className="text-xs text-muted-foreground">Private Templates and Pools are account-scoped. Catalog Templates are shown for every account.</p>
          </div>
          <div className="grid gap-2 text-xs md:grid-cols-3">
            <MiniInfo icon={Rocket} label="Launch order" value="Running Hot → Stopped → Cold" />
            <MiniInfo icon={HardDrive} label="Stopped Pool" value="measured disk only" />
            <MiniInfo icon={Flame} label="Running Hot" value="CPU/RAM billed while ready" />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="installed" className="flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList>
            <TabsTrigger value="installed">Installed Templates</TabsTrigger>
            <TabsTrigger value="browse">Browse catalog</TabsTrigger>
          </TabsList>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1fr)_150px_150px_auto]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates, sources, tags..." className="pl-8" />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="preparing">Preparing</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={visibilityFilter} onValueChange={(value) => setVisibilityFilter(value as VisibilityFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All visibility</SelectItem>
                <SelectItem value="catalog">Catalog</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters ? <Button variant="outline" onClick={() => { setQuery(''); setStatusFilter('all'); setVisibilityFilter('all'); }}><FilterX className="size-3.5" /> Clear</Button> : null}
          </div>
        </div>

        <TabsContent value="installed" className="mt-0">
          <ResourceList
            title="Installed Templates"
            description={`${filteredTemplates.length} of ${templates.length} Templates · click a row for details, Pools, launch, and danger settings`}
            rows={filteredTemplates}
            columns={templateColumns}
            rowKey={(template) => template.id}
            onRowClick={(template) => { window.location.hash = templateHash(template); }}
            empty={<EmptyTemplates onCreate={() => openCreate()} />}
            footer="Template Pool settings moved into the detail modal so the list stays dense and consistent with Machines/Pools."
          />
        </TabsContent>

        <TabsContent value="browse" className="mt-0 space-y-4">
          <TemplateSourceGuide />
          <ResourceList
            title="Browse catalog"
            description="Known-good OS bases and test candidates. Runtime images are intentionally not listed as boot Templates."
            rows={filteredBrowseRows}
            columns={browseColumns}
            rowKey={(row) => row.preset.id}
            onRowClick={(row) => { if (row.installed) window.location.hash = templateHash(row.installed); else if (canCreateFromPreset(row)) openCreate(row.preset); }}
            empty={<div className="text-sm text-muted-foreground">No catalog presets match the current search.</div>}
            footer="A source only becomes supported after Template prep installs the JustAVPS daemon and passes first-boot plus second-boot verification."
          />
        </TabsContent>
      </Tabs>

      <NewTemplateDialog
        key={createPreset?.id ?? 'blank-template'}
        open={createOpen}
        onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreatePreset(null); }}
        accountId={accountId}
        machines={state.machines.filter((machine) => machine.type === 'container')}
        preset={createPreset}
        regions={state.regions}
        request={request}
        runAction={runAction}
        refresh={() => Promise.all([load(), refreshAll()]).then(() => undefined)}
        busy={state.busy}
      />

      <TemplateDetailDialog
        key={selectedTemplate?.id ?? 'closed'}
        template={selectedTemplate}
        initialTab={detailState?.tab ?? 'overview'}
        poolEdits={poolEdits}
        setPoolEdits={setPoolEdits}
        onOpenChange={(open) => {
          if (!open) {
            setDetailState(null);
            if (typeof window !== 'undefined' && window.location.hash.startsWith('#template-')) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
          }
        }}
        savePool={savePool}
        refill={refill}
        deletePool={deletePool}
        deleteTemplate={deleteTemplate}
        accountHeaders={accountHeaders}
        request={request}
        runAction={runAction}
        refresh={() => Promise.all([load(), refreshAll()]).then(() => undefined)}
        busy={state.busy}
      />
    </div>
  );
}

function MiniInfo({ icon: Icon, label, value }: { icon: typeof Rocket; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground"><Icon className="size-3" /> {label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function EmptyTemplates({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-sm text-muted-foreground">
      <Boxes className="size-8" />
      <div className="font-medium text-foreground">No installed Templates match this view</div>
      <div>The public Ubuntu Template should auto-seed into the API catalog. You can also browse presets or create one from Docker, an image, snapshot, or backup.</div>
      <Button size="sm" onClick={onCreate}><Plus className="size-3.5" /> New Template</Button>
    </div>
  );
}

function TemplateSourceGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What can become a Machine Template?</CardTitle>
        <CardDescription>
          We only show OS/base images here. Runtime stacks like Node, Python, or Go should be baked on top of a verified OS Template, not imported as raw app Docker images.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <SourceRule icon={CheckCircle2} title="Best" body="Incus/Linux OS images: Ubuntu, Debian, Alpine. They have normal boot semantics and package managers." />
        <SourceRule icon={ShieldCheck} title="Allowed after verification" body="Docker/OCI base images with /bin/sh and install tooling. Alpine passed; others must pass daemon bake + second boot." />
        <SourceRule icon={Server} title="Not catalog boot images" body="Runtime/app images like node:*, python:*, golang:* are stack recipes. We install those onto a verified base Template instead." />
      </CardContent>
    </Card>
  );
}

function SourceRule({ icon: Icon, title, body }: { icon: typeof CheckCircle2; title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon className="size-4" /> {title}</div>
      <p className="text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function TemplateDetailDialog({
  template,
  initialTab,
  poolEdits,
  setPoolEdits,
  onOpenChange,
  savePool,
  refill,
  deletePool,
  deleteTemplate,
  accountHeaders,
  request,
  runAction,
  refresh,
  busy,
}: {
  template: MachineTemplate | null;
  initialTab: TemplateDetailTab;
  poolEdits: Record<string, PoolEdit>;
  setPoolEdits: Dispatch<SetStateAction<Record<string, PoolEdit>>>;
  onOpenChange: (open: boolean) => void;
  savePool: (template: MachineTemplate, mode: PoolMode, status?: 'active' | 'paused') => Promise<void>;
  refill: (template: MachineTemplate, mode: PoolMode) => Promise<void>;
  deletePool: (template: MachineTemplate, mode: PoolMode) => Promise<void>;
  deleteTemplate: (template: MachineTemplate) => Promise<boolean>;
  accountHeaders: Record<string, string>;
  request: ReturnType<typeof useStore>['request'];
  runAction: ReturnType<typeof useStore>['runAction'];
  refresh: () => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<StartStrategy>('auto');
  const [customSize, setCustomSize] = useState(false);
  const resources = template?.default_resources ?? { vcpu: 2, memory_gb: 2, disk_gb: 10 };
  const [vcpu, setVcpu] = useState(resources.vcpu);
  const [memoryGb, setMemoryGb] = useState(resources.memory_gb);
  const [diskGb, setDiskGb] = useState(resources.disk_gb);
  const [error, setError] = useState<string | null>(null);

  if (!template) return null;
  const templateForLaunch = template;

  const edit = poolEdits[template.id] ?? poolEditFor(template);
  const storageBytes = template.storage?.metered_bytes ?? (template.image?.size == null ? null : Number(template.image.size));

  async function launch() {
    setError(null);
    try {
      await runAction(`create ${name || templateForLaunch.name}`, async () => {
        const requestId = crypto.randomUUID();
        const result = await request('/machines', {
          method: 'POST',
          headers: { ...accountHeaders, 'X-JustAVPS-Request-Id': requestId },
          body: {
            name: name.trim() || undefined,
            template_id: templateForLaunch.id,
            start_strategy: strategy,
            resources: customSize ? { vcpu, memory_gb: memoryGb, disk_gb: diskGb } : undefined,
          } as never,
        });
        toast.success('Machine created from Template');
        await refresh();
        onOpenChange(false);
        return result;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Dialog open={Boolean(template)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{template.name}</DialogTitle>
            <Badge variant={statusVariant(template.status)}>{template.status}</Badge>
            <Badge variant={template.visibility === 'catalog' ? 'default' : 'secondary'}>{template.visibility}</Badge>
          </div>
          <DialogDescription className="font-mono">{template.slug} · {template.region} · {template.id}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={initialTab} className="flex-col gap-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="pools">Pools</TabsTrigger>
            <TabsTrigger value="launch">Launch</TabsTrigger>
            <TabsTrigger value="danger">Danger</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <ResourceStatCard icon={Server} label="Region" value={template.region} sub={template.type} />
              <ResourceStatCard icon={Gauge} label="Default size" value={`${template.default_resources.vcpu}c/${template.default_resources.memory_gb}G`} sub={`${template.default_resources.disk_gb}GB disk`} />
              <ResourceStatCard icon={HardDrive} label="Image storage" value={storageBytes ? formatBytes(storageBytes) : fmtGib(template.storage?.billable_gib)} sub={`${fmtEur(template.storage?.eur_per_month)}/mo`} />
              <ResourceStatCard icon={ShieldCheck} label="Readiness" value={template.readiness?.ready ? 'Ready' : 'Pending'} sub={template.readiness?.daemon_second_boot_verified ? 'second boot verified' : 'needs verification'} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-4" /> Boot contract</CardTitle>
                  <CardDescription>Templates must be JustAVPS-ready before they can launch user Machines.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <DetailLine label="Daemon baked" value={String(Boolean(template.readiness?.daemon_baked))} />
                  <DetailLine label="First boot verified" value={String(Boolean(template.readiness?.daemon_first_boot_verified))} />
                  <DetailLine label="Second boot verified" value={String(Boolean(template.readiness?.daemon_second_boot_verified))} />
                  <DetailLine label="Prepared" value={formatDate(template.readiness?.prepared_at)} />
                  <DetailLine label="Verified" value={formatDate(template.readiness?.verified_at)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Source + image</CardTitle>
                  <CardDescription>Images are plumbing; this Template is the product primitive users launch from.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <DetailLine label="Source" value={`${template.source?.type ?? 'unknown'} · ${template.source?.ref ?? '—'}`} />
                  <DetailLine label="Alias" value={template.image?.alias ?? '—'} mono />
                  <DetailLine label="Fingerprint" value={template.image?.fingerprint ?? '—'} mono />
                  <DetailLine label="Cluster" value={template.image?.cluster_id ?? '—'} mono />
                  <DetailLine label="Project" value={template.image?.project ?? '—'} mono />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="pools" className="mt-0 space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              Auto launch checks <span className="font-medium text-foreground">Running Hot</span> first, then <span className="font-medium text-foreground">Stopped Pool</span>, then cold create. Both pools can coexist for the same Template.
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <PoolEditor template={template} mode="running" edit={edit.running} setPoolEdits={setPoolEdits} savePool={savePool} refill={refill} deletePool={deletePool} />
              <PoolEditor template={template} mode="stopped" edit={edit.stopped} setPoolEdits={setPoolEdits} savePool={savePool} refill={refill} deletePool={deletePool} />
            </div>
          </TabsContent>

          <TabsContent value="launch" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Launch Machine</CardTitle>
                <CardDescription>Create a Machine from this Template and choose how aggressively to use Pools.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Display name</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="optional" maxLength={80} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Start strategy</Label>
                    <Select value={strategy} onValueChange={(value) => setStrategy(value as StartStrategy)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto · Running Hot → Stopped Pool → Cold</SelectItem>
                        <SelectItem value="running_pool">Running Hot Pool only</SelectItem>
                        <SelectItem value="stopped_pool">Stopped Pool only</SelectItem>
                        <SelectItem value="cold">Cold create only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Availability: hot {poolFor(template, 'running')?.ready ?? 0}/{poolFor(template, 'running')?.target ?? 0} · stopped {poolFor(template, 'stopped')?.ready ?? 0}/{poolFor(template, 'stopped')?.target ?? 0}.
                </div>
                <Button type="button" variant="outline" onClick={() => {
                  if (!customSize) {
                    setVcpu(template.default_resources.vcpu);
                    setMemoryGb(template.default_resources.memory_gb);
                    setDiskGb(template.default_resources.disk_gb);
                  }
                  setCustomSize((value) => !value);
                  setError(null);
                }}>{customSize ? 'Use Template default size' : 'Customize initial size'}</Button>
                {customSize ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5"><Label>vCPU</Label><Input type="number" min={1} value={vcpu} onChange={(event) => setVcpu(Number(event.target.value) || 1)} /></div>
                    <div className="space-y-1.5"><Label>RAM GB</Label><Input type="number" min={1} value={memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value) || 1)} /></div>
                    <div className="space-y-1.5"><Label>Disk GB</Label><Input type="number" min={1} value={diskGb} onChange={(event) => setDiskGb(Number(event.target.value) || 1)} /></div>
                  </div>
                ) : null}
                {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="danger" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Danger zone</CardTitle>
                <CardDescription>Deleting a Template drains unclaimed Pool rows. Existing claimed Machines are not deleted.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="destructive" disabled={template.visibility === 'catalog'} onClick={async () => {
                  const deleted = await deleteTemplate(template);
                  if (deleted) onOpenChange(false);
                }}>
                  <Trash2 className="size-3.5" /> Delete Template
                </Button>
                {template.visibility === 'catalog' ? <div className="mt-2 text-xs text-muted-foreground">Catalog Templates cannot be deleted from an account view.</div> : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={launch} disabled={busy || template.status !== 'active' || !template.readiness?.ready}>Launch Machine</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PoolEditor({
  template,
  mode,
  edit,
  setPoolEdits,
  savePool,
  refill,
  deletePool,
}: {
  template: MachineTemplate;
  mode: PoolMode;
  edit: { target: number };
  setPoolEdits: Dispatch<SetStateAction<Record<string, PoolEdit>>>;
  savePool: (template: MachineTemplate, mode: PoolMode, status?: 'active' | 'paused') => Promise<void>;
  refill: (template: MachineTemplate, mode: PoolMode) => Promise<void>;
  deletePool: (template: MachineTemplate, mode: PoolMode) => Promise<void>;
}) {
  const policy = poolFor(template, mode);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Flame className="size-4" /> {mode === 'running' ? 'Running Hot Pool' : 'Stopped Pool'}</CardTitle>
        <CardDescription>{mode === 'running' ? 'Fastest path. Live takeover. Bills hot CPU/RAM while ready.' : 'Cheap fast-start path. Bills measured disk only, then starts and verifies on claim.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Info label="Ready" value={`${policy?.ready ?? 0}/${policy?.target ?? 0}`} />
          <Info label="Storage/mo" value={fmtEur(policy?.billing?.storage_eur_month)} />
          <Info label="Hot/mo" value={fmtEur(policy?.billing?.hot_resource_eur_month)} />
        </div>
        <div className="grid gap-2 sm:grid-cols-[140px_auto_auto]">
          <Input
            type="number"
            min={0}
            max={500}
            value={edit.target}
            onChange={(event) => setPoolEdits((prev) => ({
              ...prev,
              [template.id]: { ...(prev[template.id] ?? poolEditFor(template)), [mode]: { target: Number(event.target.value) || 0 } },
            }))}
          />
          <Button variant="outline" onClick={() => savePool(template, mode)}>Save target</Button>
          <Button variant="outline" onClick={() => refill(template, mode)} disabled={!policy}>Refill</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {policy ? <Button variant="outline" onClick={() => savePool(template, mode, policy.status === 'paused' ? 'active' : 'paused')}>{policy.status === 'paused' ? 'Resume' : 'Pause'}</Button> : null}
          {policy ? <Button variant="destructive" onClick={() => deletePool(template, mode)}><Trash2 className="size-3.5" /> Delete Pool</Button> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-muted/20 px-3 py-2 sm:grid-cols-[150px_1fr]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? 'break-all font-mono text-xs' : 'break-words text-sm'}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
    </div>
  );
}

function NewTemplateDialog({
  open, onOpenChange, accountId, machines, preset, regions, request, runAction, refresh, busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  machines: Machine[];
  preset: BrowseTemplatePreset | null;
  regions: string[];
  request: ReturnType<typeof useStore>['request'];
  runAction: ReturnType<typeof useStore>['runAction'];
  refresh: () => Promise<void>;
  busy: boolean;
}) {
  const [source, setSource] = useState<TemplateSource>(preset?.source ?? 'simplestreams');
  const [name, setName] = useState(preset?.name ?? 'Ubuntu 24.04');
  const [slug, setSlug] = useState(preset?.slug ?? '');
  const [region, setRegion] = useState(regions[0] ?? 'eu');
  const [visibility, setVisibility] = useState<'catalog' | 'private'>('private');
  const [ref, setRef] = useState(preset?.ref ?? 'ubuntu/24.04');
  const [server, setServer] = useState(preset?.server ?? '');
  const [machineId, setMachineId] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [backupId, setBackupId] = useState('');
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [vcpu, setVcpu] = useState(preset?.default_resources.vcpu ?? 2);
  const [memoryGb, setMemoryGb] = useState(preset?.default_resources.memory_gb ?? 2);
  const [diskGb, setDiskGb] = useState(preset?.default_resources.disk_gb ?? 10);
  const [error, setError] = useState<string | null>(null);

  const selectedRegion = regions.includes(region) ? region : regions[0] ?? 'eu';
  const selectedMachineId = machines.some((machine) => machine.id === machineId) ? machineId : machines[0]?.id ?? '';

  useEffect(() => {
    if (!open || !selectedMachineId || (source !== 'snapshot' && source !== 'backup')) return;
    let cancelled = false;
    Promise.all([
      request<{ snapshots: SnapshotItem[] }>(`/machines/${encodeURIComponent(selectedMachineId)}/snapshots`),
      request<{ backups: BackupItem[] }>(`/machines/${encodeURIComponent(selectedMachineId)}/backups`),
    ]).then(([snapshotData, backupData]) => {
      if (cancelled) return;
      setSnapshots(snapshotData.snapshots ?? []);
      setBackups(backupData.backups ?? []);
    }).catch(() => {
      if (!cancelled) { setSnapshots([]); setBackups([]); }
    });
    return () => { cancelled = true; };
  }, [open, request, selectedMachineId, source]);

  function sourceBody() {
    if (source === 'simplestreams') return { type: 'simplestreams', ref: ref.trim(), server: server.trim() || undefined };
    if (source === 'docker') return { type: 'docker', ref: ref.trim(), server: server.trim() || undefined };
    if (source === 'image') return { type: 'image', image_id: ref.trim() };
    if (source === 'machine') return { type: 'machine', machine_id: selectedMachineId };
    if (source === 'snapshot') return { type: 'snapshot', machine_id: selectedMachineId, snapshot_id: snapshotId || snapshots[0]?.id || snapshots[0]?.name };
    return { type: 'backup', machine_id: selectedMachineId, backup_id: backupId || backups[0]?.id || backups[0]?.name };
  }

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Template name is required.');
    const src = sourceBody();
    if ((source === 'simplestreams' || source === 'docker' || source === 'image') && !ref.trim()) return setError('Source reference is required.');
    if ((source === 'machine' || source === 'snapshot' || source === 'backup') && !selectedMachineId) return setError('Pick a source Machine first.');
    if (source === 'snapshot' && !(src as { snapshot_id?: string }).snapshot_id) return setError('Pick a snapshot first.');
    if (source === 'backup' && !(src as { backup_id?: string }).backup_id) return setError('Pick a backup first.');
    try {
      await runAction(`create Template ${name}`, async () => {
        const result = await request('/machine-templates', {
          method: 'POST',
          headers: { 'X-Account-Id': accountId },
          body: {
            name: name.trim(),
            slug: slug.trim() || undefined,
            region: selectedRegion,
            visibility,
            default_resources: { vcpu, memory_gb: memoryGb, disk_gb: diskGb },
            source: src,
          } as never,
        });
        toast.success(`Template ${name} is ready`);
        await refresh();
        onOpenChange(false);
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
          <DialogTitle>{preset ? `Add ${preset.name}` : 'New Machine Template'}</DialogTitle>
          <DialogDescription>Create a ready-to-boot Template from any source. The prep pipeline bakes and verifies JustAVPS tooling before the Template becomes active.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">Account <span className="font-mono text-foreground">{accountId}</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></div>
            <div className="space-y-1.5"><Label>Slug</Label><Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="auto" className="font-mono" /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label>Region</Label><Select value={selectedRegion} onValueChange={setRegion}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(regions.length ? regions : ['eu']).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Visibility</Label><Select value={visibility} onValueChange={(value) => setVisibility(value as 'catalog' | 'private')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="catalog">Catalog</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Source</Label><Select value={source} onValueChange={(value) => setSource(value as TemplateSource)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="simplestreams">Simplestreams</SelectItem><SelectItem value="docker">Docker / OCI</SelectItem><SelectItem value="image">Existing image alias</SelectItem><SelectItem value="machine">Machine</SelectItem><SelectItem value="snapshot">Snapshot</SelectItem><SelectItem value="backup">Backup</SelectItem></SelectContent></Select></div>
          </div>

          {(source === 'simplestreams' || source === 'docker' || source === 'image') ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Reference</Label><Input value={ref} onChange={(event) => setRef(event.target.value)} placeholder={source === 'docker' ? 'ubuntu:24.04' : source === 'image' ? 'image alias or fingerprint' : 'ubuntu/24.04'} className="font-mono" /></div>
              {source !== 'image' ? <div className="space-y-1.5"><Label>Server</Label><Input value={server} onChange={(event) => setServer(event.target.value)} placeholder={source === 'docker' ? 'https://docker.io' : 'https://images.linuxcontainers.org'} className="font-mono text-xs" /></div> : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Source Machine</Label><Select value={selectedMachineId} onValueChange={setMachineId}><SelectTrigger><SelectValue placeholder="Pick machine" /></SelectTrigger><SelectContent>{machines.map((machine) => <SelectItem key={machine.id} value={machine.id}>{machine.name} · {machine.status}</SelectItem>)}</SelectContent></Select></div>
              {source === 'snapshot' ? <div className="space-y-1.5"><Label>Snapshot</Label><Select value={snapshotId || snapshots[0]?.id || snapshots[0]?.name || ''} onValueChange={setSnapshotId}><SelectTrigger><SelectValue placeholder="Pick snapshot" /></SelectTrigger><SelectContent>{snapshots.map((snapshot) => <SelectItem key={snapshot.id ?? snapshot.name} value={snapshot.id ?? snapshot.name}>{snapshot.name}</SelectItem>)}</SelectContent></Select></div> : null}
              {source === 'backup' ? <div className="space-y-1.5"><Label>Backup</Label><Select value={backupId || backups[0]?.id || backups[0]?.name || ''} onValueChange={setBackupId}><SelectTrigger><SelectValue placeholder="Pick backup" /></SelectTrigger><SelectContent>{backups.map((backup) => <SelectItem key={backup.id ?? backup.name} value={backup.id ?? backup.name}>{backup.name}</SelectItem>)}</SelectContent></Select></div> : null}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Default vCPU</Label><Input type="number" min={1} value={vcpu} onChange={(event) => setVcpu(Number(event.target.value) || 1)} /></div>
            <div className="space-y-1.5"><Label>Default RAM GB</Label><Input type="number" min={1} value={memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value) || 1)} /></div>
            <div className="space-y-1.5"><Label>Default disk GB</Label><Input type="number" min={1} value={diskGb} onChange={(event) => setDiskGb(Number(event.target.value) || 1)} /></div>
          </div>
          <div className="rounded-lg border bg-emerald-500/10 p-3 text-xs text-muted-foreground">The default size defines exact Pool keys. Machines can still resize at create time or later, but the fastest path is the Template default size.</div>
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy}>Create Template</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
