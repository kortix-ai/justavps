/**
 * Tests for Cloudflare client.
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

  describe('createDNSRecord', () => {
    it('should send correct payload for DNS record creation', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: { id: 'dns-record-123' }
        })
      });

      await cloudflareClient.createDNSRecord('test-machine', '192.168.1.100');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            type: 'A',
            name: 'test-machine.test.example.com',
            content: '192.168.1.100',
            proxied: false,
            ttl: 1
          })
        })
      );
    });

    it('should handle API response with record ID', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: { id: 'record-456' }
        })
      });

      // Should complete without error
      await expect(
        cloudflareClient.createDNSRecord('my-vps', '10.0.0.1')
      ).resolves.toBeUndefined();
    });
  });

  describe('createWildcardDNSRecord', () => {
    it('should create wildcard DNS record', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: { id: 'wildcard-record-123' }
        })
      });

      await cloudflareClient.createWildcardDNSRecord('test-machine', '192.168.1.100');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            type: 'A',
            name: '*.test-machine.test.example.com',
            content: '192.168.1.100',
            proxied: false,
            ttl: 1
          })
        })
      );
    });
  });

  describe('deleteDNSRecord', () => {
    it('should find and delete DNS records for a slug', async () => {
      // Mock finding the records
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            result: [
              { id: 'record-123', name: 'test-machine.test.example.com' }
            ]
          })
        })
        // Mock deleting the record
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({})
        })
        // Mock finding wildcard records
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            result: [
              { id: 'wildcard-456', name: '*.test-machine.test.example.com' }
            ]
          })
        })
        // Mock deleting wildcard
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({})
        });

      await cloudflareClient.deleteDNSRecord('test-machine');

      // Should have made 4 calls: find, delete, find wildcard, delete wildcard
      expect(fetch).toHaveBeenCalledTimes(4);
      
      // Check the search queries
      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records?name=test-machine.test.example.com',
        expect.objectContaining({ method: 'GET' })
      );
      
      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records?name=*.test-machine.test.example.com',
        expect.objectContaining({ method: 'GET' })
      );
      
      // Check the delete calls
      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records/record-123',
        expect.objectContaining({ method: 'DELETE' })
      );
      
      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records/wildcard-456',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should handle case when no records found', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: [] })
        });

      await cloudflareClient.deleteDNSRecord('nonexistent-machine');

      // Should have made 2 calls: find main and find wildcard, no deletes
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateDNSRecord', () => {
    it('should find and update DNS record IP', async () => {
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            result: [{ id: 'record-789' }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({})
        });

      await cloudflareClient.updateDNSRecord('test-machine', '10.0.0.50');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records?name=test-machine.test.example.com',
        expect.objectContaining({ method: 'GET' })
      );
      
      expect(fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/test-zone-id/dns_records/record-789',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ content: '10.0.0.50' })
        })
      );
    });

    it('should handle case when record not found', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: [] })
      });

      await cloudflareClient.updateDNSRecord('nonexistent-machine', '10.0.0.99');

      // Should only have made the search call, no update
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should throw error for API failures', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('{"error":"Forbidden"}')
      });

      await expect(
        cloudflareClient.createDNSRecord('test', '1.2.3.4')
      ).rejects.toThrow('Cloudflare API POST /zones/test-zone-id/dns_records → 403: {"error":"Forbidden"}');
    });

    it('should handle network timeouts', async () => {
      (fetch as any).mockRejectedValueOnce(new Error('Network timeout'));

      await expect(
        cloudflareClient.createDNSRecord('test', '1.2.3.4')
      ).rejects.toThrow('Network timeout');
    });

    it('should handle empty response text on error', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('Cannot read response'))
      });

      await expect(
        cloudflareClient.createDNSRecord('test', '1.2.3.4')
      ).rejects.toThrow('Cloudflare API POST /zones/test-zone-id/dns_records → 500:');
    });
  });
});