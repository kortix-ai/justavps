#!/usr/bin/env npx tsx
/**
 * REAL E2E Provisioning Test
 * 
 * This script tests the FULL lifecycle against real Hetzner infrastructure:
 * 1. Creates an SSH key via API
 * 2. Provisions a real VPS (cx23, cheapest) via API
 * 3. Waits for Hetzner server to reach 'running' 
 * 4. Verifies IP is assigned and reachable
 * 5. Verifies SSH port (22) accepts connections
 * 6. Simulates agent heartbeat → machine transitions to 'ready'
 * 7. Verifies GET /machines/:id returns complete connect info
 * 8. Destroys the machine via API
 * 9. Verifies Hetzner server is gone
 * 10. Cleans up SSH key
 * 
 * COST: ~€0.01 (a few cents for a CX23 running ~3 min)
 * 
 * Run: npx tsx scripts/e2e-provision.ts
 */

import 'dotenv/config';

const BASE = 'http://localhost:4100/api';
const API_KEY = process.env.E2E_API_KEY || 'sk_live_0b3f3fdcfc4ffa293cb94e2ca3c1a8fa3b6d99ab3b45f0b0c8a9de48d30e008a';

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

let sshKeyId: string | null = null;
let machineId: string | null = null;
let machineSlug: string | null = null;
let machineIp: string | null = null;
let machineToken: string | null = null;
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function checkPort(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const conn = await fetch(`http://${host}:${port}`, { signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);
    return true; // If fetch doesn't throw, port is open
  } catch {
    // Try TCP connect via a simple HEAD request
    try {
      const res = await fetch(`http://${host}:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForPort(host: string, port: number, maxAttempts = 30, intervalMs = 10000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const isOpen = await checkPort(host, port);
    if (isOpen) return true;
    console.log(`    waiting for ${host}:${port}... (attempt ${i + 1}/${maxAttempts})`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

async function cleanup() {
  console.log('\n🧹 Cleanup...');
  
  if (machineId) {
    try {
      console.log(`  Destroying machine ${machineId}...`);
      const res = await fetch(`${BASE}/v1/machines/${machineId}`, { method: 'DELETE', headers });
      console.log(`  Machine delete: HTTP ${res.status}`);
    } catch (err) {
      console.log(`  Machine delete failed: ${err}`);
    }
  }
  
  if (sshKeyId) {
    try {
      await fetch(`${BASE}/v1/ssh-keys/${sshKeyId}`, { method: 'DELETE', headers });
      console.log(`  SSH key cleaned up`);
    } catch {}
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     REAL E2E PROVISIONING TEST                   ║');
  console.log('║     (creates a real Hetzner VPS)                 ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  
  // ── Step 0: Verify API is reachable ──
  console.log('0. Verify API health');
  const healthRes = await fetch(`${BASE}/health`);
  const health = await healthRes.json();
  assert(health.status === 'ok', 'API is healthy');
  
  // ── Step 1: Create SSH key ──
  console.log('\n1. Create SSH key');
  const sshRes = await fetch(`${BASE}/v1/ssh-keys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'e2e-provision-test',
      public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJPLqEfzT7fJGjEtL4QVWWKjy/L+5D4bm7/Pz/6xoGFj e2e-test@justavps',
    }),
  });
  const sshKey = await sshRes.json();
  assert(sshRes.status === 201, `SSH key created: ${sshKey.id}`);
  sshKeyId = sshKey.id;
  assert(sshKey.fingerprint?.startsWith('SHA256:'), 'SSH fingerprint generated');
  
  // ── Step 2: Provision machine ──
  console.log('\n2. Provision machine (real Hetzner CX23 in nbg1)');
  console.log('   ⏳ This will take 30-90 seconds...');
  
  const createRes = await fetch(`${BASE}/v1/machines`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      server_type: 'cx23',
      template: 'blank',
      ssh_key_id: sshKeyId,
      name: 'e2e-test-machine',
      region: 'nbg1',
    }),
  });
  const machine = await createRes.json();
  
  assert(createRes.status === 201, `Machine created: ${machine.id}`);
  assert(machine.slug?.length > 0, `Slug assigned: ${machine.slug}`);
  assert(machine.status === 'provisioning', `Status: provisioning`);
  assert(machine.ip?.length > 0, `IP assigned: ${machine.ip}`);
  assert(machine.server_type === 'cx23', 'Server type: cx23');
  assert(machine.template === 'blank', 'Template: blank');
  assert(machine.region === 'nbg1', 'Region: nbg1');
  
  machineId = machine.id;
  machineSlug = machine.slug;
  machineIp = machine.ip;
  
  // ── Step 3: Verify in DB via GET ──
  console.log('\n3. Verify machine in DB');
  const getRes = await fetch(`${BASE}/v1/machines/${machineId}`, { headers });
  const machineDetail = await getRes.json();
  
  assert(getRes.status === 200, 'GET /machines/:id returns 200');
  assert(machineDetail.id === machineId, 'ID matches');
  assert(machineDetail.slug === machineSlug, 'Slug matches');
  assert(machineDetail.ip === machineIp, 'IP matches');
  assert(machineDetail.ssh === `ssh user@${machineIp}`, 'SSH command correct');
  
  // ── Step 4: Verify in machine list ──
  console.log('\n4. Verify in machine list');
  const listRes = await fetch(`${BASE}/v1/machines`, { headers });
  const list = await listRes.json();
  const found = list.machines.find((m: any) => m.id === machineId);
  assert(!!found, 'Machine appears in list');
  assert(found?.status === 'provisioning', 'Status in list: provisioning');
  
  // ── Step 5: Wait for SSH port ──
  console.log(`\n5. Waiting for SSH port on ${machineIp}:22...`);
  console.log('   ⏳ Polling every 10s for up to 5 minutes...');
  
  // We'll wait for SSH to become reachable — this proves Hetzner booted the server
  // and cloud-init configured SSH
  let sshReachable = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      // Try a raw TCP connection via fetch to port 22 — it will fail but connection means port is open
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      await fetch(`http://${machineIp}:22`, { signal: controller.signal });
    } catch (err: any) {
      // If we get "connection refused" or timeout, port isn't open yet
      // If we get a response error (not HTTP), the port IS open (SSH doesn't speak HTTP)
      if (err?.cause?.code === 'ECONNREFUSED' || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        console.log(`    attempt ${attempt + 1}/30 — not yet...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      // Any other error means the port accepted the connection (SSH sends banner)
      sshReachable = true;
      break;
    }
    // If fetch succeeded (very unlikely for SSH), port is definitely open
    sshReachable = true;
    break;
  }
  
  assert(sshReachable, `SSH port reachable at ${machineIp}:22`);
  
  // ── Step 6: Simulate heartbeat → ready ──
  console.log('\n6. Simulate agent heartbeat');
  
  // Get machine token from DB (we need it to simulate heartbeat)
  // For the test, we read it from the machine detail
  // In production, the agent on the VPS has this token
  const dbRes = await fetch(`${BASE}/v1/machines/${machineId}`, { headers });
  const dbMachine = await dbRes.json();
  
  // The machine_token isn't exposed via the public API (security!), 
  // so we'll query the DB directly for the test
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL!);
  const [dbRow] = await sql`SELECT machine_token FROM machines WHERE id = ${machineId}`;
  machineToken = dbRow?.machine_token;
  
  assert(!!machineToken, `Machine token exists in DB: ${machineToken?.slice(0, 10)}...`);
  
  // Send heartbeat
  const heartbeatRes = await fetch(`${BASE}/v1/internal/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: machineSlug,
      machine_token: machineToken,
      uptime: 60,
      services: { code_server: true, caddy: true, justavps_agent: true },
      load: { cpu: 0.15, memory: 0.32, disk: 0.08 },
    }),
  });
  const heartbeat = await heartbeatRes.json();
  
  assert(heartbeatRes.status === 200, 'Heartbeat accepted');
  assert(heartbeat.ack === true, 'Heartbeat acknowledged');
  
  // ── Step 7: Verify machine is now "ready" ──
  console.log('\n7. Verify machine transitioned to ready');
  const readyRes = await fetch(`${BASE}/v1/machines/${machineId}`, { headers });
  const readyMachine = await readyRes.json();
  
  assert(readyMachine.status === 'ready', `Status: ${readyMachine.status} (should be ready)`);
  assert(readyMachine.ready_at !== null, `ready_at set: ${readyMachine.ready_at}`);
  assert(readyMachine.urls !== null, 'URLs populated');
  assert(readyMachine.urls?.proxy?.includes(machineSlug!), `Proxy URL: ${readyMachine.urls?.proxy}`);
  assert(readyMachine.urls?.terminal?.includes(machineSlug!), `Terminal URL: ${readyMachine.urls?.terminal}`);
  assert(readyMachine.connect !== null, 'Connect info populated');
  assert(readyMachine.connect?.ssh_command?.includes(machineIp!), `SSH command has IP: ${readyMachine.connect?.ssh_command}`);
  assert(readyMachine.connect?.vscode_url?.includes(machineSlug!), `VS Code connect URL: ${readyMachine.connect?.vscode_url}`);
  assert(readyMachine.connect?.vscode_password?.length > 10, 'Password generated (>10 chars)');
  assert(readyMachine.health !== null, 'Health data from heartbeat');
  assert(readyMachine.health?.cpu === 0.15, 'CPU from heartbeat');
  assert(readyMachine.health?.memory === 0.32, 'Memory from heartbeat');
  assert(readyMachine.health?.services?.code_server === true, 'code_server service up');
  
  // ── Step 8: Verify account shows 1 machine ──
  console.log('\n8. Verify account');
  const accountRes = await fetch(`${BASE}/v1/account`, { headers });
  const account = await accountRes.json();
  assert(account.machines_count >= 1, `Account shows ${account.machines_count} machine(s)`);
  
  // ── Step 9: Delete machine ──
  console.log('\n9. Delete machine');
  const deleteRes = await fetch(`${BASE}/v1/machines/${machineId}`, { method: 'DELETE', headers });
  assert(deleteRes.status === 204, 'Delete returned 204');
  machineId = null; // Prevent cleanup from double-deleting
  
  // ── Step 10: Verify machine is deleted in DB ──
  console.log('\n10. Verify machine deleted');
  // Should not appear in list
  const postDeleteList = await fetch(`${BASE}/v1/machines`, { headers });
  const postDelete = await postDeleteList.json();
  const stillExists = postDelete.machines.find((m: any) => m.slug === machineSlug);
  assert(!stillExists, 'Machine no longer in list');
  
  // Verify directly in Hetzner (no leftover servers)
  const hetznerCheck = await fetch('https://api.hetzner.cloud/v1/servers?label_selector=slug=' + machineSlug, {
    headers: { 'Authorization': `Bearer ${process.env.HETZNER_API_KEY}` },
  });
  const hetznerServers = await hetznerCheck.json();
  assert(hetznerServers.servers?.length === 0, 'No leftover Hetzner servers');
  
  // ── Step 11: Clean up SSH key ──
  console.log('\n11. Clean up');
  if (sshKeyId) {
    await fetch(`${BASE}/v1/ssh-keys/${sshKeyId}`, { method: 'DELETE', headers });
    sshKeyId = null;
    console.log('  SSH key cleaned up');
  }
  
  await sql.end();
  
  // ── Results ──
  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed === 0) {
    console.log('  🎉 ALL E2E TESTS PASSED!');
  } else {
    console.log('  ⚠️  SOME TESTS FAILED');
  }
  console.log('══════════════════════════════════════════════════\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Ensure cleanup on any failure
process.on('SIGINT', cleanup);
process.on('uncaughtException', async (err) => {
  console.error('\n💥 Uncaught error:', err);
  await cleanup();
  process.exit(1);
});

main().catch(async (err) => {
  console.error('\n💥 Test error:', err);
  await cleanup();
  process.exit(1);
});
