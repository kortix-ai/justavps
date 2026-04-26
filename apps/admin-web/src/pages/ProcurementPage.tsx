import { useEffect, useState } from 'react';
import type { ProcurementItem } from '../lib/api';
import { useStore } from '../lib/store';
import { cx, shortId, statusTone } from '../lib/utils';

export function ProcurementPage() {
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
      const id =
        typeof (inner as { id?: unknown }).id === 'string'
          ? ((inner as { id: string }).id)
          : typeof (inner as { name?: unknown }).name === 'string'
            ? ((inner as { name: string }).name)
            : '';
      const loc = (inner as { location?: unknown }).location;
      if (id) setProductId(id);
      if (Array.isArray(loc) && typeof loc[0] === 'string') setLocation(loc[0]);
    }
  }, [productId, state.products]);

  useEffect(() => {
    if (state.regions.length && !state.regions.includes(region)) {
      setRegion(state.regions[0]);
    }
  }, [region, state.regions]);

  useEffect(() => {
    if (!clusterId && state.clusters[0]) {
      setClusterId(state.clusters[0].id);
    }
  }, [clusterId, state.clusters]);

  const selected: ProcurementItem | null =
    state.procurements.find((p) => p.id === state.selectedProcurementId) ?? null;

  function body(extra?: Record<string, unknown>) {
    return {
      product_id: productId.trim(),
      location: location.trim(),
      region: region.trim() || 'eu',
      quantity: Number(quantity) || 1,
      ...extra,
    };
  }

  async function refreshProcurements() {
    await runAction('refresh procurements', async () => {
      const data = await request<{ procurements: ProcurementItem[] }>('/admin/procurements');
      // surface via global state via refreshAll (we need to update store directly too)
      await refreshAll();
      return data;
    });
  }

  async function quote() {
    await runAction('quote procurement', async () => {
      return request('/admin/procurements/quote', { method: 'POST', body: body() });
    });
  }

  async function createDryRun() {
    await runAction('create dry-run procurement', async () => {
      const data = await request<{ procurements: ProcurementItem[] }>('/admin/procurements', {
        method: 'POST',
        body: body({ execute: false }),
      });
      const created = data.procurements?.[0];
      if (created?.id) {
        setSelectedProcurementId(created.id);
      }
      await refreshAll();
      return data;
    });
  }

  async function testBlockedNewOrder() {
    await runAction('test blocked new order', async () => {
      return request('/admin/procurements', {
        method: 'POST',
        expectedStatus: 409,
        body: body({ execute: true }),
      });
    });
  }

  async function approve() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`approve ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/approve`, {
        method: 'POST',
        body: { note: 'approved from admin UI dry run' },
      });
      await refreshAll();
      return data;
    });
  }

  async function planOrder() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`plan order ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/order`, {
        method: 'POST',
        body: { note: 'order planned from admin UI' },
      });
      await refreshAll();
      return data;
    });
  }

  async function testBlockedSelectedOrder() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction('test blocked selected order', async () => {
      return request(`/admin/procurements/${encodeURIComponent(selected.id)}/order`, {
        method: 'POST',
        expectedStatus: 409,
        body: { execute: true },
      });
    });
  }

  async function bootstrapPlan() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`bootstrap plan ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/bootstrap-plan`, {
        method: 'POST',
        body: {
          cluster_id: clusterId.trim() || state.clusters[0]?.id || 'hel1',
          provider_server_number: providerServerNumber.trim() || undefined,
          mode: 'incusos_join_cluster',
        },
      });
      await refreshAll();
      return data;
    });
  }

  async function testBlockedBootstrap() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction('test blocked bootstrap', async () => {
      return request(`/admin/procurements/${encodeURIComponent(selected.id)}/bootstrap-plan`, {
        method: 'POST',
        expectedStatus: 409,
        body: {
          cluster_id: clusterId.trim() || state.clusters[0]?.id || 'hel1',
          mode: 'incusos_join_cluster',
          execute: true,
        },
      });
    });
  }

  async function cancel() {
    if (!selected) throw new Error('Select a procurement first.');
    await runAction(`cancel ${shortId(selected.id, 12)}`, async () => {
      const data = await request(`/admin/procurements/${encodeURIComponent(selected.id)}/cancel`, {
        method: 'POST',
        body: { note: 'cancelled from admin UI' },
      });
      await refreshAll();
      return data;
    });
  }

  return (
    <section className="page" data-route="procurement">
      <div className="panel">
        <div className="panel-head">
          <h2>Procurement Pipeline</h2>
          <span className="desc">Quote, plan, approve, and bootstrap hosts safely. Live purchase/reimage execution is blocked by policy.</span>
        </div>
        <div className="pipeline">
          <div className="pipeline-card">
            <span className="badge">quote</span>
            <strong>Plan capacity</strong>
            <p>Choose Robot product, location, region, and quantity without buying anything.</p>
          </div>
          <div className="pipeline-card gate">
            <span className="badge warn">order gate</span>
            <strong>Approve before order</strong>
            <p>Order planning is persisted, but real host purchases return blocked responses.</p>
          </div>
          <div className="pipeline-card gate">
            <span className="badge warn">bootstrap gate</span>
            <strong>Join IncusOS capacity</strong>
            <p>Bootstrap plans describe the IncusOS join path. Real reimage/bootstrap stays locked.</p>
          </div>
        </div>
        <div className="form-grid cols-3">
          <div className="field">
            <label className="field-label" htmlFor="proc-product">Product ID</label>
            <input id="proc-product" className="input" value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="AX102 / product id" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="proc-location">Location</label>
            <input id="proc-location" className="input" value={location} onChange={(event) => setLocation(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="proc-region">Region</label>
            <input id="proc-region" className="input" value={region} onChange={(event) => setRegion(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="proc-quantity">Quantity</label>
            <input id="proc-quantity" className="input" type="number" min={1} max={20} value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 1)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="proc-cluster">Cluster</label>
            <input id="proc-cluster" className="input" value={clusterId} onChange={(event) => setClusterId(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="proc-server-number">Provider server #</label>
            <input id="proc-server-number" className="input" value={providerServerNumber} onChange={(event) => setProviderServerNumber(event.target.value)} placeholder="optional existing Robot server" />
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 14 }}>
          <button type="button" id="proc-quote" className="button secondary" disabled={state.busy} onClick={() => quote().catch(() => {})}>
            Quote
          </button>
          <button type="button" id="proc-create" className="button" disabled={state.busy} onClick={() => createDryRun().catch(() => {})}>
            Create Dry-Run Procurement
          </button>
          <button type="button" id="proc-refresh" className="button secondary" disabled={state.busy} onClick={() => refreshProcurements().catch(() => {})}>
            Refresh Procurements
          </button>
          <button type="button" id="proc-block-order" className="button danger" disabled={state.busy} onClick={() => testBlockedNewOrder().catch(() => {})}>
            Test Blocked New Order
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Procurements</h2>
          <span id="selected-procurement" className="desc">
            {selected ? selected.id : 'none selected'}
          </span>
        </div>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Product</th>
                <th>Location</th>
                <th>Status</th>
                <th>Host</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="procurements-tbody">
              {state.procurements.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">No procurements yet — create a dry-run quote.</div>
                  </td>
                </tr>
              ) : (
                state.procurements.map((p) => {
                  const active = p.id === state.selectedProcurementId;
                  return (
                    <tr key={p.id} className={cx('row-clickable', active && 'row-active')} onClick={() => setSelectedProcurementId(p.id)}>
                      <td>
                        <code>{shortId(p.id, 14)}</code>
                        {active ? <span className="badge ok" style={{ marginLeft: 8 }}>selected</span> : null}
                      </td>
                      <td>{p.productId ?? p.product_id ?? '-'}</td>
                      <td>{p.location}</td>
                      <td>
                        <span className={cx('badge', statusTone(p.status))}>{p.status}</span>
                      </td>
                      <td>{p.hostId ?? p.host_id ?? '-'}</td>
                      <td>
                        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="button small"
                            onClick={() => {
                              setSelectedProcurementId(p.id);
                              approve().catch(() => {});
                            }}
                            disabled={state.busy}
                          >
                            approve
                          </button>
                          <button
                            type="button"
                            className="button small secondary"
                            onClick={() => {
                              setSelectedProcurementId(p.id);
                              planOrder().catch(() => {});
                            }}
                            disabled={state.busy}
                          >
                            plan order
                          </button>
                          <button
                            type="button"
                            className="button small secondary"
                            onClick={() => {
                              setSelectedProcurementId(p.id);
                              bootstrapPlan().catch(() => {});
                            }}
                            disabled={state.busy}
                          >
                            plan bootstrap
                          </button>
                          <button
                            type="button"
                            className="button small danger"
                            onClick={() => {
                              setSelectedProcurementId(p.id);
                              cancel().catch(() => {});
                            }}
                            disabled={state.busy}
                          >
                            cancel
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
        <div className="toolbar" style={{ marginTop: 14 }}>
          <button type="button" id="proc-approve" className="button" disabled={state.busy || !selected} onClick={() => approve().catch(() => {})}>
            Approve Selected
          </button>
          <button type="button" id="proc-order-plan" className="button secondary" disabled={state.busy || !selected} onClick={() => planOrder().catch(() => {})}>
            Plan Order
          </button>
          <button type="button" id="proc-block-order-selected" className="button danger" disabled={state.busy || !selected} onClick={() => testBlockedSelectedOrder().catch(() => {})}>
            Test Blocked Selected Order
          </button>
          <button type="button" id="proc-bootstrap-plan" className="button secondary" disabled={state.busy || !selected} onClick={() => bootstrapPlan().catch(() => {})}>
            Create Bootstrap Plan
          </button>
          <button type="button" id="proc-block-bootstrap" className="button danger" disabled={state.busy || !selected} onClick={() => testBlockedBootstrap().catch(() => {})}>
            Test Blocked Bootstrap
          </button>
          <button type="button" id="proc-cancel" className="button danger" disabled={state.busy || !selected} onClick={() => cancel().catch(() => {})}>
            Cancel Selected
          </button>
        </div>
      </div>
    </section>
  );
}
