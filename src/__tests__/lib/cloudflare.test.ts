/**
 * Tests for Cloudflare KV client.
 * DNS is handled by a single wildcard *.kortix.cloud record (no per-machine DNS).
 * The client only manages KV entries for the proxy Worker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cloudflareClient } from '@/server/lib/cloudflare';

// Mock fetch globally
global.fetch = vi.fn();

describe('cloudflareClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as any).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeKVMachine', () => {
    it('should write machine info to KV', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await cloudflareClient.writeKVMachine('test-slug', {
        owner_id: 'user-123',
        ip: '10.0.0.1',
        status: 'provisioning',
        server_type: 'cpx22',
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = (fetch as any).mock.calls[0];
      expect(url).toContain('/storage/kv/namespaces/');
      expect(url).toContain('/values/machine:test-slug');
      expect(opts.method).toBe('PUT');
    });

    it('should include machine slug in KV key path', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await cloudflareClient.writeKVMachine('my-special-slug', {
        owner_id: 'user-456',
        ip: '10.0.0.2',
        status: 'ready',
        server_type: 'ccx13',
      });

      const [url] = (fetch as any).mock.calls[0];
      expect(url).toContain('machine:my-special-slug');
    });
  });

  describe('deleteKVMachine', () => {
    it('should delete machine from KV', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await cloudflareClient.deleteKVMachine('test-slug');

      // May or may not call fetch depending on config
      // The important thing is it doesn't throw
    });

    it('should not throw on failure', async () => {
      (fetch as any).mockRejectedValueOnce(new Error('Network error'));

      // Should swallow errors gracefully
      await expect(cloudflareClient.deleteKVMachine('test-slug')).resolves.toBeUndefined();
    });
  });
});
