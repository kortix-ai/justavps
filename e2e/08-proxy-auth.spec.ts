/**
 * E2E: Proxy Auth + Port Forwarding — Full browser + API test.
 *
 * Tests the complete CF Worker proxy + auth flow:
 *   1. Create a machine via API + wait for ready
 *   2. Verify API key auth → 200 code-server
 *   3. Verify wrong API key → 401
 *   4. Verify no auth → 401
 *   5. Verify unauthenticated browser → 302 redirect to proxy-auth
 *   6. Verify port forwarding: daemon health on /_port/7777/health → 200 JSON
 *   7. Verify port forwarding: sandbox-agent on /_port/2468/ → 200
 *   8. Verify port forwarding: no auth on port route → 401
 *   9. Start HTTP server on port 9000, verify /_port/9000/ → 200 custom body
 *  10. Verify machine detail page in browser (proxy URL, terminal section, IP)
 *  11. Clean up
 *
 * Requires:
 *   - Dev server on port 4100
 *   - CF Worker deployed with route *.kortix.cloud/*
 *   - Hetzner + Cloudflare credentials in .env
 *   - PLATFORM_E2E=1
 *
 * Run: PLATFORM_E2E=1 npx playwright test e2e/08-proxy-auth.spec.ts
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { execSync } from 'child_process';

// ─── Config ─────────────────────────────────────────────────────────────────

const SKIP = !process.env.PLATFORM_E2E;
const API_KEY = process.env.E2E_API_KEY || '';
const PROVISION_TIMEOUT = 5 * 60_000;
const POLL_INTERVAL = 10_000;

// ─── Shared state (sequential tests, single worker) ─────────────────────────

let machineId = '';
let machineSlug = '';
let machineIp = '';
let sshKeyPath = '';

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Proxy Auth + Port Forwarding E2E', () => {
  test.skip(!!SKIP, 'Set PLATFORM_E2E=1 to run (creates real Hetzner VPS)');
  test.describe.configure({ timeout: 10 * 60_000, mode: 'serial' });

  // ═════════════════════════════════════════════════════════════════════════
  //  SETUP: Provision machine
  // ═════════════════════════════════════════════════════════════════════════

  test('01 — provision machine and wait for ready', async ({ request }) => {
    // Create machine
    const createRes = await request.post('/api/v1/machines', {
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      data: { provider: 'hetzner', server_type: 'cpx22', region: 'hel1', name: 'pw-proxy-e2e' },
    });
    expect(createRes.ok()).toBeTruthy();
    const machine = await createRes.json();
    machineId = machine.id;
    machineSlug = machine.slug;

    // Save SSH key
    if (machine.ssh_key?.private_key) {
      sshKeyPath = `/tmp/pw_ssh_${machineSlug}`;
      const fs = await import('fs');
      const key = machine.ssh_key.private_key;
      fs.writeFileSync(sshKeyPath, key.endsWith('\n') ? key : key + '\n', { mode: 0o600 });
    }

    // Poll until ready
    const start = Date.now();
    while (Date.now() - start < PROVISION_TIMEOUT) {
      const poll = await request.get(`/api/v1/machines/${machineId}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      const data = await poll.json();
      if (data.status === 'ready') { machineIp = data.ip; break; }
      if (data.status === 'error') throw new Error('Provision failed');
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    expect(machineIp).toBeTruthy();
    expect(machineSlug).toBeTruthy();

    // Wait for cloud-init to finish (SSH-based check)
    if (sshKeyPath) {
      for (let i = 0; i < 30; i++) {
        try {
          const r = execSync(
            `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 root@${machineIp} 'cloud-init status 2>/dev/null | grep -o done'`,
            { timeout: 15_000, encoding: 'utf8' },
          ).trim();
          if (r === 'done') break;
        } catch {}
        await new Promise(r => setTimeout(r, 10_000));
      }
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  AUTH TESTS (API-level, via Playwright request context)
  // ═════════════════════════════════════════════════════════════════════════

  test('02 — valid API key → 200 code-server HTML', async ({ request }) => {
    test.skip(!machineSlug, 'No machine');
    const res = await request.get(`https://${machineSlug}.kortix.cloud/`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('html');
  });

  test('03 — wrong API key → 401 "Invalid API key"', async ({ request }) => {
    test.skip(!machineSlug, 'No machine');
    const res = await request.get(`https://${machineSlug}.kortix.cloud/`, {
      headers: {
        Authorization: 'Bearer sk_live_totally_wrong_key',
        Accept: 'application/json', // Force non-browser so Worker returns 401, not 302
        'User-Agent': 'playwright-test',
      },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid API key');
  });

  test('04 — no auth → 401 "Authentication required"', async ({ request }) => {
    test.skip(!machineSlug, 'No machine');
    const res = await request.get(`https://${machineSlug}.kortix.cloud/api/anything`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'playwright-test',
      },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Authentication required');
  });

  test('05 — unauthenticated browser GET → 302 to proxy-auth', async ({ page }) => {
    test.skip(!machineSlug, 'No machine');
    // Use page.request.fetch with redirect: manual to catch the 302
    const res = await page.request.fetch(`https://${machineSlug}.kortix.cloud/`, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Playwright' },
      maxRedirects: 0,
    });
    // CF Worker returns 302 redirect to justavps.com/api/proxy-auth
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] || '';
    expect(location).toContain('/api/proxy-auth');
    expect(location).toContain(encodeURIComponent(`https://${machineSlug}.kortix.cloud/`));
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  PORT FORWARDING TESTS
  // ═════════════════════════════════════════════════════════════════════════

  test('06 — /_port/7777/health → 200 daemon health JSON', async ({ request }) => {
    test.skip(!machineSlug, 'No machine');
    const res = await request.get(`https://${machineSlug}.kortix.cloud/_port/7777/health`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.load).toBeDefined();
    expect(typeof body.load.cpu).toBe('number');
    expect(typeof body.load.memory).toBe('number');
    expect(typeof body.load.disk).toBe('number');
  });

  test('07 — /_port/2468/ → sandbox-agent responds', async ({ request }) => {
    test.skip(!machineSlug, 'No machine');
    const res = await request.get(`https://${machineSlug}.kortix.cloud/_port/2468/`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect([200, 404]).toContain(res.status()); // 404 = agent running, no route at /
  });

  test('08 — /_port/9000/ without auth → 401', async ({ request }) => {
    test.skip(!machineSlug, 'No machine');
    const res = await request.get(`https://${machineSlug}.kortix.cloud/_port/9000/`);
    expect(res.status()).toBe(401);
  });

  test('09 — start HTTP server on 9000, proxy returns custom body', async ({ request }) => {
    test.skip(!machineSlug || !sshKeyPath, 'No machine or SSH key');

    // Write + start a Python test server on port 9000
    const script = Buffer.from(
`import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"HELLO_FROM_PORT_9000")
    def log_message(self, *a): pass
http.server.HTTPServer(("0.0.0.0", 9000), H).serve_forever()
`).toString('base64');

    try {
      execSync(
        `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${machineIp} "echo ${script} | base64 -d > /tmp/srv.py && nohup python3 /tmp/srv.py &>/dev/null &"`,
        { timeout: 15_000 },
      );
    } catch {}

    // Wait for server to start
    for (let i = 0; i < 10; i++) {
      try {
        const check = execSync(
          `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${machineIp} 'curl -sf http://localhost:9000/'`,
          { timeout: 10_000, encoding: 'utf8' },
        ).trim();
        if (check === 'HELLO_FROM_PORT_9000') break;
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }

    // Now test through CF Worker proxy
    const res = await request.get(`https://${machineSlug}.kortix.cloud/_port/9000/`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toBe('HELLO_FROM_PORT_9000');
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  BROWSER UI TESTS
  // ═════════════════════════════════════════════════════════════════════════

  test('10 — machine detail page shows slug URL, IP, terminal', async ({ page }) => {
    test.skip(!machineId, 'No machine');
    await login(page);
    await page.goto(`/machines/${machineId}`);
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    await expect(body).toContainText('pw-proxy-e2e');
    await expect(body).toContainText(machineIp);
    await expect(body).toContainText(`${machineSlug}.kortix.cloud`);
    await expect(page.locator('text=Terminal')).toBeVisible();
  });

  test('11 — Open IDE link has correct kortix.cloud URL', async ({ page }) => {
    test.skip(!machineId, 'No machine');
    await login(page);
    await page.goto(`/machines/${machineId}`);
    await page.waitForLoadState('networkidle');

    const ideLink = page.locator(`a[href*="${machineSlug}.kortix.cloud"]`).first();
    if (await ideLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const href = await ideLink.getAttribute('href');
      expect(href).toContain(`https://${machineSlug}.kortix.cloud`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  CLEANUP
  // ═════════════════════════════════════════════════════════════════════════

  test('12 — delete the test machine', async ({ request }) => {
    test.skip(!machineId, 'No machine');
    const res = await request.delete(`/api/v1/machines/${machineId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect([200, 204]).toContain(res.status());

    // Clean SSH key
    if (sshKeyPath) {
      try { execSync(`rm -f ${sshKeyPath}`); } catch {}
    }
    machineId = '';
  });
});
