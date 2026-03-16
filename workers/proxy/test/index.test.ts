import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';
import { createMockKV } from '../src/auth';

// Create mock environment
const mockKV = createMockKV();
const mockEnv = { KV: mockKV as any, ENVIRONMENT: 'test' };
const mockCtx = {} as ExecutionContext;

describe('Worker integration', () => {
  beforeEach(() => {
    mockKV.clear();
    
    // Setup test data
    mockKV.set('apikey:sha256_of_sk_live_test123', JSON.stringify({
      owner_id: 'user_123',
      name: 'Test API Key'
    }));
    
    mockKV.set('machine:abc123', JSON.stringify({
      owner_id: 'user_123',
      ip: '1.2.3.4',
      status: 'running',
      server_type: 'code-server'
    }));
  });

  describe('hostname validation', () => {
    it('should reject invalid hostnames', async () => {
      const request = new Request('https://invalid.domain.com');
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe('Invalid hostname format');
    });

    it('should reject www subdomain', async () => {
      const request = new Request('https://www.kortix.cloud');
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe('Invalid hostname format');
    });
  });

  describe('CORS preflight', () => {
    it('should handle OPTIONS request without authentication', async () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST'
        }
      });
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    });
  });

  describe('authentication', () => {
    it('should authenticate with valid Bearer token', async () => {
      // Mock fetch for proxy
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('proxy response', { status: 200 })
      );

      const request = new Request('https://abc123.kortix.cloud/api/test', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://1.2.3.4:8080/api/test'
        })
      );

      // Restore fetch
      globalThis.fetch = originalFetch;
    });

    it('should redirect browser requests to login on auth failure', async () => {
      const request = new Request('https://abc123.kortix.cloud/dashboard', {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toContain('justavps.com/login');
    });

    it('should return 401 for API requests without auth', async () => {
      const request = new Request('https://abc123.kortix.cloud/api/test');
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(401);
      const body = await response.json() as any;
      expect(body.error).toBe('Authentication required');
    });

    it('should handle machine not found', async () => {
      const request = new Request('https://nonexistent.kortix.cloud/api/test', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(401);
      const body = await response.json() as any;
      expect(body.error).toBe('Machine not found or access denied');
    });
  });

  describe('hostname parsing', () => {
    it('should handle custom ports', async () => {
      // Mock fetch for proxy
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('proxy response', { status: 200 })
      );

      const request = new Request('https://3000.abc123.kortix.cloud/app', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });
      
      const response = await worker.fetch(request, mockEnv, mockCtx);
      
      expect(response.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://1.2.3.4:3000/app'
        })
      );

      // Restore fetch
      globalThis.fetch = originalFetch;
    });
  });

  describe('error handling', () => {
    it('should handle worker errors gracefully', async () => {
      // Create a request that will cause an error in the auth validation
      const mockEnvWithBrokenKV = { 
        KV: { 
          get: vi.fn().mockRejectedValue(new Error('KV Error'))
        } as any,
        ENVIRONMENT: 'test' 
      };

      const request = new Request('https://abc123.kortix.cloud/api/test', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });
      
      const response = await worker.fetch(request, mockEnvWithBrokenKV, mockCtx);
      
      expect(response.status).toBe(500);
      const body = await response.json() as any;
      expect(body.error).toBe('Internal server error');
    });
  });
});