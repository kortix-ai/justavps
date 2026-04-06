import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const createCheckoutSessionMock = vi.fn();

vi.mock('@/server/lib/stripe', () => ({
  stripeClient: {
    isConfigured: () => true,
    createCheckoutSession: createCheckoutSessionMock,
  },
}));

describe('guest checkout route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.APP_URL = 'http://localhost:4100';
  });

  it('accepts substrate-agnostic plan+region input', async () => {
    createCheckoutSessionMock.mockResolvedValueOnce({ url: 'https://checkout.test/session' });
    const { POST } = await import('@/app/api/checkout/start/route');
    const req = new NextRequest('http://localhost/api/checkout/start', {
      method: 'POST',
      body: JSON.stringify({
        plan: 'starter',
        region: 'hel1',
        billing_interval: 'monthly',
        enable_backups: false,
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checkout_url).toBe('https://checkout.test/session');
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      machineConfig: expect.objectContaining({
        server_type: 'starter',
        region: 'hel1',
      }),
    }));
  });
});
