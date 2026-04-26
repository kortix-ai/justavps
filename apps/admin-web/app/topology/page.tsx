'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { PageHeader, Tab } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Status } from '@/components/ui/status';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { pickIncusApiUrl, pickIncusUiUrl, statusTone } from '@/lib/utils';

type View = 'live' | 'inventory';

export default function TopologyPage() {
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
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="topology">
      <PageHeader
        title="Topology"
        description="Regions, Incus clusters, live members, and persisted Hetzner inventory."
        actions={
          <>
            <Button variant="secondary" id="sync-hetzner" leftIcon={<RefreshCw className="size-3.5" />} onClick={() => syncHetzner().catch(() => {})}>
              Sync Hetzner
            </Button>
            <Button id="sync-cluster" onClick={() => syncCluster().catch(() => {})}>
              Sync cluster
            </Button>
          </>
        }
        tabs={
          <>
            <Tab active={view === 'live'} onClick={() => setView('live')}>Live Incus state</Tab>
            <Tab active={view === 'inventory'} onClick={() => setView('inventory')}>Persisted inventory</Tab>
          </>
        }
      />

      <Card>
        <CardHeader title="Regions" desc={state.regions.length ? `${state.regions.length} configured: ${state.regions.join(', ')}` : 'No regions configured.'} />
        <div className="flex flex-wrap gap-2">
          {state.regions.length === 0 ? <Tag tone="ghost">none</Tag> : state.regions.map((r) => <Tag key={r} tone="violet">{r}</Tag>)}
        </div>
        <div id="regions-view" className="flex flex-wrap gap-2">
          {state.regions.length === 0 ? <Tag tone="ghost">none</Tag> : state.regions.map((r) => <Tag key={r} tone="ghost">{r}</Tag>)}
        </div>
        <Field label="Active cluster">
          <Select id="cluster-select" value={selectedCluster} onChange={(event) => setSelectedCluster(event.target.value)}>
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
        <ScrollTable headers={['Cluster', 'Region', 'Project', 'Members', 'Instances', 'Images', 'Open']} bodyId="clusters-tbody" empty={state.clusters.length === 0}>
          {state.clusters.map((cluster) => {
            const observed = cluster.observed ?? {};
            const ui = pickIncusUiUrl(cluster);
            const api = pickIncusApiUrl(cluster);
            return (
              <tr key={cluster.id} className="border-b border-border last:border-0">
                <td className="px-3.5 py-2.5">
                  <div className="font-medium">{cluster.id}</div>
                  <div className="font-mono text-[12px] text-fg-subtle">{cluster.endpoint}</div>
                </td>
                <td className="px-3.5 py-2.5">{cluster.region}</td>
                <td className="px-3.5 py-2.5"><span className="font-mono text-fg-muted">{cluster.project}</span></td>
                <td className="px-3.5 py-2.5">{(observed.members ?? []).length}</td>
                <td className="px-3.5 py-2.5">{(observed.instances ?? []).length}</td>
                <td className="px-3.5 py-2.5">{(observed.images ?? []).length}</td>
                <td className="px-3.5 py-2.5">
                  <div className="inline-flex flex-wrap gap-1.5">
                    {ui ? (
                      <a className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-border-strong bg-bg-1 px-2.5 text-[12px] font-medium text-fg hover:bg-bg-2" target="_blank" rel="noreferrer" href={ui}>
                        Incus UI <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                    {api ? (
                      <a className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-transparent bg-transparent px-2.5 text-[12px] font-medium text-fg-muted hover:bg-bg-2 hover:text-fg" target="_blank" rel="noreferrer" href={api}>
                        API <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </ScrollTable>
        {state.clusters.length === 0 ? <Empty title="No clusters" description="Configure INCUS_ENDPOINT (and friends) on apps/v2-api to populate this view." /> : null}
      </Card>

      {view === 'live' ? (
        <Card>
          <CardHeader title="Live Incus members" desc="Observed online cluster members from /admin/hosts." />
          <ScrollTable headers={['Cluster', 'Member', 'Status', 'Schedulable', 'Roles', 'Open']} bodyId="hosts-tbody" empty={state.hosts.length === 0}>
            {state.hosts.map((host, index) => {
              const ui = pickIncusUiUrl(host);
              const api = pickIncusApiUrl(host);
              return (
                <tr key={`${host.cluster?.id ?? ''}-${host.name ?? index}`} className="border-b border-border last:border-0">
                  <td className="px-3.5 py-2.5">{host.cluster?.id ?? ''}</td>
                  <td className="px-3.5 py-2.5 font-medium">{host.name}</td>
                  <td className="px-3.5 py-2.5"><Status tone={statusTone(host.status)} label={host.status} /></td>
                  <td className="px-3.5 py-2.5">{host.schedulable ? <Tag tone="ok">yes</Tag> : <Tag tone="bad">no</Tag>}</td>
                  <td className="px-3.5 py-2.5 text-fg-muted">{(host.roles ?? []).join(', ') || '—'}</td>
                  <td className="px-3.5 py-2.5">
                    <div className="inline-flex flex-wrap gap-1.5">
                      {ui ? (
                        <a className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-border-strong bg-bg-1 px-2.5 text-[12px] font-medium text-fg hover:bg-bg-2" target="_blank" rel="noreferrer" href={ui}>
                          Incus UI <ExternalLink className="size-3" />
                        </a>
                      ) : null}
                      {api ? (
                        <a className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-transparent bg-transparent px-2.5 text-[12px] font-medium text-fg-muted hover:bg-bg-2 hover:text-fg" target="_blank" rel="noreferrer" href={api}>
                          API <ExternalLink className="size-3" />
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </ScrollTable>
          {state.hosts.length === 0 ? <Empty title="No live members" description="Run “Sync cluster” after configuring an Incus endpoint." /> : null}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Persisted host inventory" desc="Vendor-side hosts from /admin/hosts/inventory." />
          <ScrollTable headers={['Vendor', 'Server', 'IPv4', 'Cluster / Member', 'Status', 'Schedulable']} bodyId="inventory-tbody" empty={state.inventory.length === 0}>
            {state.inventory.map((host) => (
              <tr key={host.id} className="border-b border-border last:border-0">
                <td className="px-3.5 py-2.5 text-fg-muted">{host.vendor}</td>
                <td className="px-3.5 py-2.5 font-medium">{host.providerServerNumber ?? '—'}</td>
                <td className="px-3.5 py-2.5 font-mono">{host.publicIpv4 ?? '—'}</td>
                <td className="px-3.5 py-2.5">
                  <span className="font-mono text-fg-muted">{host.incusClusterId ?? '—'}</span>
                  <span className="text-fg-subtle"> / </span>
                  <span className="font-mono text-fg-muted">{host.incusMemberName ?? '—'}</span>
                </td>
                <td className="px-3.5 py-2.5"><Status tone={statusTone(host.status)} label={host.status} /></td>
                <td className="px-3.5 py-2.5">{host.schedulable ? <Tag tone="ok">yes</Tag> : <Tag tone="bad">no</Tag>}</td>
              </tr>
            ))}
          </ScrollTable>
          {state.inventory.length === 0 ? <Empty title="No inventory yet" description="Run “Sync Hetzner” to pull Robot servers into v2_core.host." /> : null}
        </Card>
      )}
    </section>
  );
}

function ScrollTable({
  headers,
  bodyId,
  empty,
  children,
}: {
  headers: string[];
  bodyId?: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-border bg-bg-1">
      <div className="overflow-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody id={bodyId}>{empty ? null : children}</tbody>
        </table>
      </div>
    </div>
  );
}
