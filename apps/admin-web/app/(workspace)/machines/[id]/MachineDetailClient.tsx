'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/confirm';
import { useUiPrefs } from '@/lib/ui-prefs';
import { ResizeMachineDialog } from '@/components/features/resize-machine-dialog';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Activity, ArrowLeft, Play, Square, RotateCcw, Trash2, RefreshCw,
  Terminal, Info, Server, Database, Braces, Camera, Archive, Plus, ExternalLink,
  Globe, Copy, Check, Link2, Share2, KeyRound, SlidersHorizontal,
  X, Cpu, MemoryStick, HardDrive, Network, Gauge, Clock3, AlertTriangle, Search,
  ListFilter, Radio, ShieldCheck, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { BackupItem, Machine, MachineTelemetryEvent, MachineTelemetryLatest, MachineTelemetryLog, MachineTelemetryMetric, MachineTelemetryTrace, ProxyToken, SnapshotItem, SshToken, TelemetryStoreInfo } from '@/lib/api';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

function isRunningStatus(status: string | undefined) {
  return status?.toLowerCase() === 'running';
}

function BackToMachines({ onBack }: { onBack?: () => void }) {
  if (onBack) {
    return (
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Machines
      </button>
    );
  }
  return (
    <Link href="/machines" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> Machines
    </Link>
  );
}

const tabTriggerClass = '!h-11 justify-start gap-2 rounded-lg px-3 text-sm sm:justify-center';
const sshAccessEnabled = process.env.NEXT_PUBLIC_V2_SSH_GATEWAY_ENABLED === 'true'
  || process.env.NEXT_PUBLIC_V2_SSH_ACCESS_ENABLED === 'true';

type TelemetryWindow = '15m' | '1h' | '6h' | '24h';
type TelemetryLevel = 'all' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const TELEMETRY_WINDOWS: Array<{ value: TelemetryWindow; label: string; ms: number }> = [
  { value: '15m', label: 'Last 15 min', ms: 15 * 60 * 1000 },
  { value: '1h', label: 'Last hour', ms: 60 * 60 * 1000 },
  { value: '6h', label: 'Last 6 hours', ms: 6 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
];

const TELEMETRY_LEVELS: Array<{ value: TelemetryLevel; label: string }> = [
  { value: 'all', label: 'All levels' },
  { value: 'debug', label: 'Debug+' },
  { value: 'info', label: 'Info+' },
  { value: 'warn', label: 'Warn+' },
  { value: 'error', label: 'Error+' },
  { value: 'fatal', label: 'Fatal only' },
];

const CORE_METRICS: Array<{ key: string; label: string; description: string; icon: LucideIcon }> = [
  { key: 'justavps.sandbox.cpu.utilization', label: 'CPU', description: 'Guest CPU utilization', icon: Cpu },
  { key: 'justavps.sandbox.memory.utilization', label: 'Memory', description: 'Guest memory utilization', icon: MemoryStick },
  { key: 'justavps.sandbox.filesystem.utilization', label: 'Disk', description: 'Root filesystem utilization', icon: HardDrive },
  { key: 'justavps.sandbox.network.rx_rate', label: 'RX rate', description: 'Inbound network throughput', icon: Network },
  { key: 'justavps.sandbox.network.tx_rate', label: 'TX rate', description: 'Outbound network throughput', icon: Network },
  { key: 'justavps.sandbox.network.connections', label: 'Connections', description: 'Observed network connections', icon: Gauge },
  { key: 'justavps.sandbox.uptime', label: 'Uptime', description: 'Guest daemon uptime', icon: Clock3 },
  { key: 'justavps.daemon.up', label: 'Daemon', description: 'Managed daemon heartbeat', icon: Radio },
];

const MACHINE_DETAIL_TABS = new Set(['terminal', 'overview', 'observability', 'proxy', 'ssh', 'incus', 'snapshots', 'backups', 'metadata', 'raw']);

function initialMachineDetailTab() {
  if (typeof window === 'undefined') return 'terminal';
  const value = new URLSearchParams(window.location.search).get('tab') ?? '';
  return MACHINE_DETAIL_TABS.has(value) ? value : 'terminal';
}

export default function MachineDetailClient({ id, onBack }: { id: string; onBack?: () => void }) {
  const router = useRouter();
  const { state, request, runAction, refreshAll, pushToast } = useStore();
  const { defaultFullBackups, defaultOptimizedBackups } = useUiPrefs();
  const { confirm } = useConfirm();
  const [machine, setMachine] = useState<Machine | null>(
    () => state.machines.find((m) => m.id === id) ?? null,
  );
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [proxyTokens, setProxyTokens] = useState<ProxyToken[]>([]);
  const [sshTokens, setSshTokens] = useState<SshToken[]>([]);
  const [telemetryLatest, setTelemetryLatest] = useState<MachineTelemetryLatest | null>(null);
  const [telemetryMetrics, setTelemetryMetrics] = useState<MachineTelemetryMetric[]>([]);
  const [telemetryLogs, setTelemetryLogs] = useState<MachineTelemetryLog[]>([]);
  const [telemetryTraces, setTelemetryTraces] = useState<MachineTelemetryTrace[]>([]);
  const [telemetryEvents, setTelemetryEvents] = useState<MachineTelemetryEvent[]>([]);
  const [telemetryStore, setTelemetryStore] = useState<TelemetryStoreInfo | null>(null);
  const [telemetryWindow, setTelemetryWindow] = useState<TelemetryWindow>('1h');
  const [telemetryLogLevel, setTelemetryLogLevel] = useState<TelemetryLevel>('all');
  const [telemetryLogSource, setTelemetryLogSource] = useState('all');
  const [telemetryLogSearch, setTelemetryLogSearch] = useState('');
  const [telemetryTraceOperation, setTelemetryTraceOperation] = useState('all');
  const [telemetryAutoRefresh, setTelemetryAutoRefresh] = useState(true);
  const [daemonEnsureLoading, setDaemonEnsureLoading] = useState(false);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [proxyTokensLoading, setProxyTokensLoading] = useState(false);
  const [sshTokensLoading, setSshTokensLoading] = useState(false);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [snapshotCreateOpen, setSnapshotCreateOpen] = useState(false);
  const [backupCreateOpen, setBackupCreateOpen] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(initialMachineDetailTab);

  const selectTab = useCallback((value: string) => {
    setActiveTab(value);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value === 'terminal') url.searchParams.delete('tab');
    else url.searchParams.set('tab', value);
    window.history.replaceState({}, '', url.toString());
  }, []);

  const refreshArtifacts = async () => {
    setArtifactsLoading(true);
    try {
      const [snapshotData, backupData] = await Promise.all([
        request<{ snapshots: SnapshotItem[] }>(`/machines/${encodeURIComponent(id)}/snapshots`),
        request<{ backups: BackupItem[] }>(`/machines/${encodeURIComponent(id)}/backups`),
      ]);
      setSnapshots(snapshotData.snapshots ?? []);
      setBackups(backupData.backups ?? []);
    } finally {
      setArtifactsLoading(false);
    }
  };

  const refreshProxyTokens = async () => {
    setProxyTokensLoading(true);
    try {
      const data = await request<{ proxy_tokens: ProxyToken[] }>(`/proxy-tokens?machine_id=${encodeURIComponent(id)}`);
      setProxyTokens(data.proxy_tokens ?? []);
    } finally {
      setProxyTokensLoading(false);
    }
  };

  useEffect(() => {
    setActiveTab(initialMachineDetailTab());
  }, [id]);

  const refreshSshTokens = async () => {
    setSshTokensLoading(true);
    try {
      const data = await request<{ ssh_tokens: SshToken[] }>(`/ssh-tokens?machine_id=${encodeURIComponent(id)}`);
      setSshTokens(data.ssh_tokens ?? []);
    } finally {
      setSshTokensLoading(false);
    }
  };

  const refreshTelemetry = useCallback(async () => {
    setTelemetryLoading(true);
    try {
      const range = telemetryWindowRange(telemetryWindow);
      const metricParams = new URLSearchParams({ from: range.from, to: range.to, limit: '2000' });
      const logParams = new URLSearchParams({ from: range.from, to: range.to, limit: '250' });
      const traceParams = new URLSearchParams({ from: range.from, to: range.to, limit: '200' });
      const eventParams = new URLSearchParams({ from: range.from, to: range.to, limit: '200' });
      const logSearch = telemetryLogSearch.trim();

      if (telemetryLogLevel !== 'all') logParams.set('level', telemetryLogLevel);
      if (telemetryLogSource !== 'all') logParams.set('source', telemetryLogSource);
      if (logSearch) logParams.set('search', logSearch);
      if (telemetryTraceOperation !== 'all') traceParams.set('operation', telemetryTraceOperation);

      const [latest, metrics, logs, traces, events] = await Promise.all([
        request<{ latest: MachineTelemetryLatest; store?: TelemetryStoreInfo }>(`/admin/telemetry/machines/${encodeURIComponent(id)}/latest`),
        request<{ metrics: MachineTelemetryMetric[]; store?: TelemetryStoreInfo }>(`/admin/telemetry/machines/${encodeURIComponent(id)}/metrics?${metricParams.toString()}`),
        request<{ logs: MachineTelemetryLog[]; store?: TelemetryStoreInfo }>(`/admin/telemetry/machines/${encodeURIComponent(id)}/logs?${logParams.toString()}`),
        request<{ traces: MachineTelemetryTrace[]; store?: TelemetryStoreInfo }>(`/admin/telemetry/machines/${encodeURIComponent(id)}/traces?${traceParams.toString()}`),
        request<{ events: MachineTelemetryEvent[]; store?: TelemetryStoreInfo }>(`/admin/telemetry/machines/${encodeURIComponent(id)}/events?${eventParams.toString()}`),
      ]);
      setTelemetryLatest(latest.latest ?? null);
      setTelemetryStore(latest.store ?? metrics.store ?? logs.store ?? traces.store ?? events.store ?? null);
      setTelemetryMetrics(metrics.metrics ?? []);
      setTelemetryLogs(logs.logs ?? []);
      setTelemetryTraces(traces.traces ?? []);
      setTelemetryEvents(events.events ?? []);
    } finally {
      setTelemetryLoading(false);
    }
  }, [id, request, telemetryLogLevel, telemetryLogSearch, telemetryLogSource, telemetryTraceOperation, telemetryWindow]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const data = await request<{ machine: Machine }>(`/machines/${encodeURIComponent(id)}`);
        if (!cancelled) setMachine(data.machine);
      } catch { /* surfaced */ }
    }
    tick();
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [id, request]);

  useEffect(() => {
    refreshArtifacts().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    refreshProxyTokens().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!sshAccessEnabled) return;
    refreshSshTokens().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    refreshTelemetry().catch(() => undefined);
    if (!telemetryAutoRefresh) return undefined;
    const t = setInterval(() => refreshTelemetry().catch(() => undefined), 10_000);
    return () => clearInterval(t);
  }, [refreshTelemetry, telemetryAutoRefresh]);

  const fire = async (label: string, fn: () => Promise<unknown>) => {
    await runAction(label, async () => {
      const r = await fn();
      await refreshAll();
      const data = await request<{ machine: Machine }>(`/machines/${encodeURIComponent(id)}`);
      setMachine(data.machine);
      return r;
    });
  };

  const artifactAction = async (label: string, fn: () => Promise<unknown>) => {
    await runAction(label, async () => {
      const r = await fn();
      await refreshArtifacts();
      return r;
    });
  };

  const repairDaemonTelemetry = async () => {
    setDaemonEnsureLoading(true);
    try {
      await runAction(`repair daemon telemetry for ${machine?.name ?? id}`, async () => {
        const result = await request(`/machines/${encodeURIComponent(id)}/daemon/ensure`, { method: 'POST', body: {} });
        await refreshTelemetry();
        return result;
      });
    } catch {
      // runAction already records the failure in the workflow log and toast.
      // Do not rethrow into Next's client runtime overlay.
    } finally {
      setDaemonEnsureLoading(false);
    }
  };

  if (!machine) {
    return (
      <div className="space-y-4">
        <BackToMachines onBack={onBack} />
        <p className="text-sm text-muted-foreground">Loading {id}…</p>
      </div>
    );
  }

  if (machine.type !== 'container') {
    return (
      <div className="space-y-4">
        <BackToMachines onBack={onBack} />
        <Card>
          <CardHeader>
            <CardTitle>Machine unavailable</CardTitle>
            <CardDescription>This machine type is inactive in the current web UI.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => (onBack ? onBack() : router.push('/machines'))}>Back to machines</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const running = isRunningStatus(machine.status);
  const resources = (machine.resources ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackToMachines onBack={onBack} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{machine.name}</h1>
              <Badge variant={running ? 'default' : 'secondary'}>{machine.status}</Badge>
              <Badge variant="outline" className="font-mono text-xs">{machine.type}</Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">{machine.id}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setResizeOpen(true)}>
              <SlidersHorizontal className="size-3.5" /> Resize
            </Button>
            {!running ? (
              <Button size="sm" variant="outline" onClick={() => fire(`start ${machine.name}`, () => request(`/machines/${machine.id}/start`, { method: 'POST' }))}>
                <Play className="size-3.5" /> Start
              </Button>
            ) : null}
            {running ? (
              <>
                <Button size="sm" variant="outline" onClick={() => fire(`stop ${machine.name}`, () => request(`/machines/${machine.id}/stop`, { method: 'POST' }))}>
                  <Square className="size-3.5" /> Stop
                </Button>
                <Button size="sm" variant="outline" onClick={() => fire(`reboot ${machine.name}`, () => request(`/machines/${machine.id}/reboot`, { method: 'POST' }))}>
                  <RotateCcw className="size-3.5" /> Restart
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => refreshAll().catch(() => {})}>
              <RefreshCw className="size-3.5" />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Button size="sm" variant="destructive" onClick={async () => {
              if (!await confirm({
                title: `Delete ${machine.name}?`,
                description: 'Stops the instance, drops the rootfs, removes config. Final.',
                confirmLabel: 'Delete',
                destructive: true,
              })) return;
              await fire(`delete ${machine.name}`, () => request(`/machines/${machine.id}`, { method: 'DELETE' }));
              if (onBack) onBack();
              else router.push('/machines');
            }}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <Stat label="vCPU" value={String(resources.vcpu ?? '—')} />
        <Stat label="RAM" value={`${resources.memory_gb ?? '—'} GB`} />
        <Stat label="Disk" value={`${resources.disk_gb ?? '—'} GB`} />
        <Stat label="Region" value={machine.region ?? '—'} />
        <Stat label="Telemetry" value={telemetryLatest?.health ?? 'unknown'} />
        <Stat label="Last seen" value={formatRelativeTime(telemetryLatest?.last_seen_at)} />
      </div>

      <Tabs value={activeTab} onValueChange={selectTab} className="flex-col gap-4">
        <div className="w-full rounded-xl border bg-card p-2 shadow-sm">
          <TabsList className={`!grid !h-auto w-full grid-cols-2 gap-1 rounded-lg bg-muted/40 p-1 ${sshAccessEnabled ? 'sm:grid-cols-10' : 'sm:grid-cols-9'}`}>
            <TabsTrigger value="terminal" className={tabTriggerClass}>
              <Terminal className="size-4" /> Terminal
            </TabsTrigger>
            <TabsTrigger value="overview" className={tabTriggerClass}>
              <Info className="size-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="observability" className={tabTriggerClass}>
              <Activity className="size-4" /> Observability
            </TabsTrigger>
            <TabsTrigger value="proxy" className={tabTriggerClass}>
              <Globe className="size-4" /> Proxy
            </TabsTrigger>
            {sshAccessEnabled ? (
              <TabsTrigger value="ssh" className={tabTriggerClass}>
                <KeyRound className="size-4" /> SSH
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="incus" className={tabTriggerClass}>
              <Server className="size-4" /> Incus
            </TabsTrigger>
            <TabsTrigger value="snapshots" className={tabTriggerClass}>
              <Camera className="size-4" /> Snapshots
            </TabsTrigger>
            <TabsTrigger value="backups" className={tabTriggerClass}>
              <Archive className="size-4" /> Backups
            </TabsTrigger>
            <TabsTrigger value="metadata" className={tabTriggerClass}>
              <Database className="size-4" /> Metadata
            </TabsTrigger>
            <TabsTrigger value="raw" className={tabTriggerClass}>
              <Braces className="size-4" /> Raw
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="terminal" forceMount className={cn('mt-0 space-y-4', activeTab !== 'terminal' && 'hidden')}>
          <TerminalPanel machine={machine} running={running} baseUrl={state.baseUrl} token={state.token} visible={activeTab === 'terminal'} />
        </TabsContent>

        <TabsContent value="overview" className="mt-0 space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <Card>
              <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow><TableCell className="font-medium w-40">Name</TableCell><TableCell>{machine.name}</TableCell></TableRow>
                    <TableRow><TableCell className="font-medium">ID</TableCell><TableCell className="font-mono text-xs">{machine.id}</TableCell></TableRow>
                    <TableRow><TableCell className="font-medium">Type</TableCell><TableCell>{machine.type}</TableCell></TableRow>
                    <TableRow><TableCell className="font-medium">Status</TableCell><TableCell><Badge variant={running ? 'default' : 'secondary'}>{machine.status}</Badge></TableCell></TableRow>
                    <TableRow><TableCell className="font-medium">Region</TableCell><TableCell>{machine.region ?? '—'}</TableCell></TableRow>
                    <TableRow><TableCell className="font-medium">Source</TableCell><TableCell className="font-mono text-xs">{machine.source ? `${machine.source.type}: ${('id' in machine.source ? machine.source.id : '') ?? ''}` : '—'}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <TelemetryOverviewCard
              latest={telemetryLatest}
              logs={telemetryLogs}
              traces={telemetryTraces}
              events={telemetryEvents}
              onOpen={() => selectTab('observability')}
            />
          </div>
        </TabsContent>

        <TabsContent value="observability" className="mt-0 space-y-4">
          <ObservabilityPanel
            machine={machine}
            latest={telemetryLatest}
            metrics={telemetryMetrics}
            logs={telemetryLogs}
            traces={telemetryTraces}
            events={telemetryEvents}
            store={telemetryStore}
            loading={telemetryLoading}
            daemonEnsureLoading={daemonEnsureLoading}
            telemetryWindow={telemetryWindow}
            onTelemetryWindowChange={setTelemetryWindow}
            logLevel={telemetryLogLevel}
            onLogLevelChange={setTelemetryLogLevel}
            logSource={telemetryLogSource}
            onLogSourceChange={setTelemetryLogSource}
            logSearch={telemetryLogSearch}
            onLogSearchChange={setTelemetryLogSearch}
            traceOperation={telemetryTraceOperation}
            onTraceOperationChange={setTelemetryTraceOperation}
            autoRefresh={telemetryAutoRefresh}
            onAutoRefreshChange={setTelemetryAutoRefresh}
            onRepairDaemonTelemetry={repairDaemonTelemetry}
            onRefresh={() => refreshTelemetry().catch(() => undefined)}
          />
        </TabsContent>

        <TabsContent value="proxy" className="mt-0 space-y-4">
          <ProxyAccessPanel
            machine={machine}
            running={running}
            tokens={proxyTokens}
            loading={proxyTokensLoading}
            request={request}
            refreshTokens={refreshProxyTokens}
            pushToast={pushToast}
            confirm={confirm}
          />
        </TabsContent>

        {sshAccessEnabled ? (
          <TabsContent value="ssh" className="mt-0 space-y-4">
            <SshAccessPanel
              machine={machine}
              running={running}
              tokens={sshTokens}
              loading={sshTokensLoading}
              request={request}
              refreshTokens={refreshSshTokens}
              pushToast={pushToast}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="incus" className="mt-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Incus placement</CardTitle>
              <CardDescription>Where this instance lives.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow><TableCell className="font-medium w-40">Cluster</TableCell><TableCell className="font-mono text-xs">{machine.incus?.cluster_id ?? '—'}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Project</TableCell><TableCell className="font-mono text-xs">{machine.incus?.project ?? '—'}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Instance name</TableCell><TableCell className="font-mono text-xs">{machine.incus?.instance_name ?? '—'}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Member</TableCell><TableCell className="font-mono text-xs">{machine.incus?.member_name ?? '—'}</TableCell></TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="snapshots" className="mt-0 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><Camera className="size-4" /> Snapshots</CardTitle>
                  <CardDescription>Point-in-time Incus snapshots for quick rollback or image publishing.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => refreshArtifacts().catch(() => undefined)} disabled={artifactsLoading}>
                    <RefreshCw className="size-3.5" /> Refresh
                  </Button>
                  <Button size="sm" onClick={() => setSnapshotCreateOpen(true)}>
                    <Plus className="size-3.5" /> Snapshot
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {snapshots.length === 0 ? (
                <ArtifactEmpty label={artifactsLoading ? 'Loading snapshots…' : 'No snapshots yet'} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Stateful</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshots.map((snapshot) => (
                      <TableRow key={snapshot.name}>
                        <TableCell className="font-mono text-xs">{snapshot.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(snapshot.created_at)}</TableCell>
                        <TableCell><Badge variant={snapshot.stateful ? 'default' : 'secondary'}>{snapshot.stateful ? 'stateful' : 'disk only'}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(snapshot.expires_at)}</TableCell>
                        <TableCell className="space-x-1 text-right">
                          <Button size="sm" variant="outline" onClick={async () => {
                            if (!await confirm({
                              title: `Restore snapshot ${snapshot.name}?`,
                              description: 'This reverts the machine rootfs to this exact snapshot. Current changes after that snapshot can be lost.',
                              confirmLabel: 'Restore',
                              destructive: true,
                            })) return;
                            await artifactAction(`restore snapshot ${snapshot.name}`, () => request(`/machines/${encodeURIComponent(machine.id)}/snapshots/${encodeURIComponent(snapshot.name)}/restore`, { method: 'POST', body: { stateful: Boolean(snapshot.stateful) } }));
                          }}>
                            <RotateCcw className="size-3.5" /> Restore
                          </Button>
                          <Button size="sm" variant="ghost" onClick={async () => {
                            if (!await confirm({
                              title: `Delete snapshot ${snapshot.name}?`,
                              description: 'Deletes this Incus snapshot permanently.',
                              confirmLabel: 'Delete',
                              destructive: true,
                            })) return;
                            await artifactAction(`delete snapshot ${snapshot.name}`, () => request(`/machines/${encodeURIComponent(machine.id)}/snapshots/${encodeURIComponent(snapshot.name)}`, { method: 'DELETE' }));
                          }}>
                            <Trash2 className="size-3.5" /> Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <CreateSnapshotDialog
            open={snapshotCreateOpen}
            onOpenChange={setSnapshotCreateOpen}
            machine={machine}
            request={request}
            artifactAction={artifactAction}
          />
        </TabsContent>

        <TabsContent value="backups" className="mt-0 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><Archive className="size-4" /> Backups</CardTitle>
                  <CardDescription>Native Incus backup tarballs. Full includes snapshots; instance-only excludes snapshots.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => refreshArtifacts().catch(() => undefined)} disabled={artifactsLoading}>
                    <RefreshCw className="size-3.5" /> Refresh
                  </Button>
                  <Button size="sm" onClick={() => setBackupCreateOpen(true)}>
                    <Plus className="size-3.5" /> Backup
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {backups.length === 0 ? (
                <ArtifactEmpty label={artifactsLoading ? 'Loading backups…' : 'No backups yet'} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((backup) => (
                      <TableRow key={backup.name}>
                        <TableCell className="font-mono text-xs">{backup.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(backup.created_at)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(backup.expires_at)}</TableCell>
                        <TableCell><Badge variant={backup.instance_only ? 'secondary' : 'default'}>{backup.instance_only ? 'instance only' : 'full'}</Badge></TableCell>
                        <TableCell className="space-x-1 text-right">
                          <Button size="sm" variant="outline" onClick={async () => {
                            if (!await confirm({
                              title: `Restore backup ${backup.name}?`,
                              description: 'This restores the backup in place using the pinned restore snapshot.',
                              confirmLabel: 'Restore',
                              destructive: true,
                            })) return;
                            await artifactAction(`restore backup ${backup.name}`, () => request(`/machines/${encodeURIComponent(machine.id)}/backups/${encodeURIComponent(backup.name)}/restore`, { method: 'POST', body: {} }));
                          }}>
                            <RotateCcw className="size-3.5" /> Restore
                          </Button>
                          <Button size="sm" variant="ghost" onClick={async () => {
                            if (!await confirm({
                              title: `Delete backup ${backup.name}?`,
                              description: 'Deletes the backup tarball and its pinned restore snapshot.',
                              confirmLabel: 'Delete',
                              destructive: true,
                            })) return;
                            await artifactAction(`delete backup ${backup.name}`, () => request(`/machines/${encodeURIComponent(machine.id)}/backups/${encodeURIComponent(backup.name)}`, { method: 'DELETE' }));
                          }}>
                            <Trash2 className="size-3.5" /> Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <CreateBackupDialog
            key={`backup-${String(defaultFullBackups)}-${String(defaultOptimizedBackups)}`}
            open={backupCreateOpen}
            onOpenChange={setBackupCreateOpen}
            machine={machine}
            request={request}
            artifactAction={artifactAction}
            defaultFull={defaultFullBackups}
            defaultOptimized={defaultOptimizedBackups}
          />
        </TabsContent>

        <TabsContent value="metadata" className="mt-0 space-y-4">
          <Card>
            <CardHeader><CardTitle>Metadata</CardTitle></CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded-md bg-muted p-4 font-mono text-xs">
                {JSON.stringify(machine.metadata ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Full payload</CardTitle>
              <CardDescription>GET /machines/{machine.id}</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[600px] overflow-auto rounded-md bg-muted p-4 font-mono text-xs">
                {JSON.stringify(machine, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ResizeMachineDialog
        open={resizeOpen}
        onOpenChange={setResizeOpen}
        machine={machine}
        busy={state.busy}
        onResize={(nextResources) => fire(`resize ${machine.name}`, () => request(`/machines/${machine.id}`, { method: 'PATCH', body: { resources: nextResources } }))}
      />
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value || value === '1970-01-01T00:00:00Z') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatMetric(metric: { value: number; unit: string } | undefined) {
  if (!metric) return '—';
  if (metric.unit === 'seconds') return formatSeconds(metric.value);
  if (metric.unit === 'percent') return `${metric.value.toFixed(1)}%`;
  if (metric.unit === 'bytes') return `${(metric.value / 1024 / 1024).toFixed(1)} MiB`;
  if (metric.unit === 'bytes/s') return `${(metric.value / 1024).toFixed(1)} KiB/s`;
  if (metric.unit === '1') return metric.value >= 1 ? 'up' : 'down';
  return `${Number.isInteger(metric.value) ? metric.value : metric.value.toFixed(2)}${metric.unit ? ` ${metric.unit}` : ''}`;
}

function telemetryWindowRange(value: TelemetryWindow) {
  const windowDef = TELEMETRY_WINDOWS.find((option) => option.value === value) ?? TELEMETRY_WINDOWS[1];
  const to = new Date();
  const from = new Date(to.getTime() - windowDef.ms);
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'never';
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 'unknown';
  const diff = Date.now() - ts;
  if (diff < 15_000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 48) return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatDurationMs(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function metricSeries(metrics: MachineTelemetryMetric[], name: string) {
  return metrics
    .filter((metric) => metric.name === name && Number.isFinite(metric.value))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function healthBadgeVariant(health?: string | null) {
  const normalized = health?.toLowerCase();
  if (!normalized) return 'outline' as const;
  if (normalized === 'healthy') return 'default' as const;
  if (normalized === 'stale') return 'secondary' as const;
  if (normalized === 'unknown') return 'outline' as const;
  return 'destructive' as const;
}

function severityBadgeVariant(severity?: string | null) {
  const normalized = severity?.toLowerCase();
  if (normalized === 'error' || normalized === 'fatal') return 'destructive' as const;
  if (normalized === 'warn' || normalized === 'warning') return 'secondary' as const;
  return 'outline' as const;
}

function prettyJson(value?: Record<string, unknown>) {
  if (!value || Object.keys(value).length === 0) return '';
  return JSON.stringify(value, null, 2);
}

function ObservabilityPanel({
  machine,
  latest,
  metrics,
  logs,
  traces,
  events,
  store,
  loading,
  daemonEnsureLoading,
  telemetryWindow,
  onTelemetryWindowChange,
  logLevel,
  onLogLevelChange,
  logSource,
  onLogSourceChange,
  logSearch,
  onLogSearchChange,
  traceOperation,
  onTraceOperationChange,
  autoRefresh,
  onAutoRefreshChange,
  onRepairDaemonTelemetry,
  onRefresh,
}: {
  machine: Machine;
  latest: MachineTelemetryLatest | null;
  metrics: MachineTelemetryMetric[];
  logs: MachineTelemetryLog[];
  traces: MachineTelemetryTrace[];
  events: MachineTelemetryEvent[];
  store: TelemetryStoreInfo | null;
  loading: boolean;
  daemonEnsureLoading: boolean;
  telemetryWindow: TelemetryWindow;
  onTelemetryWindowChange: (value: TelemetryWindow) => void;
  logLevel: TelemetryLevel;
  onLogLevelChange: (value: TelemetryLevel) => void;
  logSource: string;
  onLogSourceChange: (value: string) => void;
  logSearch: string;
  onLogSearchChange: (value: string) => void;
  traceOperation: string;
  onTraceOperationChange: (value: string) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  onRepairDaemonTelemetry: () => void;
  onRefresh: () => void;
}) {
  const latestMetrics = latest?.metrics ?? {};
  const sourceOptions = useMemo(() => {
    const seen = new Set(logs.map((log) => log.source || log.stream).filter(Boolean));
    if (logSource !== 'all') seen.add(logSource);
    return Array.from(seen).sort();
  }, [logSource, logs]);
  const operationOptions = useMemo(() => {
    const seen = new Set(traces.map((trace) => trace.operation).filter(Boolean));
    if (traceOperation !== 'all') seen.add(traceOperation);
    return Array.from(seen).sort();
  }, [traceOperation, traces]);
  const metricNames = useMemo(() => Array.from(new Set(metrics.map((metric) => metric.name))).sort(), [metrics]);
  const timeline = useMemo(() => {
    const rows = [
      ...logs.map((log) => ({
        id: `log-${log.timestamp}-${log.body}`,
        kind: 'log' as const,
        time: log.timestamp,
        title: `${log.severity || 'info'} · ${log.source || log.stream || 'log'}`,
        body: log.body,
        badge: log.severity || 'info',
      })),
      ...traces.map((trace) => ({
        id: `trace-${trace.trace_id}-${trace.span_id}`,
        kind: 'trace' as const,
        time: trace.started_at,
        title: trace.operation || trace.name,
        body: `${trace.name}${trace.duration_ms !== null && trace.duration_ms !== undefined ? ` · ${formatDurationMs(trace.duration_ms)}` : ''}`,
        badge: trace.status || 'span',
      })),
      ...events.map((event) => ({
        id: `event-${event.timestamp}-${event.type}`,
        kind: 'event' as const,
        time: event.timestamp,
        title: event.type,
        body: event.body || event.category || 'event',
        badge: event.category || 'event',
      })),
    ];
    return rows
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 14);
  }, [events, logs, traces]);
  const errorLogs = logs.filter((log) => ['error', 'fatal'].includes(log.severity?.toLowerCase()));
  const hasSignals = metrics.length > 0 || logs.length > 0 || traces.length > 0 || events.length > 0 || Boolean(latest?.last_seen_at);
  const backendLabel = store?.enabled === false ? 'disabled' : store?.driver ?? 'unknown';

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity className="size-5" /> Sandbox observability
                </CardTitle>
                <Badge variant={healthBadgeVariant(latest?.health)}>{latest?.health ?? 'unknown'}</Badge>
                {loading ? <Badge variant="secondary">refreshing…</Badge> : null}
              </div>
              <CardDescription>
                Default per-sandbox metrics, logs, traces, and lifecycle events for <span className="font-mono">{machine.name}</span>.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                <Switch id="telemetry-auto-refresh" checked={autoRefresh} onCheckedChange={onAutoRefreshChange} />
                <Label htmlFor="telemetry-auto-refresh" className="text-xs">Auto-refresh</Label>
              </div>
              <Button size="sm" variant="outline" onClick={onRepairDaemonTelemetry} disabled={daemonEnsureLoading}>
                <Wrench className={cn('size-3.5', daemonEnsureLoading && 'animate-pulse')} /> Repair daemon
              </Button>
              <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {!hasSignals ? (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="size-4" /> No telemetry has reached this backend yet
                  </div>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    The UI is connected and the telemetry endpoints are responding, but this machine has no metric/log/trace/event rows in the selected backend. Typical causes: the managed daemon has not been installed/repaired since telemetry was enabled, the API was started with the in-memory telemetry backend, ClickHouse is down, or the daemon telemetry URL is not reachable from inside the sandbox.
                  </p>
                </div>
                <Button size="sm" onClick={onRepairDaemonTelemetry} disabled={daemonEnsureLoading}>
                  <Wrench className={cn('size-3.5', daemonEnsureLoading && 'animate-pulse')} /> Repair daemon telemetry
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <HealthSummaryTile icon={ShieldCheck} label="Health" value={latest?.health ?? 'unknown'} sub={`last seen ${formatRelativeTime(latest?.last_seen_at)}`} tone={latest?.health ?? 'unknown'} />
            <HealthSummaryTile icon={Gauge} label="Metric rows" value={metrics.length.toString()} sub={`${metricNames.length} unique series`} />
            <HealthSummaryTile icon={AlertTriangle} label="Errors" value={errorLogs.length.toString()} sub={`${logs.length} logs in selected window`} tone={errorLogs.length > 0 ? 'error' : 'healthy'} />
            <HealthSummaryTile icon={ListFilter} label="Backend" value={backendLabel} sub={store?.clickhouse_database ? `database ${store.clickhouse_database}` : 'telemetry store'} tone={store?.enabled === false ? 'error' : undefined} />
          </div>

          <div className="grid gap-2 rounded-xl border bg-background p-3 lg:grid-cols-[170px_160px_170px_1fr_180px]">
            <Select value={telemetryWindow} onValueChange={(value) => onTelemetryWindowChange(value as TelemetryWindow)}>
              <SelectTrigger><Clock3 className="size-3.5" /><SelectValue /></SelectTrigger>
              <SelectContent>
                {TELEMETRY_WINDOWS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={logLevel} onValueChange={(value) => onLogLevelChange(value as TelemetryLevel)}>
              <SelectTrigger><AlertTriangle className="size-3.5" /><SelectValue /></SelectTrigger>
              <SelectContent>
                {TELEMETRY_LEVELS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={logSource} onValueChange={onLogSourceChange}>
              <SelectTrigger><ListFilter className="size-3.5" /><SelectValue placeholder="Log source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceOptions.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={logSearch} onChange={(event) => onLogSearchChange(event.target.value)} placeholder="Search logs…" className="pl-8" />
            </div>
            <Select value={traceOperation} onValueChange={onTraceOperationChange}>
              <SelectTrigger><Activity className="size-3.5" /><SelectValue placeholder="Trace operation" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All operations</SelectItem>
                {operationOptions.map((operation) => <SelectItem key={operation} value={operation}>{operation}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CORE_METRICS.map((definition) => (
          <MetricSignalCard
            key={definition.key}
            definition={definition}
            latest={latestMetrics[definition.key]}
            series={metricSeries(metrics, definition.key)}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <LogsPanel logs={logs} loading={loading} />
        <TimelinePanel items={timeline} loading={loading} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TracesPanel traces={traces} loading={loading} />
        <EventsPanel events={events} loading={loading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw metric series</CardTitle>
          <CardDescription>All metric names returned for the selected window. Useful for debugging daemon/app telemetry coverage.</CardDescription>
        </CardHeader>
        <CardContent>
          {metricNames.length === 0 ? <ArtifactEmpty label={loading ? 'Loading metrics…' : 'No metric rows in this window'} /> : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {metricNames.map((name) => {
                const rows = metricSeries(metrics, name);
                const latestRow = rows.at(-1);
                return (
                  <div key={name} className="rounded-lg border p-3">
                    <div className="truncate font-mono text-xs">{name}</div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="text-lg font-semibold tabular-nums">{formatMetric(latestRow)}</div>
                      <div className="text-xs text-muted-foreground">{rows.length} samples</div>
                    </div>
                    <Sparkline values={rows.map((row) => row.value)} className="mt-2" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TelemetryOverviewCard({
  latest, logs, traces, events, onOpen,
}: {
  latest: MachineTelemetryLatest | null;
  logs: MachineTelemetryLog[];
  traces: MachineTelemetryTrace[];
  events: MachineTelemetryEvent[];
  onOpen: () => void;
}) {
  const metrics = latest?.metrics ?? {};
  const errorLogs = logs.filter((log) => ['error', 'fatal'].includes(log.severity?.toLowerCase())).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Activity className="size-4" /> Live health</CardTitle>
            <CardDescription>At-a-glance sandbox telemetry, refreshed with the details page.</CardDescription>
          </div>
          <Badge variant={healthBadgeVariant(latest?.health)}>{latest?.health ?? 'unknown'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <MiniTelemetryStat label="CPU" value={formatMetric(metrics['justavps.sandbox.cpu.utilization'])} />
          <MiniTelemetryStat label="Memory" value={formatMetric(metrics['justavps.sandbox.memory.utilization'])} />
          <MiniTelemetryStat label="Disk" value={formatMetric(metrics['justavps.sandbox.filesystem.utilization'])} />
        </div>
        <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
          Last signal <span className="font-medium text-foreground">{formatRelativeTime(latest?.last_seen_at)}</span> · {logs.length} logs · {traces.length} traces · {events.length} events · {errorLogs} errors
        </div>
        <Button variant="outline" className="w-full" onClick={onOpen}>
          <Activity className="size-3.5" /> Open observability
        </Button>
      </CardContent>
    </Card>
  );
}

function MiniTelemetryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function HealthSummaryTile({
  icon: Icon, label, value, sub, tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  const danger = tone?.toLowerCase() === 'error' || tone?.toLowerCase() === 'fatal';
  const healthy = tone?.toLowerCase() === 'healthy';
  return (
    <div className={cn('rounded-xl border p-3', danger ? 'border-destructive/30 bg-destructive/10' : healthy ? 'border-emerald-500/30 bg-emerald-500/10' : 'bg-background')}>
      <div className="flex items-center justify-between gap-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Icon className="size-4" /></div>
        <Badge variant={healthBadgeVariant(tone)}>{label}</Badge>
      </div>
      <div className="mt-3 text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function MetricSignalCard({
  definition, latest, series,
}: {
  definition: { key: string; label: string; description: string; icon: LucideIcon };
  latest?: { value: number; unit: string; timestamp: string };
  series: MachineTelemetryMetric[];
}) {
  const Icon = definition.icon;
  const percent = latest?.unit === 'percent' ? Math.max(0, Math.min(100, latest.value)) : null;
  const isDaemonUp = definition.key === 'justavps.daemon.up' && latest?.value === 1;
  return (
    <Card size="sm" className={cn(isDaemonUp && 'border-emerald-500/30 bg-emerald-500/5')}>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Icon className="size-4" /></div>
            <div className="min-w-0">
              <div className="font-medium">{definition.label}</div>
              <div className="truncate text-xs text-muted-foreground">{definition.description}</div>
            </div>
          </div>
          <Badge variant="outline">{series.length}</Badge>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{formatMetric(latest)}</div>
          <div className="text-xs text-muted-foreground">{latest ? `updated ${formatRelativeTime(latest.timestamp)}` : 'no samples yet'}</div>
        </div>
        {percent !== null ? <Progress value={percent} /> : null}
        <Sparkline values={series.map((sample) => sample.value)} />
      </CardContent>
    </Card>
  );
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <div className={cn('h-8 rounded bg-muted/40', className)} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 30 - ((value - min) / span) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg className={cn('h-8 w-full overflow-visible text-primary', className)} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function LogsPanel({ logs, loading }: { logs: MachineTelemetryLog[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
        <CardDescription>Platform, daemon, process stdout/stderr, and app logs matched by the filters above.</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? <ArtifactEmpty label={loading ? 'Loading logs…' : 'No logs match this filter'} /> : (
          <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
            {logs.map((log, idx) => (
              <details key={`${log.timestamp}-${idx}`} className="group rounded-lg border bg-background open:bg-muted/20">
                <summary className="flex cursor-pointer list-none items-start gap-3 p-3">
                  <Badge variant={severityBadgeVariant(log.severity)}>{log.severity || 'info'}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatDate(log.timestamp)}</span>
                      <span className="font-mono">{log.source || log.stream || 'unknown'}</span>
                      {log.trace_id ? <span className="font-mono">trace {log.trace_id.slice(0, 10)}</span> : null}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-foreground">{log.body}</div>
                  </div>
                </summary>
                <div className="border-t p-3">
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{log.body}</pre>
                  {prettyJson(log.attributes) ? <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{prettyJson(log.attributes)}</pre> : null}
                </div>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimelinePanel({
  items,
  loading,
}: {
  items: Array<{ id: string; kind: 'log' | 'trace' | 'event'; time: string; title: string; body: string; badge: string }>;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Unified activity</CardTitle>
        <CardDescription>Latest logs, spans, and events in one timeline.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? <ArtifactEmpty label={loading ? 'Loading activity…' : 'No activity in this window'} /> : (
          <div className="relative space-y-3 pl-4 before:absolute before:bottom-0 before:left-1 before:top-1 before:w-px before:bg-border">
            {items.map((item) => (
              <div key={item.id} className="relative rounded-lg border bg-background p-3 before:absolute before:-left-[18px] before:top-4 before:size-2 before:rounded-full before:bg-primary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline">{item.kind}</Badge>
                    <div className="truncate text-sm font-medium">{item.title}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(item.time)}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{item.body}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TracesPanel({ traces, loading }: { traces: MachineTelemetryTrace[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Traces</CardTitle>
        <CardDescription>Toolbox, API, lifecycle, and app spans from the selected window.</CardDescription>
      </CardHeader>
      <CardContent>
        {traces.length === 0 ? <ArtifactEmpty label={loading ? 'Loading traces…' : 'No traces match this filter'} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Operation</TableHead><TableHead>Span</TableHead><TableHead>Status</TableHead><TableHead>Duration</TableHead></TableRow></TableHeader>
            <TableBody>
              {traces.map((trace) => (
                <TableRow key={`${trace.trace_id}-${trace.span_id}`}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(trace.started_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{trace.operation || '—'}</TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="truncate text-xs">{trace.name}</div>
                    <div className="truncate font-mono text-2xs text-muted-foreground">{trace.trace_id}</div>
                    {trace.error ? <div className="mt-1 truncate text-2xs text-destructive">{trace.error}</div> : null}
                  </TableCell>
                  <TableCell><Badge variant={trace.status === 'error' ? 'destructive' : 'secondary'}>{trace.status || 'ok'}</Badge></TableCell>
                  <TableCell className="text-xs tabular-nums">{formatDurationMs(trace.duration_ms)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function EventsPanel({ events, loading }: { events: MachineTelemetryEvent[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Events</CardTitle>
        <CardDescription>Lifecycle, telemetry ingest, daemon, and routing events.</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? <ArtifactEmpty label={loading ? 'Loading events…' : 'No events in this window'} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Category</TableHead><TableHead>Type</TableHead><TableHead>Body</TableHead></TableRow></TableHeader>
            <TableBody>
              {events.map((event, idx) => (
                <TableRow key={`${event.timestamp}-${event.type}-${idx}`}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(event.timestamp)}</TableCell>
                  <TableCell><Badge variant="outline">{event.category || 'event'}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{event.type}</TableCell>
                  <TableCell className="max-w-[460px]">
                    <div className="truncate text-xs">{event.body || '—'}</div>
                    {prettyJson(event.attributes) ? <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-2 font-mono text-2xs">{prettyJson(event.attributes)}</pre> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ArtifactEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

const PROXY_TTL_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '8 hours', value: 28_800 },
  { label: '24 hours', value: 86_400 },
  { label: '7 days', value: 604_800 },
];

function fallbackMachineSlug(machine: Machine) {
  return machine.slug ?? machine.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function proxyPortTemplate(machine: Machine) {
  if (machine.urls?.port_template) return machine.urls.port_template;
  const slug = fallbackMachineSlug(machine);
  if (machine.urls?.proxy) {
    try {
      const url = new URL(machine.urls.proxy);
      const host = url.hostname.startsWith(`${slug}.`) ? url.hostname.slice(slug.length + 1) : url.hostname;
      return `${url.protocol}//{port}--${slug}.${host}${url.port ? `:${url.port}` : ''}`;
    } catch { /* fall through */ }
  }
  return `https://{port}--${slug}.kortix.cloud`;
}

function proxyRootUrl(machine: Machine) {
  return machine.urls?.proxy ?? `https://${fallbackMachineSlug(machine)}.kortix.cloud`;
}

function parseProxyPorts(input: string) {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const ports = parts.map((part) => Number(part));
  if (!ports.length || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('Ports must be comma-separated integers between 1 and 65535.');
  }
  return Array.from(new Set(ports)).sort((a, b) => a - b);
}

function ProxyAccessPanel({
  machine,
  running,
  tokens,
  loading,
  request,
  refreshTokens,
  pushToast,
  confirm,
}: {
  machine: Machine;
  running: boolean;
  tokens: ProxyToken[];
  loading: boolean;
  request: ReturnType<typeof useStore>['request'];
  refreshTokens: () => Promise<void>;
  pushToast: ReturnType<typeof useStore>['pushToast'];
  confirm: ReturnType<typeof useConfirm>['confirm'];
}) {
  const [port, setPort] = useState('8000');
  const [copied, setCopied] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const rootUrl = proxyRootUrl(machine);
  const template = proxyPortTemplate(machine);
  const numericPort = Number(port);
  const portUrl = Number.isInteger(numericPort) && numericPort > 0 && numericPort <= 65535
    ? template.replace('{port}', String(numericPort))
    : '';

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    pushToast(`${label} copied`, 'ok');
    setTimeout(() => setCopied((current) => (current === value ? null : current)), 1500);
  };

  const revokeToken = async (token: ProxyToken) => {
    if (!await confirm({
      title: `Revoke ${token.label || token.token_prefix}?`,
      description: 'Anyone using that share link will lose access immediately.',
      confirmLabel: 'Revoke',
      destructive: true,
    })) return;
    try {
      await request(`/proxy-tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE', expectedStatus: 204 });
      await refreshTokens();
      pushToast('Proxy token revoked', 'ok');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'bad');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Globe className="size-4" /> Web proxy</CardTitle>
            <CardDescription>
              Worker-backed HTTP access. Root goes to port 80; use the port template for app previews.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refreshTokens().catch(() => undefined)} disabled={loading}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Share2 className="size-3.5" /> Share token
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!running ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Machine is not running. Links can be copied, but the origin will not answer until the machine starts.
          </div>
        ) : null}

        {createdUrl ? (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Share link ready</p>
                <p className="text-xs text-muted-foreground">The full tokenized URL is only shown once.</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setCreatedUrl(null)}>Dismiss</Button>
            </div>
            <button type="button" onClick={() => copy(createdUrl, 'Share URL')} className="mt-3 flex w-full items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left font-mono text-xs hover:bg-muted">
              <span className="truncate">{createdUrl}</span>
              {copied === createdUrl ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-muted-foreground" />}
            </button>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Root URL</p>
                <p className="text-xs text-muted-foreground">Default service on port 80.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => window.open(rootUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="size-3.5" /> Open
              </Button>
            </div>
            <button type="button" onClick={() => copy(rootUrl, 'Root URL')} className="flex w-full items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-left font-mono text-xs">
              <span className="truncate">{rootUrl}</span>
              {copied === rootUrl ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-muted-foreground" />}
            </button>
          </div>

          <div className="rounded-lg border p-4">
            <div className="mb-3 space-y-1">
              <p className="text-sm font-medium">Port URL</p>
              <p className="text-xs text-muted-foreground">Cloudflare URL for any HTTP port inside the machine.</p>
            </div>
            <div className="mb-3 flex gap-2">
              <Input value={port} onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))} inputMode="numeric" className="w-28 font-mono text-xs" />
              <Button size="sm" variant="outline" disabled={!portUrl} onClick={() => window.open(portUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="size-3.5" /> Open
              </Button>
            </div>
            <button type="button" onClick={() => portUrl && copy(portUrl, 'Port URL')} disabled={!portUrl} className="flex w-full items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-left font-mono text-xs disabled:opacity-50">
              <span className="truncate">{portUrl || template}</span>
              {copied === portUrl ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-muted-foreground" />}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Active share tokens</p>
              <p className="text-xs text-muted-foreground">Tokens authenticate users at the Worker using <code className="rounded bg-muted px-1">__proxy_token</code>.</p>
            </div>
          </div>
          {loading ? (
            <ArtifactEmpty label="Loading proxy tokens…" />
          ) : tokens.length === 0 ? (
            <ArtifactEmpty label="No active proxy tokens" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Ports</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => {
                  const base = token.ports?.[0]
                    ? template.replace('{port}', String(token.ports[0]))
                    : rootUrl;
                  return (
                    <TableRow key={token.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{token.label || 'Unnamed token'}</div>
                          <div className="font-mono text-xs text-muted-foreground">{token.token_prefix}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{token.ports?.length ? token.ports.join(', ') : 'all'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(token.expires_at)}</TableCell>
                      <TableCell className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{base}</TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button size="sm" variant="ghost" onClick={() => copy(base, 'Base URL')}><Link2 className="size-3.5" /> Copy</Button>
                        <Button size="sm" variant="ghost" onClick={() => revokeToken(token)}><Trash2 className="size-3.5" /> Revoke</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
      <CreateProxyTokenDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        machine={machine}
        defaultPorts={port || '8000'}
        request={request}
        refreshTokens={refreshTokens}
        pushToast={pushToast}
        onCreated={(url) => setCreatedUrl(url)}
      />
    </Card>
  );
}

function CreateProxyTokenDialog({
  open,
  onOpenChange,
  machine,
  defaultPorts,
  request,
  refreshTokens,
  pushToast,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  machine: Machine;
  defaultPorts: string;
  request: ReturnType<typeof useStore>['request'];
  refreshTokens: () => Promise<void>;
  pushToast: ReturnType<typeof useStore>['pushToast'];
  onCreated: (url: string | null) => void;
}) {
  const [label, setLabel] = useState('');
  const [portsInput, setPortsInput] = useState(defaultPorts);
  const [ttl, setTtl] = useState(String(PROXY_TTL_OPTIONS[0].value));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLabel('');
    setPortsInput(defaultPorts);
    setTtl(String(PROXY_TTL_OPTIONS[0].value));
    setSubmitting(false);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    let ports: number[] | null = null;
    try {
      ports = parseProxyPorts(portsInput);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
      return;
    }
    setSubmitting(true);
    try {
      const created = await request<ProxyToken>('/proxy-tokens', {
        method: 'POST',
        body: {
          machine_id: machine.id,
          label: label.trim() || null,
          ports,
          expires_in_seconds: Number(ttl),
        },
      });
      await refreshTokens();
      onCreated(created.proxy_url ?? null);
      pushToast('Proxy token created', 'ok');
      reset();
      onOpenChange(false);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      setError(message);
      pushToast(message, 'bad');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create proxy token</DialogTitle>
          <DialogDescription>Share temporary Worker-authenticated access to {machine.name}. The full URL is shown once.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proxy-token-label">Label</Label>
            <Input id="proxy-token-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Design review" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proxy-token-ports">Ports</Label>
            <Input id="proxy-token-ports" value={portsInput} onChange={(event) => setPortsInput(event.target.value)} placeholder="8000, 3000 — empty for all" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Comma-separated. Empty means all ports.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Expires in</Label>
            <Select value={ttl} onValueChange={(value) => setTtl(value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROXY_TTL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? 'Creating…' : 'Create token'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SshAccessPanel({
  machine,
  running,
  tokens,
  loading,
  request,
  refreshTokens,
  pushToast,
}: {
  machine: Machine;
  running: boolean;
  tokens: SshToken[];
  loading: boolean;
  request: ReturnType<typeof useStore>['request'];
  refreshTokens: () => Promise<void>;
  pushToast: ReturnType<typeof useStore>['pushToast'];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<SshToken | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const sshAccess = (machine.metadata?.ssh_access ?? null) as Record<string, unknown> | null;
  const sshState = sshAccess?.ok === true ? 'ready' : sshAccess?.error ? 'failed' : 'not prepared';

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    pushToast(`${label} copied`, 'ok');
    setTimeout(() => setCopied((current) => (current === value ? null : current)), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> SSH access</CardTitle>
            <CardDescription>
              Short-lived SSH gateway tokens for terminal clients and VS Code Remote SSH.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refreshTokens().catch(() => undefined)} disabled={loading}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <KeyRound className="size-3.5" /> SSH token
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!running ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Machine is not running. SSH tokens can be created once the machine is running.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Gateway state</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={sshState === 'ready' ? 'default' : sshState === 'failed' ? 'destructive' : 'secondary'}>{sshState}</Badge>
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="mt-2 font-mono text-xs">{String(sshAccess?.target_host ?? '—')}:{String(sshAccess?.target_port ?? 22)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Guest user</p>
            <p className="mt-2 font-mono text-xs">{String(sshAccess?.user ?? sshAccess?.ssh_user ?? '—')}</p>
          </div>
        </div>

        {sshAccess?.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {String(sshAccess.error)}
          </div>
        ) : null}

        {created ? (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">SSH token ready</p>
                <p className="text-xs text-muted-foreground">The token and command are only shown once. Use the config snippet for VS Code Remote SSH.</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Dismiss</Button>
            </div>
            {created.ssh_command ? (
              <button type="button" onClick={() => copy(created.ssh_command!, 'SSH command')} className="mt-3 flex w-full items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left font-mono text-xs hover:bg-muted">
                <span className="truncate">{created.ssh_command}</span>
                {copied === created.ssh_command ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-muted-foreground" />}
              </button>
            ) : null}
            {created.ssh_config ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">SSH config snippet</p>
                  <Button size="sm" variant="ghost" onClick={() => copy(created.ssh_config!, 'SSH config')}><Copy className="size-3.5" /> Copy</Button>
                </div>
                <pre className="overflow-auto rounded-md bg-background p-3 font-mono text-xs">{created.ssh_config}</pre>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Active SSH tokens</p>
            <p className="text-xs text-muted-foreground">Tokens are short-lived. The raw token is only returned on creation.</p>
          </div>
          {loading ? (
            <ArtifactEmpty label="Loading SSH tokens…" />
          ) : tokens.length === 0 ? (
            <ArtifactEmpty label="No active SSH tokens" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Prefix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell>{token.label || 'Unnamed token'}</TableCell>
                    <TableCell className="font-mono text-xs">{token.target?.user ?? 'user'}@{token.target?.host ?? '—'}:{token.target?.port ?? 22}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(token.expires_at)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{token.token_prefix}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
      <CreateSshTokenDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        machine={machine}
        request={request}
        refreshTokens={refreshTokens}
        pushToast={pushToast}
        onCreated={setCreated}
      />
    </Card>
  );
}

function CreateSshTokenDialog({
  open,
  onOpenChange,
  machine,
  request,
  refreshTokens,
  pushToast,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  machine: Machine;
  request: ReturnType<typeof useStore>['request'];
  refreshTokens: () => Promise<void>;
  pushToast: ReturnType<typeof useStore>['pushToast'];
  onCreated: (token: SshToken) => void;
}) {
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState(String(PROXY_TTL_OPTIONS[0].value));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLabel('');
    setTtl(String(PROXY_TTL_OPTIONS[0].value));
    setSubmitting(false);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const created = await request<SshToken>('/ssh-tokens', {
        method: 'POST',
        body: {
          machine_id: machine.id,
          label: label.trim() || null,
          expires_in_seconds: Number(ttl),
        },
      });
      await refreshTokens();
      onCreated(created);
      pushToast('SSH token created', 'ok');
      reset();
      onOpenChange(false);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      setError(message);
      pushToast(message, 'bad');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create SSH token</DialogTitle>
          <DialogDescription>Prepare guest SSH and create a short-lived gateway token for {machine.name}. The token is shown once.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ssh-token-label">Label</Label>
            <Input id="ssh-token-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="VS Code session" />
          </div>
          <div className="space-y-1.5">
            <Label>Expires in</Label>
            <Select value={ttl} onValueChange={(value) => setTtl(value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROXY_TTL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? 'Creating…' : 'Create SSH token'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateSnapshotDialog({
  open, onOpenChange, machine, request, artifactAction,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  machine: Machine;
  request: ReturnType<typeof useStore>['request'];
  artifactAction: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const slugify = (s: string) => s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const resetAndClose = () => {
    onOpenChange(false);
    setName('');
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const cleanName = slugify(name);
    if (name && !cleanName) return setError('Snapshot name must contain at least one letter or number.');
    const body: { name?: string; stateful: boolean } = { stateful: false };
    if (cleanName) body.name = cleanName;
    try {
      await artifactAction(
        `create snapshot ${machine.name}`,
        () => request(`/machines/${encodeURIComponent(machine.id)}/snapshots`, { method: 'POST', body }),
      );
      resetAndClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create snapshot</DialogTitle>
          <DialogDescription>
            Capture this machine now. Leave the name empty to let the API generate one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="snapshot-name">Name</Label>
            <Input
              id="snapshot-name"
              value={name}
              onChange={(e) => setName(slugify(e.target.value))}
              placeholder="auto-generated"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-2xs text-muted-foreground">Lowercase letters, numbers, dots, underscores, and dashes.</p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            Snapshots capture the container root filesystem. Runtime memory state is not captured.
          </div>
          {error ? (
            <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={submit}>Create snapshot</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateBackupDialog({
  open, onOpenChange, machine, request, artifactAction, defaultFull, defaultOptimized,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  machine: Machine;
  request: ReturnType<typeof useStore>['request'];
  artifactAction: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  defaultFull: boolean;
  defaultOptimized: boolean;
}) {
  const [name, setName] = useState('');
  const [fullBackup, setFullBackup] = useState(defaultFull);
  const [optimizedStorage, setOptimizedStorage] = useState(defaultOptimized);
  const [error, setError] = useState<string | null>(null);

  const slugify = (s: string) => s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const resetAndClose = () => {
    onOpenChange(false);
    setName('');
    setFullBackup(defaultFull);
    setOptimizedStorage(defaultOptimized);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const cleanName = slugify(name);
    if (name && !cleanName) return setError('Backup name must contain at least one letter or number.');
    const body: { name?: string; instance_only: boolean; optimized_storage: boolean } = {
      instance_only: !fullBackup,
      optimized_storage: optimizedStorage,
    };
    if (cleanName) body.name = cleanName;
    try {
      await artifactAction(
        `create ${fullBackup ? 'full ' : 'instance-only '}backup ${machine.name}`,
        () => request(`/machines/${encodeURIComponent(machine.id)}/backups`, { method: 'POST', body }),
      );
      resetAndClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create backup</DialogTitle>
          <DialogDescription>
            Native Incus backup tarball plus a pinned restore snapshot for same-machine rollback.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="backup-name">Name</Label>
            <Input
              id="backup-name"
              value={name}
              onChange={(e) => setName(slugify(e.target.value))}
              placeholder="auto-generated"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-2xs text-muted-foreground">Lowercase letters, numbers, dots, underscores, and dashes.</p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="backup-full" className="cursor-pointer">Full backup</Label>
              <p className="text-xs text-muted-foreground">
                Includes the instance plus its snapshots. Turn this off for <strong>instance-only</strong>, which excludes snapshots and is smaller/faster.
              </p>
            </div>
            <Switch id="backup-full" checked={fullBackup} onCheckedChange={setFullBackup} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="backup-optimized" className="cursor-pointer">Optimized storage format</Label>
              <p className="text-xs text-muted-foreground">
                Uses Incus storage-driver optimized export when available. Best for speed and same-driver restore; less portable across storage drivers.
              </p>
            </div>
            <Switch id="backup-optimized" checked={optimizedStorage} onCheckedChange={setOptimizedStorage} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Billing is accounted per account from exact usage records. This machine tab only manages the Incus backup artifact.
          </div>
          {error ? (
            <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={submit}>{fullBackup ? 'Create full backup' : 'Create instance-only backup'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TerminalStatus = 'connecting' | 'connected' | 'closed' | 'error' | 'stopped';

type TerminalSessionMeta = {
  id: string;
  title: string;
  createdAt: number;
};

type TerminalWorkspace = {
  sessions: TerminalSessionMeta[];
  activeSessionId: string | null;
};

const TERMINAL_STORAGE_PREFIX = 'justavps:machine-ptys:';
const DEFAULT_TERMINAL_SESSION: TerminalSessionMeta = { id: 'main', title: 'Shell 1', createdAt: 0 };

function defaultTerminalWorkspace(): TerminalWorkspace {
  return { sessions: [{ ...DEFAULT_TERMINAL_SESSION }], activeSessionId: DEFAULT_TERMINAL_SESSION.id };
}

function terminalStorageKey(machineId: string) {
  return `${TERMINAL_STORAGE_PREFIX}${machineId}`;
}

function normalizeTerminalWorkspace(value: unknown): TerminalWorkspace {
  if (!value || typeof value !== 'object') return defaultTerminalWorkspace();
  const raw = value as { sessions?: unknown; activeSessionId?: unknown };
  const seen = new Set<string>();
  const rawSessions = Array.isArray(raw.sessions) ? raw.sessions as unknown[] : null;
  const hasSessionArray = Boolean(rawSessions);
  const sessions = rawSessions
    ? rawSessions.flatMap((entry): TerminalSessionMeta[] => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Partial<TerminalSessionMeta>;
      const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim().slice(0, 96) : '';
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim().slice(0, 40) : `Shell ${seen.size}`,
        createdAt: typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : 0,
      }];
    })
    : [];
  const safeSessions = sessions.slice(0, 12);
  if (safeSessions.length === 0) return hasSessionArray ? { sessions: [], activeSessionId: null } : defaultTerminalWorkspace();
  const activeSessionId = typeof raw.activeSessionId === 'string' && safeSessions.some((session: TerminalSessionMeta) => session.id === raw.activeSessionId)
    ? raw.activeSessionId
    : safeSessions[0].id;
  return { sessions: safeSessions, activeSessionId };
}

function loadTerminalWorkspace(machineId: string): TerminalWorkspace {
  if (typeof window === 'undefined') return defaultTerminalWorkspace();
  try {
    const stored = window.localStorage.getItem(terminalStorageKey(machineId));
    if (!stored) return defaultTerminalWorkspace();
    return normalizeTerminalWorkspace(JSON.parse(stored));
  } catch {
    return defaultTerminalWorkspace();
  }
}

function saveTerminalWorkspace(machineId: string, workspace: TerminalWorkspace) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(terminalStorageKey(machineId), JSON.stringify(workspace));
  } catch { /* ignore local storage pressure */ }
}

function newTerminalSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextTerminalTitle(sessions: TerminalSessionMeta[]) {
  const titles = new Set(sessions.map((session) => session.title));
  let index = sessions.length + 1;
  while (titles.has(`Shell ${index}`)) index += 1;
  return `Shell ${index}`;
}

function terminalStatusVariant(status: TerminalStatus) {
  if (status === 'connected') return 'default' as const;
  if (status === 'error') return 'destructive' as const;
  return 'secondary' as const;
}

function terminalWsUrl(baseUrl: string, token: string, machineId: string, sessionId: string, cols: number, rows: number) {
  const url = new URL(`/machines/${encodeURIComponent(machineId)}/pty`, baseUrl || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set('token', token);
  url.searchParams.set('session', sessionId);
  url.searchParams.set('cols', String(cols));
  url.searchParams.set('rows', String(rows));
  return url.toString();
}

function TerminalPanel({
  machine, running, baseUrl, token, visible,
}: {
  machine: Machine;
  running: boolean;
  baseUrl: string;
  token: string;
  visible: boolean;
}) {
  const [workspace, setWorkspace] = useState<TerminalWorkspace>(() => defaultTerminalWorkspace());
  const [workspaceMachineId, setWorkspaceMachineId] = useState(machine.id);
  const [statuses, setStatuses] = useState<Record<string, TerminalStatus>>({});
  const [restartCounters, setRestartCounters] = useState<Record<string, number>>({});
  const [closingSessionIds, setClosingSessionIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setWorkspace(loadTerminalWorkspace(machine.id));
      setWorkspaceMachineId(machine.id);
      setStatuses({});
      setRestartCounters({});
      setClosingSessionIds([]);
    });
    return () => { cancelled = true; };
  }, [machine.id]);

  useEffect(() => {
    if (workspaceMachineId !== machine.id) return;
    saveTerminalWorkspace(machine.id, workspace);
  }, [machine.id, workspace, workspaceMachineId]);

  const sessions = workspace.sessions;
  const activeSessionId = workspace.activeSessionId && sessions.some((session) => session.id === workspace.activeSessionId)
    ? workspace.activeSessionId
    : sessions[0]?.id ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeStatus = activeSession ? statuses[activeSession.id] ?? (running ? 'connecting' : 'stopped') : 'closed';

  const updateSessionStatus = useCallback((sessionId: string, status: TerminalStatus) => {
    setStatuses((current) => (current[sessionId] === status ? current : { ...current, [sessionId]: status }));
  }, []);

  const addSession = () => {
    const session: TerminalSessionMeta = {
      id: newTerminalSessionId(),
      title: nextTerminalTitle(sessions),
      createdAt: Date.now(),
    };
    setWorkspace((current) => ({
      sessions: [...current.sessions, session],
      activeSessionId: session.id,
    }));
  };

  const closeSession = (sessionId: string) => {
    setClosingSessionIds((current) => (current.includes(sessionId) ? current : [...current, sessionId]));
    window.setTimeout(() => {
      setWorkspace((current) => {
        const nextSessions = current.sessions.filter((session) => session.id !== sessionId);
        const activeStillExists = nextSessions.some((session) => session.id === current.activeSessionId);
        return {
          sessions: nextSessions,
          activeSessionId: activeStillExists ? current.activeSessionId : nextSessions[0]?.id ?? null,
        };
      });
      setClosingSessionIds((current) => current.filter((id) => id !== sessionId));
      setStatuses((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    }, 150);
  };

  const reconnectActive = () => {
    if (!activeSessionId) return;
    setRestartCounters((current) => ({ ...current, [activeSessionId]: (current[activeSessionId] ?? 0) + 1 }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4" /> Interactive PTY terminals
            </CardTitle>
            <CardDescription>
              Open multiple shells. They stay attached while you move around this page and are restored until you close them.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={terminalStatusVariant(activeStatus)}>{activeStatus}</Badge>
            <Button size="sm" variant="outline" onClick={reconnectActive} disabled={!activeSessionId}>
              <RefreshCw className="size-3.5" /> Reconnect
            </Button>
            <Button size="sm" onClick={addSession}>
              <Plus className="size-3.5" /> New PTY
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center">
            <Terminal className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No PTY sessions open</p>
            <p className="mt-1 text-xs text-muted-foreground">Create a shell to connect to this machine.</p>
            <Button className="mt-4" size="sm" onClick={addSession}><Plus className="size-3.5" /> New PTY</Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto rounded-lg border bg-muted/30 p-1">
              {sessions.map((session) => {
                const status = statuses[session.id] ?? (running ? 'connecting' : 'stopped');
                const active = session.id === activeSessionId;
                return (
                  <div
                    key={session.id}
                    className={cn(
                      'group flex min-w-44 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors',
                      active ? 'border-border bg-background shadow-sm' : 'border-transparent hover:bg-background/70',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setWorkspace((current) => ({ ...current, activeSessionId: session.id }))}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className={cn(
                        'size-2 shrink-0 rounded-full',
                        status === 'connected' ? 'bg-emerald-500' : status === 'error' ? 'bg-destructive' : status === 'stopped' ? 'bg-amber-500' : 'bg-muted-foreground',
                      )} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{session.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{status}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${session.title}`}
                      onClick={() => closeSession(session.id)}
                      className="rounded p-1 text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="overflow-hidden rounded-lg border bg-black p-2 shadow-inner">
              {sessions.map((session) => (
                <div key={session.id} className={session.id === activeSessionId ? 'block' : 'hidden'}>
                  <TerminalSessionView
                    session={session}
                    machineId={machine.id}
                    running={running}
                    baseUrl={baseUrl}
                    token={token}
                    active={session.id === activeSessionId}
                    visible={visible}
                    restartNonce={restartCounters[session.id] ?? 0}
                    closing={closingSessionIds.includes(session.id)}
                    onStatusChange={updateSessionStatus}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TerminalSessionView({
  session, machineId, running, baseUrl, token, active, visible, restartNonce, closing, onStatusChange,
}: {
  session: TerminalSessionMeta;
  machineId: string;
  running: boolean;
  baseUrl: string;
  token: string;
  active: boolean;
  visible: boolean;
  restartNonce: number;
  closing: boolean;
  onStatusChange: (sessionId: string, status: TerminalStatus) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const setSessionStatus = useCallback((status: TerminalStatus) => {
    onStatusChange(session.id, status);
  }, [onStatusChange, session.id]);

  useEffect(() => {
    if (!active || !visible) return undefined;
    const frame = window.requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* terminal can be hidden during tab transitions */ }
      terminalRef.current?.focus();
      const socket = socketRef.current;
      const term = terminalRef.current;
      if (socket?.readyState === WebSocket.OPEN && term) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, visible]);

  useEffect(() => {
    if (!closing) return;
    setSessionStatus('closed');
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'close' }));
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'terminal tab closed');
    terminalRef.current?.writeln('\r\n\x1b[33mPTY session closed\x1b[0m');
  }, [closing, setSessionStatus]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let resizeDisposable: { dispose: () => void } | null = null;

    async function bootTerminal() {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = '';

      const [{ Terminal: BrowserTerminal }, { FitAddon: BrowserFitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed) return;

      const term = new BrowserTerminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        scrollback: 5000,
        theme: {
          background: '#050505',
          foreground: '#f4f4f5',
          cursor: '#22d3ee',
          selectionBackground: '#164e63',
          black: '#09090b',
          brightBlack: '#52525b',
          green: '#22c55e',
          cyan: '#06b6d4',
          red: '#ef4444',
          yellow: '#eab308',
        },
      });
      const fit = new BrowserFitAddon();
      terminalRef.current = term;
      fitRef.current = fit;
      term.loadAddon(fit);
      term.open(container);
      try { fit.fit(); } catch { /* wait for visible layout */ }

      const sendResize = () => {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      resizeDisposable = term.onResize(sendResize);
      resizeObserver = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* hidden tabs have no measurable box */ }
        sendResize();
      });
      resizeObserver.observe(container);

      if (!running) {
        setSessionStatus('stopped');
        term.writeln('\x1b[33mMachine is stopped. Start it, then reconnect.\x1b[0m');
        return;
      }

      setSessionStatus('connecting');
      term.writeln(`\x1b[90mConnecting ${session.title}...\x1b[0m`);
      const socket = new WebSocket(terminalWsUrl(baseUrl, token, machineId, session.id, term.cols, term.rows));
      socketRef.current = socket;

      socket.onopen = () => {
        setSessionStatus('connected');
        term.write('\x1b[2K\r');
        sendResize();
      };
      socket.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          term.write(new Uint8Array(await event.data.arrayBuffer()));
        } else if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else {
          term.write(String(event.data));
        }
      };
      socket.onerror = () => {
        setSessionStatus('error');
        term.writeln('\r\n\x1b[31mWebSocket terminal error\x1b[0m');
      };
      socket.onclose = () => {
        if (!disposed) setSessionStatus('closed');
      };
      dataDisposable = term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
      });
    }

    bootTerminal().catch((error) => {
      setSessionStatus('error');
      terminalRef.current?.writeln(`\r\n\x1b[31mTerminal init failed: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) socketRef.current.close(1000, 'detached');
      terminalRef.current?.dispose();
      socketRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [baseUrl, machineId, restartNonce, running, session.id, session.title, setSessionStatus, token]);

  return (
    <div ref={containerRef} className="h-[620px] w-full" />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
