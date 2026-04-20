import { describe, expect, it, vi } from 'vitest';

import { JustAVPS, JustAVPSV2 } from '@/sdk/client';
import { normalizeV2BaseUrl } from '@/sdk/client-v2';

describe('versioned SDK clients', () => {
  it('defaults V1 client to /api/v1', () => {
    const client = new JustAVPS({ apiKey: 'test-key', baseUrl: 'https://example.com' });
    expect((client as unknown as { _http: { baseUrl: string } })._http.baseUrl).toBe('https://example.com');
  });

  it('defaults V2 client to /api/v2', () => {
    const client = new JustAVPSV2({ apiKey: 'test-key' });
    expect((client as unknown as { _http: { baseUrl: string } })._http.baseUrl).toBe('https://justavps.com/api/v2');
  });

  it('normalizes origin-only V2 base URLs', () => {
    expect(normalizeV2BaseUrl('http://localhost:4100')).toBe('http://localhost:4100/api/v2');
    expect(normalizeV2BaseUrl('http://localhost:4100/api')).toBe('http://localhost:4100/api/v2');
    expect(normalizeV2BaseUrl('http://localhost:4100/api/v2')).toBe('http://localhost:4100/api/v2');
  });

  it('supports V2 exec through the handwritten client wrapper', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, stdout: 'hi\n', stderr: '', exit_code: 0 }),
    });
    const client = new JustAVPSV2({ apiKey: 'test-key', baseUrl: 'http://localhost:4100', fetch: fetchMock as unknown as typeof fetch });

    const result = await client.machines.exec('machine-1', { command: 'bash', args: ['-lc', 'echo hi'] });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4100/api/v2/machines/machine-1/exec', expect.objectContaining({
      method: 'POST',
    }));
    expect(result).toEqual({ ok: true, stdout: 'hi\n', stderr: '', exit_code: 0 });
  });
});
