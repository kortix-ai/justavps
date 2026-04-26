import { useEffect, useRef, useState } from 'react';
import type { BackupItem, Machine, SnapshotItem, ToolboxRoutes } from '../../lib/api';
import { useStore } from '../../lib/store';
import { cx, randomSuffix, statusTone } from '../../lib/utils';

export type MachineDetailProps = {
  machine: Machine;
};

export function MachineDetail({ machine }: MachineDetailProps) {
  const { state, request, runAction, refreshAll, setSnapshots, setBackups, setToolbox } = useStore();
  const [snapshotName, setSnapshotName] = useState(`snap-ui-${randomSuffix()}`);
  const [backupName, setBackupName] = useState(`backup-ui-${randomSuffix()}`);
  const [imageName, setImageName] = useState(`img-ui-${randomSuffix()}`);
  const [imageSnapshotInput, setImageSnapshotInput] = useState('');

  const [toolboxUrl, setToolboxUrl] = useState('');
  const [toolboxCwd, setToolboxCwd] = useState('/root');
  const [toolboxTimeout, setToolboxTimeout] = useState(60);
  const [toolboxCommand, setToolboxCommand] = useState('pwd && whoami && uname -a');
  const [terminalOutput, setTerminalOutput] = useState('');
  const terminalRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset suggestions when selected machine changes.
  useEffect(() => {
    setSnapshotName(`snap-ui-${randomSuffix()}`);
    setBackupName(`backup-ui-${randomSuffix()}`);
    setImageName(`img-ui-${randomSuffix()}`);
    setImageSnapshotInput('');
    setToolboxUrl('');
    setTerminalOutput('');
  }, [machine.id]);

  // Auto-load toolbox config when token + machine present.
  useEffect(() => {
    if (!state.token) return;
    request<{ toolbox: ToolboxRoutes }>(`/machines/${encodeURIComponent(machine.id)}/toolbox-config`)
      .then((data) => {
        setToolbox(data.toolbox ?? null);
        setToolboxUrl(data.toolbox?.base_url ?? '');
      })
      .catch(() => {
        setToolbox(null);
      });
  }, [machine.id, request, setToolbox, state.token]);

  function appendTerminal(label: string, data: unknown) {
    const ts = new Date().toLocaleTimeString();
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    setTerminalOutput((prev) => `[${ts}] ${label}\n${text}\n\n${prev}`);
    requestAnimationFrame(() => {
      terminalRef.current?.scrollTo({ top: 0 });
    });
  }

  // Lifecycle actions.
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
      return data;
    });
  }

  async function inspectMachine() {
    await runAction(`inspect machine ${machine.id}`, async () => {
      return request(`/machines/${encodeURIComponent(machine.id)}`);
    });
  }

  // Snapshot actions.
  async function listSnapshots() {
    await runAction('list snapshots', async () => {
      const data = await request<{ snapshots: SnapshotItem[] | unknown }>(`/machines/${encodeURIComponent(machine.id)}/snapshots`);
      const items = Array.isArray(data.snapshots) ? (data.snapshots as SnapshotItem[]) : [];
      setSnapshots(items);
      return data;
    });
  }

  async function createSnapshot() {
    const name = snapshotName.trim() || `snap-ui-${randomSuffix()}`;
    setSnapshotName(name);
    await runAction(`create snapshot ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/snapshots`, {
        method: 'POST',
        body: { name },
      });
      await listSilent();
      return data;
    });
  }

  async function listSilent() {
    try {
      const data = await request<{ snapshots: SnapshotItem[] | unknown }>(`/machines/${encodeURIComponent(machine.id)}/snapshots`);
      setSnapshots(Array.isArray(data.snapshots) ? (data.snapshots as SnapshotItem[]) : []);
    } catch {
      setSnapshots([]);
    }
    try {
      const data = await request<{ backups: BackupItem[] | unknown }>(`/machines/${encodeURIComponent(machine.id)}/backups`);
      setBackups(Array.isArray(data.backups) ? (data.backups as BackupItem[]) : []);
    } catch {
      setBackups([]);
    }
  }

  async function restoreSnapshot(name: string) {
    await runAction(`restore snapshot ${name}`, async () => {
      return request(`/machines/${encodeURIComponent(machine.id)}/snapshots/${encodeURIComponent(name)}/restore`, {
        method: 'POST',
        body: {},
      });
    });
  }

  async function deleteSnapshot(name: string) {
    await runAction(`delete snapshot ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/snapshots/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      await listSilent();
      return data;
    });
  }

  // Backup actions.
  async function listBackups() {
    await runAction('list backups', async () => {
      const data = await request<{ backups: BackupItem[] | unknown }>(`/machines/${encodeURIComponent(machine.id)}/backups`);
      const items = Array.isArray(data.backups) ? (data.backups as BackupItem[]) : [];
      setBackups(items);
      return data;
    });
  }

  async function createBackup() {
    const name = backupName.trim() || `backup-ui-${randomSuffix()}`;
    setBackupName(name);
    await runAction(`create backup ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/backups`, {
        method: 'POST',
        body: { name },
      });
      await listSilent();
      return data;
    });
  }

  async function restoreBackup(name: string) {
    await runAction(`restore backup ${name}`, async () => {
      return request(`/machines/${encodeURIComponent(machine.id)}/backups/${encodeURIComponent(name)}/restore`, {
        method: 'POST',
        body: {},
        expectedStatus: 501,
      });
    });
  }

  async function deleteBackup(name: string) {
    await runAction(`delete backup ${name}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(machine.id)}/backups/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      await listSilent();
      return data;
    });
  }

  // Image publishing.
  async function publishImage() {
    const alias = imageName.trim() || `img-ui-${randomSuffix()}`;
    setImageName(alias);
    await runAction(`publish image ${alias}`, async () => {
      const data = await request('/images', {
        method: 'POST',
        body: {
          machine_id: machine.id,
          snapshot_id: imageSnapshotInput.trim() || undefined,
          name: alias,
        },
      });
      await refreshAll();
      return data;
    });
  }

  // Daemon controls.
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
    if (!command) {
      throw new Error('Command required.');
    }
    await runAction('run daemon command', async () => {
      const data = await request<{ exit_code?: number; duration_ms?: number; stdout?: string; stderr?: string }>(
        `/machines/${encodeURIComponent(machine.id)}/toolbox-command`,
        {
          method: 'POST',
          body: { command, cwd: toolboxCwd.trim(), timeout: Number(toolboxTimeout) || 60 },
        },
      );
      const summary = `exit ${data.exit_code ?? '?'} in ${data.duration_ms ?? '?'}ms\n\nstdout:\n${data.stdout ?? ''}\n\nstderr:\n${data.stderr ?? ''}`;
      appendTerminal(`$ ${command}`, summary);
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

  function clearTerminal() {
    setTerminalOutput('');
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Selected Machine</h2>
        <span className="desc" id="selected-machine-desc">
          {machine.id}
        </span>
      </div>

      <div className="form-grid cols-2">
        <div className="focus-machine">
          <div className="title" id="focus-name">{machine.name || machine.id}</div>
          <div className="grid-2">
            <div>id<br /><code id="focus-id">{machine.id}</code></div>
            <div>type<br /><code id="focus-type">{machine.type ?? '-'}</code></div>
            <div>status<br /><span className={cx('badge', statusTone(machine.status))} id="focus-status">{machine.status ?? '-'}</span></div>
            <div>region<br /><code id="focus-region">{machine.cluster?.region ?? machine.region ?? '-'}</code></div>
            <div>cluster<br /><code id="focus-cluster">{machine.cluster?.id ?? machine.incus?.cluster_id ?? '-'}</code></div>
            <div>member<br /><code id="focus-member">{machine.location ?? machine.incus?.member_name ?? '-'}</code></div>
          </div>
          <div className="row-actions">
            <button type="button" id="inspect-machine" className="button secondary" disabled={state.busy} onClick={() => inspectMachine().catch(() => {})}>Inspect</button>
            <button type="button" id="lifecycle-start" className="button" disabled={state.busy} onClick={() => lifecycle('start').catch(() => {})}>Start</button>
            <button type="button" id="lifecycle-stop" className="button" disabled={state.busy} onClick={() => lifecycle('stop').catch(() => {})}>Stop</button>
            <button type="button" id="lifecycle-reboot" className="button" disabled={state.busy} onClick={() => lifecycle('reboot').catch(() => {})}>Reboot</button>
            <button type="button" id="lifecycle-delete" className="button danger" disabled={state.busy} onClick={() => deleteMachine().catch(() => {})}>Delete</button>
          </div>
        </div>

        <div className="focus-machine">
          <div className="title">Snapshots</div>
          <div className="toolbar">
            <input
              id="snapshot-name"
              className="input compact"
              placeholder="snap name"
              value={snapshotName}
              onChange={(event) => setSnapshotName(event.target.value)}
            />
            <button type="button" id="create-snapshot" className="button" disabled={state.busy} onClick={() => createSnapshot().catch(() => {})}>
              Create
            </button>
            <button type="button" id="list-snapshots" className="button secondary" disabled={state.busy} onClick={() => listSnapshots().catch(() => {})}>
              List
            </button>
          </div>
          <div className="scroll" style={{ maxHeight: 240 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="snapshots-tbody">
                {state.snapshots.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="empty">No snapshots loaded yet. Use “List” or take a snapshot.</div>
                    </td>
                  </tr>
                ) : (
                  state.snapshots.map((snap) => (
                    <tr key={snap.name}>
                      <td><code>{snap.name}</code></td>
                      <td>{snap.created_at ?? '-'}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="button small secondary" onClick={() => restoreSnapshot(snap.name).catch(() => {})}>restore</button>
                          <button type="button" className="button small danger" onClick={() => deleteSnapshot(snap.name).catch(() => {})}>delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="focus-machine">
          <div className="title">Backups</div>
          <div className="toolbar">
            <input
              id="backup-name"
              className="input compact"
              placeholder="backup name"
              value={backupName}
              onChange={(event) => setBackupName(event.target.value)}
            />
            <button type="button" id="create-backup" className="button" disabled={state.busy} onClick={() => createBackup().catch(() => {})}>
              Create
            </button>
            <button type="button" id="list-backups" className="button secondary" disabled={state.busy} onClick={() => listBackups().catch(() => {})}>
              List
            </button>
          </div>
          <div className="scroll" style={{ maxHeight: 240 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="backups-tbody">
                {state.backups.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="empty">No backups loaded yet. Use “List” or create one.</div>
                    </td>
                  </tr>
                ) : (
                  state.backups.map((bk) => (
                    <tr key={bk.name}>
                      <td><code>{bk.name}</code></td>
                      <td>{bk.created_at ?? '-'}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="button small secondary" onClick={() => restoreBackup(bk.name).catch(() => {})}>restore (501)</button>
                          <button type="button" className="button small danger" onClick={() => deleteBackup(bk.name).catch(() => {})}>delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="focus-machine">
          <div className="title">Publish Image</div>
          <div className="toolbar">
            <input
              id="image-name"
              className="input compact"
              placeholder="image alias"
              value={imageName}
              onChange={(event) => setImageName(event.target.value)}
            />
            <input
              id="image-snapshot"
              className="input compact"
              placeholder="snapshot name (optional)"
              value={imageSnapshotInput}
              onChange={(event) => setImageSnapshotInput(event.target.value)}
            />
            <button type="button" id="create-image" className="button" disabled={state.busy} onClick={() => publishImage().catch(() => {})}>
              Publish
            </button>
          </div>
          <div className="field-help">
            Creates an Incus image from this machine. Provide a snapshot name to publish from a snapshot.
          </div>
        </div>

        <div className="focus-machine wide">
          <div className="title">Daemon &amp; Terminal</div>
          <div className="terminal-hint">
            Set the machine daemon base URL once (the JustAVPS daemon front door — usually <code>https://&lt;machine&gt;</code> or
            an authenticated proxy). Then use process execution, services, terminal, and OpenCode access right from here.
          </div>
          <div className="form-grid cols-3">
            <div className="wide field">
              <label className="field-label" htmlFor="toolbox-url">Daemon base URL</label>
              <input
                id="toolbox-url"
                className="input"
                placeholder="https://machine.example.com or proxy URL"
                value={toolboxUrl}
                onChange={(event) => setToolboxUrl(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="toolbox-cwd">CWD</label>
              <input
                id="toolbox-cwd"
                className="input"
                value={toolboxCwd}
                onChange={(event) => setToolboxCwd(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="toolbox-timeout">Timeout (s)</label>
              <input
                id="toolbox-timeout"
                className="input"
                type="number"
                min={1}
                max={3600}
                value={toolboxTimeout}
                onChange={(event) => setToolboxTimeout(Number(event.target.value) || 60)}
              />
            </div>
            <div className="wide field">
              <label className="field-label" htmlFor="toolbox-command">Command</label>
              <input
                id="toolbox-command"
                className="input"
                value={toolboxCommand}
                onChange={(event) => setToolboxCommand(event.target.value)}
              />
            </div>
          </div>
          <div className="toolbar">
            <button type="button" id="save-toolbox-url" className="button secondary" disabled={state.busy} onClick={() => saveDaemonUrl().catch(() => {})}>
              Save Daemon URL
            </button>
            <button type="button" id="probe-daemon" className="button secondary" disabled={state.busy} onClick={() => probeDaemon().catch(() => {})}>
              Probe Daemon
            </button>
            <button type="button" id="list-daemon-services" className="button secondary" disabled={state.busy} onClick={() => listDaemonServices().catch(() => {})}>
              List Services
            </button>
            <button type="button" id="run-toolbox-command" className="button" disabled={state.busy} onClick={() => runDaemonCommand().catch(() => {})}>
              Run Command
            </button>
            <button type="button" id="open-daemon-terminal" className="button secondary" onClick={() => openDaemonTerminal()}>
              Open Terminal
            </button>
            <button type="button" id="open-daemon-home" className="button secondary" onClick={() => openDaemonHome()}>
              Open OpenCode
            </button>
            <button type="button" id="clear-terminal" className="button ghost" onClick={() => clearTerminal()}>
              Clear Terminal
            </button>
          </div>
          <textarea
            id="terminal-output"
            ref={terminalRef}
            className="input log terminal-output"
            readOnly
            placeholder="Daemon output appears here. Use Clear Terminal to reset this pane."
            value={terminalOutput}
          />
        </div>
      </div>
    </div>
  );
}
