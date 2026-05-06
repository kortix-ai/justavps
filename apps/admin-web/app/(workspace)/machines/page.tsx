'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  X,
  type LucideIcon,
} from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { ResizeMachineDialog } from '@/components/features/resize-machine-dialog';
import type { Machine, MachineCreationTrace, MachineTemplate } from '@/lib/api';
import MachineDetailClient from './[id]/MachineDetailClient';

function isRunningStatus(status: string | undefined) {
  return status?.toLowerCase() === 'running';
}

function isPoolMachine(machine: Machine) {
  const status = machine.status?.toLowerCase();
  return status === 'warm_pool' || status === 'warm_pool_claiming';
}

type MachineStatusFilter = 'running' | 'stopped' | 'other' | 'pool';
type CreatedWindow = 'all' | '24h' | '7d' | '30d';
type MachineSort = 'created_desc' | 'created_asc' | 'name_asc' | 'status_asc';
type StartStrategy = 'auto' | 'running_pool' | 'stopped_pool' | 'cold';
const PAGE_REFERENCE_TIME = Date.now();
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;
const STATUS_FILTER_OPTIONS: Array<{ value: MachineStatusFilter; label: string; dotClass: string }> = [
  { value: 'running', label: 'Running', dotClass: 'bg-emerald-500' },
  { value: 'stopped', label: 'Stopped', dotClass: 'bg-muted-foreground/60' },
  { value: 'other', label: 'Other', dotClass: 'bg-amber-500' },
  { value: 'pool', label: 'Pool', dotClass: 'bg-sky-500' },
];
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

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

function templatePool(template: MachineTemplate | null, mode: 'running' | 'stopped') {
  return template?.pools?.[mode] ?? (template?.pool?.pool_mode === mode ? template.pool : null);
}

function matchesStatusFilters(machine: Machine, filters: MachineStatusFilter[]) {
  const status = machine.status?.toLowerCase();
  if (filters.length === 0) return !isPoolMachine(machine);
  return filters.some((filter) => {
    if (filter === 'running') return status === 'running';
    if (filter === 'stopped') return status === 'stopped' || status === 'stopped/idle';
    if (filter === 'pool') return status === 'warm_pool' || status === 'warm_pool_claiming';
    return status !== 'running' && status !== 'stopped' && status !== 'stopped/idle' && status !== 'warm_pool' && status !== 'warm_pool_claiming';
  });
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
  const { confirm, confirmPhrase } = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [resizeTarget, setResizeTarget] = useState<Machine | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilters, setStatusFilters] = useState<MachineStatusFilter[]>([]);
  const [createdWindow, setCreatedWindow] = useState<CreatedWindow>('all');
  const [sort, setSort] = useState<MachineSort>('created_desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);

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

  const filteredMachines = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleMachines
      .filter((machine) => !normalizedQuery || machineSearchText(machine).includes(normalizedQuery))
      .filter((machine) => matchesStatusFilters(machine, statusFilters))
      .filter((machine) => matchesCreatedWindow(machine, createdWindow, PAGE_REFERENCE_TIME))
      .sort((a, b) => sortMachines(a, b, sort));
  }, [createdWindow, query, sort, visibleMachines, statusFilters]);

  const runningCount = useMemo(() => visibleMachines.filter((m) => isRunningStatus(m.status)).length, [visibleMachines]);
  const stoppedCount = useMemo(() => visibleMachines.filter((m) => m.status?.toLowerCase() === 'stopped').length, [visibleMachines]);
  const poolReadyCount = useMemo(() => visibleMachines.filter((m) => m.status?.toLowerCase() === 'warm_pool').length, [visibleMachines]);
  const poolClaimingCount = useMemo(() => visibleMachines.filter((m) => m.status?.toLowerCase() === 'warm_pool_claiming').length, [visibleMachines]);
  const poolCount = poolReadyCount + poolClaimingCount;
  const customerMachineCount = visibleMachines.length - poolCount;
  const hasActiveFilters = query.trim().length > 0 || statusFilters.length > 0 || createdWindow !== 'all';
  const resetFilters = () => {
    setQuery('');
    setStatusFilters([]);
    setCreatedWindow('all');
    setSort('created_desc');
  };

  const toggleStatusFilter = (value: MachineStatusFilter) => {
    setStatusFilters((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  };

  const totalFiltered = filteredMachines.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / pageSize));

  // Reset to page 1 when filters/sort/page-size change. Comparing against a
  // tracked key during render avoids the cascading-render lint rule that
  // forbids setState-in-effect.
  const filterKey = `${query}|${statusFilters.join(',')}|${createdWindow}|${sort}|${pageSize}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalFiltered);
  const paginatedMachines = useMemo(
    () => filteredMachines.slice(pageStart, pageEnd),
    [filteredMachines, pageStart, pageEnd],
  );

  // Selections that point to filtered-out rows are kept in state but ignored
  // by the toolbar count and bulk actions, so unhiding rows restores them.
  const selectedMachines = useMemo(
    () => filteredMachines.filter((m) => selectedIds.has(m.id) && !isPoolMachine(m)),
    [filteredMachines, selectedIds],
  );
  const selectionCount = selectedMachines.length;

  const pageIds = useMemo(() => paginatedMachines.filter((m) => !isPoolMachine(m)).map((m) => m.id), [paginatedMachines]);
  const pageSelectedCount = pageIds.reduce((n, id) => n + (selectedIds.has(id) ? 1 : 0), 0);
  const pageAllSelected = pageIds.length > 0 && pageSelectedCount === pageIds.length;
  const pageSomeSelected = pageSelectedCount > 0 && !pageAllSelected;

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const togglePage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) for (const id of pageIds) next.add(id);
      else for (const id of pageIds) next.delete(id);
      return next;
    });
  };
  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredMachines.filter((m) => !isPoolMachine(m)).map((m) => m.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const runBulk = async (label: string, machines: Machine[], op: (m: Machine) => Promise<unknown>) => {
    if (machines.length === 0) return;
    await runAction(label, async () => {
      const results = await Promise.allSettled(machines.map((m) => op(m)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const ok = results.length - failed;
      await refreshAll();
      if (failed > 0) throw new Error(`${ok}/${results.length} succeeded · ${failed} failed`);
      return { ok, total: results.length };
    });
  };

  const bulkStart = () => {
    const targets = selectedMachines.filter((m) => !isRunningStatus(m.status));
    if (targets.length === 0) return;
    return runBulk(
      `start ${targets.length} machine${targets.length === 1 ? '' : 's'}`,
      targets,
      (m) => request(`/machines/${m.id}/start`, { method: 'POST' }),
    );
  };
  const bulkStop = () => {
    const targets = selectedMachines.filter((m) => isRunningStatus(m.status));
    if (targets.length === 0) return;
    return runBulk(
      `stop ${targets.length} machine${targets.length === 1 ? '' : 's'}`,
      targets,
      (m) => request(`/machines/${m.id}/stop`, { method: 'POST' }),
    );
  };
  const bulkRestart = () => {
    const targets = selectedMachines.filter((m) => isRunningStatus(m.status));
    if (targets.length === 0) return;
    return runBulk(
      `restart ${targets.length} machine${targets.length === 1 ? '' : 's'}`,
      targets,
      (m) => request(`/machines/${m.id}/reboot`, { method: 'POST' }),
    );
  };
  const bulkDelete = async () => {
    const targets = [...selectedMachines];
    if (targets.length === 0) return;
    const phrase = `DELETE ${targets.length} ${targets.length === 1 ? 'MACHINE' : 'MACHINES'}`;
    const ok = await confirmPhrase({
      title: `Delete ${targets.length} machine${targets.length === 1 ? '' : 's'}?`,
      description: 'Stops every selected instance, drops the rootfs, removes config. This is final and cannot be undone.',
      phrase,
      phraseLabel: 'Type the phrase exactly to confirm',
      confirmLabel: `Delete ${targets.length}`,
      destructive: true,
    });
    if (!ok) return;
    await runBulk(
      `delete ${targets.length} machine${targets.length === 1 ? '' : 's'}`,
      targets,
      (m) => request(`/machines/${m.id}`, { method: 'DELETE' }),
    );
    clearSelection();
  };

  if (selectedId) return <MachineDetailClient id={selectedId} onBack={closeMachine} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
          <p className="text-sm text-muted-foreground">
            Customer containers are shown by default. {customerMachineCount} machines · {runningCount} running · {poolCount} pool slots hidden
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> New container
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MachineStatCard icon={Boxes} label="Customer machines" value={customerMachineCount} sub={`${filteredMachines.length} visible`} />
        <MachineStatCard icon={Play} label="Running" value={runningCount} sub={`${stoppedCount} stopped`} />
        <MachineStatCard icon={Clock3} label="Pool slots" value={poolCount} sub={`${poolReadyCount} ready · ${poolClaimingCount} claiming`} />
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
                  {filteredMachines.length} visible · Pool slots are hidden unless the Pool status is selected · sorted by {sort === 'created_desc' ? 'latest created' : sort === 'created_asc' ? 'oldest created' : sort === 'status_asc' ? 'status' : 'name'}
                </CardDescription>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_minmax(280px,auto)_190px_180px_auto]">
                <div className="relative sm:col-span-2 xl:col-span-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, id, host..."
                    className="pl-8"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-1">
                  <Button
                    type="button"
                    variant={statusFilters.length === 0 ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setStatusFilters([])}
                  >
                    Customer
                  </Button>
                  {STATUS_FILTER_OPTIONS.map((option) => {
                    const active = statusFilters.includes(option.value);
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant={active ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => toggleStatusFilter(option.value)}
                      >
                        <span className={cn('size-2 rounded-full', option.dotClass)} /> {option.label}
                      </Button>
                    );
                  })}
                </div>
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
          {selectionCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {selectionCount} selected
                </span>
                {selectionCount < totalFiltered ? (
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAllFiltered}>
                    Select all {totalFiltered}
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs" onClick={clearSelection}>
                  <X className="size-3" /> Clear
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={state.busy} onClick={bulkStart}>
                  <Play className="size-3.5" /> Start
                </Button>
                <Button variant="outline" size="sm" disabled={state.busy} onClick={bulkStop}>
                  <Square className="size-3.5" /> Stop
                </Button>
                <Button variant="outline" size="sm" disabled={state.busy} onClick={bulkRestart}>
                  <RotateCcw className="size-3.5" /> Restart
                </Button>
                <Button variant="destructive" size="sm" disabled={state.busy} onClick={bulkDelete}>
                  <Trash2 className="size-3.5" /> Delete{selectionCount > 1 ? ` ${selectionCount}` : ''}
                </Button>
              </div>
            </div>
          ) : null}
          <CardContent className="p-0">
            <div className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        aria-label="Select all rows on this page"
                        checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                        onCheckedChange={(value) => togglePage(value === true)}
                        disabled={pageIds.length === 0}
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Resources</TableHead>
                    <TableHead>Placement</TableHead>
                    <TableHead className="w-12 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totalFiltered === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-sm text-muted-foreground">
                          <Boxes className="size-7" />
                          <div className="font-medium text-foreground">No machines match these filters</div>
                          <div>Try clearing search, status, type, or created date filters.</div>
                          <Button size="sm" variant="outline" onClick={resetFilters}><FilterX className="size-3.5" /> Clear filters</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : paginatedMachines.map((m) => (
                    <TableRow
                      key={m.id}
                      onClick={() => openMachine(m.id)}
                      data-state={selectedIds.has(m.id) ? 'selected' : undefined}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell className="w-10 pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${m.name}`}
                          checked={selectedIds.has(m.id)}
                          onCheckedChange={(value) => toggleRow(m.id, value === true)}
                          disabled={isPoolMachine(m)}
                        />
                      </TableCell>
                      <TableCell className="min-w-56">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'size-2 rounded-full',
                            isPoolMachine(m) ? 'bg-sky-500' : isRunningStatus(m.status) ? 'bg-emerald-500' : m.status?.toLowerCase() === 'stopped' ? 'bg-muted-foreground/60' : 'bg-amber-500',
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
                              {isPoolMachine(m) ? <Badge variant="secondary" className="text-[10px]">pool</Badge> : null}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={isPoolMachine(m) ? 'outline' : isRunningStatus(m.status) ? 'default' : 'secondary'}>{m.status}</Badge>
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
                            {!isPoolMachine(m) ? (
                              <DropdownMenuItem onSelect={() => setResizeTarget(m)}>
                                <SlidersHorizontal className="size-3.5" /> Resize
                              </DropdownMenuItem>
                            ) : null}
                            {!isPoolMachine(m) && !isRunningStatus(m.status) ? (
                              <DropdownMenuItem onSelect={() => fire(`start ${m.name}`, () => request(`/machines/${m.id}/start`, { method: 'POST' }))}>
                                <Play className="size-3.5" /> Start
                              </DropdownMenuItem>
                            ) : null}
                            {!isPoolMachine(m) && isRunningStatus(m.status) ? (
                              <>
                                <DropdownMenuItem onSelect={() => fire(`stop ${m.name}`, () => request(`/machines/${m.id}/stop`, { method: 'POST' }))}>
                                  <Square className="size-3.5" /> Stop
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => fire(`reboot ${m.name}`, () => request(`/machines/${m.id}/reboot`, { method: 'POST' }))}>
                                  <RotateCcw className="size-3.5" /> Restart
                                </DropdownMenuItem>
                              </>
                            ) : null}
                            {isPoolMachine(m) ? (
                              <DropdownMenuItem disabled>Managed by Pools</DropdownMenuItem>
                            ) : (
                              <>
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
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalFiltered > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
                <div className="tabular-nums">
                  {pageStart + 1}–{pageEnd} of {totalFiltered}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span>Rows per page</span>
                    <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value) as PageSize)}>
                      <SelectTrigger size="sm" className="h-7 w-[72px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="tabular-nums">
                    Page {safePage} of {pageCount}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon-sm" disabled={safePage <= 1} onClick={() => setPage(1)} aria-label="First page">
                      <ChevronsLeft className="size-3.5" />
                    </Button>
                    <Button variant="outline" size="icon-sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <Button variant="outline" size="icon-sm" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)} aria-label="Next page">
                      <ChevronRight className="size-3.5" />
                    </Button>
                    <Button variant="outline" size="icon-sm" disabled={safePage >= pageCount} onClick={() => setPage(pageCount)} aria-label="Last page">
                      <ChevronsRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      <CreateMachineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        regions={state.regions}
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

function CreateMachineDialog({
  open, onOpenChange, regions, baseUrl, fire, request, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  regions: string[];
  baseUrl: string;
  fire: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  request: ReturnType<typeof useStore>['request'];
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const type = 'container' as const;
  const [templates, setTemplates] = useState<MachineTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [strategy, setStrategy] = useState<StartStrategy>('auto');
  const [customSize, setCustomSize] = useState(false);
  const [vcpu, setVcpu] = useState(2);
  const [memoryGb, setMemoryGb] = useState(2);
  const [diskGb, setDiskGb] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [fetchedRegions, setFetchedRegions] = useState<string[]>([]);
  const [createRequestId, setCreateRequestId] = useState<string | null>(null);
  const [createTrace, setCreateTrace] = useState<MachineCreationTrace | null>(null);
  const [createStartedAt, setCreateStartedAt] = useState<number | null>(null);
  const [createNow, setCreateNow] = useState(() => Date.now());
  const [createPollError, setCreatePollError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    request<{ templates: MachineTemplate[] }>('/machine-templates')
      .then((templateData) => {
        if (!cancelled) setTemplates((templateData.templates ?? []).filter((template) => template.type === 'container' && template.status === 'active'));
      })
      .catch(() => { if (!cancelled) setTemplates([]); });

    request<{ regions: string[] }>('/regions', { auth: false })
      .then((regionData) => { if (!cancelled) setFetchedRegions(regionData.regions ?? []); })
      .catch(() => { /* surfaced */ });

    return () => { cancelled = true; };
  }, [open, request]);

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

  const selectedTemplateId = templates.some((template) => template.id === templateId) ? templateId : templates[0]?.id ?? '';
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const regionChoices = regions.length > 0 ? regions : fetchedRegions;
  const selectedRegion = selectedTemplate?.region ?? (regionChoices[0] ?? '');
  const createReady = Boolean(selectedTemplate);

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
    if (!selectedTemplate) return setError('Pick a Machine Template first.');
    const displayName = name.trim();
    if (displayName.length > 80) return setError('Display name must be 80 characters or less.');
    const startedAt = new Date().getTime();
    const requestId = crypto.randomUUID();
    setCreateRequestId(requestId);
    setCreateStartedAt(startedAt);
    setCreateNow(startedAt);
    setCreatePollError(null);
    setCreateTrace({ id: requestId, kind: 'machine.create', status: 'active', stage: 'connecting to API', started_at: new Date().toISOString(), labels: { api_base_url: baseUrl }, spans: [] });
    try {
      await fire(`create ${displayName || 'machine'}`, async () => {
        const data = await request('/machines', {
          method: 'POST',
          headers: { 'X-JustAVPS-Request-Id': requestId },
          body: {
            name: displayName || undefined,
            type,
            template_id: selectedTemplate.id,
            start_strategy: strategy,
            resources: customSize ? { vcpu, memory_gb: memoryGb, disk_gb: diskGb } : undefined,
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
          <DialogDescription>New Machines are created from ready-to-boot Machine Templates only. Images, snapshots, and backups must become Templates first.</DialogDescription>
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
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">{selectedRegion || 'Template region'}</div>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div>
              <Label>Machine Template</Label>
              <p className="mt-1 text-xs text-muted-foreground">Templates are prepared images with JustAVPS daemon baked and second-boot verified.</p>
            </div>
            <Select value={selectedTemplateId} onValueChange={setTemplateId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="pick Template…" /></SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>{template.name} · {template.default_resources.vcpu}c/{template.default_resources.memory_gb}GB/{template.default_resources.disk_gb}GB · hot {templatePool(template, 'running')?.ready ?? 0}/{templatePool(template, 'running')?.target ?? 0} · stopped {templatePool(template, 'stopped')?.ready ?? 0}/{templatePool(template, 'stopped')?.target ?? 0}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.length === 0 ? <p className="text-xs text-destructive">No active Machine Templates are available. Create one on the Templates page first.</p> : null}
            {selectedTemplate ? (
              <div className="grid gap-2 rounded-md border bg-background px-3 py-2 text-xs sm:grid-cols-3">
                <div><span className="text-muted-foreground">Default</span><div className="font-mono">{selectedTemplate.default_resources.vcpu}c · {selectedTemplate.default_resources.memory_gb}GB · {selectedTemplate.default_resources.disk_gb}GB</div></div>
                <div><span className="text-muted-foreground">Pools</span><div className="font-mono">hot {templatePool(selectedTemplate, 'running')?.ready ?? 0}/{templatePool(selectedTemplate, 'running')?.target ?? 0} · stopped {templatePool(selectedTemplate, 'stopped')?.ready ?? 0}/{templatePool(selectedTemplate, 'stopped')?.target ?? 0}</div></div>
                <div><span className="text-muted-foreground">Ready</span><div className="font-mono">{String(Boolean(selectedTemplate.readiness?.ready))}</div></div>
              </div>
            ) : null}
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
            <p className="text-2xs text-muted-foreground">Auto always checks Running Hot first, then Stopped Pool, then cold create.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => {
            if (!customSize && selectedTemplate) {
              setVcpu(selectedTemplate.default_resources.vcpu);
              setMemoryGb(selectedTemplate.default_resources.memory_gb);
              setDiskGb(selectedTemplate.default_resources.disk_gb);
            }
            setCustomSize((value) => !value);
          }}>
            {customSize ? 'Use Template default size' : 'Customize initial size'}
          </Button>
          {customSize ? <div className="grid grid-cols-3 gap-3">
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
          </div> : null}
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
          <Button onClick={submit} disabled={busy || !createReady}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
