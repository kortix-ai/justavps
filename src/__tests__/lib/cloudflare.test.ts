/**
 * Tests for Cloudflare client — DNS A records and KV management.
 * Architecture: direct IP proxy (no tunnels).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cloudflareClient } from '@/server/lib/cloudflare';

describe('cloudflareClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [] }),
      text: async () => '',
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addMachineDNS', () => {
    it('should create proxied A, wildcard A, and DNS-only origin A', async () => {
      mockFetch.mockImplementation(async (_url: string, opts?: any) => {
        const method = opts?.method || 'GET';
        if (method === 'GET') return { ok: true, json: async () => ({ result: [] }) };
        if (method === 'POST') return { ok: true, json: async () => ({ result: { id: 'dns-id' } }) };
        if (method === 'DELETE') return { ok: true, json: async () => ({ result: null }) };
        return { ok: true, json: async () => ({}) };
      });

      await cloudflareClient.addMachineDNS('test-slug', '10.0.0.1');

      const postCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'POST');
      expect(postCalls.length).toBe(3);

      // 1: Proxied A record (triggers Worker route)
      const body1 = JSON.parse(postCalls[0][1].body);
      expect(body1.type).toBe('A');
      expect(body1.name).toContain('test-slug');
      expect(body1.content).toBe('10.0.0.1');
      expect(body1.proxied).toBe(true);

      // 2: Wildcard A (port subdomains)
      const body2 = JSON.parse(postCalls[1][1].body);
      expect(body2.type).toBe('A');
      expect(body2.name).toContain('*.test-slug');
      expect(body2.proxied).toBe(true);

      // 3: Origin A (DNS-only — Worker fetches this to bypass CF proxy)
      const body3 = JSON.parse(postCalls[2][1].body);
      expect(body3.type).toBe('A');
      expect(body3.name).toContain('origin-test-slug');
      expect(body3.content).toBe('10.0.0.1');
      expect(body3.proxied).toBe(false);
    });
  });

  describe('removeMachineDNS', () => {
    it('should delete all DNS records for slug, wildcard, and origin', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: [] }),
      });

      await cloudflareClient.removeMachineDNS('test-slug');

      // Should query for CNAME, A, AAAA for slug + wildcard + origin.slug
      expect(mockFetch).toHaveBeenCalled();
      const getCalls = mockFetch.mock.calls.filter((c: any) => !c[1]?.method || c[1]?.method === 'GET');
      // 3 hostnames × 3 types = 9 GET calls
      expect(getCalls.length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('writeKVMachine', () => {
    it('should PUT machine data to KV with correct key', async () => {
      await cloudflareClient.writeKVMachine('my-slug', {
        owner_id: 'user-123',
        ip: '1.2.3.4',
        origin_hostname: 'origin-my-slug.kortix.cloud',
        status: 'ready',
        server_type: 'cx22',
      });

      const putCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'PUT');
      expect(putCalls.length).toBe(1);
      const url = putCalls[0][0] as string;
      expect(url).toContain('machine:my-slug');
    });
  });

  describe('deleteKVMachine', () => {
    it('should DELETE machine from KV', async () => {
      await cloudflareClient.deleteKVMachine('my-slug');

      const deleteCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'DELETE');
      expect(deleteCalls.length).toBe(1);
      const url = deleteCalls[0][0] as string;
      expect(url).toContain('machine:my-slug');
    });

    it('should swallow errors on delete failure', async () => {
      mockFetch.mockRejectedValue(new Error('KV Error'));
      await expect(cloudflareClient.deleteKVMachine('slug')).resolves.toBeUndefined();
    });
  });
});
