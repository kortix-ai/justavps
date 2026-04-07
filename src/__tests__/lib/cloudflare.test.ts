/**
 * Tests for Cloudflare client — broker DNS, route, and KV management.
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
    it('should create unproxied origin DNS record for SSH access', async () => {
      mockFetch.mockImplementation(async (_url: string, opts?: { method?: string }) => {
        const method = opts?.method || 'GET';
        if (method === 'GET') return { ok: true, json: async () => ({ result: [] }) };
        if (method === 'DELETE') return { ok: true, json: async () => ({ result: null }) };
        return { ok: true, json: async () => ({}) };
      });

      await cloudflareClient.addMachineDNS('test-slug', {
        ipv4: '168.119.45.176',
        ipv6: '2a01:4f8:c17:e4c4::1',
      });

      // Should create DNS records (A + AAAA) for origin-test-slug.<domain>
      const postCalls = (mockFetch.mock.calls as MockCall[]).filter((c) => c[1]?.method === 'POST');
      expect(postCalls.length).toBeGreaterThan(0);
      // Verify records are unproxied
      for (const call of postCalls) {
        const body = JSON.parse(call[1]?.body as string);
        if (body.type === 'A' || body.type === 'AAAA') {
          expect(body.proxied).toBe(false);
          expect(body.name).toContain('origin-test-slug');
        }
      }
    });
  });

  describe('removeMachineDNS', () => {
    it('should delete all DNS records for slug, wildcard, origin, and legacy origin', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: [] }),
      });

      await cloudflareClient.removeMachineDNS('test-slug');

      // 4 hostnames × 3 types = 12 GET calls
      expect(mockFetch).toHaveBeenCalled();
      const getCalls = (mockFetch.mock.calls as MockCall[]).filter((c) => !c[1]?.method || c[1]?.method === 'GET');
      expect(getCalls.length).toBeGreaterThanOrEqual(12);
    });
  });

  describe('writeKVMachine', () => {
    it('should PUT machine data to KV with correct key', async () => {
      await cloudflareClient.writeKVMachine('my-slug', {
        machine_id: 'machine-123',
        account_id: 'acct-123',
        ip: '2a01:4f8:c17:e4c4::',
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
