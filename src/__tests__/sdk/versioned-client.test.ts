import { describe, expect, it } from 'vitest';

import { JustAVPS, JustAVPSV2 } from '@/sdk/client';

describe('versioned SDK clients', () => {
  it('defaults V1 client to /api/v1', () => {
    const client = new JustAVPS({ apiKey: 'test-key', baseUrl: 'https://example.com' });
    expect((client as unknown as { _http: { baseUrl: string } })._http.baseUrl).toBe('https://example.com');
  });

  it('defaults V2 client to /api/v2', () => {
    const client = new JustAVPSV2({ apiKey: 'test-key' });
    expect((client as unknown as { _http: { baseUrl: string } })._http.baseUrl).toBe('https://justavps.com/api/v2');
  });
});
