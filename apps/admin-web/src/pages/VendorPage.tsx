import { EmptyState } from '../components/EmptyState';
import { useStore } from '../lib/store';

type Server = Record<string, unknown>;
type Product = Record<string, unknown> & { product?: Record<string, unknown> };

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
      <div className="panel">
        <div className="panel-head">
          <h2>Hetzner Robot Servers</h2>
          <div className="toolbar">
            <button type="button" id="fetch-vendor" className="button secondary" disabled={state.busy} onClick={() => fetchVendorData().catch(() => {})}>
              Fetch Vendor Data
            </button>
            <button type="button" id="sync-hetzner-2" className="button" disabled={state.busy} onClick={() => syncHetzner().catch(() => {})}>
              Sync Inventory
            </button>
          </div>
        </div>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Server</th>
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
                    <EmptyState>Hit “Fetch Vendor Data” to load Robot servers.</EmptyState>
                  </td>
                </tr>
              ) : (
                (state.servers as Server[]).map((server, index) => (
                  <tr key={index}>
                    <td>{stringField(server, ['serverNumber', 'server_number'])}</td>
                    <td>{stringField(server, ['name', 'serverName'])}</td>
                    <td>{stringField(server, ['publicIpv4', 'serverIp'])}</td>
                    <td>{stringField(server, ['status'])}</td>
                    <td>{stringField(server, ['dc', 'location'])}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Robot Products</h2>
          <span className="desc">Per location</span>
        </div>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Name</th>
                <th>Location</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody id="products-tbody">
              {state.products.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState>Hit “Fetch Vendor Data” to load Robot products.</EmptyState>
                  </td>
                </tr>
              ) : (
                (state.products as Product[]).map((product, index) => {
                  const inner = (product.product ?? product) as Record<string, unknown>;
                  const id = stringField(inner, ['id', 'product_id']);
                  const name = stringField(inner, ['name', 'description']);
                  const location = arrayField(inner, ['location']);
                  const price = stringField(inner, ['price', 'price_monthly']);
                  return (
                    <tr key={`${id}-${index}`}>
                      <td>{id}</td>
                      <td>{name}</td>
                      <td>{location.join(', ')}</td>
                      <td>{price}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function stringField(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = value[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
  }
  return '-';
}

function arrayField(value: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const v = value[key];
    if (Array.isArray(v)) return v.map(String);
  }
  return [];
}
