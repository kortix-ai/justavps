import { useStore } from '../lib/store';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Empty } from '../components/ui/Empty';
import { Button } from '../components/ui/Button';
import { IconRefresh } from '../components/ui/icons';

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

export function VendorPage() {
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
    <section className="page" data-route="vendor">
      <PageHeader
        title="Vendor"
        description="Hetzner Robot servers and product catalog."
        actions={
          <>
            <Button variant="secondary" leftIcon={<IconRefresh />} disabled={state.busy} onClick={() => fetchVendorData().catch(() => {})} id="fetch-vendor">
              Fetch vendor data
            </Button>
            <Button id="sync-hetzner-2" disabled={state.busy} onClick={() => syncHetzner().catch(() => {})}>
              Sync inventory
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader title="Robot servers" desc="Live server list returned by Hetzner Robot." />
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Server #</th>
                  <th>Name</th>
                  <th>IPv4</th>
                  <th>Status</th>
                  <th>Datacenter</th>
                </tr>
              </thead>
              <tbody id="servers-tbody">
                {state.servers.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <Empty title="No vendor data fetched" description="Hit “Fetch vendor data” to load Robot servers + products." />
                    </td>
                  </tr>
                ) : (
                  (state.servers as Server[]).map((server, index) => (
                    <tr key={index}>
                      <td className="cell-primary mono">{stringField(server, ['serverNumber', 'server_number'])}</td>
                      <td>{stringField(server, ['name', 'serverName'])}</td>
                      <td className="mono text-muted">{stringField(server, ['publicIpv4', 'serverIp'])}</td>
                      <td className="text-muted">{stringField(server, ['status'])}</td>
                      <td className="text-muted">{stringField(server, ['dc', 'location'])}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Products" desc="Per-location pricing returned by Robot." />
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Name</th>
                  <th>Locations</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody id="products-tbody">
                {state.products.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <Empty title="No products fetched" description="Hit “Fetch vendor data” to load Robot products." />
                    </td>
                  </tr>
                ) : (
                  (state.products as Product[]).map((product, index) => {
                    const inner = (product.product ?? product) as Record<string, unknown>;
                    return (
                      <tr key={`${stringField(inner, ['id', 'product_id'])}-${index}`}>
                        <td className="cell-primary mono">{stringField(inner, ['id', 'product_id'])}</td>
                        <td>{stringField(inner, ['name', 'description'])}</td>
                        <td className="text-muted">{arrayField(inner, ['location']).join(', ')}</td>
                        <td className="text-muted">{stringField(inner, ['price', 'price_monthly'])}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </section>
  );
}
