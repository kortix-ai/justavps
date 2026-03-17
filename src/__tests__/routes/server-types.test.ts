/**
 * Tests for server-types API route (CCX dedicated only).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serverTypesApp } from '@/server/routes/v1/server-types';
import { hetznerClient } from '@/server/lib/hetzner';

// Mock the hetzner client
vi.mock('@/server/lib/hetzner');

const mockHetznerClient = hetznerClient as any;

describe('server-types API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockServerTypes = [
    {
      name: 'ccx13',
      description: 'CCX13 - 2 vCPU, 8 GB RAM',
      cores: 2,
      memory: 8,
      disk: 80,
      cpuType: 'dedicated' as const,
      architecture: 'x86' as const,
      priceMonthlyHetzner: 11.99,
      priceMonthlyOurs: 30,
      location: 'hel1'
    },
    {
      name: 'ccx23',
      description: 'CCX23 - 4 vCPU, 16 GB RAM',
      cores: 4,
      memory: 16,
      disk: 160,
      cpuType: 'dedicated' as const,
      architecture: 'x86' as const,
      priceMonthlyHetzner: 23.99,
      priceMonthlyOurs: 60,
      location: 'hel1'
    },
    {
      name: 'ccx33',
      description: 'CCX33 - 8 vCPU, 32 GB RAM',
      cores: 8,
      memory: 32,
      disk: 240,
      cpuType: 'dedicated' as const,
      architecture: 'x86' as const,
      priceMonthlyHetzner: 47.99,
      priceMonthlyOurs: 120,
      location: 'hel1'
    }
  ];

  describe('GET /api/v1/server-types', () => {
    it('should return server_types array (flat, no featured/more split)', async () => {
      mockHetznerClient.listServerTypes.mockResolvedValueOnce(mockServerTypes);

      const req = new Request('http://localhost/');
      const res = await serverTypesApp.request(req);

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data).toHaveProperty('region');
      expect(data).toHaveProperty('server_types');
      expect(Array.isArray(data.server_types)).toBe(true);
    });

    it('should only include CCX types', async () => {
      const mixedTypes = [
        ...mockServerTypes,
        {
          name: 'cx22',
          description: 'CX22 - shared',
          cores: 2,
          memory: 4,
          disk: 40,
          cpuType: 'shared' as const,
          architecture: 'x86' as const,
          priceMonthlyHetzner: 4.05,
          priceMonthlyOurs: 11,
          location: 'hel1',
        },
      ];
      mockHetznerClient.listServerTypes.mockResolvedValueOnce(mixedTypes);

      const req = new Request('http://localhost/');
      const res = await serverTypesApp.request(req);
      const data = await res.json();

      const names = data.server_types.map((t: any) => t.name);
      expect(names).not.toContain('cx22');
      expect(names).toContain('ccx13');
      expect(names).toContain('ccx23');
      expect(names).toContain('ccx33');
    });

    it('should default to hel1 region', async () => {
      mockHetznerClient.listServerTypes.mockResolvedValueOnce(mockServerTypes);

      const req = new Request('http://localhost/');
      await serverTypesApp.request(req);
      
      expect(mockHetznerClient.listServerTypes).toHaveBeenCalledWith('hel1');
    });

    it('should use correct region parameter', async () => {
      mockHetznerClient.listServerTypes.mockResolvedValueOnce(mockServerTypes);

      const req = new Request('http://localhost/?region=ash');
      await serverTypesApp.request(req);
      
      expect(mockHetznerClient.listServerTypes).toHaveBeenCalledWith('ash');
    });

    it('should reject invalid region', async () => {
      const req = new Request('http://localhost/?region=invalid');
      const res = await serverTypesApp.request(req);
      
      expect(res.status).toBe(400);
    });

    it('should include backup_price_monthly for each type', async () => {
      mockHetznerClient.listServerTypes.mockResolvedValueOnce(mockServerTypes);

      const req = new Request('http://localhost/');
      const res = await serverTypesApp.request(req);
      const data = await res.json();

      data.server_types.forEach((st: any) => {
        expect(st).toHaveProperty('backup_price_monthly');
        expect(typeof st.backup_price_monthly).toBe('number');
        expect(st.backup_price_monthly).toBeGreaterThan(0);
      });
    });

    it('should return server types with correct structure', async () => {
      mockHetznerClient.listServerTypes.mockResolvedValueOnce(mockServerTypes);

      const req = new Request('http://localhost/');
      const res = await serverTypesApp.request(req);
      const data = await res.json();

      data.server_types.forEach((serverType: any) => {
        expect(serverType).toHaveProperty('name');
        expect(serverType).toHaveProperty('description');
        expect(serverType).toHaveProperty('vcpu');
        expect(serverType).toHaveProperty('ram_gb');
        expect(serverType).toHaveProperty('disk_gb');
        expect(serverType).toHaveProperty('cpu_type');
        expect(serverType).toHaveProperty('architecture');
        expect(serverType).toHaveProperty('price_monthly');
        expect(serverType).toHaveProperty('hetzner_price_monthly');
        expect(serverType).toHaveProperty('available');

        const mockType = mockServerTypes.find(m => m.name === serverType.name);
        if (mockType) {
          expect(serverType.price_monthly).toBe(mockType.priceMonthlyOurs);
          expect(serverType.hetzner_price_monthly).toBe(mockType.priceMonthlyHetzner);
          expect(serverType.vcpu).toBe(mockType.cores);
          expect(serverType.ram_gb).toBe(mockType.memory);
          expect(serverType.disk_gb).toBe(mockType.disk);
          expect(serverType.cpu_type).toBe(mockType.cpuType);
        }
      });
    });

    it('should handle API errors gracefully', async () => {
      mockHetznerClient.listServerTypes.mockRejectedValueOnce(new Error('Hetzner API error'));

      const req = new Request('http://localhost/');
      const res = await serverTypesApp.request(req);

      expect(res.status).toBe(500);
      
      const data = await res.json();
      expect(data.error).toBe(true);
      expect(data.message).toBe('Failed to fetch server types');
    });

    it('should handle empty server types list', async () => {
      mockHetznerClient.listServerTypes.mockResolvedValueOnce([]);

      const req = new Request('http://localhost/');
      const res = await serverTypesApp.request(req);

      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.server_types).toEqual([]);
    });

    it('should include region in response', async () => {
      mockHetznerClient.listServerTypes.mockResolvedValueOnce(mockServerTypes);

      const req = new Request('http://localhost/?region=nbg1');
      const res = await serverTypesApp.request(req);
      const data = await res.json();

      expect(data.region).toBe('nbg1');
    });
  });
});
