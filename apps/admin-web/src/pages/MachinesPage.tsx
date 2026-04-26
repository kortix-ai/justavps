import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Tag } from '../components/ui/Tag';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Empty } from '../components/ui/Empty';
import { Status } from '../components/ui/Status';
import { CreateMachineDialog } from '../features/machines/CreateMachineDialog';
import { MachineDetail } from '../features/machines/MachineDetail';
import { cx, shortId, statusTone } from '../lib/utils';
import { IconBolt, IconPlus, IconRefresh, IconSearch, IconTrash } from '../components/ui/icons';

export function MachinesPage() {
  const { state, request, runAction, refreshAll, setSelectedMachineId } = useStore();
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (params.id) {
      setSelectedMachineId(params.id);
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

  const containerCount = state.machines.filter((m) => m.type === 'container').length;
  const vmCount = state.machines.filter((m) => m.type === 'vm').length;

  function selectMachine(id: string) {
    setSelectedMachineId(id);
    navigate(`/machines/${encodeURIComponent(id)}`);
  }

  function closeDetail() {
    setSelectedMachineId(null);
    navigate('/machines');
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
      <PageHeader
        title="Machines"
        description="Create, inspect, and manage Incus-backed machines across configured clusters."
        actions={
          <>
            <Button variant="secondary" leftIcon={<IconRefresh />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>
              Refresh
            </Button>
            <Button variant="danger-ghost" leftIcon={<IconTrash />} disabled={state.busy} onClick={() => cleanupTests().catch(() => {})} id="cleanup-tests">
              Cleanup tests
            </Button>
            <Button leftIcon={<IconPlus />} disabled={state.busy} onClick={() => setCreateOpen(true)} id="open-create">
              Create machine
            </Button>
          </>
        }
      />

      <div className="card-grid card-grid--4">
        <SummaryStat label="Total" value={state.machines.length} />
        <SummaryStat label="Containers" value={containerCount} />
        <SummaryStat label="VMs" value={vmCount} />
        <SummaryStat label="Running" value={state.machines.filter((m) => String(m.status ?? '').toLowerCase() === 'running').length} accent="ok" />
      </div>

      <Card>
        <CardHeader
          title="All machines"
          actions={
            <div className="search" style={{ width: 260 }}>
              <span className="search-icon">
                <IconSearch />
              </span>
              <Input
                id="machine-search"
                inputSize="sm"
                placeholder="Filter by name, id, region, status…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          }
        />
        <div className="table-wrap">
          <div className="table-scroll">
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
                      <Empty
                        title={filter ? 'No machines match this filter' : 'No machines yet'}
                        description={filter ? 'Try a different search.' : 'Create a machine to populate this table.'}
                        action={
                          !filter ? (
                            <Button leftIcon={<IconBolt />} onClick={() => setCreateOpen(true)}>
                              Create machine
                            </Button>
                          ) : null
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((m) => {
                    const active = m.id === state.selectedMachineId;
                    return (
                      <tr
                        key={m.id}
                        className={cx('is-clickable', active && 'is-active')}
                        data-machine-id={m.id}
                        onClick={() => selectMachine(m.id)}
                      >
                        <td>
                          <div className="cell-primary">{m.name || m.id}</div>
                          <div className="cell-meta mono">{shortId(m.id, 22)}</div>
                        </td>
                        <td><Tag tone={m.type === 'vm' ? 'violet' : 'ghost'}>{m.type ?? '?'}</Tag></td>
                        <td>
                          <Status tone={statusTone(m.status) || 'neutral'} label={m.status} />
                        </td>
                        <td>{m.cluster?.region ?? m.region ?? '—'}</td>
                        <td className="text-muted text-mono">{m.location ?? m.incus?.member_name ?? '—'}</td>
                        <td><span className="mono text-muted">{(m.source as { type?: string } | undefined)?.type ?? '—'}</span></td>
                        <td>
                          <div className="cell-actions" onClick={(event) => event.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                selectMachine(m.id);
                              }}
                            >
                              Open
                            </Button>
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
      </Card>

      {selected ? <MachineDetail machine={selected} onClose={closeDetail} /> : null}

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

function SummaryStat({ label, value, accent }: { label: string; value: number; accent?: 'ok' }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        {accent === 'ok' ? <Tag tone="ok">live</Tag> : null}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
