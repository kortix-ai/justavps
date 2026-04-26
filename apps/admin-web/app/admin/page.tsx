'use client';

import Link from 'next/link';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Stat } from '@/components/ui/stat';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { ArrowRight, Network, RefreshCw, ShoppingCart, Terminal, Building2 } from 'lucide-react';

export default function AdminOverviewPage() {
  const { state, refreshAll } = useStore();

  const schedulableInventory = state.inventory.filter((host) => host.schedulable === true).length;
  const schedulableLive = state.hosts.filter((host) => host.schedulable === true).length;
  const clusteredInventory = state.inventory.filter((host) => host.incusClusterId).length;
  const activeProcurements = state.procurements.filter((p) =>
    ['planned', 'approved', 'order_planned', 'bootstrap_planned'].includes(String(p.status ?? '')),
  ).length;
  const recent = state.workflowLog.slice(0, 8);

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="admin">
      <PageHeader
        title="Admin"
        description="Operate the V2 control plane: clusters, vendor inventory, capacity, and the procurement gates that turn Robot hosts into Incus capacity."
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-4 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <Stat label="Clusters" value={String(state.clusters.length)} meta={state.clusters.map((c) => c.id).join(', ') || 'none configured'} />
        <Stat label="Schedulable hosts" value={String(schedulableInventory)} meta={`${schedulableLive} live · ${clusteredInventory} clustered`} />
        <Stat label="Inventory" value={String(state.inventory.length)} meta={`${clusteredInventory} clustered`} />
        <Stat label="Procurements" value={String(state.procurements.length)} meta={`${activeProcurements} active`} />
      </div>

      <div className="grid grid-cols-3 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <AdminQuickCard
          icon={<Network className="size-3.5 text-fg-muted" />}
          title="Topology"
          desc="Regions, Incus clusters, and persisted Hetzner inventory."
          to="/admin/topology"
          tagText={`${state.clusters.length} clusters · ${state.regions.length} regions`}
        />
        <AdminQuickCard
          icon={<Building2 className="size-3.5 text-fg-muted" />}
          title="Vendor"
          desc="Hetzner Robot servers and product catalog."
          to="/admin/vendor"
          tagText={`${state.servers.length} servers · ${state.products.length} products`}
        />
        <AdminQuickCard
          icon={<ShoppingCart className="size-3.5 text-fg-muted" />}
          title="Procurement"
          desc="Quote → approve → plan order → plan bootstrap. Live execution stays gated."
          to="/admin/procurement"
          gate
          tagText={`${activeProcurements} active`}
        />
        <AdminQuickCard
          icon={<Terminal className="size-3.5 text-fg-muted" />}
          title="API Console"
          desc="Send raw requests to any V2 API path."
          to="/admin/console"
        />
      </div>

      <Card>
        <CardHeader title="Recent activity" desc="Newest first" />
        <pre
          id="workflow-log"
          data-testid="v2-workflow-log"
          className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-zinc-300"
        >
{recent.length === 0 ? '— No activity yet. Refresh to populate.' : recent.map((entry) => `${entry.ts}  ${entry.text}`).join('\n')}
        </pre>
      </Card>
    </section>
  );
}

function AdminQuickCard({ icon, title, desc, to, tagText, gate }: { icon: React.ReactNode; title: string; desc: string; to: string; tagText?: string; gate?: boolean }) {
  return (
    <Link
      href={to}
      className="group flex flex-col gap-2 rounded-[12px] border border-border bg-bg-1 p-4 transition-colors hover:border-border-focus hover:bg-bg-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[14px] font-semibold tracking-tight">
          {icon}
          {title}
          {gate ? <Tag tone="warn">gate</Tag> : null}
        </div>
        <ArrowRight className="size-3.5 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="text-[12.5px] text-fg-muted">{desc}</div>
      {tagText ? <div className="mt-1 text-[12px] text-fg-subtle">{tagText}</div> : null}
    </Link>
  );
}
