/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listServerProductsMock = vi.fn();

vi.mock('@/server/lib/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('isAdmin', true);
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    return next();
  },
}));

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(() => ({ from: async () => [] })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: async () => [] })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: async () => [] })) })),
  },
}));

vi.mock('@/server/lib/baremetal/vendors/hetzner-robot', () => ({
  HetznerRobotClient: vi.fn(function HetznerRobotClient() {
    return {
      listServerProducts: listServerProductsMock,
    };
  }),
}));

describe('admin baremetal API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.HETZNER_ROBOT_USER = 'robot-user';
    process.env.HETZNER_ROBOT_PASSWORD = 'robot-pass';
  });

  it('lists Hetzner Robot products for admins', async () => {
    listServerProductsMock.mockResolvedValueOnce([
      {
        product: {
          id: 'AX41-NVMe',
          name: 'AX41-NVMe',
          location: ['FSN1'],
        },
      },
    ]);

    const { adminBaremetalApp } = await import('@/server/routes/v1/admin-baremetal');
    const req = new Request('http://localhost/products/hetzner?location=FSN1&max_price=60');
    const res = await adminBaremetalApp.request(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.products).toHaveLength(1);
    expect(data.products[0].id).toBe('AX41-NVMe');
    expect(listServerProductsMock).toHaveBeenCalledWith({ location: 'FSN1', maxPrice: 60 });
  });
});
