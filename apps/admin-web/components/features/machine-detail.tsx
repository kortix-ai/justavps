'use client';

import { useEffect, useRef, useState } from 'react';
import type { BackupItem, Machine, SnapshotItem, ToolboxRoutes } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tag } from '@/components/ui/tag';
import { Status } from '@/components/ui/status';
import { Empty } from '@/components/ui/empty';
import { Card, CardHeader } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { ExternalLink, Play, RefreshCw, RotateCcw, Square, Terminal, Trash2 } from 'lucide-react';
import { randomSuffix, statusTone } from '@/lib/utils';

export function MachineDetail({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const { state, request, runAction, refreshAll, setSnapshots, setBackups, setToolbox } = useStore();
  const [snapshotName, setSnapshotName] = useState(`snap-ui-${randomSuffix()}`);
  const [backupName, setBackupName] = useState(`backup-ui-${randomSuffix()}`);
  const [imageName, setImageName] = useState(`img-ui-${randomSuffix()}`);
  const [imageSnapshot, setImageSnapshot] = useState('');

  const [toolboxUrl, setToolboxUrl] = useState('');
  const [toolboxCwd, setToolboxCwd] = useState('/root');
  const [toolboxTimeout, setToolboxTimeout] = useState(60);
  const [toolboxCommand, setToolboxCommand] = useState('pwd && whoami && uname -a');
  const [terminalOutput, setTerminalOutput] = useState('');
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSnapshotName(`snap-ui-${randomSuffix()}`);
    setBackupName(`backup-ui-${randomSuffix()}`);
    setImageName(`img-ui-${randomSuffix()}`);
    setImageSnapshot('');
    setToolboxUrl('');
    setTerminalOutput('');
  }, [machine.id]);

  useEffect(() => {
    if (!state.token) return;
    request<{ toolbox: ToolboxRoutes }>(`/machines/${encodeURIComponent(machine.id)}/toolbox-config`)
      .then((data) => {
        setToolbox(data.toolbox ?? null);
        setToolboxUrl(data.toolbox?.base_url ?? '');
      })
      .catch(() => setToolbox(null));
  }, [machine.id, request, setToolbox, state.token]);

  function appendTerminal(label: string, data: unknown) {
    const ts = new Date().toLocaleTimeString();
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    setTerminalOutput((prev) => `[${ts}] ${label}\n${text}\n\n${prev}`);
    requestAnimationFrame(() => terminalRef.current?.scrollTo({ top: 0 }));
  }

  async function lifecycle(action: 'start' | 'stop' | 'reboot') {
    await runAction(`${action} machine ${machine.id}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/${action}`, { method: 'POST' });
      await refreshAll();
      return data;
    });
  }

  async function deleteMachine() {
    await runAction(`delete machine ${machine.id}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}`, { method: 'DELETE' });
      await refreshAll();
      onClose();
      return data;
    });
  }

  async function listSnapshotsLive() {
    try {
      const data = await request<{ snapshots: SnapshotItem[] | unknown }>(`/machines/${encodeURIComponent(machine.id)}/snapshots`);
      setSnapshots(Array.isArray(data.snapshots) ? (data.snapshots as SnapshotItem[]) : []);
    } catch {
      setSnapshots([]);
    }
  }

  async function listBackupsLive() {
    try {
      const data = await request<{ backups: BackupItem[] | unknown }>(`/machines/${encodeURIComponent(machine.id)}/backups`);
      setBackups(Array.isArray(data.backups) ? (data.backups as BackupItem[]) : []);
    } catch {
      setBackups([]);
    }
  }

  async function listSnapshots() {
    await runAction('list snapshots', async () => {
      await listSnapshotsLive();
      return { snapshots: state.snapshots.length };
    });
  }

  async function createSnapshot() {
    const name = snapshotName.trim() || `snap-ui-${randomSuffix()}`;
    setSnapshotName(name);
    await runAction(`create snapshot ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/snapshots`, { method: 'POST', body: { name } });
      await listSnapshotsLive();
      return data;
    });
  }

  async function restoreSnapshot(name: string) {
    await runAction(`restore snapshot ${name}`, async () => {
      return request(`/machines/${encodeURIComponent(machine.id)}/snapshots/${encodeURIComponent(name)}/restore`, { method: 'POST', body: {} });
    });
  }

  async function deleteSnapshot(name: string) {
    await runAction(`delete snapshot ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/snapshots/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await listSnapshotsLive();
      return data;
    });
  }

  async function listBackups() {
    await runAction('list backups', async () => {
      await listBackupsLive();
      return { backups: state.backups.length };
    });
  }

  async function createBackup() {
    const name = backupName.trim() || `backup-ui-${randomSuffix()}`;
    setBackupName(name);
    await runAction(`create backup ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/backups`, { method: 'POST', body: { name } });
      await listBackupsLive();
      return data;
    });
  }

  async function restoreBackup(name: string) {
    await runAction(`restore backup ${name}`, async () => {
      return request(`/machines/${encodeURIComponent(machine.id)}/backups/${encodeURIComponent(name)}/restore`, { method: 'POST', body: {}, expectedStatus: 501 });
    });
  }

  async function deleteBackup(name: string) {
    await runAction(`delete backup ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await listBackupsLive();
      return data;
    });
  }

  async function publishImage() {
    const alias = imageName.trim() || `img-ui-${randomSuffix()}`;
    setImageName(alias);
    await runAction(`publish image ${alias}`, async () => {
      const data = await request('/images', {
        method: 'POST',
        body: { machine_id: machine.id, snapshot_id: imageSnapshot.trim() || undefined, name: alias },
      });
      await refreshAll();
      return data;
    });
  }

  async function saveDaemonUrl() {
    await runAction('save daemon url', async () => {
      const data = await request<{ toolbox: ToolboxRoutes }>(`/machines/${encodeURIComponent(machine.id)}/toolbox-config`, {
        method: 'PUT',
        body: { base_url: toolboxUrl.trim() || null },
      });
      setToolbox(data.toolbox ?? null);
      setToolboxUrl(data.toolbox?.base_url ?? '');
      appendTerminal('daemon url saved', data.toolbox ?? {});
      return data;
    });
  }

  async function probeDaemon() {
    await runAction('probe daemon', async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/toolbox-health`);
      appendTerminal('daemon health', data);
      return data;
    });
  }

  async function listDaemonServices() {
    await runAction('list daemon services', async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/toolbox-services`);
      appendTerminal('daemon services', data);
      return data;
    });
  }

  async function runDaemonCommand() {
    const command = toolboxCommand.trim();
    if (!command) throw new Error('Command required.');
    await runAction('run daemon command', async () => {
      const data = await request<{ exit_code?: number; duration_ms?: number; stdout?: string; stderr?: string }>(
        `/machines/${encodeURIComponent(machine.id)}/toolbox-command`,
        { method: 'POST', body: { command, cwd: toolboxCwd.trim(), timeout: Number(toolboxTimeout) || 60 } },
      );
      appendTerminal(`$ ${command}`, `exit ${data.exit_code ?? '?'} in ${data.duration_ms ?? '?'}ms\n\nstdout:\n${data.stdout ?? ''}\n\nstderr:\n${data.stderr ?? ''}`);
      return data;
    });
  }

  function currentDaemonBase(): string | null {
    const url = toolboxUrl.trim() || state.toolbox?.base_url || '';
    if (!url) return null;
    return url.endsWith('/') ? url : `${url}/`;
  }

  function openDaemonTerminal() {
    const base = currentDaemonBase();
    if (!base) {
      appendTerminal('open terminal', 'Set the daemon base URL first.');
      return;
    }
    window.open(new URL('_terminal', base).toString(), '_blank', 'noreferrer');
  }

  function openDaemonHome() {
    const base = currentDaemonBase();
    if (!base) {
      appendTerminal('open daemon home', 'Set the daemon base URL first.');
      return;
    }
    window.open(base, '_blank', 'noreferrer');
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <span>{machine.name || machine.id}</span>
          <Tag tone={statusTone(machine.status) as 'ok' | 'warn' | 'bad' | 'neutral'}>{machine.status}</Tag>
        </span>
      }
      description={<span className="font-mono">{machine.id}</span>}
      testId="v2-machine-sheet"
      footer={
        <>
          <Button variant="secondary" leftIcon={<Play className="size-3.5" />} disabled={state.busy} onClick={() => lifecycle('start').catch(() => {})} id="lifecycle-start">Start</Button>
          <Button variant="secondary" leftIcon={<Square className="size-3.5" />} disabled={state.busy} onClick={() => lifecycle('stop').catch(() => {})} id="lifecycle-stop">Stop</Button>
          <Button variant="secondary" leftIcon={<RotateCcw className="size-3.5" />} disabled={state.busy} onClick={() => lifecycle('reboot').catch(() => {})} id="lifecycle-reboot">Reboot</Button>
          <Button variant="danger-ghost" leftIcon={<Trash2 className="size-3.5" />} disabled={state.busy} onClick={() => deleteMachine().catch(() => {})} id="lifecycle-delete">Delete</Button>
        </>
      }
    >
      <Card compact>
        <CardHeader title="Identity" />
        <div className="grid grid-cols-2 gap-3 text-[13px] max-[720px]:grid-cols-1">
          <KeyVal label="ID" value={<code className="font-mono" id="focus-id">{machine.id}</code>} />
          <KeyVal label="Name" value={<code className="font-mono" id="focus-name">{machine.name || '—'}</code>} />
          <KeyVal label="Type" value={<code className="font-mono" id="focus-type">{machine.type ?? '—'}</code>} />
          <KeyVal label="Status" value={<Status tone={statusTone(machine.status)} label={machine.status} />} />
          <KeyVal label="Region" value={<code className="font-mono" id="focus-region">{machine.cluster?.region ?? machine.region ?? '—'}</code>} />
          <KeyVal label="Cluster" value={<code className="font-mono" id="focus-cluster">{machine.cluster?.id ?? machine.incus?.cluster_id ?? '—'}</code>} />
          <KeyVal label="Member" value={<code className="font-mono" id="focus-member">{machine.location ?? machine.incus?.member_name ?? '—'}</code>} />
          <KeyVal label="Source" value={<code className="font-mono">{(machine.source as { type?: string } | undefined)?.type ?? '—'}</code>} />
        </div>
      </Card>

      <Card compact>
        <CardHeader title="Snapshots" actions={<Button variant="ghost" size="sm" leftIcon={<RefreshCw className="size-3.5" />} onClick={() => listSnapshots().catch(() => {})} id="list-snapshots">List</Button>} />
        <div className="flex flex-wrap items-center gap-2">
          <Input id="snapshot-name" inputSize="sm" placeholder="snap name" value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} />
          <Button size="sm" disabled={state.busy} onClick={() => createSnapshot().catch(() => {})} id="create-snapshot">Create</Button>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-border">
          <div className="max-h-[220px] overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Name', 'Created', ''].map((h) => (
                    <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="snapshots-tbody">
                {state.snapshots.length === 0 ? (
                  <tr><td colSpan={3}><Empty title="No snapshots" description="Take a snapshot or hit “List” to load." /></td></tr>
                ) : state.snapshots.map((snap) => (
                  <tr key={snap.name} className="border-b border-border last:border-0">
                    <td className="px-3.5 py-2 font-mono">{snap.name}</td>
                    <td className="px-3.5 py-2 text-[12px] text-fg-muted">{snap.created_at ?? '—'}</td>
                    <td className="px-3.5 py-2">
                      <div className="inline-flex flex-wrap gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => restoreSnapshot(snap.name).catch(() => {})}>restore</Button>
                        <Button variant="danger-ghost" size="sm" onClick={() => deleteSnapshot(snap.name).catch(() => {})}>delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card compact>
        <CardHeader title="Backups" actions={<Button variant="ghost" size="sm" leftIcon={<RefreshCw className="size-3.5" />} onClick={() => listBackups().catch(() => {})} id="list-backups">List</Button>} />
        <div className="flex flex-wrap items-center gap-2">
          <Input id="backup-name" inputSize="sm" placeholder="backup name" value={backupName} onChange={(event) => setBackupName(event.target.value)} />
          <Button size="sm" disabled={state.busy} onClick={() => createBackup().catch(() => {})} id="create-backup">Create</Button>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-border">
          <div className="max-h-[200px] overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Name', 'Created', ''].map((h) => (
                    <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="backups-tbody">
                {state.backups.length === 0 ? (
                  <tr><td colSpan={3}><Empty title="No backups" description="Restore is locked until Incus backup import is wired." /></td></tr>
                ) : state.backups.map((bk) => (
                  <tr key={bk.name} className="border-b border-border last:border-0">
                    <td className="px-3.5 py-2 font-mono">{bk.name}</td>
                    <td className="px-3.5 py-2 text-[12px] text-fg-muted">{bk.created_at ?? '—'}</td>
                    <td className="px-3.5 py-2">
                      <div className="inline-flex flex-wrap gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => restoreBackup(bk.name).catch(() => {})}>restore (501)</Button>
                        <Button variant="danger-ghost" size="sm" onClick={() => deleteBackup(bk.name).catch(() => {})}>delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card compact>
        <CardHeader title="Publish image" desc="Snapshot to image (alias)" />
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          <Field label="Alias" htmlFor="image-name">
            <Input id="image-name" inputSize="sm" value={imageName} onChange={(event) => setImageName(event.target.value)} />
          </Field>
          <Field label="From snapshot (optional)" htmlFor="image-snapshot">
            <Input id="image-snapshot" inputSize="sm" placeholder="snapshot name" value={imageSnapshot} onChange={(event) => setImageSnapshot(event.target.value)} />
          </Field>
        </div>
        <div className="flex">
          <Button size="sm" disabled={state.busy} onClick={() => publishImage().catch(() => {})} id="create-image">Publish</Button>
        </div>
      </Card>

      <Card compact>
        <CardHeader title="Daemon & terminal" desc="Direct access to justavps-daemon on the machine." />
        <div className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1">
          <Field label="Daemon base URL" htmlFor="toolbox-url" span="full">
            <Input id="toolbox-url" placeholder="https://machine.example.com or proxy URL" value={toolboxUrl} onChange={(event) => setToolboxUrl(event.target.value)} />
          </Field>
          <Field label="CWD" htmlFor="toolbox-cwd">
            <Input id="toolbox-cwd" inputSize="sm" value={toolboxCwd} onChange={(event) => setToolboxCwd(event.target.value)} />
          </Field>
          <Field label="Timeout (s)" htmlFor="toolbox-timeout">
            <Input id="toolbox-timeout" inputSize="sm" type="number" min={1} max={3600} value={toolboxTimeout} onChange={(event) => setToolboxTimeout(Number(event.target.value) || 60)} />
          </Field>
          <Field label="Command" htmlFor="toolbox-command" span="full">
            <Input id="toolbox-command" inputSize="sm" value={toolboxCommand} onChange={(event) => setToolboxCommand(event.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={state.busy} onClick={() => saveDaemonUrl().catch(() => {})} id="save-toolbox-url">Save daemon URL</Button>
          <Button variant="secondary" size="sm" disabled={state.busy} onClick={() => probeDaemon().catch(() => {})} id="probe-daemon">Probe</Button>
          <Button variant="secondary" size="sm" disabled={state.busy} onClick={() => listDaemonServices().catch(() => {})} id="list-daemon-services">Services</Button>
          <Button size="sm" disabled={state.busy} leftIcon={<Terminal className="size-3.5" />} onClick={() => runDaemonCommand().catch(() => {})} id="run-toolbox-command">Run</Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" leftIcon={<ExternalLink className="size-3.5" />} onClick={() => openDaemonTerminal()} id="open-daemon-terminal">Open terminal</Button>
          <Button variant="ghost" size="sm" leftIcon={<ExternalLink className="size-3.5" />} onClick={() => openDaemonHome()} id="open-daemon-home">OpenCode</Button>
          <Button variant="ghost" size="sm" onClick={() => setTerminalOutput('')} id="clear-terminal">Clear</Button>
        </div>
        <div ref={terminalRef} className="max-h-[440px] min-h-[220px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-border-strong bg-[#050507] p-3 font-mono text-[12px] leading-relaxed text-zinc-200" id="terminal-output" data-testid="v2-terminal">
          {terminalOutput || 'Daemon output appears here. Use Clear to reset this pane.'}
        </div>
      </Card>
    </Sheet>
  );
}

function KeyVal({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-fg-subtle">{label}</div>
      <div>{value}</div>
    </div>
  );
}
