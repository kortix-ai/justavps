#!/usr/bin/env npx tsx
/**
 * ═══════════════════════════════════════════════════════════════════════
 *  JustAVPS — Full End-to-End Test
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Tests the complete flow: user → machine → provision → SSH → tunnel → auth → cleanup
 *
 * Usage:
 *   npx tsx scripts/e2e-full.ts
 *   SKIP_CLEANUP=1 npx tsx scripts/e2e-full.ts
 *
 * Cost: ~$0.01 (cpx22 for ~5 min)
 * Time: ~5-8 minutes
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, chmodSync } from 'fs';
import { db } from '../src/server/db';
import { users, apiKeys } from '../src/server/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword, generateApiKey } from '../src/server/lib/crypto';
import { signProxyToken } from '../src/server/lib/proxy-token';

// ─── Config ─────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL || 'http://localhost:4100';
const API = `${BASE}/api`;
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === '1';
const HETZNER_TOKEN = process.env.HETZNER_API_KEY || '';

// ─── State ──────────────────────────────────────────────────────────────────

let apiKey = '';
let userId = '';
let machineId = '';
let machineSlug = '';
let machineIp = '';
let sshKeyFile = '';
let jwt = '';
let pass = 0, fail = 0, total = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function log(msg: string) { console.log(`\x1b[36m[E2E]\x1b[0m ${msg}`); }
function ok(name: string) { total++; pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
function bad(name: string, detail?: string) { total++; fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` (${detail})` : ''}`); }
function skipped(name: string) { total++; console.log(`  \x1b[33m⊘\x1b[0m ${name} (skipped)`); }

function assertEq(name: string, expected: string, actual: string) {
  expected === actual ? ok(name) : bad(name, `expected='${expected}' got='${actual}'`);
}
function assertContains(name: string, haystack: string, needle: string) {
  haystack.includes(needle) ? ok(name) : bad(name, `missing '${needle}'`);
}
function assertNotEmpty(name: string, val: string) {
  val ? ok(name) : bad(name, 'empty');
}

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}

async function apiDelete(path: string): Promise<number> {
  const res = await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  return res.status;
}

function ssh(cmd: string, timeout = 10): string | null {
  if (!sshKeyFile || !machineIp) return null;
  try {
    return execSync(
      `ssh -i ${sshKeyFile} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=${timeout} root@${machineIp} '${cmd.replace(/'/g, "'\\''")}'`,
      { timeout: (timeout + 5) * 1000, encoding: 'utf8' },
    ).trim();
  } catch { return null; }
}

function dig(hostname: string): string {
  try {
    return execSync(`dig +short ${hostname}`, { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0] || '';
  } catch { return ''; }
}

function curlCode(url: string, opts = ''): string {
  try {
    return execSync(`curl -s -o /dev/null --max-time 10 -w "%{http_code}" ${opts} "${url}"`, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch { return '000'; }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

async function cleanup() {
  if (machineId && !SKIP_CLEANUP) {
    log('Cleaning up...');
    await apiDelete(`/v1/machines/${machineId}`).catch(() => {});
    // Fallback: Hetzner direct delete
    if (machineSlug && HETZNER_TOKEN) {
      try {
        const res = await fetch(`https://api.hetzner.cloud/v1/servers?label_selector=slug=${machineSlug}`, {
          headers: { Authorization: `Bearer ${HETZNER_TOKEN}` },
        });
        const data = await res.json() as any;
        for (const srv of data.servers || []) {
          await fetch(`https://api.hetzner.cloud/v1/servers/${srv.id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${HETZNER_TOKEN}` },
          });
        }
      } catch {}
    }
  }
  if (sshKeyFile) try { unlinkSync(sshKeyFile); } catch {}

  // Clean up test user
  if (userId) {
    try {
      await db.delete(apiKeys).where(eq(apiKeys.ownerId, userId));
      await db.delete(users).where(eq(users.id, userId));
    } catch {}
  }
}

process.on('SIGINT', async () => { await cleanup(); process.exit(1); });
process.on('uncaughtException', async (err) => { console.error(err); await cleanup(); process.exit(1); });

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log('\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[36m  JustAVPS — Full End-to-End Test\x1b[0m');
  console.log('\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m');
  console.log();

  // Check server is running
  const serverCheck = curlCode(`${BASE}/`);
  if (serverCheck !== '200') {
    console.error(`Server not running at ${BASE} (HTTP ${serverCheck}). Run: npm run dev`);
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 1: Create test user + API key (directly in DB)
  // ═══════════════════════════════════════════════════════════════════════

  log('Phase 1: Test User Setup');

  const testEmail = `e2e-${Date.now()}@test.justavps.com`;
  const passwordHash = await hashPassword('TestPass123!');
  const [user] = await db.insert(users).values({
    email: testEmail,
    passwordHash,
    name: 'E2E Test',
  }).returning();
  userId = user.id;
  assertNotEmpty('User created', userId);

  const { key, hash, prefix } = await generateApiKey();
  await db.insert(apiKeys).values({ ownerId: userId, name: 'e2e', keyPrefix: prefix, keyHash: hash });
  apiKey = key;
  assertNotEmpty('API key created', apiKey);

  // Verify API works
  const machinesList = await api('/v1/machines');
  assertEq('API authenticates', 'true', String(Array.isArray(machinesList.machines)));

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 2: Deploy Machine
  // ═══════════════════════════════════════════════════════════════════════

  console.log();
  log('Phase 2: Deploy Machine');

  const createResp = await api('/v1/machines', {
    provider: 'hetzner',
    server_type: 'cpx22',
    region: 'hel1',
    name: 'e2e-full-test',
  });

  if (createResp.requires_checkout) {
    console.log('\x1b[33mStripe checkout required — set STRIPE_SECRET_KEY="" in .env\x1b[0m');
    await cleanup();
    process.exit(0);
  }

  machineId = createResp.id || '';
  machineSlug = createResp.slug || '';
  assertNotEmpty('Machine ID', machineId);
  assertNotEmpty('Machine slug', machineSlug);
  assertEq('Status = provisioning', 'provisioning', createResp.status);

  // SSH key
  const pk = createResp.ssh_key?.private_key;
  if (pk) {
    sshKeyFile = `/tmp/e2e_ssh_${machineSlug}`;
    writeFileSync(sshKeyFile, pk.endsWith('\n') ? pk : pk + '\n', { mode: 0o600 });
    ok('SSH key saved');
  } else {
    bad('SSH key extraction');
  }

  log(`  slug=${machineSlug} id=${machineId.slice(0, 8)}...`);

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 3: Wait for Ready
  // ═══════════════════════════════════════════════════════════════════════

  console.log();
  log('Phase 3: Provisioning (up to 5 min)...');

  const start = Date.now();
  let status = '';
  while (Date.now() - start < 300_000) {
    const d = await api(`/v1/machines/${machineId}`);
    status = d.status || '';
    if (d.ip && !machineIp) { machineIp = d.ip; log(`  IP: ${machineIp}`); }
    if (status === 'ready') { log(`  Ready! (${Math.round((Date.now() - start) / 1000)}s)`); break; }
    if (status === 'error') { bad('Provisioning (error)'); break; }
    process.stdout.write(`\r  [${Math.round((Date.now() - start) / 1000)}s] ${status}   `);
    await sleep(10_000);
  }
  process.stdout.write('\n');
  assertEq('Machine ready', 'ready', status);
  assertNotEmpty('Has IP', machineIp);

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 4: SSH + Cloud-Init
  // ═══════════════════════════════════════════════════════════════════════

  console.log();
  log('Phase 4: SSH + Cloud-Init (up to 6 min)...');

  let sshOk = false;
  for (let i = 0; i < 36; i++) {
    if (ssh('echo OK') === 'OK') { sshOk = true; log(`  SSH up (${i * 10}s)`); break; }
    await sleep(10_000);
  }
  assertEq('SSH connects', 'true', String(sshOk));

  if (sshOk) {
    // Cloud-init
    let ciDone = false;
    for (let i = 0; i < 36; i++) {
      const cs = ssh('cloud-init status 2>/dev/null | grep -o "done\\|running\\|error"') || '?';
      if (cs === 'done') { ciDone = true; log(`  Cloud-init done (${i * 10}s)`); break; }
      if (cs === 'error') { bad('Cloud-init error'); break; }
      await sleep(10_000);
    }
    assertEq('Cloud-init done', 'true', String(ciDone));

    // Services
    for (const svc of ['code-server', 'docker', 'justavps-daemon', 'cloudflared']) {
      assertEq(`${svc} running`, 'active', ssh(`systemctl is-active ${svc}`) || 'inactive');
    }

    // Daemon health
    const dh = ssh('curl -sf http://localhost:7777/health');
    assertContains('Daemon /health', dh || '', '"status":"ok"');

    // code-server local (may return 302 redirect to /login or 200)
    const csLocal = ssh('curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/') || '000';
    assertEq('code-server local', 'true', String(csLocal === '302' || csLocal === '200'));

    // Config
    const cfgSlug = ssh('cat /etc/justavps/config.json | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get(\'slug\',\'\'))"') || '';
    assertEq('Config slug', machineSlug, cfgSlug);

    // Firewall
    assertContains('Firewall active', ssh('ufw status | head -1') || '', 'active');
  } else {
    for (const t of ['Cloud-init', 'code-server', 'docker', 'justavps-daemon', 'cloudflared', 'Daemon /health', 'code-server local', 'Config slug', 'Firewall']) {
      skipped(t);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 5: Tunnel + DNS
  // ═══════════════════════════════════════════════════════════════════════

  console.log();
  log('Phase 5: Tunnel + DNS');

  let dnsOk = false;
  for (let i = 0; i < 12; i++) {
    if (dig(`${machineSlug}.kortix.cloud`)) { dnsOk = true; ok(`DNS resolves`); break; }
    await sleep(5_000);
  }
  if (!dnsOk) bad('DNS not resolved after 60s');

  // Tunnel health
  if (process.env.CLOUDFLARE_TUNNEL_ID) {
    try {
      const tr = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${process.env.CLOUDFLARE_TUNNEL_ID}`,
        { headers: { 'X-Auth-Key': process.env.CLOUDFLARE_GLOBAL_API_KEY!, 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL! } },
      );
      const td = await tr.json() as any;
      assertEq('Tunnel healthy', 'healthy', td.result?.status || '');
    } catch { skipped('Tunnel health'); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 6: Proxy Auth
  // ═══════════════════════════════════════════════════════════════════════

  console.log();
  log('Phase 6: Proxy Auth');

  const proxyUrl = `https://${machineSlug}.kortix.cloud`;

  // Generate JWT
  try {
    jwt = await signProxyToken(userId);
  } catch { jwt = ''; }

  if (jwt) {
    // No auth → blocked
    const na = curlCode(proxyUrl);
    if (na === '401' || na === '302') ok(`No auth → ${na}`);
    else if (na === '000') bad('No auth → connection failed');
    else bad(`No auth → ${na} (expected 401/302)`);

    // JWT cookie → code-server
    assertEq('JWT cookie → 200', '200', curlCode(`${proxyUrl}/login`, `-b "__justavps_proxy=${jwt}"`));

    // Page content
    try {
      const body = execSync(`curl -s --max-time 10 -b "__justavps_proxy=${jwt}" "${proxyUrl}/login"`, { encoding: 'utf8', timeout: 15000 });
      assertContains('code-server page', body, 'code-server');
    } catch { bad('code-server page'); }

    // Auth header
    assertEq('Auth header → 200', '200', curlCode(`${proxyUrl}/login`, `-H "Authorization: Bearer ${jwt}"`));

    // Token param
    assertEq('Token param → 200', '200', curlCode(`${proxyUrl}/login?token=${jwt}`));
  } else {
    for (const t of ['No auth', 'JWT cookie', 'code-server page', 'Auth header', 'Token param']) {
      skipped(t);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 7: Platform API
  // ═══════════════════════════════════════════════════════════════════════

  console.log();
  log('Phase 7: Platform API');

  const list = await api('/v1/machines');
  assertEq('GET /machines lists machine', 'true', String((list.machines || []).some((m: any) => m.slug === machineSlug)));

  const get = await api(`/v1/machines/${machineId}`);
  assertEq('GET /machines/:id correct', machineSlug, get.slug || '');

  const imgs = await api('/v1/images');
  assertEq('GET /images empty', '0', String((imgs.images || []).length));

  assertEq('Images 404', '404', curlCode(`${API}/v1/images/00000000-0000-0000-0000-000000000000`, `-H "Authorization: Bearer ${apiKey}"`));
  assertEq('Unauth → 401', '401', curlCode(`${API}/v1/machines`));

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 8: Cleanup
  // ═══════════════════════════════════════════════════════════════════════

  console.log();
  if (SKIP_CLEANUP) {
    log('Cleanup SKIPPED');
    log(`  SSH: ssh -i ${sshKeyFile} root@${machineIp}`);
    log(`  URL: ${proxyUrl}`);
    machineId = ''; // prevent trap cleanup
  } else {
    log('Phase 8: Cleanup');
    const dc = await apiDelete(`/v1/machines/${machineId}`);
    assertContains('Delete machine', String(dc), '20');
    machineId = '';
  }

  // ═══════════════════════════════════════════════════════════════════════

  await cleanup();

  console.log();
  console.log('\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m');
  if (fail === 0) {
    console.log(`  \x1b[32mALL ${pass} TESTS PASSED\x1b[0m (${total} total)`);
  } else {
    console.log(`  \x1b[31m${fail} FAILED\x1b[0m, \x1b[32m${pass} passed\x1b[0m (${total} total)`);
  }
  console.log('\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m');
  console.log();

  process.exit(fail);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await cleanup();
  process.exit(1);
});
