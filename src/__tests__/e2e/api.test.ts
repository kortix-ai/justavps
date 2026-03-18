/**
 * E2E API tests — hit the live dev server on port 4100 with real DB.
 * These tests require:
 *   1. Docker Postgres running on port 54330
 *   2. Dev server running on port 4100
 *   3. Seeded test user with API key
 *
 * Run: npx vitest run src/__tests__/e2e/
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = 'http://localhost:4100/api';
let API_KEY = '';
let serverAvailable = false;

// Resolve API key from DB before tests
beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      console.warn('Dev server not running on port 4100 — skipping E2E API tests');
      return;
    }
    serverAvailable = true;
  } catch {
    console.warn('Dev server not reachable — skipping E2E API tests');
    return;
  }

  const keysRes = await fetch(`${BASE_URL}/v1/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'e2e-test-key' }),
  });

  if (keysRes.ok) {
    const keyData = await keysRes.json();
    API_KEY = keyData.key;
    console.log(`[E2E] Generated API key: ${keyData.key_prefix}`);
  } else {
    API_KEY = 'sk_live_0b3f3fdcfc4ffa293cb94e2ca3c1a8fa3b6d99ab3b45f0b0c8a9de48d30e008a';
    console.log(`[E2E] Using seeded API key`);
  }
});

function authHeaders() {
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────────────────────────────────────

describe('Health', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('justavps-api');
    expect(data.timestamp).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVER TYPES (CCX dedicated only)
// ─────────────────────────────────────────────────────────────────────────────

describe('Server Types', () => {
  it('GET /v1/server-types returns server_types array', async () => {
    const res = await fetch(`${BASE_URL}/v1/server-types?region=hel1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.region).toBe('hel1');
    expect(Array.isArray(data.server_types)).toBe(true);
  });

  it('server types have correct fields', async () => {
    const res = await fetch(`${BASE_URL}/v1/server-types?region=hel1`);
    const data = await res.json();
    if (data.server_types.length === 0) return; // Hetzner API may not be configured
    const first = data.server_types[0];
    expect(first.name).toBeTruthy();
    expect(first.vcpu).toBeGreaterThan(0);
    expect(first.ram_gb).toBeGreaterThan(0);
    expect(first.disk_gb).toBeGreaterThan(0);
    expect(first.price_monthly).toBeGreaterThan(0);
    expect(['shared', 'dedicated']).toContain(first.cpu_type);
    expect(first.backup_price_monthly).toBeGreaterThan(0);
  });

  it('pricing includes provider backup pricing metadata', async () => {
    const res = await fetch(`${BASE_URL}/v1/server-types?region=hel1`);
    const data = await res.json();
    if (data.server_types.length === 0) return;
    const first = data.server_types[0];
    expect(first.provider_price_monthly).toBeGreaterThan(0);
    expect(first.price_monthly).toBeGreaterThan(first.provider_price_monthly);
    expect(first.backup_price_monthly).toBeCloseTo(first.provider_price_monthly * 0.2, 1);
  });

  it('works for multiple regions', async () => {
    for (const region of ['nbg1', 'fsn1', 'hel1', 'ash', 'hil']) {
      const res = await fetch(`${BASE_URL}/v1/server-types?region=${region}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.region).toBe(region);
    }
  });

  it('returns an empty list for unsupported regions', async () => {
    const res = await fetch(`${BASE_URL}/v1/server-types?region=invalid`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.region).toBe('invalid');
    expect(data.server_types).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SSH KEYS CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('SSH Keys', () => {
  let createdKeyId: string;

  it('POST /v1/ssh-keys creates a key', async () => {
    const res = await fetch(`${BASE_URL}/v1/ssh-keys`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'e2e-test-key',
        public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForE2ETesting0000000000000000000 e2e@test',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.name).toBe('e2e-test-key');
    expect(data.fingerprint).toMatch(/^SHA256:/);
    createdKeyId = data.id;
  });

  it('GET /v1/ssh-keys lists keys', async () => {
    const res = await fetch(`${BASE_URL}/v1/ssh-keys`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ssh_keys.length).toBeGreaterThan(0);
    const found = data.ssh_keys.find((k: any) => k.id === createdKeyId);
    expect(found).toBeTruthy();
  });

  it('rejects request without auth', async () => {
    const res = await fetch(`${BASE_URL}/v1/ssh-keys`);
    expect(res.status).toBe(401);
  });

  it('rejects request with invalid API key', async () => {
    const res = await fetch(`${BASE_URL}/v1/ssh-keys`, {
      headers: { 'Authorization': 'Bearer sk_live_invalid_key_12345' },
    });
    expect(res.status).toBe(401);
  });

  it('POST rejects missing fields', async () => {
    const res = await fetch(`${BASE_URL}/v1/ssh-keys`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'missing-key' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /v1/ssh-keys/:id deletes a key', async () => {
    const createRes = await fetch(`${BASE_URL}/v1/ssh-keys`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'to-delete',
        public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeleteMeKey000000000000000000000000000 del@test',
      }),
    });
    const created = await createRes.json();

    const delRes = await fetch(`${BASE_URL}/v1/ssh-keys/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(delRes.status).toBe(204);
  });

  it('DELETE returns 404 for nonexistent key', async () => {
    const res = await fetch(`${BASE_URL}/v1/ssh-keys/00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API KEYS CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('API Keys', () => {
  let createdKeyId: string;
  let createdKeyValue: string;

  it('POST /v1/api-keys creates a key with value shown once', async () => {
    const res = await fetch(`${BASE_URL}/v1/api-keys`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'e2e-test-api-key' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.name).toBe('e2e-test-api-key');
    expect(data.key).toMatch(/^sk_live_/);
    expect(data.key_prefix).toMatch(/^sk_live_/);
    createdKeyId = data.id;
    createdKeyValue = data.key;
  });

  it('newly created key can authenticate', async () => {
    if (!createdKeyValue) return;
    const res = await fetch(`${BASE_URL}/v1/api-keys`, {
      headers: { 'Authorization': `Bearer ${createdKeyValue}`, 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('GET /v1/api-keys lists keys WITHOUT values', async () => {
    const res = await fetch(`${BASE_URL}/v1/api-keys`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    for (const key of data.api_keys) {
      expect(key.key).toBeUndefined();
      expect(key.key_prefix).toBeTruthy();
    }
  });

  it('DELETE /v1/api-keys/:id revokes a key', async () => {
    if (!createdKeyId) return;
    const res = await fetch(`${BASE_URL}/v1/api-keys/${createdKeyId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(res.status).toBe(204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

describe('Account', () => {
  it('GET /v1/account returns user info', async () => {
    const res = await fetch(`${BASE_URL}/v1/account`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.email).toBeTruthy();
    expect(typeof data.machines_count).toBe('number');
  });

  it('GET /v1/account/usage returns usage', async () => {
    const res = await fetch(`${BASE_URL}/v1/account/usage`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.current_period).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINES
// ─────────────────────────────────────────────────────────────────────────────

describe('Machines', () => {
  it('GET /v1/machines returns array', async () => {
    const res = await fetch(`${BASE_URL}/v1/machines`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.machines)).toBe(true);
  });

  it('GET /v1/machines/:id returns 404 for nonexistent', async () => {
    const res = await fetch(`${BASE_URL}/v1/machines/00000000-0000-0000-0000-000000000000`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('POST /v1/machines rejects empty server_type', async () => {
    const res = await fetch(`${BASE_URL}/v1/machines`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ server_type: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /v1/machines rejects non-CCX server_type', async () => {
    const res = await fetch(`${BASE_URL}/v1/machines`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ server_type: 'cx22' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/reboot returns 404 for nonexistent', async () => {
    const res = await fetch(`${BASE_URL}/v1/machines/00000000-0000-0000-0000-000000000000/reboot`, {
      method: 'POST',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /:id returns 404 for nonexistent', async () => {
    const res = await fetch(`${BASE_URL}/v1/machines/00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Internal', () => {
  it('POST /v1/internal/heartbeat rejects invalid payload', async () => {
    const res = await fetch(`${BASE_URL}/v1/internal/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bad: 'data' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /v1/internal/heartbeat rejects wrong machine_token', async () => {
    const res = await fetch(`${BASE_URL}/v1/internal/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'nonexistent',
        machine_token: 'mt_wrong',
        uptime: 100,
        services: { caddy: true, docker: true, opencode_web: true, sandbox_agent: true, justavps_docker: true },
        load: { cpu: 0.1, memory: 0.5, disk: 0.3 },
      }),
    });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 HANDLING
// ─────────────────────────────────────────────────────────────────────────────

describe('404 handling', () => {
  it('returns 404 for unknown API routes', async () => {
    const res = await fetch(`${BASE_URL}/v1/nonexistent`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.message).toBe('Not found');
  });
});
