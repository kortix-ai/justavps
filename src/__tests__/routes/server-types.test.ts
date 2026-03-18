/**
 * Tests for server-types API route.
 * Uses the provider-based system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serverTypesApp } from '@/server/routes/v1/server-types';
import * as providers from '@/server/lib/providers';

vi.mock('@/server/lib/providers', () => ({
  getProvider: vi.fn(),
  listProviders: vi.fn(() => [{ name: 'cloud', displayName: 'JustAVPS Cloud' }]),
  isProviderAvailable: vi.fn(() => true),
}));

const mockListServerTypes = vi.fn();
const mockListRegions = vi.fn();

describe('server-types API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (providers.getProvider as any).mockReturnValue({
      name: 'cloud',
      displayName: 'JustAVPS Cloud',
      listServerTypes: mockListServerTypes,
      listRegions: mockListRegions,
    });
    (providers.isProviderAvailable as any).mockReturnValue(true);
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
      providerPriceMonthly: 11.99,
      priceMonthly: 30,
      region: 'hel1',
    },
    {
      name: 'ccx23',
      description: 'CCX23 - 4 vCPU, 16 GB RAM',
      cores: 4,
      memory: 16,
      disk: 160,
      cpuType: 'dedicated' as const,
      architecture: 'x86' as const,
      providerPriceMonthly: 23.99,
      priceMonthly: 60,
      region: 'hel1',
    },
  ];

  describe('GET /api/v1/server-types', () => {
    it('should return server_types array', async () => {
      mockListServerTypes.mockResolvedValueOnce(mockServerTypes);
      const req = new Request('http://localhost/?region=hel1');
      const res = await serverTypesApp.request(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('server_types');
      expect(Array.isArray(data.server_types)).toBe(true);
    });

    it('should require region parameter', async () => {
      const req = new Request('http://localhost/');
      const res = await serverTypesApp.request(req);
      expect(res.status).toBe(400);
    });

    it('should return server types with correct structure', async () => {
      mockListServerTypes.mockResolvedValueOnce(mockServerTypes);
      const req = new Request('http://localhost/?region=hel1');
      const res = await serverTypesApp.request(req);
      const data = await res.json();
      data.server_types.forEach((st: any) => {
        expect(st).toHaveProperty('name');
        expect(st).toHaveProperty('description');
        expect(st).toHaveProperty('vcpu');
        expect(st).toHaveProperty('ram_gb');
        expect(st).toHaveProperty('disk_gb');
        expect(st).toHaveProperty('cpu_type');
        expect(st).toHaveProperty('architecture');
        expect(st).toHaveProperty('price_monthly');
        expect(st).toHaveProperty('available');
      });
    });

    it('should handle empty server types list', async () => {
      mockListServerTypes.mockResolvedValueOnce([]);
      const req = new Request('http://localhost/?region=hel1');
      const res = await serverTypesApp.request(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.server_types).toEqual([]);
    });

    it('should include provider and region in response', async () => {
      mockListServerTypes.mockResolvedValueOnce(mockServerTypes);
      const req = new Request('http://localhost/?region=nbg1');
      const res = await serverTypesApp.request(req);
      const data = await res.json();
      expect(data.region).toBe('nbg1');
      expect(data.provider).toBe('cloud');
    });
  });
});
