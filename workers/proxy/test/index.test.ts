import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/index';

/**
 * Mock KV store for Worker integration tests.
 */
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    set: (key: string, value: string) => store.set(key, value),
    clear: () => store.clear(),
  };
}

const PROXY_SECRET = 'test-proxy-auth-secret-for-jwt-signing';
const PLATFORM_URL = 'https://justavps.com';
const BROKER_ORIGIN = 'http://broker.kortix-dev.cloud';

const mockKV = createMockKV();
const mockEnv: Env = {
  KV: mockKV as any,
  PROXY_AUTH_SECRET: PROXY_SECRET,
  PLATFORM_URL,
  BROKER_ORIGIN,
  BROKER_SHARED_SECRET: 'test-broker-secret',
  ENVIRONMENT: 'test',
};
const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

let savedFetch: typeof globalThis.fetch;

describe('Worker integration — broker proxy', () => {
  beforeEach(() => {
    mockKV.clear();
    savedFetch = globalThis.fetch;

    // Setup test data: API key + machine
    // Use the real SHA-256 hash of 'sk_live_test123'
    setupTestData();
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  async function setupTestData() {
    const hash = await sha256Hex('sk_live_test123');
    mockKV.set(`apikey:${hash}`, JSON.stringify({
      owner_id: 'user_123',
      name: 'Test API Key',
    }));
    mockKV.set('machine:abc123', JSON.stringify({
      owner_id: 'user_123',
      ip: '10.0.0.1',
      status: 'ready',
      server_type: 'cx22',
    }));
  }

  describe('hostname validation', () => {
    it('should reject invalid hostnames', async () => {
      const request = new Request('https://invalid.domain.com');
      const response = await worker.fetch(request, mockEnv, mockCtx);
      expect(response.status).toBe(400);
      const body = await response.json() as any;
      expect(body.error).toBe('Invalid hostname');
    });

    it('should reject www subdomain', async () => {
      const request = new Request('https://www.kortix.cloud');
      const response = await worker.fetch(request, mockEnv, mockCtx);
      expect(response.status).toBe(400);
    });
  });

  describe('CORS preflight', () => {
    it('should handle OPTIONS request without authentication', async () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });
      const response = await worker.fetch(request, mockEnv, mockCtx);
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    });
  });

  describe('authentication + broker proxy', () => {
    it('should proxy authenticated request through the broker', async () => {
      // Wait for async setup
      await setupTestData();

      // Mock the outgoing fetch (Worker -> broker)
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('OpenCode response', { status: 200 }),
      );

      const request = new Request('https://abc123.kortix.cloud/api/test', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      // Verify the Worker fetched the shared broker.
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BROKER_ORIGIN}/_broker_proxy`,
        expect.objectContaining({ method: 'GET' }),
      );

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const forwardedHeaders = fetchCall[1].headers;
      expect(forwardedHeaders.get('X-Kortix-Target-IP')).toBe('10.0.0.1');
      expect(forwardedHeaders.get('X-Kortix-Target-Port')).toBe('80');
      expect(forwardedHeaders.get('X-Kortix-Target-Path')).toBe('/api/test');
    });

    it('should proxy port subdomain through daemon port proxy on port 80', async () => {
      await setupTestData();

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('app response', { status: 200 }),
      );

      const request = new Request('https://3000.abc123.kortix.cloud/app', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      // Non-default ports are encoded into the target path for the broker.
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BROKER_ORIGIN}/_broker_proxy`,
        expect.objectContaining({ method: 'GET' }),
      );

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers.get('X-Kortix-Target-Path')).toBe('/_port/3000/app');
    });

    it('should proxy PORT--SLUG format through daemon port proxy', async () => {
      await setupTestData();

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('opencode ui', { status: 200 }),
      );

      const request = new Request('https://3456--abc123.kortix.cloud/', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(200);
      // Non-default ports are encoded into the target path for the broker.
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BROKER_ORIGIN}/_broker_proxy`,
        expect.objectContaining({ method: 'GET' }),
      );

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers.get('X-Kortix-Target-Path')).toBe('/_port/3456');
    });

    it('should sign broker headers with original host information', async () => {
      await setupTestData();

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('ok', { status: 200 }),
      );

      const request = new Request('https://abc123.kortix.cloud/path', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      await worker.fetch(request, mockEnv, mockCtx);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const forwardedHeaders = fetchCall[1].headers;
      expect(forwardedHeaders.get('X-Kortix-Original-Host')).toBe('abc123.kortix.cloud');
      expect(forwardedHeaders.get('X-Kortix-Signature')).toBeTruthy();
    });

    it('should redirect browser requests to login on auth failure', async () => {
      const request = new Request('https://abc123.kortix.cloud/dashboard', {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0',
        },
      });

      const response = await worker.fetch(request, mockEnv, mockCtx);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location') || '';
      expect(location).toContain('justavps.com');
      expect(location).toContain('proxy-auth');
    });

    it('should return 401 for API requests without auth', async () => {
      const request = new Request('https://abc123.kortix.cloud/api/test');
      const response = await worker.fetch(request, mockEnv, mockCtx);
      expect(response.status).toBe(401);
    });

    it('should return 401 for nonexistent machine', async () => {
      await setupTestData();

      const request = new Request('https://nonexistent.kortix.cloud/api/test', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const response = await worker.fetch(request, mockEnv, mockCtx);
      expect(response.status).toBe(401);
    });
  });

  describe('error handling', () => {
    it('should handle KV errors gracefully (returns auth failure)', async () => {
      const brokenEnv: Env = {
        KV: { get: vi.fn().mockRejectedValue(new Error('KV Error')) } as any,
        PROXY_AUTH_SECRET: PROXY_SECRET,
        PLATFORM_URL,
        BROKER_ORIGIN,
        BROKER_SHARED_SECRET: 'test-broker-secret',
        ENVIRONMENT: 'test',
      };

      const request = new Request('https://abc123.kortix.cloud/api/test', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const response = await worker.fetch(request, brokenEnv, mockCtx);
      // KV error manifests as auth failure (can't verify key) — returns 401, not 500
      expect(response.status).toBe(401);
    });
  });
});

// ─── Helper ─────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
