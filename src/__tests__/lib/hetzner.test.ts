/**
 * Tests for Hetzner client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hetznerClient, _resetSnapshotCache } from '@/server/lib/hetzner';

// Mock fetch globally
global.fetch = vi.fn();

describe('hetznerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as any).mockReset();
    _resetSnapshotCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveSnapshot', () => {
    it('should return snapshot from API call', async () => {
      // Mock API call
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          images: [{
            id: 123,
            description: 'justavps-base-v1.0',
            created: '2024-01-01T00:00:00Z',
            disk_size: 20,
            architecture: 'x86'
          }]
        })
      });

      const result = await hetznerClient.resolveSnapshot();
      expect(result.snapshotId).toBe('123');
      expect(result.diskSize).toBe(20);
      expect(result.architecture).toBe('x86');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should filter and sort snapshots by description pattern', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          images: [
            {
              id: 123,
              description: 'justavps-base-v1.0',
              created: '2024-01-01T00:00:00Z',
              disk_size: 20,
              architecture: 'x86'
            },
            {
              id: 456,
              description: 'other-snapshot',
              created: '2024-01-02T00:00:00Z',
              disk_size: 25,
              architecture: 'x86'
            },
            {
              id: 789,
              description: 'justavps-base-v2.0',
              created: '2024-01-02T00:00:00Z',
              disk_size: 30,
              architecture: 'x86'
            }
          ]
        })
      });

      const result = await hetznerClient.resolveSnapshot();
      
      // Should pick the newest justavps-base snapshot (v2.0)
      expect(result.snapshotId).toBe('789');
      expect(result.diskSize).toBe(30);
      expect(result.architecture).toBe('x86');
    });

    it('should fallback to ubuntu-24.04 when no snapshots found', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          images: []
        })
      });

      const result = await hetznerClient.resolveSnapshot();
      
      expect(result.snapshotId).toBe('ubuntu-24.04');
      expect(result.diskSize).toBe(20);
      expect(result.architecture).toBe('x86');
    });
  });

  describe('listServerTypes', () => {
    beforeEach(() => {
      // Each test needs fresh mock setup since they're being called multiple times
      (fetch as any).mockClear();
    });

    const setupMocks = () => {
      // Mock snapshot resolution first
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          images: [{
            id: 123,
            description: 'justavps-base-v1.0',
            created: '2024-01-01T00:00:00Z',
            disk_size: 20,
            architecture: 'x86'
          }]
        })
      });
      
      // Then mock server types API
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          server_types: [
            {
              id: 1,
              name: 'cx22',
              description: 'CX22 - 2 vCPU, 4 GB RAM',
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{
                location: 'nbg1',
                price_hourly: { net: '0.0052', gross: '0.0062' },
                price_monthly: { net: '3.40', gross: '4.05' }
              }],
              cpu_type: 'shared',
              architecture: 'x86'
            },
            {
              id: 2,
              name: 'cpx31',
              description: 'CPX31 - 4 vCPU, 8 GB RAM',
              cores: 4,
              memory: 8,
              disk: 160,
              prices: [{
                location: 'nbg1',
                price_hourly: { net: '0.0119', gross: '0.0142' },
                price_monthly: { net: '7.80', gross: '9.28' }
              }],
              cpu_type: 'shared',
              architecture: 'x86'
            },
            {
              id: 3,
              name: 'invalid-prefix',
              description: 'Invalid server type',
              cores: 1,
              memory: 2,
              disk: 20,
              prices: [{
                location: 'nbg1',
                price_hourly: { net: '0.0026', gross: '0.0031' },
                price_monthly: { net: '1.70', gross: '2.02' }
              }],
              cpu_type: 'shared',
              architecture: 'x86'
            }
          ]
        })
      });
    };

    it('should return filtered and sorted server types', async () => {
      setupMocks();
      
      const result = await hetznerClient.listServerTypes();
      
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('cx22');
      expect(result[1].name).toBe('cpx31');
      
      // Should not include invalid-prefix
      expect(result.find(r => r.name === 'invalid-prefix')).toBeUndefined();
    });

    it('should apply markup pricing correctly', async () => {
      setupMocks();
      
      const result = await hetznerClient.listServerTypes();
      
      const cx22 = result.find(r => r.name === 'cx22');
      expect(cx22?.priceMonthlyHetzner).toBe(4.05);
      expect(cx22?.priceMonthlyOurs).toBe(Math.ceil(4.05 * 2.5)); // 11
      
      const cpx31 = result.find(r => r.name === 'cpx31');
      expect(cpx31?.priceMonthlyHetzner).toBe(9.28);
      expect(cpx31?.priceMonthlyOurs).toBe(Math.ceil(9.28 * 2.5)); // 24
    });

    it('should sort by price ascending', async () => {
      setupMocks();
      
      const result = await hetznerClient.listServerTypes();
      
      // Should be sorted by Hetzner price (4.05 < 9.28)
      expect(result[0].priceMonthlyHetzner).toBeLessThan(result[1].priceMonthlyHetzner);
    });

    it('should filter by location', async () => {
      setupMocks();
      
      const result = await hetznerClient.listServerTypes('nbg1');
      
      // All results should have the requested location
      result.forEach(type => {
        expect(type.location).toBe('nbg1');
      });
    });
  });

  describe('createServer', () => {
    it('should send correct payload and wait for running state', async () => {
      const mockServer = {
        id: 12345,
        name: 'test-server',
        status: 'running',
        public_net: {
          ipv4: { ip: '192.168.1.100' },
          ipv6: { ip: '2001:db8::1' }
        },
        server_type: { name: 'cx22' },
        labels: {}
      };

      // Mock create server response
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ server: mockServer })
        })
        // Mock wait for status check
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ server: mockServer })
        })
        // Mock re-fetch for IP
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ server: mockServer })
        });

      const result = await hetznerClient.createServer({
        name: 'test-server',
        serverType: 'cx22',
        image: '123',
        location: 'nbg1',
        userData: '#!/bin/bash\necho hello',
        sshKeyIds: [1, 2],
        labels: { project: 'test' },
        firewallId: 456
      });

      expect(result).toEqual({
        serverId: 12345,
        publicIp: '192.168.1.100'
      });

      // Check create server API call was made
      expect(fetch).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/servers',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
      
      // Check the body contains expected data
      const createCall = (fetch as any).mock.calls.find((call: any) => 
        call[0] === 'https://api.hetzner.cloud/v1/servers' && 
        call[1].method === 'POST'
      );
      expect(createCall).toBeTruthy();
      const body = JSON.parse(createCall[1].body);
      expect(body.name).toBe('test-server');
      expect(body.server_type).toBe('cx22');
      expect(body.image).toBe(123);
    });

    it('should handle string image names', async () => {
      const mockServer = {
        id: 12345,
        name: 'test-server',
        status: 'running',
        public_net: { ipv4: { ip: '192.168.1.100' }, ipv6: { ip: '2001:db8::1' } },
        server_type: { name: 'cx22' },
        labels: {}
      };

      (fetch as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ server: mockServer }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ server: mockServer }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ server: mockServer }) });

      await hetznerClient.createServer({
        name: 'test-server',
        serverType: 'cx22',
        image: 'ubuntu-24.04',
        location: 'nbg1',
        userData: '',
        sshKeyIds: [],
        labels: {}
      });

      const createCall = (fetch as any).mock.calls.find((call: any) => 
        call[0] === 'https://api.hetzner.cloud/v1/servers' && 
        call[1].method === 'POST'
      );
      expect(createCall).toBeTruthy();
      const body = JSON.parse(createCall[1].body);
      expect(body.image).toBe('ubuntu-24.04'); // Should remain string
    });
  });

  describe('deleteServer', () => {
    it('should call delete API', async () => {
      (fetch as any).mockResolvedValueOnce({ ok: true, status: 204 });

      await hetznerClient.deleteServer(12345);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/servers/12345',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('rebootServer', () => {
    it('should call reboot action API', async () => {
      (fetch as any).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await hetznerClient.rebootServer(12345);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/servers/12345/actions/reboot',
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
  });

  describe('resizeServer', () => {
    it('should call change_type action with upgrade_disk', async () => {
      (fetch as any).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await hetznerClient.resizeServer(12345, 'cx32');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.hetzner.cloud/v1/servers/12345/actions/change_type',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            server_type: 'cx32',
            upgrade_disk: true
          })
        })
      );
    });
  });

  describe('waitForStatus', () => {
    it('should poll until target status is reached', async () => {
      (fetch as any).mockClear();
      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ server: { status: 'initializing' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ server: { status: 'starting' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ server: { status: 'running' } })
        });

      await hetznerClient.waitForStatus(12345, 'running', 10000);

      expect(fetch).toHaveBeenCalledTimes(3);
    }, 15000); // Increase test timeout

    it('should timeout if status not reached', async () => {
      (fetch as any).mockClear();
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ server: { status: 'initializing' } })
      });

      await expect(
        hetznerClient.waitForStatus(12345, 'running', 100)
      ).rejects.toThrow("Server 12345 did not reach 'running' within 0.1s");
    });
  });

  describe('error handling', () => {
    it('should throw error for API failures', async () => {
      (fetch as any).mockClear();
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"Unauthorized"}')
      });

      await expect(hetznerClient.deleteServer(12345)).rejects.toThrow(
        'Hetzner API DELETE /servers/12345 → 401: {"error":"Unauthorized"}'
      );
    });

    it('should handle network timeouts', async () => {
      (fetch as any).mockClear();
      (fetch as any).mockRejectedValueOnce(new Error('Fetch timeout'));

      await expect(hetznerClient.deleteServer(12345)).rejects.toThrow('Fetch timeout');
    });

    it('should handle empty response text on error', async () => {
      (fetch as any).mockClear();
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('Cannot read response'))
      });

      await expect(hetznerClient.deleteServer(12345)).rejects.toThrow(
        'Hetzner API DELETE /servers/12345 → 500:'
      );
    });
  });
});