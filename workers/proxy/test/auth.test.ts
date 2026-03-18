import { describe, it, expect, beforeEach } from 'vitest';
import { validateAuth } from '../src/auth';

/**
 * Mock KV store for testing.
 * Simulates Cloudflare KV get() with an in-memory Map.
 */
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => store.set(key, value),
    clear: () => store.clear(),
  };
}

const mockKV = createMockKV();
const PROXY_SECRET = 'test-proxy-auth-secret-for-jwt-signing';

describe('validateAuth', () => {
  beforeEach(() => {
    mockKV.clear();
  });

  describe('Bearer token (API key) authentication', () => {
    it('should validate valid API key and check machine ownership', async () => {
      const ownerId = 'user_123';

      // API key hash — the Worker computes SHA-256 of the raw key
      // For testing we just use a predictable hash key
      const apiKeyHash = await sha256Hex('sk_live_test123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: ownerId,
        name: 'Test API Key',
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(ownerId);
      expect(result.machineInfo).toEqual({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      });
    });

    it('should reject invalid API key', async () => {
      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_invalid' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should reject when user does not own machine', async () => {
      const apiKeyHash = await sha256Hex('sk_live_test123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: 'user_123',
        name: 'Test API Key',
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: 'user_456', // different owner
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });

  describe('JWT cookie authentication', () => {
    it('should validate valid JWT cookie', async () => {
      const ownerId = 'user_123';
      const jwt = await createTestJWT(ownerId, PROXY_SECRET);

      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Cookie': `__justavps_proxy=${jwt}` },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(ownerId);
    });

    it('should reject invalid JWT', async () => {
      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Cookie': '__justavps_proxy=not-a-valid-jwt' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
    });

    it('should reject expired JWT', async () => {
      const ownerId = 'user_123';
      const jwt = await createTestJWT(ownerId, PROXY_SECRET, -3600); // expired 1h ago

      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Cookie': `__justavps_proxy=${jwt}` },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('JWT expired');
    });
  });

  describe('Query parameter authentication', () => {
    it('should validate token from ?token= query param', async () => {
      const ownerId = 'user_123';
      const jwt = await createTestJWT(ownerId, PROXY_SECRET);

      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request(`https://abc123.kortix.cloud?token=${jwt}`);

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(ownerId);
    });
  });

  describe('No authentication', () => {
    it('should reject requests without any auth', async () => {
      const request = new Request('https://abc123.kortix.cloud');

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication required');
    });
  });

  describe('Machine state validation', () => {
    it('should reject when machine does not exist', async () => {
      const apiKeyHash = await sha256Hex('sk_live_test123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: 'user_123',
        name: 'Test API Key',
      }));
      // No machine:{slug} entry

      const request = new Request('https://nonexistent.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const result = await validateAuth(request, 'nonexistent', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Machine not found');
    });

    it('should reject deleted machines', async () => {
      const ownerId = 'user_123';
      const apiKeyHash = await sha256Hex('sk_live_test123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: ownerId,
        name: 'Test API Key',
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'deleted',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Machine is deleted');
    });
  });
});

// ─── Test helpers ──────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function createTestJWT(sub: string, secret: string, expiresInSeconds = 86400): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    sub,
    iat: now,
    exp: now + expiresInSeconds,
  }));

  const sigInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigInput));
  const sigB64 = base64UrlEncode(sig);

  return `${sigInput}.${sigB64}`;
}

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
