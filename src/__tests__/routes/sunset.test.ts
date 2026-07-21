import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SUNSET_ENABLED } from '@/shared/lib/sunset';

// While justavps.com transitions to platinum.dev, all sign-up and checkout
// entry points must return 410 Gone.
describe('sunset guards', () => {
  it('sunset flag is enabled', () => {
    expect(SUNSET_ENABLED).toBe(true);
  });

  it.each([
    ['/api/checkout/start', () => import('@/app/api/checkout/start/route')],
    ['/api/checkout/access', () => import('@/app/api/checkout/access/route')],
    ['/api/auth/register', () => import('@/app/api/auth/register/route')],
    ['/api/auth/forgot-password', () => import('@/app/api/auth/forgot-password/route')],
    ['/api/auth/reset-password', () => import('@/app/api/auth/reset-password/route')],
    ['/api/auth/resend-verification', () => import('@/app/api/auth/resend-verification/route')],
  ])('%s returns 410', async (path, load) => {
    const { POST } = await load();
    const req = new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.message).toContain('platinum.dev');
  });
});
