'use client';

import { useEffect, useState } from 'react';
import type { ProcurementItem } from '@/lib/api';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Empty } from '@/components/ui/empty';
import { Status } from '@/components/ui/status';
import { cn, shortId, statusTone } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';

export default function ProcurementPage() {
  const { state, request, runAction, refreshAll, setSelectedProcurementId } = useStore();
  const [productId, setProductId] = useState('');
  const [location, setLocation] = useState('HEL1');
  const [region, setRegion] = useState('eu');
  const [quantity, setQuantity] = useState(1);
  const [clusterId, setClusterId] = useState('hel1');
  const [providerServerNumber, setProviderServerNumber] = useState('');

  useEffect(() => {
    if (!productId && state.products.length > 0) {
      const first = state.products[0] as { product?: { id?: string; name?: string; location?: string[] } };
      const inner = first.product ?? (first as Record<string, unknown>);
      const id = typeof (inner as { id?: unknown }).id === 'string' ? ((inner as { id: string }).id) : typeof (inner as { name?: unknown }).name === 'string' ? ((inner as { name: string }).name) : '';
      const loc = (inner as { location?: unknown }).location;
      if (id) setProductId(id);
      if (Array.isArray(loc) && typeof loc[0] === 'string') setLocation(loc[0]);
    }
  }, [productId, state.products]);

  useEffect(() => {
    if (state.regions.length && !state.regions.includes(region)) setRegion(state.regions[0]);
  }, [region, state.regions]);

  useEffect(() => {
    if (!clusterId && state.clusters[0]) setClusterId(state.clusters[0].id);
  }, [clusterId, state.clusters]);

  const selected: ProcurementItem | null = state.procurements.find((p) => p.id === state.selectedProcurementId) ?? null;

  function body(extra?: Record<string, unknown>) {
    return { product_id: productId.trim(), location: location.trim(), region: region.trim() || 'eu', quantity: Number(quantity) || 1, ...extra };
  }

  async function refreshProcurements() {
    await runAction('refresh procurements', async () => {
      const data = await request<{ procurements: ProcurementItem[] }>('/admin/procurements');
      await refreshAll();
      return data;
    });
  }

  async function quote() {
    await runAction('quote procurement', async () => request('/admin/procurements/quote', { method: 'POST', body: body() }));
  }

  async function createDryRun() {
    await runAction('create dry-run procurement', async () => {
      const data = await request<{ procurements: ProcurementItem[] }>('/admin/procurements', { method: 'POST', body: body({ execute: false }) });
      const created = data.procurements?.[0];
      if (created?.id) setSelectedProcurementId(created.id);
      await refreshAll();
      return data;
    });
  }

  async function testBlockedNewOrder() {
    await runAction('test blocked new order', async () => request('/admin/procurements', { method: 'POST', expectedStatus: 409, body: body({ execute: true }) }));
  }

  async function approve() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`approve ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/approve`, { method: 'POST', body: { note: 'approved from admin UI dry run' } });
      await refreshAll();
      return data;
    });
  }

  async function planOrder() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`plan order ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/order`, { method: 'POST', body: { note: 'order planned from admin UI' } });
      await refreshAll();
      return data;
    });
  }

  async function testBlockedSelectedOrder() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction('test blocked selected order', async () =>
      request(`/admin/procurements/${encodeURIComponent(selected.id)}/order`, { method: 'POST', expectedStatus: 409, body: { execute: true } }),
    );
  }

  async function bootstrapPlan() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`bootstrap plan ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/bootstrap-plan`, {
        method: 'POST',
        body: { cluster_id: clusterId.trim() || state.clusters[0]?.id || 'hel1', provider_server_number: providerServerNumber.trim() || undefined, mode: 'incusos_join_cluster' },
      });
      await refreshAll();
      return data;
    });
  }

  async function testBlockedBootstrap() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction('test blocked bootstrap', async () =>
      request(`/admin/procurements/${encodeURIComponent(selected.id)}/bootstrap-plan`, {
        method: 'POST',
        expectedStatus: 409,
        body: { cluster_id: clusterId.trim() || state.clusters[0]?.id || 'hel1', mode: 'incusos_join_cluster', execute: true },
      }),
    );
  }

  async function cancel() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`cancel ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/cancel`, { method: 'POST', body: { note: 'cancelled from admin UI' } });
      await refreshAll();
      return data;
    });
  }

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="procurement">
      <PageHeader
        title="Procurement"
        description="Quote, approve, order-plan, and bootstrap-plan dedicated hosts. Real ordering and bootstrap are gated."
        actions={<Button variant="secondary" leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => refreshProcurements().catch(() => {})} id="proc-refresh">Refresh</Button>}
      />

      <Card>
        <CardHeader title="Pipeline" desc="Quote → Approve → Plan order → Plan bootstrap. Live execution stays blocked until explicitly confirmed." />
        <div className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
          <PipelineCard step="01" title="Quote" desc="Pick Robot product, location, region, quantity. No hosts purchased." />
          <PipelineCard step="02" title="Order gate" desc="Order planning is persisted, but real Robot purchases return 409 unless the operator types ORDER REAL HOSTS." gate />
          <PipelineCard step="03" title="Bootstrap gate" desc="Bootstrap plan describes the IncusOS install/join path. Real reimage stays blocked." gate />
        </div>
      </Card>

      <Card>
        <CardHeader title="Plan capacity" desc="Build a fresh procurement (always dry-run by default)." />
        <div className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
          <Field label="Product ID" htmlFor="proc-product"><Input id="proc-product" value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="AX102 / product id" /></Field>
          <Field label="Location" htmlFor="proc-location"><Input id="proc-location" value={location} onChange={(event) => setLocation(event.target.value)} /></Field>
          <Field label="Region" htmlFor="proc-region"><Input id="proc-region" value={region} onChange={(event) => setRegion(event.target.value)} /></Field>
          <Field label="Quantity" htmlFor="proc-quantity"><Input id="proc-quantity" type="number" min={1} max={20} value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 1)} /></Field>
          <Field label="Cluster" htmlFor="proc-cluster"><Input id="proc-cluster" value={clusterId} onChange={(event) => setClusterId(event.target.value)} /></Field>
          <Field label="Provider server #" htmlFor="proc-server-number" help="Optional — link to an existing Robot server."><Input id="proc-server-number" value={providerServerNumber} onChange={(event) => setProviderServerNumber(event.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" id="proc-quote" disabled={state.busy} onClick={() => quote().catch(() => {})}>Quote</Button>
          <Button id="proc-create" disabled={state.busy} onClick={() => createDryRun().catch(() => {})}>Create dry-run</Button>
          <Button variant="danger-ghost" id="proc-block-order" disabled={state.busy} onClick={() => testBlockedNewOrder().catch(() => {})}>Test blocked new order</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Procurements" desc={selected ? `Selected: ${selected.id}` : 'No procurement selected'} />
        <div className="overflow-hidden rounded-[12px] border border-border bg-bg-1">
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {['ID', 'Product', 'Location', 'Status', 'Host', ''].map((h) => (
                    <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="procurements-tbody">
                {state.procurements.length === 0 ? (
                  <tr><td colSpan={6}><Empty title="No procurements yet" description="Build one above with Quote → Create dry-run." /></td></tr>
                ) : state.procurements.map((p) => {
                  const active = p.id === state.selectedProcurementId;
                  return (
                    <tr key={p.id} className={cn('cursor-pointer border-b border-border last:border-0 hover:bg-bg-2', active && 'bg-surface-active')} onClick={() => setSelectedProcurementId(p.id)}>
                      <td className="px-3.5 py-2.5">
                        <code className="font-mono">{shortId(p.id, 16)}</code>
                        {active ? <Tag tone="ok" className="ml-2">selected</Tag> : null}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono">{p.productId ?? p.product_id ?? '—'}</td>
                      <td className="px-3.5 py-2.5 text-fg-muted">{p.location}</td>
                      <td className="px-3.5 py-2.5"><Status tone={statusTone(p.status)} label={p.status} /></td>
                      <td className="px-3.5 py-2.5 font-mono text-fg-muted">{p.hostId ?? p.host_id ?? '—'}</td>
                      <td className="px-3.5 py-2.5">
                        <div className="inline-flex flex-wrap gap-1.5" onClick={(event) => event.stopPropagation()}>
                          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setSelectedProcurementId(p.id); approve().catch(() => {}); }}>approve</Button>
                          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setSelectedProcurementId(p.id); planOrder().catch(() => {}); }}>plan order</Button>
                          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setSelectedProcurementId(p.id); bootstrapPlan().catch(() => {}); }}>plan bootstrap</Button>
                          <Button variant="danger-ghost" size="sm" onClick={(event) => { event.stopPropagation(); setSelectedProcurementId(p.id); cancel().catch(() => {}); }}>cancel</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button id="proc-approve" disabled={state.busy || !selected} onClick={() => approve().catch(() => {})}>Approve selected</Button>
          <Button variant="secondary" id="proc-order-plan" disabled={state.busy || !selected} onClick={() => planOrder().catch(() => {})}>Plan order</Button>
          <Button variant="danger-ghost" id="proc-block-order-selected" disabled={state.busy || !selected} onClick={() => testBlockedSelectedOrder().catch(() => {})}>Test blocked selected order</Button>
          <Button variant="secondary" id="proc-bootstrap-plan" disabled={state.busy || !selected} onClick={() => bootstrapPlan().catch(() => {})}>Plan bootstrap</Button>
          <Button variant="danger-ghost" id="proc-block-bootstrap" disabled={state.busy || !selected} onClick={() => testBlockedBootstrap().catch(() => {})}>Test blocked bootstrap</Button>
          <Button variant="danger-ghost" id="proc-cancel" disabled={state.busy || !selected} onClick={() => cancel().catch(() => {})}>Cancel</Button>
        </div>
      </Card>
    </section>
  );
}

function PipelineCard({ step, title, desc, gate }: { step: string; title: string; desc: string; gate?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-[12px] border bg-bg-1 p-4', gate ? 'border-amber-500/30 bg-amber-500/5' : 'border-border')}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">{step}</div>
      <div className="flex items-center gap-2">
        <div className="text-[14px] font-semibold tracking-tight">{title}</div>
        {gate ? <Tag tone="warn">gate</Tag> : null}
      </div>
      <div className="text-[12.5px] text-fg-muted">{desc}</div>
    </div>
  );
}
