'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import Link from 'next/link';
import {
  Activity,
  ArrowDownUp,
  Boxes,
  CalendarClock,
  ChevronRight,
  Clock3,
  FilterX,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server,
  SlidersHorizontal,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { ResizeMachineDialog } from '@/components/features/resize-machine-dialog';
import type { BackupItem, ImageItem, Machine, MachineCreationTrace, SnapshotItem } from '@/lib/api';
import {
  CATALOG_IMAGES,
  catalogImageType,
  catalogForImage,
  imageDisplayName,
  imageIdForCreate,
  imageMatchesMachineType,
  machineTypeToImageType,
} from '@/lib/image-sources';
import MachineDetailClient from './[id]/MachineDetailClient';

function isRunningStatus(status: string | undefined) {
  return status?.toLowerCase() === 'running';
}

type MachineStatusFilter = 'all' | 'running' | 'stopped' | 'other';
type CreatedWindow = 'all' | '24h' | '7d' | '30d';
type MachineSort = 'created_desc' | 'created_asc' | 'name_asc' | 'status_asc';
const PAGE_REFERENCE_TIME = Date.now();

function createdTimestamp(machine: Machine) {
  const raw = machine.created_at;
  if (!raw) return 0;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
}

function formatCreatedAt(value: string | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number | undefined) {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function creationTrace(machine: Machine): MachineCreationTrace | null {
  const trace = machine.metadata?.creation_telemetry;
  if (!trace || typeof trace !== 'object') return null;
  return trace as MachineCreationTrace;
}

function relativeCreatedAt(value: string | undefined, now: number | null) {
  if (!value) return 'Unknown';
  if (!now) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Unknown';
  const diff = now - time;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function resourceValue(resources: Machine['resources'], key: string) {
  const value = resources?.[key];
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function matchesStatusFilter(machine: Machine, filter: MachineStatusFilter) {
  const status = machine.status?.toLowerCase();
  if (filter === 'all') return true;
  if (filter === 'running') return status === 'running';
  if (filter === 'stopped') return status === 'stopped' || status === 'stopped/idle';
  return status !== 'running' && status !== 'stopped' && status !== 'stopped/idle';
}

function matchesCreatedWindow(machine: Machine, window: CreatedWindow, now: number) {
  if (window === 'all') return true;
  const created = createdTimestamp(machine);
  if (!created) return false;
  const windows: Record<Exclude<CreatedWindow, 'all'>, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return created >= now - windows[window];
}

function machineSearchText(machine: Machine) {
  return [
    machine.name,
    machine.id,
    machine.type,
    machine.status,
    machine.region,
    machine.location,
    machine.incus?.cluster_id,
    machine.incus?.member_name,
    machine.incus?.instance_name,
  ].filter(Boolean).join(' ').toLowerCase();
}

function sortMachines(a: Machine, b: Machine, sort: MachineSort) {
  if (sort === 'created_desc') return createdTimestamp(b) - createdTimestamp(a) || a.name.localeCompare(b.name);
  if (sort === 'created_asc') return createdTimestamp(a) - createdTimestamp(b) || a.name.localeCompare(b.name);
  if (sort === 'status_asc') return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name);
}

function MachineStatCard({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string | number; sub?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
          {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MachinesPage() {
  const { state, request, runAction, refreshAll } = useStore();
  const { confirm } = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [resizeTarget, setResizeTarget] = useState<Machine | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MachineStatusFilter>('all');
  const [createdWindow, setCreatedWindow] = useState<CreatedWindow>('all');
  const [sort, setSort] = useState<MachineSort>('created_desc');

  useEffect(() => {
    const syncSelectedId = () => setSelectedId(new URLSearchParams(window.location.search).get('id'));
    syncSelectedId();
    window.addEventListener('popstate', syncSelectedId);
    return () => window.removeEventListener('popstate', syncSelectedId);
  }, []);

  const machinesPath = () => (window.location.pathname.startsWith('/admin-ui') ? '/admin-ui/machines/' : '/machines/');
  const openMachine = (id: string, tab?: string) => {
    setSelectedId(id);
    const params = new URLSearchParams({ id });
    if (tab) params.set('tab', tab);
    window.history.pushState({}, '', `${machinesPath()}?${params.toString()}`);
  };
  const closeMachine = () => {
    setSelectedId(null);
    window.history.pushState({}, '', machinesPath());
  };

  const fire = async (label: string, fn: () => Promise<unknown>) => {
    await runAction(label, async () => {
      const r = await fn();
      await refreshAll();
      return r;
    });
  };

  const visibleMachines = useMemo(() => state.machines.filter((machine) => machine.type === 'container'), [state.machines]);

  const latestMachine = useMemo(() => {
    return [...visibleMachines].sort((a, b) => sortMachines(a, b, 'created_desc'))[0] ?? null;
  }, [visibleMachines]);

  const filteredMachines = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleMachines
      .filter((machine) => !normalizedQuery || machineSearchText(machine).includes(normalizedQuery))
      .filter((machine) => matchesStatusFilter(machine, statusFilter))
      .filter((machine) => matchesCreatedWindow(machine, createdWindow, PAGE_REFERENCE_TIME))
      .sort((a, b) => sortMachines(a, b, sort));
  }, [createdWindow, query, sort, visibleMachines, statusFilter]);

  const runningCount = useMemo(() => visibleMachines.filter((m) => isRunningStatus(m.status)).length, [visibleMachines]);
  const stoppedCount = useMemo(() => visibleMachines.filter((m) => m.status?.toLowerCase() === 'stopped').length, [visibleMachines]);
  const hasActiveFilters = query.trim().length > 0 || statusFilter !== 'all' || createdWindow !== 'all';
  const resetFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setCreatedWindow('all');
    setSort('created_desc');
  };

  if (selectedId) return <MachineDetailClient id={selectedId} onBack={closeMachine} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
          <p className="text-sm text-muted-foreground">
            Latest created containers are shown first by default. {visibleMachines.length} total · {runningCount} running
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> New container
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MachineStatCard icon={Boxes} label="Total containers" value={visibleMachines.length} sub={`${filteredMachines.length} visible`} />
        <MachineStatCard icon={Play} label="Running" value={runningCount} sub={`${stoppedCount} stopped`} />
        <MachineStatCard icon={Clock3} label="Latest created" value={latestMachine ? relativeCreatedAt(latestMachine.created_at, PAGE_REFERENCE_TIME) : '—'} sub={latestMachine?.name ?? 'No machines'} />
        <MachineStatCard icon={Server} label="Regions" value={new Set(visibleMachines.map((m) => m.region).filter(Boolean)).size || '—'} sub="Active placements" />
      </div>

      {visibleMachines.length === 0 ? (
        <EmptyState
          title="No machines yet"
          description="Create one below, or buy a host to add capacity first."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-3.5" /> New container</Button>}
        />
      ) : (
        <Card>
          <CardHeader className="border-b">
            <div className="space-y-4">
              <div>
                <CardTitle>Machine inventory</CardTitle>
                <CardDescription>
                  {filteredMachines.length} of {visibleMachines.length} containers · sorted by {sort === 'created_desc' ? 'latest created' : sort === 'created_asc' ? 'oldest created' : sort === 'status_asc' ? 'status' : 'name'}
                </CardDescription>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_160px_190px_180px_auto]">
                <div className="relative sm:col-span-2 xl:col-span-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, id, host..."
                    className="pl-8"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as MachineStatusFilter)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="stopped">Stopped</SelectItem>
                    <SelectItem value="other">Other states</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={createdWindow} onValueChange={(value) => setCreatedWindow(value as CreatedWindow)}>
                  <SelectTrigger className="w-full"><CalendarClock className="size-3.5" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any created date</SelectItem>
                    <SelectItem value="24h">Created last 24h</SelectItem>
                    <SelectItem value="7d">Created last 7d</SelectItem>
                    <SelectItem value="30d">Created last 30d</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(value) => setSort(value as MachineSort)}>
                  <SelectTrigger className="w-full"><ArrowDownUp className="size-3.5" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created_desc">Latest created</SelectItem>
                    <SelectItem value="created_asc">Oldest created</SelectItem>
                    <SelectItem value="name_asc">Name A-Z</SelectItem>
                    <SelectItem value="status_asc">Status A-Z</SelectItem>
                  </SelectContent>
                </Select>
                {hasActiveFilters ? (
                  <Button variant="outline" onClick={resetFilters} className="w-full xl:w-auto">
                    <FilterX className="size-3.5" /> Clear
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Resources</TableHead>
                    <TableHead>Placement</TableHead>
                    <TableHead className="w-12 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMachines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-sm text-muted-foreground">
                          <Boxes className="size-7" />
                          <div className="font-medium text-foreground">No machines match these filters</div>
                          <div>Try clearing search, status, type, or created date filters.</div>
                          <Button size="sm" variant="outline" onClick={resetFilters}><FilterX className="size-3.5" /> Clear filters</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : filteredMachines.map((m) => (
                    <TableRow
                      key={m.id}
                      onClick={() => openMachine(m.id)}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell className="min-w-56">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'size-2 rounded-full',
                            isRunningStatus(m.status) ? 'bg-emerald-500' : m.status?.toLowerCase() === 'stopped' ? 'bg-muted-foreground/60' : 'bg-amber-500',
                          )} />
                          <div className="min-w-0">
                            <Link
                              href={`/machines/?id=${encodeURIComponent(m.id)}`}
                              className="block truncate font-medium hover:underline"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openMachine(m.id);
                              }}
                            >
                              {m.name}
                            </Link>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{m.id.slice(0, 8)}</span>
                              <Badge variant="outline" className="font-mono text-[10px]">{m.type}</Badge>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={isRunningStatus(m.status) ? 'default' : 'secondary'}>{m.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm tabular-nums">{formatCreatedAt(m.created_at)}</div>
                        <div className="text-xs text-muted-foreground">{relativeCreatedAt(m.created_at, PAGE_REFERENCE_TIME)}</div>
                        {creationTrace(m) ? (
                          <div className="mt-1 text-2xs text-muted-foreground">
                            create {formatDuration(creationTrace(m)?.duration_ms)} · {creationTrace(m)?.status}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {resourceValue(m.resources, 'vcpu')}c · {resourceValue(m.resources, 'memory_gb')}G · {resourceValue(m.resources, 'disk_gb')}G
                      </TableCell>
                      <TableCell className="max-w-64">
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {m.region ? <span>{m.region} · </span> : null}{m.incus?.cluster_id ?? '—'}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.incus?.member_name ?? m.location ?? 'No member'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => openMachine(m.id)}>
                              <ChevronRight className="size-3.5" /> Open details
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openMachine(m.id, 'observability')}>
                              <Activity className="size-3.5" /> Observability
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setResizeTarget(m)}>
                              <SlidersHorizontal className="size-3.5" /> Resize
                            </DropdownMenuItem>
                            {!isRunningStatus(m.status) ? (
                              <DropdownMenuItem onSelect={() => fire(`start ${m.name}`, () => request(`/machines/${m.id}/start`, { method: 'POST' }))}>
                                <Play className="size-3.5" /> Start
                              </DropdownMenuItem>
                            ) : null}
                            {isRunningStatus(m.status) ? (
                              <>
                                <DropdownMenuItem onSelect={() => fire(`stop ${m.name}`, () => request(`/machines/${m.id}/stop`, { method: 'POST' }))}>
                                  <Square className="size-3.5" /> Stop
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => fire(`reboot ${m.name}`, () => request(`/machines/${m.id}/reboot`, { method: 'POST' }))}>
                                  <RotateCcw className="size-3.5" /> Restart
                                </DropdownMenuItem>
                              </>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={async (event) => {
                                event.preventDefault();
                                if (!await confirm({
                                  title: `Delete ${m.name}?`,
                                  description: 'Stops the instance, drops the rootfs, removes config. Final.',
                                  confirmLabel: 'Delete',
                                  destructive: true,
                                })) return;
                                fire(`delete ${m.name}`, () => request(`/machines/${m.id}`, { method: 'DELETE' }));
                              }}
                            >
                              <Trash2 className="size-3.5" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <CreateMachineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        regions={state.regions}
        machines={state.machines}
        images={state.images}
        baseUrl={state.baseUrl}
        fire={fire}
        request={request}
        busy={state.busy}
      />
      <ResizeMachineDialog
        open={Boolean(resizeTarget)}
        onOpenChange={(open) => { if (!open) setResizeTarget(null); }}
        machine={resizeTarget}
        busy={state.busy}
        onResize={(nextResources) => resizeTarget
          ? fire(`resize ${resizeTarget.name}`, () => request(`/machines/${resizeTarget.id}`, { method: 'PATCH', body: { resources: nextResources } }))
          : Promise.resolve()}
      />
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed py-16 text-center">
      <Boxes className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

type CatalogImageRow = { id: string; name: string; type: 'container' };
type SourceMode = 'image' | 'snapshot' | 'backup';
type ImageChoice = { id: string; label: string; source: 'catalog' | 'raw' };

const DEFAULT_CATALOG_IMAGES: CatalogImageRow[] = CATALOG_IMAGES.map((image) => ({
  id: image.id,
  name: image.name,
  type: catalogImageType(image.type),
}));

const SOURCE_MODES: Array<{ value: SourceMode; label: string; description: string }> = [
  { value: 'image', label: 'Images', description: 'Base images + cached imports' },
  { value: 'snapshot', label: 'Snapshot', description: 'Clone from machine snapshot' },
  { value: 'backup', label: 'Backup', description: 'Clone from backup artifact' },
];

function CreateMachineDialog({
  open, onOpenChange, regions, machines, images, baseUrl, fire, request, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  regions: string[];
  machines: Machine[];
  images: ImageItem[];
  baseUrl: string;
  fire: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  request: ReturnType<typeof useStore>['request'];
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const type = 'container' as const;
  const [region, setRegion] = useState(regions[0] ?? 'eu');
  const [sourceMode, setSourceMode] = useState<SourceMode>('image');
  const [imageId, setImageId] = useState('');
  const [sourceMachineId, setSourceMachineId] = useState('');
  const [sourceSnapshotName, setSourceSnapshotName] = useState('');
  const [sourceBackupName, setSourceBackupName] = useState('');
  const [vcpu, setVcpu] = useState(2);
  const [memoryGb, setMemoryGb] = useState(2);
  const [diskGb, setDiskGb] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [catalogImages, setCatalogImages] = useState<CatalogImageRow[]>(DEFAULT_CATALOG_IMAGES);
  const [rawImages, setRawImages] = useState<ImageItem[]>(images);
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [fetchedRegions, setFetchedRegions] = useState<string[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [createRequestId, setCreateRequestId] = useState<string | null>(null);
  const [createTrace, setCreateTrace] = useState<MachineCreationTrace | null>(null);
  const [createStartedAt, setCreateStartedAt] = useState<number | null>(null);
  const [createNow, setCreateNow] = useState(() => Date.now());
  const [createPollError, setCreatePollError] = useState<string | null>(null);

  // Load every create source the API can accept. The base catalog is available
  // immediately from the bundled product catalog; live Incus image cache is
  // background enrichment. Do not block the picker on /images, which can lag
  // while Incus lists aliases from the cluster.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    request<{ templates: CatalogImageRow[] }>('/templates')
      .then((catalogData) => {
        if (!cancelled && catalogData.templates.length > 0) setCatalogImages(catalogData.templates);
      })
      .catch(() => { /* keep bundled catalog */ });

    request<{ regions: string[] }>('/regions', { auth: false })
      .then((regionData) => { if (!cancelled) setFetchedRegions(regionData.regions ?? []); })
      .catch(() => { /* surfaced */ });

    request<{ images: ImageItem[] }>('/images', { auth: false })
      .then((imageData) => { if (!cancelled) setRawImages(imageData.images ?? images); })
      .catch(() => { /* cached images are optional */ });

    return () => { cancelled = true; };
  }, [images, open, request]);

  useEffect(() => {
    if (!createRequestId || !open) return;
    let cancelled = false;
    const poll = () => {
      request<{ trace: MachineCreationTrace }>(`/admin/telemetry/creations/${encodeURIComponent(createRequestId)}`)
        .then((data) => {
          if (!cancelled) {
            setCreateTrace(data.trace);
            setCreatePollError(null);
          }
        })
        .catch((pollError) => {
          if ((pollError as { status?: number } | null)?.status === 404) return;
          if (!cancelled) setCreatePollError(pollError instanceof Error ? pollError.message : String(pollError));
        });
    };
    poll();
    const pollTimer = window.setInterval(poll, 1000);
    const clockTimer = window.setInterval(() => setCreateNow(Date.now()), 250);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
    };
  }, [createRequestId, open, request]);

  const compatibleCatalogImages = useMemo(() => {
    const want = machineTypeToImageType(type);
    return catalogImages.filter((t) => t.type === want);
  }, [catalogImages, type]);

  const compatibleRawImages = useMemo(() => {
    return rawImages.filter((image) => imageMatchesMachineType(image, type));
  }, [rawImages, type]);

  const imageChoices = useMemo(() => {
    const choices: ImageChoice[] = [];
    const seen = new Set<string>();
    for (const image of compatibleRawImages) {
      const id = imageIdForCreate(image);
      const key = image.fingerprint || id;
      if (!id || seen.has(key)) continue;
      seen.add(key);
      seen.add(id);
      const catalog = catalogForImage(image);
      choices.push({
        id,
        label: catalog ? imageDisplayName(image) : `${imageDisplayName(image)} · cached`,
        source: catalog ? 'catalog' : 'raw',
      });
    }
    for (const catalogImage of compatibleCatalogImages) {
      if (seen.has(catalogImage.id)) continue;
      seen.add(catalogImage.id);
      choices.push({ id: catalogImage.id, label: catalogImage.name, source: 'catalog' });
    }
    return choices;
  }, [compatibleCatalogImages, compatibleRawImages]);

  const compatibleSourceMachines = useMemo(() => (
    machines.filter((machine) => machine.type === type)
  ), [machines, type]);

  const selectedImageId = imageChoices.some((choice) => choice.id === imageId) ? imageId : imageChoices[0]?.id ?? '';
  const selectedSourceMachineId = compatibleSourceMachines.some((machine) => machine.id === sourceMachineId)
    ? sourceMachineId
    : compatibleSourceMachines[0]?.id ?? '';
  const selectedSourceMachine = compatibleSourceMachines.find((machine) => machine.id === selectedSourceMachineId) ?? null;
  const selectedSnapshotName = snapshots.some((snapshot) => snapshot.name === sourceSnapshotName)
    ? sourceSnapshotName
    : snapshots[0]?.name ?? '';
  const selectedBackupName = backups.some((backup) => backup.name === sourceBackupName)
    ? sourceBackupName
    : backups[0]?.name ?? '';
  const regionChoices = regions.length > 0 ? regions : fetchedRegions;
  const selectedRegion = regionChoices.includes(region) ? region : regionChoices[0] ?? '';

  useEffect(() => {
    if (!open || !selectedSourceMachineId || (sourceMode !== 'snapshot' && sourceMode !== 'backup')) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setSourceLoading(true);
        return Promise.all([
          request<{ snapshots: SnapshotItem[] }>(`/machines/${encodeURIComponent(selectedSourceMachineId)}/snapshots`),
          request<{ backups: BackupItem[] }>(`/machines/${encodeURIComponent(selectedSourceMachineId)}/backups`),
        ]);
      })
      .then(([snapshotData, backupData]) => {
        if (cancelled) return;
        setSnapshots(snapshotData.snapshots ?? []);
        setBackups(backupData.backups ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshots([]);
        setBackups([]);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, request, selectedSourceMachineId, sourceMode]);

  const selectedSource = () => {
    if (sourceMode === 'image') {
      if (!selectedImageId) return null;
      return { type: 'image', image_id: selectedImageId };
    }
    if (sourceMode === 'snapshot') {
      if (!selectedSourceMachine || !selectedSnapshotName) return null;
      const instanceName = selectedSourceMachine.incus?.instance_name ?? selectedSourceMachine.name;
      return { type: 'snapshot', snapshot_id: `${instanceName}/${selectedSnapshotName}` };
    }
    if (sourceMode === 'backup') {
      if (!selectedSourceMachineId || !selectedBackupName) return null;
      return { type: 'backup', backup_id: `${selectedSourceMachineId}/${selectedBackupName}` };
    }
    return null;
  };

  const source = selectedSource();
  const sourceReady = Boolean(source);
  const createElapsedMs = createTrace?.duration_ms ?? (createStartedAt ? createNow - createStartedAt : undefined);
  const latestSpan = createTrace?.spans.find((span) => span.status === 'active') ?? createTrace?.spans.at(-1) ?? null;
  const createIsActive = createTrace?.status === 'active';
  const traceHasReachedApi = Boolean(createTrace?.spans.length);
  const createPanelTone = createTrace?.status === 'error' ? 'danger' : createTrace?.status === 'ok' ? 'success' : createPollError && !traceHasReachedApi ? 'warning' : 'info';
  const createPanelClass = createPanelTone === 'danger'
    ? 'border-destructive/40 bg-destructive/10'
    : createPanelTone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : createPanelTone === 'warning'
        ? 'border-amber-500/40 bg-amber-500/10'
        : 'border-sky-500/30 bg-sky-500/10';
  const clearCreateTelemetry = () => {
    setCreateRequestId(null);
    setCreateTrace(null);
    setCreateStartedAt(null);
    setCreatePollError(null);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) clearCreateTelemetry();
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    setError(null);
    if (!selectedRegion) return setError('No regions / clusters are available. Refresh Fleet first.');
    if (!source) return setError('Pick a valid machine source first.');
    const displayName = name.trim();
    if (displayName.length > 80) return setError('Display name must be 80 characters or less.');
    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setCreateRequestId(requestId);
    setCreateStartedAt(Date.now());
    setCreateNow(Date.now());
    setCreatePollError(null);
    setCreateTrace({ id: requestId, kind: 'machine.create', status: 'active', stage: 'connecting to API', started_at: new Date().toISOString(), labels: { api_base_url: baseUrl }, spans: [] });
    try {
      await fire(`create ${displayName || 'machine'}`, async () => {
        const data = await request('/machines', {
          method: 'POST',
          headers: { 'X-JustAVPS-Request-Id': requestId },
          body: {
            name: displayName || undefined, type, region: selectedRegion,
            source,
            resources: { vcpu, memory_gb: memoryGb, disk_gb: diskGb },
          } as never,
        });
        handleOpenChange(false);
        setName('');
        return data;
      });
    } catch (e) {
      // Surface validation issues from the API instead of the generic
      // "Invalid request" — the issues array names the offending field.
      const data = (e as { data?: { issues?: { path?: string[]; message?: string }[]; message?: string } } | null)?.data;
      const issues = data?.issues;
      const message = issues?.length
        ? issues.map((i) => `${(i.path ?? []).join('.') || 'request'}: ${i.message ?? 'invalid'}`).join('\n')
        : e instanceof Error ? e.message : String(e);
      setError(message);
      setCreateRequestId(null);
      setCreateTrace((prev) => prev ? {
        ...prev,
        status: 'error',
        stage: 'request failed',
        ended_at: new Date().toISOString(),
        duration_ms: createStartedAt ? Date.now() - createStartedAt : prev.duration_ms,
        error: message,
      } : prev);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New container</DialogTitle>
          <DialogDescription>POST /machines creates containers only. Choose exactly what to create from, then set resources.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {regionChoices.length === 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              No regions / clusters configured. Register a cluster (Fleet → Clusters) before creating machines.
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="m-name">Display name</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="optional label, e.g. staging api"
              autoComplete="off"
              spellCheck={false}
              maxLength={80}
            />
            <p className="text-2xs text-muted-foreground">For search/display only. The real Incus hostname is a generated UUID, so duplicate labels are safe.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">Container</div>
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select value={selectedRegion} onValueChange={setRegion}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {regionChoices.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div>
              <Label>Source</Label>
              <p className="mt-1 text-xs text-muted-foreground">Pick the source type explicitly — image, snapshot, or backup.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {SOURCE_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setSourceMode(mode.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${sourceMode === mode.value ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                >
                  <span className="block text-sm font-medium">{mode.label}</span>
                  <span className={`mt-1 block text-2xs ${sourceMode === mode.value ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{mode.description}</span>
                </button>
              ))}
            </div>

            {sourceMode === 'image' ? (
              <div className="space-y-1.5">
                <Label>Image</Label>
                <Select value={selectedImageId} onValueChange={setImageId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="pick image…" /></SelectTrigger>
                  <SelectContent>
                    {imageChoices.map((image) => (
                      <SelectItem key={`${image.source}-${image.id}`} value={image.id}>{image.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {imageChoices.length === 0 ? <p className="text-xs text-destructive">No {type} images are available.</p> : null}
              </div>
            ) : null}

            {sourceMode === 'snapshot' || sourceMode === 'backup' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Source machine</Label>
                  <Select value={selectedSourceMachineId} onValueChange={setSourceMachineId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="pick machine…" /></SelectTrigger>
                    <SelectContent>
                      {compatibleSourceMachines.map((machine) => (
                        <SelectItem key={machine.id} value={machine.id}>{machine.name} · {machine.status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {compatibleSourceMachines.length === 0 ? <p className="text-xs text-destructive">No {type} source machines exist.</p> : null}
                </div>

                {sourceMode === 'snapshot' ? (
                  <div className="space-y-1.5">
                    <Label>Snapshot</Label>
                    <Select value={selectedSnapshotName} onValueChange={setSourceSnapshotName} disabled={!selectedSourceMachineId || sourceLoading}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={sourceLoading ? 'loading…' : 'pick snapshot…'} /></SelectTrigger>
                      <SelectContent>
                        {snapshots.map((snapshot) => (
                          <SelectItem key={snapshot.name} value={snapshot.name}>{snapshot.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!sourceLoading && selectedSourceMachineId && snapshots.length === 0 ? <p className="text-xs text-destructive">This machine has no snapshots.</p> : null}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Backup</Label>
                    <Select value={selectedBackupName} onValueChange={setSourceBackupName} disabled={!selectedSourceMachineId || sourceLoading}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={sourceLoading ? 'loading…' : 'pick backup…'} /></SelectTrigger>
                      <SelectContent>
                        {backups.map((backup) => (
                          <SelectItem key={backup.name} value={backup.name}>{backup.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!sourceLoading && selectedSourceMachineId && backups.length === 0 ? <p className="text-xs text-destructive">This machine has no backups.</p> : null}
                  </div>
                )}
              </div>
            ) : null}

          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>vCPU</Label>
              <Input type="number" value={vcpu} onChange={(e) => setVcpu(Number(e.target.value) || 1)} min={1} />
            </div>
            <div className="space-y-1.5">
              <Label>RAM (GB)</Label>
              <Input type="number" value={memoryGb} onChange={(e) => setMemoryGb(Number(e.target.value) || 1)} min={1} />
            </div>
            <div className="space-y-1.5">
              <Label>Disk (GB)</Label>
              <Input type="number" value={diskGb} onChange={(e) => setDiskGb(Number(e.target.value) || 1)} min={1} />
            </div>
          </div>
          {createTrace ? (
            <div className={`rounded-lg border p-3 text-xs ${createPanelClass}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-foreground">
                  {createTrace.status === 'error' ? 'Create failed' : createTrace.status === 'ok' ? 'Create complete' : 'Creating machine'}
                </div>
                <div className="font-mono tabular-nums text-muted-foreground">{formatDuration(createElapsedMs)}</div>
              </div>
              <div className="mt-1 text-muted-foreground">
                Stage: <span className="font-medium text-foreground">{createTrace.stage}</span>
                {latestSpan ? <span> · current step {latestSpan.name}</span> : null}
              </div>
              <div className="mt-1 truncate font-mono text-2xs text-muted-foreground">
                API {baseUrl || 'same-origin'} · request {createTrace.id.slice(0, 12)}
              </div>
              {!traceHasReachedApi && createIsActive ? (
                <div className="mt-2 rounded-md bg-background/60 px-2 py-1 text-muted-foreground">
                  Waiting for the backend to accept the request. If this stays here, the browser could not reach the API or the API restarted mid-request.
                </div>
              ) : null}
              {createPollError && createIsActive ? (
                <div className="mt-2 rounded-md border border-amber-500/30 bg-background/60 px-2 py-1 text-amber-700 dark:text-amber-300">
                  Telemetry poll failed: {createPollError}
                </div>
              ) : null}
              {createTrace.spans.length ? (
                <div className="mt-2 grid gap-1">
                  {createTrace.spans.slice(-5).map((span) => (
                    <div key={`${span.name}-${span.started_at}`} className="flex items-center justify-between gap-3 text-muted-foreground">
                      <span className={span.status === 'error' ? 'text-destructive' : span.status === 'active' ? 'text-amber-600 dark:text-amber-400' : ''}>{span.name}</span>
                      <span className="font-mono tabular-nums">{span.status === 'active' ? 'running' : formatDuration(span.duration_ms)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {createTrace.error ? <div className="mt-2 text-destructive">{createTrace.error}</div> : null}
            </div>
          ) : null}
          {error ? (
            <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !sourceReady || regionChoices.length === 0}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
