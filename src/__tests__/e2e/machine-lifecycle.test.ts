/**
 * E2E Machine Lifecycle Test — Full infrastructure + proxy + auth test.
 *
 * This test creates a REAL Hetzner VPS, waits for it to provision, then verifies
 * the ENTIRE stack end-to-end:
 *
 *   1. Machine creation via API (provisioning → ready)
 *   2. Cloudflare DNS (proxied A record + origin A + wildcard A)
 *   3. SSH connectivity + cloud-init completion
 *   4. Platform services (OpenCode, Caddy, Docker, daemon, sandbox-agent)
 *   5. Security: no cloudflared, correct firewall, correct config (no tunnel secrets)
 *   6. CF Worker auth: unauthenticated → 302/401, wrong key → 401
 *   7. CF Worker proxy: authenticated → 200 (OpenCode via Caddy)
 *   8. Port forwarding: start custom server on port 9000, proxy via 9000--slug.kortix.cloud → 200
 *   9. Port forwarding: daemon health via 7777--slug.kortix.cloud/health → 200 JSON
 *  10. Port forwarding: sandbox-agent via 2468--slug.kortix.cloud → 200
 *  11. API contract tests (images, docker machines)
 *  12. Cleanup + deletion
 *
 * Requires:
 *   - Dev server running on port 4100
 *   - Hetzner API key, Cloudflare API key, CF KV namespace
 *   - Valid API key (set E2E_API_KEY or seed a test user)
 *   - CF Worker deployed (`cd workers/proxy && npx wrangler deploy`)
 *   - CF Worker route: *.kortix.cloud/* → kortix-cloud-proxy
 *
 * Run:  PLATFORM_E2E=1 npx vitest run --config vitest.e2e.config.ts src/__tests__/e2e/machine-lifecycle.test.ts
 *
 * Cost: ~$0.01 per run (cpx22 for ~5-7 minutes)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

// ─── Config ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:4100/api';
const HETZNER_TOKEN = process.env.HETZNER_API_KEY || '';
const SKIP_REASON = !process.env.PLATFORM_E2E
  ? 'Set PLATFORM_E2E=1 to run infrastructure tests (creates real Hetzner VPS)'
  : '';

const PROVISION_TIMEOUT = 5 * 60 * 1000; // 5 min
const CLOUD_INIT_TIMEOUT = 5 * 60 * 1000; // 5 min for fresh Ubuntu
const POLL_INTERVAL = 10_000; // 10s
const PROXY_POLL_INTERVAL = 5_000; // 5s
const PROXY_RETRIES = 12; // 12 × 5s = 60s max wait for CF Worker

// ─── State ──────────────────────────────────────────────────────────────────

let API_KEY = '';
let machineId = '';
let machineSlug = '';
let machineIp = '';
let sshKeyPath = '';
let sessionCookieHeader = '';
let sessionApiKeyId = '';

// ─── Helpers ────────────────────────────────────────────────────────────────

function headers() {
  return { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: headers() });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function apiDelete(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: headers() });
  return { status: res.status };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sshWithKey(ip: string | null, keyPath: string | null, cmd: string, timeoutSec = 10): string | null {
  if (!keyPath || !ip) return null;
  try {
    return execSync(
      `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=${timeoutSec} root@${ip} '${cmd}'`,
      { timeout: (timeoutSec + 5) * 1000, encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
}

function ssh(cmd: string, timeoutSec = 10): string | null {
  return sshWithKey(machineIp, sshKeyPath, cmd, timeoutSec);
}

function savePrivateKey(slug: string, privateKey: string): string {
  const path = `/tmp/e2e_ssh_${slug}`;
  writeFileSync(path, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`, { mode: 0o600 });
  return path;
}

function machineProxyUrl(slug: string, path = '/', port?: number): string {
  const prefix = port ? `${port}--` : '';
  return `https://${prefix}${slug}.kortix.cloud${path}`;
}

function proxyGetForSlug(slug: string, path: string, opts?: { auth?: boolean; accept?: string; port?: number }): string {
  const authHeader = opts?.auth ? `-H "Authorization: Bearer ${API_KEY}"` : '';
  const acceptHeader = opts?.accept ? `-H "Accept: ${opts.accept}"` : '';
  try {
    return execSync(
      `curl -sk -w "\\n%{http_code}" ${authHeader} ${acceptHeader} "${machineProxyUrl(slug, path, opts?.port)}"`,
      { encoding: 'utf8', timeout: 15_000 },
    ).trim();
  } catch {
    return '\n000';
  }
}

async function waitForMachineReady(targetMachineId: string, label: string) {
  const start = Date.now();
  let ip = '';

  while (Date.now() - start < PROVISION_TIMEOUT) {
    const { data } = await apiGet(`/v1/machines/${targetMachineId}`);
    if (data.status === 'ready') {
      const resolvedIp = data.ip || ip;
      console.log(`[E2E] ${label} ready: ip=${resolvedIp} (${Math.round((Date.now() - start) / 1000)}s)`);
      return { ip: resolvedIp, data };
    }
    if (data.status === 'error') {
      throw new Error(`${label} failed: ${data.provisioning_stage}`);
    }
    if (data.ip && !ip) {
      ip = data.ip;
      console.log(`[E2E] ${label} got IP: ${ip}, stage: ${data.provisioning_stage}`);
    }
    await sleep(POLL_INTERVAL);
  }

  throw new Error(`${label} did not become ready within 5 minutes`);
}

async function waitForSSHReady(ip: string, keyPath: string, label: string) {
  const attempts = Math.ceil(CLOUD_INIT_TIMEOUT / 10_000);
  for (let i = 0; i < attempts; i++) {
    if (sshWithKey(ip, keyPath, 'echo OK', 15) === 'OK') {
      console.log(`[E2E] ${label} SSH connected after ${i * 10}s`);
      return;
    }
    await sleep(10_000);
  }

  throw new Error(`${label} SSH never became reachable`);
}

async function waitForCloudInitDone(ip: string, keyPath: string, label: string) {
  const attempts = Math.ceil(CLOUD_INIT_TIMEOUT / 10_000);
  for (let i = 0; i < attempts; i++) {
    const status = sshWithKey(ip, keyPath, 'cloud-init status 2>/dev/null | grep -o "done\\|running\\|error"', 10);
    if (status === 'done') {
      console.log(`[E2E] ${label} cloud-init done after ${i * 10}s`);
      return;
    }
    if (status === 'error') {
      throw new Error(`${label} cloud-init failed: ${sshWithKey(ip, keyPath, 'tail -20 /var/log/cloud-init-output.log', 10)}`);
    }
    await sleep(10_000);
  }

  throw new Error(`${label} cloud-init did not complete in time`);
}

/** curl to CF Worker proxy (slug.kortix.cloud) with optional auth + path */
function proxyGet(path: string, opts?: { auth?: boolean; accept?: string; port?: number }): string {
  return proxyGetForSlug(machineSlug, path, opts);
}

/** Parse curl output into {body, status} */
function parseCurl(raw: string): { body: string; status: string } {
  const lines = raw.split('\n');
  const status = lines[lines.length - 1] || '000';
  const body = lines.slice(0, -1).join('\n');
  return { body, status };
}

async function createSessionBackedApiKey() {
  const baseUrl = BASE_URL.replace('/api', '');
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrfData = await csrfRes.json() as { csrfToken: string };
  const cookies = csrfRes.headers.getSetCookie?.() || [];

  const loginRes = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies.join('; '),
    },
    body: `email=e2e-prod@justavps.com&password=testpassword123&csrfToken=${csrfData.csrfToken}`,
    redirect: 'manual',
  });

  const sessionCookies = loginRes.headers.getSetCookie?.() || [];
  sessionCookieHeader = [...cookies, ...sessionCookies].join('; ');

  const createKeyRes = await fetch(`${BASE_URL}/v1/api-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookieHeader,
    },
    body: JSON.stringify({ name: `e2e-machine-lifecycle-${Date.now()}` }),
  });
  const keyData = await createKeyRes.json().catch(() => null) as { id?: string; key?: string; message?: string } | null;

  if (!createKeyRes.ok || !keyData?.key || !keyData.id) {
    throw new Error(`Failed to create E2E API key: ${keyData?.message || createKeyRes.status}`);
  }

  sessionApiKeyId = keyData.id;
  API_KEY = keyData.key;
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP_REASON) return;
  API_KEY = process.env.E2E_API_KEY || '';
  if (!API_KEY) {
    API_KEY = 'sk_live_0b3f3fdcfc4ffa293cb94e2ca3c1a8fa3b6d99ab3b45f0b0c8a9de48d30e008a';
  }
  let { status } = await apiGet('/v1/machines');
  if (status === 401) {
    console.warn('[E2E] Default API key invalid — creating one via session login');
    await createSessionBackedApiKey();
    status = (await apiGet('/v1/machines')).status;
  }
  expect(status).toBe(200);
});

afterAll(async () => {
  if (sessionApiKeyId && sessionCookieHeader) {
    await fetch(`${BASE_URL}/v1/api-keys/${sessionApiKeyId}`, {
      method: 'DELETE',
      headers: { 'Cookie': sessionCookieHeader },
    }).catch(() => {});
  }
  if (!machineId || SKIP_REASON) return;
  console.log(`[E2E] Cleaning up machine ${machineSlug} (${machineId})...`);
  await apiDelete(`/v1/machines/${machineId}`);

  if (HETZNER_TOKEN && machineSlug) {
    try {
      const res = await fetch(
        `https://api.hetzner.cloud/v1/servers?label_selector=slug=${machineSlug}`,
        { headers: { Authorization: `Bearer ${HETZNER_TOKEN}` } },
      );
      const data = await res.json() as { servers: Array<{ id: number }> };
      for (const srv of data.servers) {
        await fetch(`https://api.hetzner.cloud/v1/servers/${srv.id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${HETZNER_TOKEN}` },
        });
        console.log(`[E2E] Deleted Hetzner server ${srv.id}`);
      }
    } catch {}
  }
  if (sshKeyPath) { try { execSync(`rm -f ${sshKeyPath}`); } catch {} }
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe.skipIf(!!SKIP_REASON)('Machine Lifecycle E2E', { timeout: 15 * 60 * 1000 }, () => {

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 1: MACHINE CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('1. creates a machine from Ubuntu via API', async () => {
    const { status, data } = await apiPost('/v1/machines', {
      provider: 'hetzner',
      server_type: 'cpx22',
      region: 'hel1',
      name: 'e2e-lifecycle-test',
    });

    expect([200, 202]).toContain(status);
    if (status === 200 && data.requires_checkout) {
      console.log('[E2E] Stripe checkout required — skipping');
      return;
    }

    expect(data.id).toBeTruthy();
    expect(data.slug).toBeTruthy();
    expect(data.status).toBe('provisioning');
    expect(data.image_id).toBeNull();

    machineId = data.id;
    machineSlug = data.slug;

    // Save SSH key
    let privateKey = data.ssh_key?.private_key;
    if (!privateKey) {
      const { data: d2 } = await apiGet(`/v1/machines/${machineId}`);
      privateKey = d2?.ssh_key?.private_key;
    }
    if (privateKey) {
      sshKeyPath = savePrivateKey(machineSlug, privateKey);
      console.log(`[E2E] SSH key saved to ${sshKeyPath}`);
    }

    console.log(`[E2E] Machine created: slug=${machineSlug} id=${machineId}`);
  });

  it('2. transitions to ready within 5 minutes', async () => {
    const start = Date.now();
    while (Date.now() - start < PROVISION_TIMEOUT) {
      const { data } = await apiGet(`/v1/machines/${machineId}`);
      if (data.status === 'ready') {
        machineIp = data.ip;
        console.log(`[E2E] Machine ready: ip=${machineIp} (${Math.round((Date.now() - start) / 1000)}s)`);
        expect(data.ip).toBeTruthy();
        expect(data.connect?.vscode_url).toContain(machineSlug);
        return;
      }
      if (data.status === 'error') throw new Error(`Machine failed: ${data.provisioning_stage}`);
      if (data.ip && !machineIp) {
        machineIp = data.ip;
        console.log(`[E2E] Got IP: ${machineIp}, stage: ${data.provisioning_stage}`);
      }
      await sleep(POLL_INTERVAL);
    }
    throw new Error('Machine did not become ready within 5 minutes');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 1b: SSH KEY CLEANUP (ephemeral key deleted from Hetzner)
  // ═══════════════════════════════════════════════════════════════════════════

  it('2b. Hetzner SSH key for this machine was cleaned up after provisioning', async () => {
    if (!HETZNER_TOKEN || !machineSlug) { console.log('[E2E] No Hetzner token — skip'); return; }

    // Check that no justavps-{slug} SSH key exists in Hetzner
    // (it should have been deleted immediately after server creation)
    const res = await fetch('https://api.hetzner.cloud/v1/ssh_keys?per_page=50', {
      headers: { Authorization: `Bearer ${HETZNER_TOKEN}` },
    });
    const data = await res.json() as { ssh_keys: Array<{ id: number; name: string }> };

    const machineKeys = data.ssh_keys.filter((k) =>
      k.name === `justavps-${machineSlug}` || k.name.startsWith(`justavps-${machineSlug}-`)
    );

    console.log(`[E2E] Hetzner SSH keys for ${machineSlug}: ${machineKeys.length} found (expected 0)`);
    expect(machineKeys).toHaveLength(0);
  });

  it('2c. SSH connect still works (cloud-init key, not Hetzner key)', async () => {
    if (!sshKeyPath || !machineIp) { console.log('[E2E] No SSH key or IP — skip'); return; }

    // Wait for SSH to be reachable
    let connected = false;
    for (let i = 0; i < 15; i++) {
      if (ssh('echo OK', 15) === 'OK') { connected = true; break; }
      await sleep(10_000);
    }
    expect(connected).toBe(true);
    console.log('[E2E] SSH works after Hetzner key deletion — cloud-init key is independent ✓');
  });

  it('2d. API returns decrypted SSH key (encryption at rest is transparent)', async () => {
    // Verify the API returns a usable SSH private key, not an encrypted blob
    const { data } = await apiGet(`/v1/machines/${machineId}`);
    const privateKey = data?.ssh_key?.private_key;

    expect(privateKey).toBeTruthy();
    // Must be a valid OpenSSH private key, NOT an encrypted envelope
    expect(privateKey).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(privateKey).toContain('-----END OPENSSH PRIVATE KEY-----');
    expect(privateKey).not.toContain('enc:v1:'); // must NOT be the encrypted form

    // The setup_command should also contain the decrypted key
    const setupCommand = data?.ssh_key?.setup_command;
    expect(setupCommand).toBeTruthy();
    expect(setupCommand).not.toContain('enc:v1:');

    console.log('[E2E] API returns decrypted SSH key ✓ (encryption at rest is transparent to clients)');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 2: DNS RECORDS (Cloudflare API verification)
  // ═══════════════════════════════════════════════════════════════════════════

  it('3. Cloudflare has proxied A record for slug.kortix.cloud', async () => {
    const cfApiKey = process.env.CLOUDFLARE_GLOBAL_API_KEY;
    const cfEmail = process.env.CLOUDFLARE_EMAIL;
    const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;
    if (!cfApiKey || !cfZoneId) { console.log('[E2E] No CF creds — skip'); return; }

    const hostname = `${machineSlug}.kortix.cloud`;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records?name=${hostname}&type=A`,
      { headers: { 'X-Auth-Key': cfApiKey, 'X-Auth-Email': cfEmail || '' } },
    );
    const data = await res.json() as { result: Array<{ type: string; content: string; proxied: boolean }> };

    expect(data.result.length).toBeGreaterThan(0);
    expect(data.result[0].content).toBe(machineIp);
    expect(data.result[0].proxied).toBe(true);
    console.log(`[E2E] CF A record: ${hostname} → ${data.result[0].content} (proxied)`);
  });

  it('4. Cloudflare has DNS-only origin record for origin-slug.kortix.cloud', async () => {
    const cfApiKey = process.env.CLOUDFLARE_GLOBAL_API_KEY;
    const cfEmail = process.env.CLOUDFLARE_EMAIL;
    const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;
    if (!cfApiKey || !cfZoneId) { console.log('[E2E] No CF creds — skip'); return; }

    const origin = `origin-${machineSlug}.kortix.cloud`;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records?name=${origin}&type=A`,
      { headers: { 'X-Auth-Key': cfApiKey, 'X-Auth-Email': cfEmail || '' } },
    );
    const data = await res.json() as { result: Array<{ content: string; proxied: boolean }> };

    expect(data.result.length).toBeGreaterThan(0);
    expect(data.result[0].content).toBe(machineIp);
    expect(data.result[0].proxied).toBe(false); // DNS-only — Worker fetches this
    console.log(`[E2E] CF origin: ${origin} → ${data.result[0].content} (DNS-only)`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 3: SSH + CLOUD-INIT + SERVICES
  // ═══════════════════════════════════════════════════════════════════════════

  it('5. SSH connects and cloud-init completes', async () => {
    if (!sshKeyPath) { console.log('[E2E] No SSH key — skip'); return; }

    // Wait for SSH
    let connected = false;
    for (let i = 0; i < 30; i++) {
      if (ssh('echo OK', 15) === 'OK') { connected = true; console.log(`[E2E] SSH connected after ${i * 10}s`); break; }
      await sleep(10_000);
    }
    expect(connected).toBe(true);

    // Wait for cloud-init
    let done = false;
    for (let i = 0; i < 30; i++) {
      const s = ssh('cloud-init status 2>/dev/null | grep -o "done\\|running\\|error"', 10);
      if (s === 'done') { done = true; console.log(`[E2E] Cloud-init done after ${i * 10}s`); break; }
      if (s === 'error') { console.error('[E2E] Cloud-init failed:', ssh('tail -20 /var/log/cloud-init-output.log', 10)); break; }
      await sleep(10_000);
    }
    expect(done).toBe(true);
  });

  it('6. opencode-web active on port 3456', () => {
    if (!sshKeyPath) return;
    expect(ssh('systemctl is-active opencode-web')).toBe('active');
    expect(Number(ssh('ss -tlnp | grep 3456 | wc -l'))).toBeGreaterThan(0);
  });

  it('7. justavps-daemon handles port 80 and Caddy stays disabled', () => {
    if (!sshKeyPath) return;
    expect(ssh('systemctl is-active justavps-daemon')).toBe('active');
    expect(Number(ssh('ss -tlnp | grep 0.0.0.0:80 | wc -l'))).toBeGreaterThan(0);
    expect(ssh('systemctl is-active caddy 2>/dev/null || true')).not.toBe('active');
  });

  it('8. Docker active', () => {
    if (!sshKeyPath) return;
    expect(ssh('systemctl is-active docker')).toBe('active');
  });

  it('9. justavps-daemon active on port 7777', () => {
    if (!sshKeyPath) return;
    expect(ssh('systemctl is-active justavps-daemon')).toBe('active');
    expect(Number(ssh('ss -tlnp | grep 7777 | wc -l'))).toBeGreaterThan(0);
  });

  it('10. sandbox-agent active on port 2468', () => {
    if (!sshKeyPath) return;
    expect(ssh('systemctl is-active sandbox-agent')).toBe('active');
    expect(Number(ssh('ss -tlnp | grep 2468 | wc -l'))).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 4: SECURITY — no tunnels, correct config, correct firewall
  // ═══════════════════════════════════════════════════════════════════════════

  it('11. cloudflared service is NOT active (no tunnels)', () => {
    if (!sshKeyPath) return;
    // systemctl is-active returns "inactive" for stopped/disabled/unknown units
    // but exits non-zero, so we wrap to always exit 0
    const result = ssh('systemctl is-active cloudflared 2>/dev/null || true');
    expect(result).not.toBe('active');
  });

  it('12. platform config has no proxy_domain or proxy_auth_secret', () => {
    if (!sshKeyPath) return;
    const config = ssh('cat /etc/justavps/config.json');
    expect(config).toBeTruthy();
    const parsed = JSON.parse(config!);
    expect(parsed.slug).toBe(machineSlug);
    expect(parsed.machine_token).toBeTruthy();
    expect(parsed.callback_url).toBeTruthy();
    expect(parsed.proxy_domain).toBeUndefined();
    expect(parsed.proxy_auth_secret).toBeUndefined();
  });

  it('13. ufw allows SSH + port 80 only', () => {
    if (!sshKeyPath) return;
    const ufw = ssh('ufw status');
    expect(ufw).toContain('22/tcp');
    expect(ufw).toContain('80/tcp');
    expect(ufw).not.toContain('1024:65535/tcp');
  });

  it('14. user account exists with sudo + docker groups', () => {
    if (!sshKeyPath) return;
    const groups = ssh('id user');
    expect(groups).toContain('sudo');
    expect(groups).toContain('docker');
  });

  it('15. OpenCode service unit references port 3456', () => {
    if (!sshKeyPath) return;
    const unit = ssh('cat /etc/systemd/system/opencode-web.service 2>/dev/null');
    expect(unit).toContain('3456');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 5: CF WORKER AUTH — the real proxy auth test
  // ═══════════════════════════════════════════════════════════════════════════

  it('16. unauthenticated browser request → 302 redirect to login', async () => {
    let status = '';
    for (let i = 0; i < PROXY_RETRIES; i++) {
      const r = parseCurl(proxyGet('/', { accept: 'text/html' }));
      status = r.status;
      if (status === '302' || status === '401') break;
      await sleep(PROXY_POLL_INTERVAL);
    }
    console.log(`[E2E] Unauth browser: ${machineSlug}.kortix.cloud → ${status}`);
    expect(['302', '401']).toContain(status);
  });

  it('17. unauthenticated API request → 401 with JSON error', async () => {
    let status = '';
    let body = '';
    for (let i = 0; i < PROXY_RETRIES; i++) {
      const r = parseCurl(proxyGet('/api/test'));
      status = r.status; body = r.body;
      if (status === '401') break;
      await sleep(PROXY_POLL_INTERVAL);
    }
    console.log(`[E2E] Unauth API: ${status} ${body}`);
    expect(status).toBe('401');
    expect(body).toContain('Authentication required');
  });

  it('18. wrong API key → 401 "Invalid API key"', async () => {
    let result = '';
    try {
      result = execSync(
        `curl -sk -w "\\n%{http_code}" -H "Authorization: Bearer sk_live_wrong_key" "https://${machineSlug}.kortix.cloud/"`,
        { encoding: 'utf8', timeout: 15_000 },
      ).trim();
    } catch {}
    const { status, body } = parseCurl(result);
    console.log(`[E2E] Wrong key: ${status} ${body}`);
    expect(status).toBe('401');
    expect(body).toContain('Invalid API key');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 6: CF WORKER PROXY — authenticated traffic flows through
  // ═══════════════════════════════════════════════════════════════════════════

  it('19. authenticated request → 200 (Caddy → OpenCode)', async () => {
    let status = '';
    for (let i = 0; i < PROXY_RETRIES; i++) {
      const r = parseCurl(proxyGet('/', { auth: true }));
      status = r.status;
      if (status === '200' || status === '302') break;
      await sleep(PROXY_POLL_INTERVAL);
    }
    console.log(`[E2E] Auth proxy (default port 80): ${machineSlug}.kortix.cloud → ${status}`);
    expect(['200', '302']).toContain(status);
  });

  it('19b. proxy-auth endpoint issues JWT cookie without 500', async () => {
    // This tests the full proxy-auth flow that the browser uses:
    // 1. Login to platform (get session cookie)
    // 2. Hit /api/proxy-auth?redirect=... with session
    // 3. Should get 302 redirect with __justavps_proxy cookie, NOT 500
    const baseUrl = BASE_URL.replace('/api', '');

    // Get CSRF token
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    const csrfData = await csrfRes.json() as { csrfToken: string };
    const cookies = csrfRes.headers.getSetCookie?.() || [];

    // Login
    const loginRes = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies.join('; '),
      },
      body: `email=e2e-prod@justavps.com&password=testpassword123&csrfToken=${csrfData.csrfToken}`,
      redirect: 'manual',
    });
    const sessionCookies = loginRes.headers.getSetCookie?.() || [];
    const allCookies = [...cookies, ...sessionCookies].join('; ');

    // Hit proxy-auth with session
    const proxyAuthRes = await fetch(
      `${baseUrl}/api/proxy-auth?redirect=https://${machineSlug}.kortix.cloud/`,
      { headers: { 'Cookie': allCookies }, redirect: 'manual' },
    );

    console.log(`[E2E] proxy-auth: ${proxyAuthRes.status}`);
    // Must be a redirect (302 or 307), NOT 500
    expect([302, 307]).toContain(proxyAuthRes.status);
    const location = proxyAuthRes.headers.get('location') || '';
    expect(location).toContain(`${machineSlug}.kortix.cloud`);
    // Check the proxy cookie was set
    const setCookies = proxyAuthRes.headers.getSetCookie?.() || [];
    const proxyCookie = setCookies.find(c => c.includes('__justavps_proxy'));
    expect(proxyCookie).toBeTruthy();
    console.log(`[E2E] proxy-auth: cookie set ✓, redirect to ${location.slice(0, 50)}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 7: PORT FORWARDING — start custom server, proxy through CF Worker
  // ═══════════════════════════════════════════════════════════════════════════

  it('20. starts custom HTTP server on port 9000 via SSH', async () => {
    if (!sshKeyPath) return;
    // Write a Python server script via base64 to avoid shell escaping issues
    const script = `import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"HELLO_FROM_PORT_9000")
    def log_message(self, *a): pass
http.server.HTTPServer(("0.0.0.0", 9000), H).serve_forever()
`;
    const b64 = Buffer.from(script).toString('base64');

    // Write script via base64 decode then start server
    // Use execSync directly to avoid single-quote nesting in ssh() helper
    try {
      execSync(
        `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${machineIp} "echo ${b64} | base64 -d > /tmp/testserver.py && nohup python3 /tmp/testserver.py > /dev/null 2>&1 &"`,
        { timeout: 15_000, encoding: 'utf8' },
      );
    } catch { /* background process exits with nohup */ }

    // Wait for it to start
    let running = false;
    for (let i = 0; i < 10; i++) {
      const result = ssh('curl -sf http://localhost:9000/ 2>/dev/null || echo ""');
      if (result === 'HELLO_FROM_PORT_9000') { running = true; break; }
      await sleep(1_000);
    }
    console.log(`[E2E] Custom server on port 9000: ${running ? 'running' : 'failed to start'}`);
    expect(running).toBe(true);
  });

  it('21. 9000--slug.kortix.cloud with API key → 200 "HELLO_FROM_PORT_9000"', async () => {
    const { status, body } = parseCurl(proxyGet('/', { auth: true, port: 9000 }));
    console.log(`[E2E] Port 9000 proxy: ${status} body="${body.slice(0, 50)}"`);
    expect(status).toBe('200');
    expect(body).toContain('HELLO_FROM_PORT_9000');
  });

  it('22. 7777--slug.kortix.cloud/health with API key → 200 daemon health JSON', async () => {
    const { status, body } = parseCurl(proxyGet('/health', { auth: true, port: 7777 }));
    console.log(`[E2E] Port 7777 daemon: ${status} body="${body.slice(0, 80)}"`);
    expect(status).toBe('200');
    const json = JSON.parse(body);
    expect(json.status).toBe('ok');
    expect(json.load).toBeDefined();
  });

  it('23. 2468--slug.kortix.cloud with API key → 200 sandbox-agent', async () => {
    const { status } = parseCurl(proxyGet('/', { auth: true, port: 2468 }));
    console.log(`[E2E] Port 2468 sandbox-agent: ${status}`);
    expect(['200', '404']).toContain(status); // 404 = agent running but no route at /
  });

  it('24. 9000--slug.kortix.cloud WITHOUT auth → 401', async () => {
    const { status, body } = parseCurl(proxyGet('/', { port: 9000 }));
    console.log(`[E2E] Port 9000 no auth: ${status} ${body}`);
    expect(['401', '302']).toContain(status);
    if (status === '401') expect(body).toMatch(/auth|unauthorized|invalid/i);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 8: API CONTRACT TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  it('25. GET /images returns list', async () => {
    const { status, data } = await apiGet('/v1/images');
    expect(status).toBe(200);
    expect(Array.isArray(data.images)).toBe(true);
  });

  it('26. provisions a real Docker workload machine and verifies reachability', async () => {
    let dockerMachineId = '';
    let dockerMachineSlug = '';
    let dockerMachineIp = '';
    let dockerKeyPath = '';

    try {
      const { status, data } = await apiPost('/v1/machines', {
        provider: 'hetzner',
        server_type: 'cpx22',
        region: 'hel1',
        name: 'e2e-docker-python-http',
        docker_image: 'python:3.12-alpine',
        entrypoint: 'python',
        command: '-m http.server 8000',
      });

      expect(status).toBe(202);
      expect(data.status).toBe('provisioning');
      dockerMachineId = data.id;
      dockerMachineSlug = data.slug;

      const privateKey = data.ssh_key?.private_key || (await apiGet(`/v1/machines/${dockerMachineId}`)).data?.ssh_key?.private_key;
      expect(privateKey).toBeTruthy();
      dockerKeyPath = savePrivateKey(dockerMachineSlug, privateKey);

      const ready = await waitForMachineReady(dockerMachineId, 'Docker machine');
      dockerMachineIp = ready.ip;
      expect(dockerMachineIp).toBeTruthy();

      await waitForSSHReady(dockerMachineIp, dockerKeyPath, 'Docker machine');
      await waitForCloudInitDone(dockerMachineIp, dockerKeyPath, 'Docker machine');

      expect(sshWithKey(dockerMachineIp, dockerKeyPath, 'systemctl is-active justavps-docker')).toBe('active');
      expect(sshWithKey(dockerMachineIp, dockerKeyPath, 'docker ps --format "{{.Names}}" | grep -x justavps-workload')).toBe('justavps-workload');

      const runtime = sshWithKey(
        dockerMachineIp,
        dockerKeyPath,
        'docker inspect justavps-workload --format "{{.Path}} {{json .Args}}"',
      );
      console.log(`[E2E] Docker runtime: ${runtime}`);
      expect(runtime).toContain('python');
      expect(runtime).toContain('["-m","http.server","8000"]');

      const localResponse = sshWithKey(dockerMachineIp, dockerKeyPath, 'curl -sf http://localhost:8000/ | tr -d "\n" | head -c 120');
      console.log(`[E2E] Docker localhost:8000 body="${localResponse}"`);
      expect(localResponse).toContain('Directory listing');

      let proxied: { status: string; body: string } = { status: '000', body: '' };
      for (let i = 0; i < PROXY_RETRIES; i++) {
        proxied = parseCurl(proxyGetForSlug(dockerMachineSlug, '/', { auth: true, port: 8000 }));
        if (proxied.status === '200') break;
        await sleep(PROXY_POLL_INTERVAL);
      }
      console.log(`[E2E] Docker proxy ${dockerMachineSlug}: ${proxied.status} body="${proxied.body.slice(0, 120)}"`);
      expect(proxied.status).toBe('200');
      expect(proxied.body).toContain('Directory listing');
    } finally {
      if (dockerMachineId) {
        await apiDelete(`/v1/machines/${dockerMachineId}`);
      }
      if (dockerKeyPath) {
        try { execSync(`rm -f ${dockerKeyPath}`); } catch {}
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 8b: SSH KEY GC ENDPOINT
  // ═══════════════════════════════════════════════════════════════════════════

  it('26b. POST /internal/gc/ssh-keys cleans orphaned Hetzner keys', async () => {
    const res = await fetch(`${BASE_URL}/v1/internal/gc/ssh-keys`, { method: 'POST' });
    const data = await res.json() as { deleted: number; kept: number; total: number };

    console.log(`[E2E] SSH Key GC: deleted=${data.deleted} kept=${data.kept} total=${data.total}`);
    expect(res.status).toBe(200);
    expect(typeof data.deleted).toBe('number');
    expect(typeof data.kept).toBe('number');
    expect(typeof data.total).toBe('number');
    // After GC, total should be reasonable (well under Hetzner's 100 limit)
    expect(data.total - data.deleted).toBeLessThan(100);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PHASE 9: CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  it('27. deletes the test machine', async () => {
    const { status } = await apiDelete(`/v1/machines/${machineId}`);
    expect([204, 200]).toContain(status);
    await sleep(2_000);
    const { data } = await apiGet(`/v1/machines/${machineId}`);
    expect(['deleted', null]).toContain(data?.status ?? null);
    machineId = ''; // prevent afterAll double-delete
  });
});
