import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';

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

  return (
    <section className="page" data-route="dashboard">
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Standalone V2 API</div>
          <h2>Incus operator command center.</h2>
          <p>
            One place to see cluster health, physical supply, machine runtime, image artifacts, and the procurement gates that
            turn Robot hosts into Incus capacity.
          </p>
          <div className="hero-actions">
            <button type="button" className="button" onClick={() => navigate('/machines')}>
              Manage Machines
            </button>
            <button type="button" className="button secondary" onClick={() => navigate('/procurement')}>
              Procurement Pipeline
            </button>
            <button type="button" className="button secondary" onClick={() => navigate('/topology')}>
              Cluster Topology
            </button>
          </div>
        </div>
        <div className="hero-side">
          <div className="signal">
            <strong>Runtime truth</strong>
            <span>Incus cluster observation</span>
          </div>
          <div className="signal">
            <strong>Supply truth</strong>
            <span>Hetzner Robot inventory</span>
          </div>
          <div className="signal gate">
            <strong>Safety lock</strong>
            <span>ordering &amp; bootstrap blocked unless explicitly confirmed</span>
          </div>
        </div>
      </div>

      <div className="runway">
        <div className="runway-step">
          <div className="num">01</div>
          <h3>Sync Robot</h3>
          <p>Pull physical servers and keep unknown hosts unschedulable.</p>
        </div>
        <div className="runway-step">
          <div className="num">02</div>
          <h3>Observe Incus</h3>
          <p>Cache clusters, members, instances, and images directly from Incus.</p>
        </div>
        <div className="runway-step">
          <div className="num">03</div>
          <h3>Schedule Machines</h3>
          <p>Create containers or VMs only on online Incus members.</p>
        </div>
        <div className="runway-step">
          <div className="num">04</div>
          <h3>Publish Artifacts</h3>
          <p>Snapshot, restore, publish images, and create backups from Incus primitives.</p>
        </div>
        <div className="runway-step">
          <div className="num">05</div>
          <h3>Procure Capacity</h3>
          <p>Quote, approve, order-plan, and bootstrap-plan dedicated hosts safely.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard id="metric-health" label="Health" value={state.health?.status ?? '-'} meta={state.health?.service ?? 'configuration'} />
        <StatCard
          id="metric-regions"
          label="Regions"
          value={String(state.regions.length)}
          meta={state.regions.join(', ') || 'unique regions'}
        />
        <StatCard
          id="metric-clusters"
          label="Clusters"
          value={String(state.clusters.length)}
          meta={state.clusters.map((c) => c.id).join(', ') || 'configured Incus clusters'}
        />
        <StatCard
          id="metric-schedulable"
          label="Schedulable hosts"
          value={String(schedulableInventory)}
          meta={`${schedulableLive} live members`}
        />
        <StatCard
          id="metric-machines"
          label="Machines"
          value={String(state.machines.length)}
          meta={`${runningMachines} running`}
        />
        <StatCard
          id="metric-images"
          label="Images"
          value={String(state.images.length)}
          meta={`${publicImages} public`}
        />
        <StatCard
          id="metric-inventory"
          label="Inventory hosts"
          value={String(state.inventory.length)}
          meta={`${clusteredInventory} clustered`}
        />
        <StatCard
          id="metric-robot"
          label="Robot"
          value={state.health ? (state.health.hetzner_robot_configured ? 'on' : 'off') : '-'}
          meta={state.health ? (state.health.hetzner_robot_configured ? 'credentials set' : 'credentials missing') : 'credentials'}
        />
        <StatCard
          id="metric-db"
          label="Database"
          value={state.health ? (state.health.database_configured ? 'on' : 'off') : '-'}
          meta={state.health ? (state.health.database_configured ? 'prisma connected' : 'missing DATABASE_URL') : 'prisma config'}
        />
        <StatCard
          id="metric-auth"
          label="Auth"
          value={state.token ? 'set' : 'open'}
          meta={state.token ? 'admin token attached' : 'no token attached'}
        />
        <StatCard
          id="metric-procurements"
          label="Procurements"
          value={String(state.procurements.length)}
          meta={`${activeProcurements} active`}
        />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Recent Activity</h2>
          <span className="desc">Newest first</span>
        </div>
        <textarea
          id="workflow-log"
          className="input log"
          data-testid="v2-workflow-log"
          readOnly
          placeholder="Run actions to see progress here."
          style={{ minHeight: 220 }}
          value={state.workflowLog.map((entry) => `${entry.ts} ${entry.text}`).join('\n')}
        />
      </div>
    </section>
  );
}

function StatCard({ id, label, value, meta }: { id: string; label: string; value: string; meta: string }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value" id={id}>
        {value}
      </div>
      <div className="meta" id={`${id}-meta`}>
        {meta}
      </div>
    </div>
  );
}
