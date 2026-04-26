import { useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { IncusLinks } from '../components/IncusLinks';
import { useStore } from '../lib/store';
import { cx, statusTone } from '../lib/utils';

export function TopologyPage() {
  const { state, request, runAction, refreshAll } = useStore();
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
    if (!id) {
      throw new Error('No cluster available; refresh first.');
    }
    await runAction(`sync cluster ${id}`, async () => {
      const data = await request(`/admin/clusters/${encodeURIComponent(id)}/sync`, { method: 'POST' });
      await refreshAll();
      return data;
    });
  }

  return (
    <section className="page" data-route="topology">
      <div className="panel">
        <div className="panel-head">
          <h2>Regions &amp; Clusters</h2>
          <div className="toolbar">
            <button type="button" id="sync-hetzner" className="button secondary" disabled={state.busy} onClick={() => syncHetzner().catch(() => {})}>
              Sync Hetzner
            </button>
            <button type="button" id="sync-cluster" className="button" disabled={state.busy} onClick={() => syncCluster().catch(() => {})}>
              Sync Selected Cluster
            </button>
          </div>
        </div>

        <div className="form-grid cols-3">
          <div className="wide field">
            <label className="field-label">Regions</label>
            <div id="regions-view" className="chip-row">
              {state.regions.length ? (
                state.regions.map((region) => (
                  <span key={region} className="badge">
                    {region}
                  </span>
                ))
              ) : (
                <span className="badge">no regions</span>
              )}
            </div>
          </div>
          <div className="wide field">
            <label className="field-label" htmlFor="cluster-select">Selected cluster</label>
            <select
              id="cluster-select"
              className="input"
              value={selectedCluster}
              onChange={(event) => setSelectedCluster(event.target.value)}
            >
              <option value="">{state.clusters.length ? 'Select a cluster' : 'Refresh to load clusters'}</option>
              {state.clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.id} · {cluster.region}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="scroll" style={{ marginTop: 14 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Cluster</th>
                <th>Region</th>
                <th>Project</th>
                <th>Members</th>
                <th>Instances</th>
                <th>Images</th>
                <th>Incus</th>
              </tr>
            </thead>
            <tbody id="clusters-tbody">
              {state.clusters.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState>No clusters configured.</EmptyState>
                  </td>
                </tr>
              ) : (
                state.clusters.map((cluster) => {
                  const observed = cluster.observed ?? {};
                  return (
                    <tr key={cluster.id}>
                      <td>{cluster.id}</td>
                      <td>{cluster.region}</td>
                      <td>{cluster.project}</td>
                      <td>{(observed.members ?? []).length}</td>
                      <td>{(observed.instances ?? []).length}</td>
                      <td>{(observed.images ?? []).length}</td>
                      <td>
                        <IncusLinks item={cluster} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Live Incus Members</h2>
          <span className="desc">From /admin/hosts</span>
        </div>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Cluster</th>
                <th>Member</th>
                <th>Status</th>
                <th>Schedulable</th>
                <th>Roles</th>
                <th>Incus</th>
              </tr>
            </thead>
            <tbody id="hosts-tbody">
              {state.hosts.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState>No live cluster members observed.</EmptyState>
                  </td>
                </tr>
              ) : (
                state.hosts.map((host, index) => (
                  <tr key={`${host.cluster?.id ?? ''}-${host.name ?? index}`}>
                    <td>{host.cluster?.id ?? ''}</td>
                    <td>{host.name}</td>
                    <td>
                      <span className={cx('badge', statusTone(host.status))}>{host.status}</span>
                    </td>
                    <td>
                      {host.schedulable ? <span className="badge ok">yes</span> : <span className="badge bad">no</span>}
                    </td>
                    <td>{(host.roles ?? []).join(', ')}</td>
                    <td>
                      <IncusLinks item={host} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Persisted Host Inventory</h2>
          <span className="desc">From /admin/hosts/inventory</span>
        </div>
        <div className="scroll">
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
                    <EmptyState>No persisted inventory yet. Run “Sync Hetzner”.</EmptyState>
                  </td>
                </tr>
              ) : (
                state.inventory.map((host) => (
                  <tr key={host.id}>
                    <td>{host.vendor}</td>
                    <td>{host.providerServerNumber ?? '-'}</td>
                    <td>{host.publicIpv4 ?? '-'}</td>
                    <td>
                      <code>{host.incusClusterId ?? '-'}</code> / <code>{host.incusMemberName ?? '-'}</code>
                    </td>
                    <td>
                      <span className={cx('badge', statusTone(host.status))}>{host.status}</span>
                    </td>
                    <td>
                      {host.schedulable ? <span className="badge ok">yes</span> : <span className="badge bad">no</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
