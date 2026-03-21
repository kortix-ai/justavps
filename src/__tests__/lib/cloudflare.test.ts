/**
 * Tests for Cloudflare client — dual-stack DNS and KV management.
 * Architecture: direct IP proxy (no tunnels).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cloudflareClient } from '@/server/lib/cloudflare';

type MockCall = [string, { method?: string; body?: string }?];

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
    it('should create dual-stack root, wildcard, and origin records', async () => {
      mockFetch.mockImplementation(async (_url: string, opts?: { method?: string }) => {
        const method = opts?.method || 'GET';
        if (method === 'GET') return { ok: true, json: async () => ({ result: [] }) };
        if (method === 'POST') return { ok: true, json: async () => ({ result: { id: 'dns-id' } }) };
        if (method === 'DELETE') return { ok: true, json: async () => ({ result: null }) };
        return { ok: true, json: async () => ({}) };
      });

      await cloudflareClient.addMachineDNS('test-slug', {
        ipv4: '168.119.45.176',
        ipv6: '2a01:4f8:c17:e4c4::1',
      });

      const postCalls = (mockFetch.mock.calls as MockCall[]).filter((c) => c[1]?.method === 'POST');
      expect(postCalls.length).toBe(6);

      // 1-3: IPv4 A records
      const body1 = JSON.parse(postCalls[0]![1]!.body!);
      expect(body1.type).toBe('A');
      expect(body1.name).toContain('test-slug');
      expect(body1.content).toBe('168.119.45.176');
      expect(body1.proxied).toBe(true);

      const body2 = JSON.parse(postCalls[1]![1]!.body!);
      expect(body2.type).toBe('A');
      expect(body2.name).toContain('*.test-slug');
      expect(body2.proxied).toBe(true);

      const body3 = JSON.parse(postCalls[2]![1]!.body!);
      expect(body3.type).toBe('A');
      expect(body3.name).toContain('origin-test-slug');
      expect(body3.content).toBe('168.119.45.176');
      expect(body3.proxied).toBe(false);

      // 4-6: IPv6 AAAA records
      const body4 = JSON.parse(postCalls[3]![1]!.body!);
      expect(body4.type).toBe('AAAA');
      expect(body4.name).toContain('test-slug');
      expect(body4.content).toBe('2a01:4f8:c17:e4c4::1');
      expect(body4.proxied).toBe(true);

      const body5 = JSON.parse(postCalls[4]![1]!.body!);
      expect(body5.type).toBe('AAAA');
      expect(body5.name).toContain('*.test-slug');
      expect(body5.proxied).toBe(true);

      const body6 = JSON.parse(postCalls[5]![1]!.body!);
      expect(body6.type).toBe('AAAA');
      expect(body6.name).toContain('origin-test-slug');
      expect(body6.content).toBe('2a01:4f8:c17:e4c4::1');
      expect(body6.proxied).toBe(false);
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
      const getCalls = (mockFetch.mock.calls as MockCall[]).filter((c) => !c[1]?.method || c[1]?.method === 'GET');
      // 3 hostnames × 3 types = 9 GET calls
      expect(getCalls.length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('writeKVMachine', () => {
    it('should PUT machine data to KV with correct key', async () => {
      await cloudflareClient.writeKVMachine('my-slug', {
        owner_id: 'user-123',
        ip: '2a01:4f8:c17:e4c4::',
        origin_hostname: 'origin-my-slug.kortix.cloud',
        status: 'ready',
        server_type: 'cx22',
      });

      const putCalls = (mockFetch.mock.calls as MockCall[]).filter((c) => c[1]?.method === 'PUT');
      expect(putCalls.length).toBe(1);
      const url = putCalls[0][0] as string;
      expect(url).toContain('machine:my-slug');
    });
  });

  describe('deleteKVMachine', () => {
    it('should DELETE machine from KV', async () => {
      await cloudflareClient.deleteKVMachine('my-slug');

      const deleteCalls = (mockFetch.mock.calls as MockCall[]).filter((c) => c[1]?.method === 'DELETE');
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
