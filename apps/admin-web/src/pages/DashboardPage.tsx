import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { PageHeader } from '../components/ui/PageHeader';
import { Stat } from '../components/ui/Stat';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Tag } from '../components/ui/Tag';
import { IconArrowRight, IconBolt, IconNetwork, IconShoppingCart } from '../components/ui/icons';

export function DashboardPage() {
  const { state } = useStore();
  const navigate = useNavigate();

  const schedulableInventory = state.inventory.filter((host) => host.schedulable === true).length;
  const schedulableLive = state.hosts.filter((host) => host.schedulable === true).length;
  const runningMachines = state.machines.filter((m) => String(m.status ?? '').toLowerCase() === 'running').length;
  const publicImages = state.images.filter((image) => image.public).length;
  const clusteredInventory = state.inventory.filter((host) => host.incusClusterId).length;
  const activeProcurements = state.procurements.filter((p) =>
    ['planned', 'approved', 'order_planned', 'bootstrap_planned'].includes(String(p.status ?? '')),
  ).length;
  const recent = state.workflowLog.slice(0, 12);

  return (
    <section className="page" data-route="dashboard">
      <PageHeader
        title="Dashboard"
        description="Live snapshot of the V2 control plane: clusters, machines, artifacts, and the procurement gates that turn Robot hosts into Incus capacity."
        actions={
          <>
            <Button variant="secondary" rightIcon={<IconArrowRight />} onClick={() => navigate('/topology')}>
              View topology
            </Button>
            <Button variant="primary" leftIcon={<IconBolt />} onClick={() => navigate('/machines')}>
              Manage machines
            </Button>
          </>
        }
      />

      <div className="card-grid card-grid--4">
        <Stat label="Health" value={state.health?.status ?? '—'} meta={state.health?.service ?? 'service'} />
        <Stat label="Clusters" value={String(state.clusters.length)} meta={state.clusters.map((c) => c.id).join(', ') || 'none configured'} />
        <Stat
          label="Schedulable hosts"
          value={String(schedulableInventory)}
          meta={`${schedulableLive} live · ${clusteredInventory} clustered`}
        />
        <Stat label="Regions" value={String(state.regions.length)} meta={state.regions.join(', ') || '—'} />
        <Stat label="Machines" value={String(state.machines.length)} meta={`${runningMachines} running`} />
        <Stat label="Images" value={String(state.images.length)} meta={`${publicImages} public`} />
        <Stat label="Inventory" value={String(state.inventory.length)} meta={`${clusteredInventory} clustered`} />
        <Stat label="Procurements" value={String(state.procurements.length)} meta={`${activeProcurements} active`} />
      </div>

      <div className="card-grid card-grid--3">
        <Card>
          <CardHeader title="Cluster topology" desc="Online members + persisted inventory" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {state.clusters.length === 0 ? (
              <div className="text-muted text-sm">No clusters configured.</div>
            ) : (
              state.clusters.map((cluster) => {
                const observed = cluster.observed ?? {};
                const members = (observed.members ?? []).length;
                const instances = (observed.instances ?? []).length;
                return (
                  <div key={cluster.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cell-primary">{cluster.id}</div>
                      <div className="cell-meta">{cluster.region} · {cluster.project}</div>
                    </div>
                    <Tag tone="ok">{members} mem</Tag>
                    <Tag>{instances} inst</Tag>
                  </div>
                );
              })
            )}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" rightIcon={<IconArrowRight />} onClick={() => navigate('/topology')}>
              Topology
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Procurement pipeline" desc="Order &amp; bootstrap gates" />
          <div className="text-sm text-muted" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              Quote → Approve → Plan order → Plan bootstrap. Real Hetzner ordering and host bootstrap are
              <strong className="text-mono" style={{ color: 'var(--amber)', marginLeft: 4 }}>blocked</strong> until you explicitly confirm with{' '}
              <code className="mono">ORDER REAL HOSTS</code>{' / '}
              <code className="mono">BOOTSTRAP REAL HOST</code>.
            </div>
            <div className="toolbar">
              <Tag tone="warn">order gate</Tag>
              <Tag tone="warn">bootstrap gate</Tag>
              <Tag tone="ghost">{activeProcurements} active</Tag>
            </div>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" rightIcon={<IconArrowRight />} onClick={() => navigate('/procurement')}>
              Procurement
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick actions" desc="Common operator flows" />
          <div className="form-grid form-grid--2">
            <Button variant="secondary" leftIcon={<IconNetwork />} onClick={() => navigate('/topology')}>
              Sync &amp; observe
            </Button>
            <Button variant="secondary" leftIcon={<IconBolt />} onClick={() => navigate('/machines')}>
              Create machine
            </Button>
            <Button variant="secondary" onClick={() => navigate('/artifacts')}>
              Image catalog
            </Button>
            <Button variant="secondary" leftIcon={<IconShoppingCart />} onClick={() => navigate('/procurement')}>
              Plan capacity
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" desc="Newest first" />
        <div className="log" style={{ maxHeight: 280 }} data-testid="v2-workflow-log" id="workflow-log">
          {recent.length === 0
            ? '— No activity yet. Trigger a refresh or run the full E2E to populate.'
            : recent.map((entry) => `${entry.ts}  ${entry.text}`).join('\n')}
        </div>
      </Card>
    </section>
  );
}
