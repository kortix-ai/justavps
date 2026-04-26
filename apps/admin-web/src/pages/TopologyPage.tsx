import { useState } from 'react';
import { useStore } from '../lib/store';
import { PageHeader, Tab } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Tag } from '../components/ui/Tag';
import { Button } from '../components/ui/Button';
import { Empty } from '../components/ui/Empty';
import { Status } from '../components/ui/Status';
import { Select } from '../components/ui/Input';
import { Field } from '../components/ui/Field';
import { cx, pickIncusApiUrl, pickIncusUiUrl, statusTone } from '../lib/utils';
import { IconExternal, IconRefresh } from '../components/ui/icons';

type View = 'live' | 'inventory';

export function TopologyPage() {
  const { state, request, runAction, refreshAll } = useStore();
  const [view, setView] = useState<View>('live');
  const [selectedCluster, setSelectedCluster] = useState<string>('');

  async function syncHetzner() {
    await runAction('sync hetzner', async () => {
      const data = await request('/admin/vendors/hetzner/sync', { method: 'POST' });
      await refreshAll();
      return data;
    });
  }

  async function syncCluster() {
    const id = selectedCluster || state.clusters[0]?.id;
    if (!id) throw new Error('No cluster available; refresh first.');
    await runAction(`sync cluster ${id}`, async () => {
      const data = await request(`/admin/clusters/${encodeURIComponent(id)}/sync`, { method: 'POST' });
      await refreshAll();
      return data;
    });
  }

  return (
    <section className="page" data-route="topology">
      <PageHeader
        title="Topology"
        description="Regions, Incus clusters, live members, and persisted Hetzner inventory."
        actions={
          <>
            <Button variant="secondary" id="sync-hetzner" leftIcon={<IconRefresh />} onClick={() => syncHetzner().catch(() => {})}>
              Sync Hetzner
            </Button>
            <Button variant="primary" id="sync-cluster" onClick={() => syncCluster().catch(() => {})}>
              Sync cluster
            </Button>
          </>
        }
        tabs={
          <>
            <Tab active={view === 'live'} onClick={() => setView('live')}>
              Live Incus state
            </Tab>
            <Tab active={view === 'inventory'} onClick={() => setView('inventory')}>
              Persisted inventory
            </Tab>
          </>
        }
      />

      <Card>
        <CardHeader
          title="Regions"
          desc={
            state.regions.length
              ? `${state.regions.length} configured: ${state.regions.join(', ')}`
              : 'No regions configured.'
          }
        />
        <div className="toolbar">
          {state.regions.length === 0 ? <Tag tone="ghost">none</Tag> : state.regions.map((region) => <Tag key={region} tone="violet">{region}</Tag>)}
        </div>
        <div id="regions-view" className="toolbar">
          {state.regions.length === 0 ? <Tag tone="ghost">none</Tag> : state.regions.map((region) => <Tag key={region} tone="ghost">{region}</Tag>)}
        </div>
        <Field label="Active cluster">
          <Select
            id="cluster-select"
            value={selectedCluster}
            onChange={(event) => setSelectedCluster(event.target.value)}
          >
            <option value="">{state.clusters.length ? 'All clusters' : 'No clusters configured'}</option>
            {state.clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.id} · {cluster.region}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card>
        <CardHeader title="Clusters" desc="Configured Incus clusters with observed counts." />
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Cluster</th>
                  <th>Region</th>
                  <th>Project</th>
                  <th>Members</th>
                  <th>Instances</th>
                  <th>Images</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody id="clusters-tbody">
                {state.clusters.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <Empty title="No clusters" description="Configure INCUS_ENDPOINT (and friends) on apps/v2-api to populate this view." />
                    </td>
                  </tr>
                ) : (
                  state.clusters.map((cluster) => {
                    const observed = cluster.observed ?? {};
                    const ui = pickIncusUiUrl(cluster);
                    const api = pickIncusApiUrl(cluster);
                    return (
                      <tr key={cluster.id}>
                        <td>
                          <div className="cell-primary">{cluster.id}</div>
                          <div className="cell-meta mono">{cluster.endpoint}</div>
                        </td>
                        <td>{cluster.region}</td>
                        <td><span className="mono text-muted">{cluster.project}</span></td>
                        <td>{(observed.members ?? []).length}</td>
                        <td>{(observed.instances ?? []).length}</td>
                        <td>{(observed.images ?? []).length}</td>
                        <td>
                          <div className="cell-actions">
                            {ui ? (
                              <a className="btn btn--secondary btn--sm" target="_blank" rel="noreferrer" href={ui}>
                                Incus UI <IconExternal />
                              </a>
                            ) : null}
                            {api ? (
                              <a className="btn btn--ghost btn--sm" target="_blank" rel="noreferrer" href={api}>
                                API <IconExternal />
                              </a>
                            ) : null}
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

      {view === 'live' ? (
        <Card>
          <CardHeader title="Live Incus members" desc="Observed online cluster members from /admin/hosts." />
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cluster</th>
                    <th>Member</th>
                    <th>Status</th>
                    <th>Schedulable</th>
                    <th>Roles</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody id="hosts-tbody">
                  {state.hosts.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <Empty title="No live members" description="Run “Sync cluster” after configuring an Incus endpoint." />
                      </td>
                    </tr>
                  ) : (
                    state.hosts.map((host, index) => (
                      <tr key={`${host.cluster?.id ?? ''}-${host.name ?? index}`}>
                        <td>{host.cluster?.id ?? ''}</td>
                        <td className="cell-primary">{host.name}</td>
                        <td>
                          <Status tone={statusTone(host.status) || 'neutral'} label={host.status} />
                        </td>
                        <td>
                          {host.schedulable ? <Tag tone="ok">yes</Tag> : <Tag tone="bad">no</Tag>}
                        </td>
                        <td className="text-muted">{(host.roles ?? []).join(', ') || '—'}</td>
                        <td>
                          {(() => {
                            const ui = pickIncusUiUrl(host);
                            const api = pickIncusApiUrl(host);
                            return (
                              <div className="cell-actions">
                                {ui ? <a className="btn btn--secondary btn--sm" target="_blank" rel="noreferrer" href={ui}>Incus UI</a> : null}
                                {api ? <a className="btn btn--ghost btn--sm" target="_blank" rel="noreferrer" href={api}>API</a> : null}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Persisted host inventory" desc="Vendor-side hosts from /admin/hosts/inventory." />
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Server</th>
                    <th>IPv4</th>
                    <th>Cluster / Member</th>
                    <th>Status</th>
                    <th>Schedulable</th>
                  </tr>
                </thead>
                <tbody id="inventory-tbody">
                  {state.inventory.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <Empty title="No inventory yet" description="Run “Sync Hetzner” to pull Robot servers into v2_core.host." />
                      </td>
                    </tr>
                  ) : (
                    state.inventory.map((host) => (
                      <tr key={host.id}>
                        <td className={cx('text-muted')}>{host.vendor}</td>
                        <td className="cell-primary">{host.providerServerNumber ?? '—'}</td>
                        <td className="mono">{host.publicIpv4 ?? '—'}</td>
                        <td>
                          <span className="mono text-muted">{host.incusClusterId ?? '—'}</span>
                          <span className="text-subtle"> / </span>
                          <span className="mono text-muted">{host.incusMemberName ?? '—'}</span>
                        </td>
                        <td>
                          <Status tone={statusTone(host.status) || 'neutral'} label={host.status} />
                        </td>
                        <td>{host.schedulable ? <Tag tone="ok">yes</Tag> : <Tag tone="bad">no</Tag>}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </section>
  );
}
