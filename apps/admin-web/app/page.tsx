'use client';

import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Stat } from '@/components/ui/stat';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { ArrowRight, Network, ShoppingCart, Zap } from 'lucide-react';

export default function DashboardPage() {
  const { state } = useStore();
  const router = useRouter();

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
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="dashboard">
      <PageHeader
        title="Dashboard"
        description="Live snapshot of the V2 control plane: clusters, machines, artifacts, and the procurement gates that turn Robot hosts into Incus capacity."
        actions={
          <>
            <Button variant="secondary" rightIcon={<ArrowRight className="size-3.5" />} onClick={() => router.push('/topology')}>
              View topology
            </Button>
            <Button leftIcon={<Zap className="size-3.5" />} onClick={() => router.push('/machines')}>
              Manage machines
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <Stat label="Health" value={state.health?.status ?? '—'} meta={state.health?.service ?? 'service'} />
        <Stat label="Clusters" value={String(state.clusters.length)} meta={state.clusters.map((c) => c.id).join(', ') || 'none configured'} />
        <Stat label="Schedulable hosts" value={String(schedulableInventory)} meta={`${schedulableLive} live · ${clusteredInventory} clustered`} />
        <Stat label="Regions" value={String(state.regions.length)} meta={state.regions.join(', ') || '—'} />
        <Stat label="Machines" value={String(state.machines.length)} meta={`${runningMachines} running`} />
        <Stat label="Images" value={String(state.images.length)} meta={`${publicImages} public`} />
        <Stat label="Inventory" value={String(state.inventory.length)} meta={`${clusteredInventory} clustered`} />
        <Stat label="Procurements" value={String(state.procurements.length)} meta={`${activeProcurements} active`} />
      </div>

      <div className="grid grid-cols-3 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <Card>
          <CardHeader title="Cluster topology" desc="Online members + persisted inventory" />
          <div className="flex flex-col gap-2.5">
            {state.clusters.length === 0 ? (
              <div className="text-[12.5px] text-fg-muted">No clusters configured.</div>
            ) : (
              state.clusters.map((cluster) => {
                const observed = cluster.observed ?? {};
                const members = (observed.members ?? []).length;
                const instances = (observed.instances ?? []).length;
                return (
                  <div key={cluster.id} className="flex items-center gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{cluster.id}</div>
                      <div className="text-[12px] text-fg-subtle">{cluster.region} · {cluster.project}</div>
                    </div>
                    <Tag tone="ok">{members} mem</Tag>
                    <Tag>{instances} inst</Tag>
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-auto flex justify-end">
            <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="size-3.5" />} onClick={() => router.push('/topology')}>
              Topology
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Procurement pipeline" desc="Order & bootstrap gates" />
          <div className="flex flex-col gap-2 text-[13px] text-fg-muted">
            <div>
              Quote → Approve → Plan order → Plan bootstrap. Real Hetzner ordering and host bootstrap are
              <strong className="ml-1 font-mono text-amber-400">blocked</strong> until you explicitly confirm with{' '}
              <code className="font-mono">ORDER REAL HOSTS</code>{' / '}
              <code className="font-mono">BOOTSTRAP REAL HOST</code>.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="warn">order gate</Tag>
              <Tag tone="warn">bootstrap gate</Tag>
              <Tag tone="ghost">{activeProcurements} active</Tag>
            </div>
          </div>
          <div className="mt-auto flex justify-end">
            <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="size-3.5" />} onClick={() => router.push('/procurement')}>
              Procurement
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick actions" desc="Common operator flows" />
          <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <Button variant="secondary" leftIcon={<Network className="size-3.5" />} onClick={() => router.push('/topology')}>
              Sync &amp; observe
            </Button>
            <Button variant="secondary" leftIcon={<Zap className="size-3.5" />} onClick={() => router.push('/machines')}>
              Create machine
            </Button>
            <Button variant="secondary" onClick={() => router.push('/artifacts')}>Image catalog</Button>
            <Button variant="secondary" leftIcon={<ShoppingCart className="size-3.5" />} onClick={() => router.push('/procurement')}>
              Plan capacity
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" desc="Newest first" />
        <pre
          id="workflow-log"
          data-testid="v2-workflow-log"
          className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-zinc-300"
        >
{recent.length === 0
  ? '— No activity yet. Trigger a refresh or run the full E2E to populate.'
  : recent.map((entry) => `${entry.ts}  ${entry.text}`).join('\n')}
        </pre>
      </Card>
    </section>
  );
}
