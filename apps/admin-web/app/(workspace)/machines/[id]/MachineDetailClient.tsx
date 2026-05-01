'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  ArrowLeft, Play, Square, RotateCcw, Trash2, RefreshCw,
  Terminal, Info, Server, Database, Braces, Camera, Archive, Plus, ExternalLink,
  Globe, Copy, Check, Link2, Share2, KeyRound, SlidersHorizontal,
  X,
} from 'lucide-react';
import type { BackupItem, Machine, ProxyToken, SnapshotItem, SshToken } from '@/lib/api';
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

export default function MachineDetailClient({ id, onBack }: { id: string; onBack?: () => void }) {
  const router = useRouter();
  const { state, request, runAction, refreshAll, pushToast } = useStore();
  const { defaultStatefulSnapshots, defaultFullBackups, defaultOptimizedBackups } = useUiPrefs();
  const { confirm } = useConfirm();
  const [machine, setMachine] = useState<Machine | null>(
    () => state.machines.find((m) => m.id === id) ?? null,
  );
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [proxyTokens, setProxyTokens] = useState<ProxyToken[]>([]);
  const [sshTokens, setSshTokens] = useState<SshToken[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [proxyTokensLoading, setProxyTokensLoading] = useState(false);
  const [sshTokensLoading, setSshTokensLoading] = useState(false);
  const [snapshotCreateOpen, setSnapshotCreateOpen] = useState(false);
  const [backupCreateOpen, setBackupCreateOpen] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('terminal');

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

  const refreshSshTokens = async () => {
    setSshTokensLoading(true);
    try {
      const data = await request<{ ssh_tokens: SshToken[] }>(`/ssh-tokens?machine_id=${encodeURIComponent(id)}`);
      setSshTokens(data.ssh_tokens ?? []);
    } finally {
      setSshTokensLoading(false);
    }
  };

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

  if (!machine) {
    return (
      <div className="space-y-4">
        <BackToMachines onBack={onBack} />
        <p className="text-sm text-muted-foreground">Loading {id}…</p>
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="vCPU" value={String(resources.vcpu ?? '—')} />
        <Stat label="RAM" value={`${resources.memory_gb ?? '—'} GB`} />
        <Stat label="Disk" value={`${resources.disk_gb ?? '—'} GB`} />
        <Stat label="Region" value={machine.region ?? '—'} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-col gap-4">
        <div className="w-full rounded-xl border bg-card p-2 shadow-sm">
          <TabsList className={`!grid !h-auto w-full grid-cols-2 gap-1 rounded-lg bg-muted/40 p-1 ${sshAccessEnabled ? 'sm:grid-cols-9' : 'sm:grid-cols-8'}`}>
            <TabsTrigger value="terminal" className={tabTriggerClass}>
              <Terminal className="size-4" /> Terminal
            </TabsTrigger>
            <TabsTrigger value="overview" className={tabTriggerClass}>
              <Info className="size-4" /> Overview
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
                              description: snapshot.stateful
                                ? 'This reverts disk and asks Incus to restore the captured VM runtime state from this exact stateful snapshot. Current changes after that snapshot can be lost.'
                                : 'This reverts the machine rootfs to this exact snapshot. Current changes after that snapshot can be lost.',
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
            key={`snapshot-${String(defaultStatefulSnapshots)}`}
            open={snapshotCreateOpen}
            onOpenChange={setSnapshotCreateOpen}
            machine={machine}
            request={request}
            artifactAction={artifactAction}
            defaultStateful={defaultStatefulSnapshots}
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
  open, onOpenChange, machine, request, artifactAction, defaultStateful,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  machine: Machine;
  request: ReturnType<typeof useStore>['request'];
  artifactAction: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  defaultStateful: boolean;
}) {
  const [name, setName] = useState('');
  const [stateful, setStateful] = useState(defaultStateful);
  const [error, setError] = useState<string | null>(null);
  const isVm = machine.type === 'vm';

  const slugify = (s: string) => s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const resetAndClose = () => {
    onOpenChange(false);
    setName('');
    setStateful(defaultStateful);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const cleanName = slugify(name);
    if (name && !cleanName) return setError('Snapshot name must contain at least one letter or number.');
    const body: { name?: string; stateful: boolean } = { stateful: isVm && stateful };
    if (cleanName) body.name = cleanName;
    try {
      await artifactAction(
        `create ${isVm && stateful ? 'stateful ' : ''}snapshot ${machine.name}`,
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
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="snapshot-stateful" className="cursor-pointer">Stateful snapshot</Label>
              <p className="text-xs text-muted-foreground">
                Captures VM memory/runtime state as well as disk. Restore will pass <code className="rounded bg-muted px-1">stateful=true</code> for stateful snapshots.
              </p>
              {!isVm ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">Stateful snapshots are VM-only here. Containers can still create disk-only snapshots.</p>
              ) : null}
            </div>
            <Switch id="snapshot-stateful" checked={isVm && stateful} onCheckedChange={setStateful} disabled={!isVm} />
          </div>
          {error ? (
            <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={submit}>{isVm && stateful ? 'Create stateful snapshot' : 'Create snapshot'}</Button>
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
  const hasSessionArray = Array.isArray(raw.sessions);
  const sessions = hasSessionArray
    ? raw.sessions.flatMap((entry): TerminalSessionMeta[] => {
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
  const activeSessionId = typeof raw.activeSessionId === 'string' && safeSessions.some((session) => session.id === raw.activeSessionId)
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
