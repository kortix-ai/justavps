import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateMachineDialog } from '../features/machines/CreateMachineDialog';
import { MachineDetail } from '../features/machines/MachineDetail';
import { useStore } from '../lib/store';
import { cx, shortId, statusTone } from '../lib/utils';

export function MachinesPage() {
  const { state, request, runAction, refreshAll, setSelectedMachineId } = useStore();
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Sync selected from URL.
  useEffect(() => {
    if (params.id) {
      setSelectedMachineId(params.id);
    } else if (state.selectedMachineId && state.machines.find((m) => m.id === state.selectedMachineId)) {
      // keep
    } else {
      setSelectedMachineId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const selected = state.machines.find((m) => m.id === state.selectedMachineId) ?? null;

  const filtered = useMemo(() => {
    if (!filter.trim()) return state.machines;
    const lower = filter.trim().toLowerCase();
    return state.machines.filter((m) => {
      const hay = `${m.name ?? ''} ${m.id} ${m.region ?? ''} ${m.status ?? ''} ${m.cluster?.region ?? ''}`.toLowerCase();
      return hay.includes(lower);
    });
  }, [filter, state.machines]);

  function selectMachine(id: string) {
    setSelectedMachineId(id);
    navigate(`/machines/${encodeURIComponent(id)}`);
  }

  async function lifecycleQuick(id: string, action: 'start' | 'stop') {
    await runAction(`${action} machine ${id}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      await refreshAll();
      return data;
    });
  }

  async function deleteMachine(id: string) {
    await runAction(`delete machine ${id}`, async () => {
      const data = await request(`/machines/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (id === state.selectedMachineId) setSelectedMachineId(null);
      await refreshAll();
      return data;
    });
  }

  async function cleanupTests() {
    await runAction('cleanup test resources', async () => {
      await refreshAll();
      const testMachines = state.machines.filter(
        (m) => m.id.startsWith('v2e2e-') || (m.name ?? '').startsWith('v2e2e-'),
      );
      const testImages = state.images.filter((image) =>
        (image.aliases ?? []).some((alias) => alias.name.startsWith('img-ui-') || alias.name.startsWith('img-snap-')),
      );
      let imagesDeleted = 0;
      for (const image of testImages) {
        const alias = image.aliases?.[0]?.name ?? image.fingerprint ?? image.id;
        try {
          await request(`/images/${encodeURIComponent(alias)}`, { method: 'DELETE' });
          imagesDeleted += 1;
        } catch {
          // ignore
        }
      }
      let machinesDeleted = 0;
      for (const m of testMachines) {
        try {
          await request(`/machines/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
          machinesDeleted += 1;
        } catch {
          // ignore
        }
      }
      await refreshAll();
      return { machines_deleted: machinesDeleted, images_deleted: imagesDeleted };
    });
  }

  return (
    <section className="page" data-route="machines">
      <div className="panel">
        <div className="panel-head">
          <h2>Machines</h2>
          <div className="toolbar">
            <input
              id="machine-search"
              className="input compact"
              placeholder="Filter machines"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <button type="button" id="open-create" className="button" disabled={state.busy} onClick={() => setCreateOpen(true)}>
              Create Machine
            </button>
            <button type="button" id="cleanup-tests" className="button danger" disabled={state.busy} onClick={() => cleanupTests().catch(() => {})}>
              Cleanup Tests
            </button>
          </div>
        </div>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Region</th>
                <th>Member</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="machines-tbody">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">{filter ? 'No machines match this filter.' : 'No machines yet — create your first.'}</div>
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const active = m.id === state.selectedMachineId;
                  return (
                    <tr
                      key={m.id}
                      className={cx('row-clickable', active && 'row-active')}
                      data-machine-id={m.id}
                      onClick={() => selectMachine(m.id)}
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>{m.name || m.id}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>{shortId(m.id, 18)}</div>
                      </td>
                      <td>{m.type ?? ''}</td>
                      <td>
                        <span className={cx('badge', statusTone(m.status))}>{m.status ?? ''}</span>
                      </td>
                      <td>{m.cluster?.region ?? m.region ?? '-'}</td>
                      <td>{m.location ?? m.incus?.member_name ?? '-'}</td>
                      <td>
                        <code>{(m.source as { type?: string } | undefined)?.type ?? '-'}</code>
                      </td>
                      <td>
                        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="button small secondary"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectMachine(m.id);
                            }}
                          >
                            select
                          </button>
                          <button
                            type="button"
                            className="button small"
                            disabled={state.busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              lifecycleQuick(m.id, 'start').catch(() => {});
                            }}
                          >
                            start
                          </button>
                          <button
                            type="button"
                            className="button small"
                            disabled={state.busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              lifecycleQuick(m.id, 'stop').catch(() => {});
                            }}
                          >
                            stop
                          </button>
                          <button
                            type="button"
                            className="button small danger"
                            disabled={state.busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteMachine(m.id).catch(() => {});
                            }}
                          >
                            delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? <MachineDetail machine={selected} /> : (
        <div className="panel">
          <div className="empty">Select a machine to inspect lifecycle, snapshots, backups, images, and the daemon.</div>
        </div>
      )}

      <CreateMachineDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          refreshAll().finally(() => selectMachine(id));
        }}
      />
    </section>
  );
}
