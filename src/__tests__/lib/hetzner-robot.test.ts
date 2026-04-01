import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('HetznerRobotClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.HETZNER_ROBOT_USER = 'robot-user';
    process.env.HETZNER_ROBOT_PASSWORD = 'robot-pass';
  });

  it('lists dedicated products with basic auth and query filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([{ product: { id: 'AX41-NVMe' } }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { HetznerRobotClient } = await import('@/server/lib/baremetal/vendors/hetzner-robot');
    const client = new HetznerRobotClient();
    const products = await client.listServerProducts({ location: 'FSN1', maxPrice: 60 });

    expect(products).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/order/server/product');
    expect(url).toContain('location=FSN1');
    expect(url).toContain('max_price=60');
    expect(init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('robot-user:robot-pass').toString('base64')}`,
    });
  });

  it('orders a dedicated server with urlencoded form payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ transaction: { id: 'T-123', status: 'in process' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { HetznerRobotClient } = await import('@/server/lib/baremetal/vendors/hetzner-robot');
    const client = new HetznerRobotClient();
    const result = await client.orderServer({
      productId: 'AX41-NVMe',
      location: 'FSN1',
      distribution: 'Ubuntu 24.04 minimal',
      authorizedKeys: ['ssh-fp-1', 'ssh-fp-2'],
      addons: ['primary_ipv4'],
    });

    expect(result.transaction.id).toBe('T-123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/order/server/transaction');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    const body = String(init.body);
    expect(body).toContain('product_id=AX41-NVMe');
    expect(body).toContain('location=FSN1');
    expect(body).toContain('dist=Ubuntu+24.04+minimal');
    expect(body).toContain('authorized_key%5B%5D=ssh-fp-1');
    expect(body).toContain('authorized_key%5B%5D=ssh-fp-2');
    expect(body).toContain('addon%5B%5D=primary_ipv4');
  });

  it('throws a helpful error when ordering is rejected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 412,
      text: async () => JSON.stringify({ error: { code: 'PRECONDITION_FAILED', message: 'place via frontend' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { HetznerRobotClient } = await import('@/server/lib/baremetal/vendors/hetzner-robot');
    const client = new HetznerRobotClient();

    await expect(client.orderServer({
      productId: 'AX41-NVMe',
      location: 'FSN1',
      distribution: 'Ubuntu 24.04 minimal',
      authorizedKeys: ['ssh-fp-1'],
      addons: ['primary_ipv4'],
    })).rejects.toThrow(/PRECONDITION_FAILED|frontend/i);
  });

  it('reuses an existing robot SSH key when data matches', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([{ key: { fingerprint: 'aa:bb', data: 'ssh-ed25519 AAAA existing' } }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { HetznerRobotClient } = await import('@/server/lib/baremetal/vendors/hetzner-robot');
    const client = new HetznerRobotClient();
    const fingerprint = await client.ensureKey({ name: 'bootstrap', data: 'ssh-ed25519 AAAA existing' });

    expect(fingerprint).toBe('aa:bb');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a robot SSH key when it does not already exist', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ key: { fingerprint: 'cc:dd', data: 'ssh-ed25519 AAAA new' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { HetznerRobotClient } = await import('@/server/lib/baremetal/vendors/hetzner-robot');
    const client = new HetznerRobotClient();
    const fingerprint = await client.ensureKey({ name: 'bootstrap', data: 'ssh-ed25519 AAAA new' });

    expect(fingerprint).toBe('cc:dd');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
