'use client';

import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

type Server = Record<string, unknown>;
type Product = Record<string, unknown> & { product?: Record<string, unknown> };

function stringField(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = value[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
  }
  return '—';
}
function arrayField(value: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const v = value[key];
    if (Array.isArray(v)) return v.map(String);
  }
  return [];
}

export default function VendorPage() {
  const { state, request, runAction, setProducts, setServers, refreshAll } = useStore();

  async function fetchVendorData() {
    await runAction('fetch vendor data', async () => {
      const productsResp = await request<{ products: Product[] }>('/admin/vendors/hetzner/products');
      const serversResp = await request<{ servers: Server[] }>('/admin/vendors/hetzner/servers');
      setProducts(productsResp.products ?? []);
      setServers(serversResp.servers ?? []);
      return { products: (productsResp.products ?? []).length, servers: (serversResp.servers ?? []).length };
    });
  }

  async function syncHetzner() {
    await runAction('sync hetzner', async () => {
      const data = await request('/admin/vendors/hetzner/sync', { method: 'POST' });
      await refreshAll();
      return data;
    });
  }

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="vendor">
      <PageHeader
        title="Vendor"
        description="Hetzner Robot servers and product catalog."
        actions={
          <>
            <Button variant="secondary" leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => fetchVendorData().catch(() => {})} id="fetch-vendor">Fetch vendor data</Button>
            <Button id="sync-hetzner-2" disabled={state.busy} onClick={() => syncHetzner().catch(() => {})}>Sync inventory</Button>
          </>
        }
      />

      <Card>
        <CardHeader title="Robot servers" desc="Live server list returned by Hetzner Robot." />
        <ScrollTable headers={['Server #', 'Name', 'IPv4', 'Status', 'Datacenter']} bodyId="servers-tbody" empty={state.servers.length === 0}>
          {(state.servers as Server[]).map((server, index) => (
            <tr key={index} className="border-b border-border last:border-0">
              <td className="px-3.5 py-2.5 font-medium font-mono">{stringField(server, ['serverNumber', 'server_number'])}</td>
              <td className="px-3.5 py-2.5">{stringField(server, ['name', 'serverName'])}</td>
              <td className="px-3.5 py-2.5 font-mono text-fg-muted">{stringField(server, ['publicIpv4', 'serverIp'])}</td>
              <td className="px-3.5 py-2.5 text-fg-muted">{stringField(server, ['status'])}</td>
              <td className="px-3.5 py-2.5 text-fg-muted">{stringField(server, ['dc', 'location'])}</td>
            </tr>
          ))}
        </ScrollTable>
        {state.servers.length === 0 ? <Empty title="No vendor data fetched" description="Hit “Fetch vendor data” to load Robot servers + products." /> : null}
      </Card>

      <Card>
        <CardHeader title="Products" desc="Per-location pricing returned by Robot." />
        <ScrollTable headers={['Product', 'Name', 'Locations', 'Price']} bodyId="products-tbody" empty={state.products.length === 0}>
          {(state.products as Product[]).map((product, index) => {
            const inner = (product.product ?? product) as Record<string, unknown>;
            return (
              <tr key={`${stringField(inner, ['id', 'product_id'])}-${index}`} className="border-b border-border last:border-0">
                <td className="px-3.5 py-2.5 font-medium font-mono">{stringField(inner, ['id', 'product_id'])}</td>
                <td className="px-3.5 py-2.5">{stringField(inner, ['name', 'description'])}</td>
                <td className="px-3.5 py-2.5 text-fg-muted">{arrayField(inner, ['location']).join(', ')}</td>
                <td className="px-3.5 py-2.5 text-fg-muted">{stringField(inner, ['price', 'price_monthly'])}</td>
              </tr>
            );
          })}
        </ScrollTable>
        {state.products.length === 0 ? <Empty title="No products fetched" description="Hit “Fetch vendor data” to load Robot products." /> : null}
      </Card>
    </section>
  );
}

function ScrollTable({ headers, bodyId, empty, children }: { headers: string[]; bodyId?: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-border bg-bg-1">
      <div className="overflow-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody id={bodyId}>{empty ? null : children}</tbody>
        </table>
      </div>
    </div>
  );
}
