/* eslint-disable @typescript-eslint/no-explicit-any */
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
      const accountId = 'acct_123';

      // API key hash — the Worker computes SHA-256 of the raw key
      // For testing we just use a predictable hash key
        const apiKeyHash = await sha256Hex('sk_live_test123');
        mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
         account_id: accountId,
         name: 'Test API Key',
        }));
        mockKV.set('machine:abc123', JSON.stringify({
         account_id: accountId,
         ip: '1.2.3.4',
         status: 'ready',
         server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_test123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.accountId).toBe(accountId);
      expect(result.machineInfo).toEqual({
        account_id: accountId,
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
        account_id: 'acct_123',
        name: 'Test API Key',
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_456', // different account
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
      const userId = 'user_123';
      const accountId = 'acct_123';
      const jwt = await createTestJWT(userId, accountId, PROXY_SECRET);

      mockKV.set('machine:abc123', JSON.stringify({
        account_id: accountId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Cookie': `__justavps_proxy=${jwt}` },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.accountId).toBe(accountId);
    });

    it('should reject invalid JWT', async () => {
      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Cookie': '__justavps_proxy=not-a-valid-jwt' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.authSource).toBe('cookie'); // must propagate source for stale cookie clearing
    });

    it('should reject expired JWT', async () => {
      const jwt = await createTestJWT('user_123', 'acct_123', PROXY_SECRET, -3600); // expired 1h ago

      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
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
      expect(result.authSource).toBe('cookie'); // must propagate source for stale cookie clearing
    });

    it('should propagate authSource=cookie on ownership failure (stale user token)', async () => {
      const jwt = await createTestJWT('user_old', 'acct_old', PROXY_SECRET);

      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_new', // machine now belongs to different account
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Cookie': `__justavps_proxy=${jwt}` },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
      expect(result.authSource).toBe('cookie'); // worker uses this to clear the stale cookie
    });
  });

  describe('Query parameter authentication', () => {
    it('should validate token from ?token= query param', async () => {
      const userId = 'user_123';
      const accountId = 'acct_123';
      const jwt = await createTestJWT(userId, accountId, PROXY_SECRET);

      mockKV.set('machine:abc123', JSON.stringify({
        account_id: accountId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request(`https://abc123.kortix.cloud?token=${jwt}`);

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.accountId).toBe(accountId);
    });
  });

  describe('Query token priority over stale cookie', () => {
    it('should use ?token= over cookie when both present (fresh token wins over stale cookie)', async () => {
      const userId = 'user_123';
      const correctJwt = await createTestJWT(userId, 'acct_123', PROXY_SECRET);
      const staleJwt = await createTestJWT('user_other', 'acct_other', PROXY_SECRET); // cookie has wrong account

      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      // Cookie has wrong user, ?token= has correct user
      const request = new Request(`https://abc123.kortix.cloud?token=${correctJwt}`, {
        headers: { 'Cookie': `__justavps_proxy=${staleJwt}` },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.accountId).toBe('acct_123');
      expect(result.authSource).toBe('querytoken');
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
        account_id: 'acct_123',
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
      const accountId = 'acct_123';
      const apiKeyHash = await sha256Hex('sk_live_test123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: accountId,
        name: 'Test API Key',
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: accountId,
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

  describe('Proxy token authentication (pt_xxx)', () => {
    it('should validate proxy token via X-Proxy-Token header', async () => {
      const ownerId = 'user_123';
      const ptToken = 'pt_test123456789abcdef';
      const ptHash = await sha256Hex(ptToken);

      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: ownerId,
        machine_id: 'machine-uuid-1',
        machine_slug: 'abc123',
        ports: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'X-Proxy-Token': ptToken },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.authSource).toBe('proxytoken');
      expect(result.proxyTokenData).toBeTruthy();
      expect(result.proxyTokenData!.machine_slug).toBe('abc123');
    });

    it('should validate proxy token via ?__proxy_token= query param', async () => {
      const ownerId = 'user_123';
      const ptToken = 'pt_querytoken123';
      const ptHash = await sha256Hex(ptToken);

      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: ownerId,
        machine_id: 'machine-uuid-1',
        machine_slug: 'abc123',
        ports: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request(`https://abc123.kortix.cloud?__proxy_token=${ptToken}`);

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.proxyTokenData).toBeTruthy();
    });

    it('should validate proxy token via __justavps_pt cookie', async () => {
      const ownerId = 'user_123';
      const ptToken = 'pt_cookietoken123';
      const ptHash = await sha256Hex(ptToken);

      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: ownerId,
        machine_id: 'machine-uuid-1',
        machine_slug: 'abc123',
        ports: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Cookie': `__justavps_pt=${ptToken}` },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.authSource).toBe('proxycookie');
    });

    it('should reject expired proxy token', async () => {
      const ptToken = 'pt_expired123';
      const ptHash = await sha256Hex(ptToken);

      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: 'acct_123',
        machine_id: 'machine-uuid-1',
        machine_slug: 'abc123',
        ports: null,
        expires_at: new Date(Date.now() - 3600_000).toISOString(), // expired 1h ago
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'X-Proxy-Token': ptToken },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Proxy token has expired');
    });

    it('should reject proxy token for wrong machine', async () => {
      const ptToken = 'pt_wrongmachine123';
      const ptHash = await sha256Hex(ptToken);

      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: 'acct_123',
        machine_id: 'machine-uuid-1',
        machine_slug: 'other-machine', // different slug
        ports: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'X-Proxy-Token': ptToken },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Proxy token is not valid for this machine');
    });

    it('should reject proxy token when port is restricted and not allowed', async () => {
      const ptToken = 'pt_portrestricted123';
      const ptHash = await sha256Hex(ptToken);

      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: 'acct_123',
        machine_id: 'machine-uuid-1',
        machine_slug: 'abc123',
        ports: [3000, 8080], // only these ports allowed
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'X-Proxy-Token': ptToken },
      });

      // Port 5000 is NOT in the allowed list
      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET, 5000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Proxy token does not allow port 5000');
    });

    it('should allow proxy token when port is in allowed list', async () => {
      const ptToken = 'pt_portallowed123';
      const ptHash = await sha256Hex(ptToken);

      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: 'acct_123',
        machine_id: 'machine-uuid-1',
        machine_slug: 'abc123',
        ports: [3000, 8080],
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'X-Proxy-Token': ptToken },
      });

      // Port 3000 IS in the allowed list
      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET, 3000);

      expect(result.success).toBe(true);
    });

    it('should not require machine ownership for proxy token auth', async () => {
      const ptToken = 'pt_noownership123';
      const ptHash = await sha256Hex(ptToken);

      // Proxy token owner is user_123, but machine owner is user_456
      // This should STILL work — proxy tokens bypass ownership checks
      mockKV.set(`pt:${ptHash}`, JSON.stringify({
        account_id: 'acct_123',
        machine_id: 'machine-uuid-1',
        machine_slug: 'abc123',
        ports: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_456', // different account — doesn't matter for proxy tokens
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'X-Proxy-Token': ptToken },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
    });
  });

  describe('API key expiration', () => {
    it('should reject expired API key', async () => {
      const apiKeyHash = await sha256Hex('sk_live_expired123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: 'acct_123',
        name: 'Expired Key',
        expires_at: new Date(Date.now() - 3600_000).toISOString(), // expired 1h ago
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_expired123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API key has expired');
    });

    it('should accept non-expired API key with expires_at', async () => {
      const ownerId = 'user_123';
      const apiKeyHash = await sha256Hex('sk_live_valid_expiry123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: ownerId,
        name: 'Valid Key',
        expires_at: new Date(Date.now() + 86400_000).toISOString(), // expires in 24h
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_valid_expiry123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
    });
  });

  describe('API key permissions', () => {
    it('should reject API key without proxy permission', async () => {
      const apiKeyHash = await sha256Hex('sk_live_noproxy123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: 'acct_123',
        name: 'Read-only Key',
        permissions: ['read'],  // no 'proxy' permission
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_noproxy123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API key does not have proxy permission');
    });

    it('should accept API key with wildcard permission', async () => {
      const ownerId = 'user_123';
      const apiKeyHash = await sha256Hex('sk_live_wildcard123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: ownerId,
        name: 'Wildcard Key',
        permissions: ['*'],
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_wildcard123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
    });

    it('should accept API key with explicit proxy permission', async () => {
      const ownerId = 'user_123';
      const apiKeyHash = await sha256Hex('sk_live_proxy123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: ownerId,
        name: 'Proxy Key',
        permissions: ['read', 'proxy'],
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        account_id: ownerId,
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_proxy123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
    });
  });

  describe('API key machine scope', () => {
    it('should reject a machine-scoped key for a different machine_id', async () => {
      const apiKeyHash = await sha256Hex('sk_live_scope_denied123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: 'acct_123',
        name: 'Scoped Key',
        scope: 'machine',
        machine_ids: ['machine-uuid-allowed'],
        permissions: ['proxy'],
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        machine_id: 'machine-uuid-other',
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_scope_denied123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API key does not have access to this machine');
    });

    it('should accept a machine-scoped key for the allowed machine_id', async () => {
      const apiKeyHash = await sha256Hex('sk_live_scope_allowed123');
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        account_id: 'acct_123',
        name: 'Scoped Key',
        scope: 'machine',
        machine_ids: ['machine-uuid-allowed'],
        permissions: ['proxy'],
      }));
      mockKV.set('machine:abc123', JSON.stringify({
        machine_id: 'machine-uuid-allowed',
        account_id: 'acct_123',
        ip: '1.2.3.4',
        status: 'ready',
        server_type: 'cx22',
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: { 'Authorization': 'Bearer sk_live_scope_allowed123' },
      });

      const result = await validateAuth(request, 'abc123', mockKV as any, PROXY_SECRET);

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('acct_123');
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

async function createTestJWT(sub: string, accountId: string, secret: string, expiresInSeconds = 86400): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    sub,
    account_id: accountId,
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
