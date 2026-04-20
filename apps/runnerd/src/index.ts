import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extractPrivateIpv4, inspectInstance } from './incus/inspection.js';
import { resolveContainerImageReference, resolveVmImageReference } from './incus/images.js';
import { waitForInstance, waitForPrivateIpv4 } from './incus/instance-wait.js';
import { allocateStaticBridgeIpv4 } from './network/bridge-ip.js';
import { setupContainerProxyDevices, setupProxyDevices, setupWarmClaimProxyDevices } from './network/proxy-devices.js';
import { buildContainerCreateMetadata, buildContainerLaunchArgs } from './runtime/container/create.js';
import { buildVmCreateMetadata, buildWarmPoolPrefix, buildWarmPoolVmCreateMetadata, buildWarmPoolVmName, checkVmAgentReady } from './runtime/vm/create.js';

const execFileAsync = promisify(execFile);
const app = new Hono();

const RUNNERD_TOKEN = process.env.RUNNERD_TOKEN || '';
const RUNNERD_PORT = Number(process.env.RUNNERD_PORT || 7779);
const INCUS_REMOTE = (process.env.INCUS_REMOTE || '').trim();
const INCUS_PROJECT = (process.env.INCUS_PROJECT || '').trim();
const RUNNERD_PUBLIC_IPV4 = (process.env.RUNNERD_PUBLIC_IPV4 || '').trim() || null;
const RUNNERD_PUBLIC_IPV6 = (process.env.RUNNERD_PUBLIC_IPV6 || '').trim() || null;
const RUNNERD_STATE_DIR = '/run/justavps-runnerd';

const FAST_VM_RAW_QEMU_CONF = [
  '[device "qemu_gpu"]',
  '[device "qemu_keyboard"]',
  '[device "qemu_tablet"]',
  '[device "qemu_usb"]',
  '[device "qemu_spice-usb1"]',
  '[device "qemu_spice-usb2"]',
  '[device "qemu_spice-usb3"]',
  '[device "qemu_spice-usb-chardev1"]',
  '[device "qemu_spice-usb-chardev2"]',
  '[device "qemu_spice-usb-chardev3"]',
  '[device "qemu_spice-audio"]',
  '[device "qemu_spice-audiodev"]',
  '[device "qemu_spice"]',
  '[device "qemu_spice-chardev"]',
  '[device "qemu_spicedir"]',
  '[device "qemu_spicedir-chardev"]',
  '[device "qemu_pcie5"]',
  '[device "qemu_pcie6"]',
  '[device "qemu_pcie7"]',
  '[device "qemu_pcie8"]',
  '[device "qemu_pcie9"]',
  '[device "qemu_pcie10"]',
  '[device "qemu_pcie11"]',
  '[device "qemu_pcie12"]',
].join('\n');

mkdirSync(RUNNERD_STATE_DIR, { recursive: true });

// ─── Bucketed warm pools ───────────────────────────────────────────────────
// We maintain running reserve VMs keyed by exact vCPU count.
// This is the only fast-path reserve in the live runtime. When empty, we fall
// back to a full cold boot.
// Memory is hotplugged upward on claim; CPU cannot be hotplugged reliably, so bucket by CPU.

const DEFAULT_CPU_BUCKETS = (process.env.POOL_CPU_BUCKETS || '1,2,4,8')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const trackedCpuBuckets = new Set<number>(DEFAULT_CPU_BUCKETS);

const WARM_POOL_PER_CPU = Number(process.env.WARM_POOL_PER_CPU || 1);
const POOL_IMAGE = 'justavps-golden';
const WARM_POOL_PREFIX = buildWarmPoolPrefix();
const BASE_POOL_MEMORY_GIB = 1;     // memory hotplugged upward on claim
const BASE_POOL_DISK_GIB = 10;      // filesystem expanded upward on claim

interface PoolVM {
  name: string;
  cpu: number;
  privateIpv4: string;
  createdAt: number;
}

const warmPools = new Map<number, PoolVM[]>();
let poolReplenishing = false;

function getWarmBucket(cpu: number) {
  const arr = warmPools.get(cpu) ?? [];
  if (!warmPools.has(cpu)) warmPools.set(cpu, arr);
  return arr;
}

function poolVmName(prefix: string, cpu: number) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return buildWarmPoolVmName({ prefix, cpu, suffix: id });
}

async function isVmAgentReady(name: string): Promise<{ ready: boolean; ip: string | null }> {
  return checkVmAgentReady({
    name,
    runIncus,
    incusTarget,
    inspectInstance: ({ instanceName }) => inspectInstance({ instanceName, queryIncus }),
  });
}

async function prepareBaseVm(name: string, cpu: number): Promise<{ ip: string } | null> {
  try {
    await retryTransient(() => runIncusPty(['init', POOL_IMAGE, incusTarget(name), '--vm'], 300000), 310000);
    await waitForInstance({ instanceName: name, queryIncus, delay });
    await setIncusConfig(name, 'user.justavps.role', 'warm_pool_reserve').catch(() => {});
    await setIncusConfig(name, 'user.justavps.cpu_bucket', String(cpu)).catch(() => {});
    await applyVmBootTuning(name);
    await setIncusConfig(name, 'limits.cpu', String(cpu));
    await setIncusConfig(name, 'limits.memory', `${BASE_POOL_MEMORY_GIB}GiB`);
    await ensureRootDiskSize(name, BASE_POOL_DISK_GIB);
    await retryBusy(() => runIncus(['start', incusTarget(name)]));

    const deadline = Date.now() + 120000;
    let ip: string | null = null;
    while (Date.now() < deadline) {
      const check = await isVmAgentReady(name);
      if (check.ready && check.ip) {
        ip = check.ip;
        break;
      }
      await delay(500);
    }
    if (!ip) throw new Error('agent never became ready');

    // Pre-pin eth0 with the discovered IP so claim path avoids the 2s NIC reconfiguration penalty.
    await runIncus([
      'config', 'device', 'add', incusTarget(name), 'eth0', 'nic',
      'name=eth0', 'nictype=bridged', 'parent=incusbr0', `ipv4.address=${ip}`,
    ], 10000).catch(() => {});

    return { ip };
  } catch (err) {
    console.warn(`[pool] failed to prepare ${name}:`, err instanceof Error ? err.message : err);
    await runIncus(['delete', incusTarget(name), '--force']).catch(() => {});
    return null;
  }
}

async function createWarmVM(cpu: number): Promise<PoolVM | null> {
  const name = poolVmName(WARM_POOL_PREFIX, cpu);
  console.log(`[warm-pool] creating ${name}`);
  const prepared = await prepareBaseVm(name, cpu);
  if (!prepared) return null;
  const vm: PoolVM = { name, cpu, privateIpv4: prepared.ip, createdAt: Date.now() };
  console.log(`[warm-pool] ${name} ready ip=${prepared.ip} (cpu=${cpu})`);
  return vm;
}

async function claimWarmVM(cpu: number): Promise<PoolVM | null> {
  const bucket = getWarmBucket(cpu);
  while (bucket.length > 0) {
    const vm = bucket.shift()!;
    try {
      await runIncus(['info', incusTarget(vm.name)], 5000);
      console.log(`[warm-pool] claimed ${vm.name} (cpu=${cpu}), bucket now ${bucket.length}/${WARM_POOL_PER_CPU}`);
      replenishPools().catch(() => {});
      return vm;
    } catch {
      console.warn(`[warm-pool] dropped stale entry ${vm.name} (cpu=${cpu})`);
    }
  }
  return null;
}

async function prunePrefix(prefix: string) {
  const { stdout } = await execFileAsync('incus', ['list', '--format', 'csv', '-c', 'n'], { timeout: 15000, maxBuffer: 1024 * 1024 });
  const names = stdout.split('\n').map((s) => s.trim()).filter(Boolean).filter((n) => n.startsWith(prefix));
  for (const name of names) {
    await runIncus(['delete', incusTarget(name), '--force']).catch(() => {});
  }
}

async function replenishPools() {
  if (poolReplenishing) return;
  poolReplenishing = true;
  try {
    // Buckets are exact per requested CPU; no lying about resources.
    for (const cpu of trackedCpuBuckets) {
      const warm = getWarmBucket(cpu);
      while (warm.length < WARM_POOL_PER_CPU) {
        const vm = await createWarmVM(cpu);
        if (!vm) break;
        warm.push(vm);
      }
    }
    const warmReady = [...warmPools.values()].reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[pool] warm=${warmReady} buckets=${[...trackedCpuBuckets].join(',')}`);
  } finally {
    poolReplenishing = false;
  }
}

// ─── End pool system ───────────────────────────────────────────────────────

function incusTarget(name?: string) {
  return INCUS_REMOTE ? `${INCUS_REMOTE}:${name ?? ''}` : (name ?? '');
}

function withIncusContext(args: string[]) {
  return INCUS_PROJECT ? ['--project', INCUS_PROJECT, ...args] : args;
}

async function runIncus(args: string[], timeoutMs = 15000) {
  const { stdout, stderr } = await execFileAsync('incus', withIncusContext(args), {
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { stdout, stderr };
}

async function runIncusPty(args: string[], timeoutMs = 300000) {
  const command = `incus ${withIncusContext(args).map((arg) => JSON.stringify(arg)).join(' ')}`;
  const { stdout, stderr } = await execFileAsync('script', ['-qec', command, '/dev/null'], {
    maxBuffer: 50 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { stdout, stderr };
}

async function runIncusAllowingFailure(args: string[], timeoutMs = 300000) {
  try {
    const { stdout, stderr } = await execFileAsync('incus', withIncusContext(args), {
      maxBuffer: 50 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const details = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    if (typeof details.code === 'number') {
      return {
        stdout: details.stdout ?? '',
        stderr: details.stderr ?? (details.message ?? ''),
        exitCode: details.code,
      };
    }
    throw error;
  }
}

async function retryBusy<T>(fn: () => Promise<T>, timeoutMs = 120000): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('Instance is busy') &&
        !message.includes("ETag doesn't match") &&
        !/websocket: close 1006|unexpected EOF|connection reset/i.test(message)
      ) throw error;
      await delay(1000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function retryTransient<T>(fn: () => Promise<T>, timeoutMs = 120000): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/websocket: close 1006|unexpected EOF|Get "http:\/\/unix.socket\/1.0\/instances.*EOF|connection reset|Instance not found/i.test(message)) {
        throw error;
      }
      await delay(1000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function queryIncus<T>(path: string): Promise<T> {
  const { stdout } = await retryTransient(() => runIncus(['query', path]), 120000);
  return JSON.parse(stdout) as T;
}

async function queryIncusFast<T>(path: string, timeoutMs = 5000): Promise<T> {
  const { stdout } = await runIncus(['query', path], timeoutMs);
  return JSON.parse(stdout) as T;
}


async function runDetachedPublish(instanceId: string, alias: string) {
  await retryTransient(() => runIncusPty(['publish', incusTarget(instanceId), '--alias', alias, '--force'], 300000), 310000);
}

async function waitForCloudInit(instanceName: string, timeoutMs = 300000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await runIncus(['exec', incusTarget(instanceName), '--', 'cloud-init', 'status', '--wait'], 240000);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not found|not ready|not currently running|Failed connecting|SIGTERM|SIGKILL|killed|timed out/i.test(message)) {
        throw error;
      }
      await delay(2000);
    }
  }
  throw new Error(`Timed out waiting for cloud-init on ${instanceName}`);
}

async function setIncusConfig(instanceName: string, key: string, value: string, timeoutMs = 120000) {
  await retryBusy(() => runIncus(['config', 'set', incusTarget(instanceName), key, value]), timeoutMs);
}

async function applyVmBootTuning(instanceName: string) {
  // Proven manual savings: ~1s from disabling secure boot + ~1.5s from stripping GUI/spice/unused PCIe devices.
  await setIncusConfig(instanceName, 'security.secureboot', 'false').catch(() => {});
  await setIncusConfig(instanceName, 'security.agent.metrics', 'false').catch(() => {});
  await setIncusConfig(instanceName, 'raw.qemu.conf', FAST_VM_RAW_QEMU_CONF).catch(() => {});
}

async function ensureRootDiskSize(instanceName: string, sizeGiB: number) {
  try {
    // If a root override device already exists, update it in place.
    await retryBusy(() => runIncus(['config', 'device', 'set', incusTarget(instanceName), 'root', 'size', `${sizeGiB}GiB`]));
  } catch {
    // Otherwise create an override off the profile root device.
    await retryBusy(() => runIncus(['config', 'device', 'override', incusTarget(instanceName), 'root', `size=${sizeGiB}GiB`]));
  }
}

async function growGuestFilesystem(instanceName: string) {
  await runIncus([
    'exec', incusTarget(instanceName), '--', 'bash', '-lc',
    'growpart /dev/sda 2 >/dev/null 2>&1 || true; resize2fs /dev/sda2 >/dev/null 2>&1 || true',
  ], 30000);
}

async function applyClaimResources(instanceName: string, memoryGb: number, diskGb: number) {
  // RAM hotplug works on running VMs; don't block waiting for guest visibility.
  await setIncusConfig(instanceName, 'limits.memory', `${memoryGb}GiB`);
  // Disk device resize + in-guest filesystem expansion.
  await ensureRootDiskSize(instanceName, diskGb);
  await growGuestFilesystem(instanceName).catch(() => {});
}

function requireAuth(c: Context) {
  if (!RUNNERD_TOKEN) return c.json({ error: 'runnerd token not configured' }, 500);
  const auth = c.req.header('authorization') || '';
  if (auth !== `Bearer ${RUNNERD_TOKEN}`) return c.json({ error: 'unauthorized' }, 401);
  return null;
}

function isBenignLifecycleMessage(error: unknown, expected: 'stopped' | 'running') {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return expected === 'stopped' ? message.includes('already stopped') : message.includes('already running');
}

function sshPortForInstance(instanceId: string) {
  const digest = createHash('sha1').update(instanceId).digest();
  const offset = digest.readUInt16BE(0) % 1000;
  return 22000 + offset;
}

function httpPortForInstance(instanceId: string) {
  const digest = createHash('sha1').update(instanceId).digest();
  const offset = digest.readUInt16BE(2) % 1000;
  return 8000 + offset;
}

function resolveExplicitPort(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

/**
 * Regenerate the nginx VM map file and reload nginx.
 * Called after VM create/delete so the host reverse proxy stays in sync.
 *
 * Reads all running Incus instances, builds slug→privateIP map,
 * writes /etc/nginx/vm-map.conf, and reloads nginx.
 */
async function regenerateNginxMap() {
  try {
    // Use JSON output from incus list (CSV breaks on multiline IP fields from Docker VMs)
    const { stdout } = await execFileAsync('incus', ['list', '--format', 'json'], {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const instances: Array<{
      name: string;
      status: string;
      state?: { network?: Record<string, { addresses?: Array<{ family?: string; scope?: string; address?: string }> }> };
    }> = JSON.parse(stdout);
    const lines = ['# Auto-generated by runnerd — slug → vm_private_ip'];
    let count = 0;
    for (const inst of instances) {
      if (inst.status !== 'Running') continue;
      const slug = inst.name.replace(/^justavps-/, '');
      // Find the first 10.x.x.x IPv4 (Incus bridge, not Docker)
      let ip: string | null = null;
      for (const [, iface] of Object.entries(inst.state?.network ?? {})) {
        const addr = (iface.addresses ?? []).find(
          (a) => a.family === 'inet' && a.scope === 'global' && a.address?.startsWith('10.')
        );
        if (addr?.address) { ip = addr.address; break; }
      }
      if (slug && ip) {
        lines.push(`${slug} ${ip};`);
        count++;
      }
    }
    writeFileSync('/etc/nginx/vm-map.conf', lines.join('\n') + '\n');
    await execFileAsync('nginx', ['-s', 'reload'], { timeout: 5000 }).catch(() => {});
    console.log(`[runnerd] nginx map regenerated (${count} VMs)`);
  } catch (err) {
    console.warn(`[runnerd] nginx map regen failed:`, err instanceof Error ? err.message : err);
  }
}

async function listInstanceSnapshots(instanceName: string) {
  const parsed = await queryIncus<Array<{ name: string; created_at?: string }>>(`/1.0/instances/${encodeURIComponent(instanceName)}/snapshots?recursion=1`);
  return parsed.map((snapshot) => ({
    id: snapshot.name.split('/').pop() || snapshot.name,
    name: snapshot.name.split('/').pop() || snapshot.name,
    createdAt: snapshot.created_at ?? new Date().toISOString(),
    status: 'ready',
  }));
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.]+/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseGiB(value: unknown) {
  const parsed = parseNumber(value);
  return parsed == null ? null : parsed;
}

async function listInstancesDetailed() {
  const parsed = await queryIncus<Array<{
    name: string;
    status?: string;
    config?: Record<string, string>;
    devices?: Record<string, Record<string, string>>;
    expanded_devices?: Record<string, Record<string, string>>;
    state?: {
      network?: Record<string, { addresses?: Array<{ family?: string; scope?: string; address?: string }> }>;
    };
  }>>('/1.0/instances?recursion=1');

  return parsed.map((instance) => {
      const privateIpv4 = extractPrivateIpv4(instance.state?.network);

    const rootDevice = instance.devices?.root ?? instance.expanded_devices?.root ?? {};
    return {
      instanceId: instance.name,
      status: instance.status ?? null,
      privateIpv4,
      vcpu: parseNumber(instance.config?.['limits.cpu']),
      memoryGb: parseGiB(instance.config?.['limits.memory']),
      diskGb: parseGiB(rootDevice.size),
      role: instance.config?.['user.justavps.role'] ?? null,
    };
  });
}

async function listImagesDetailed() {
  const parsed = await queryIncus<Array<{
    fingerprint: string;
    aliases?: Array<{ name?: string }>;
    update_source?: { alias?: string } | null;
    cached?: boolean;
  }>>('/1.0/images?recursion=1');

  return parsed.map((image) => ({
    imageId: image.fingerprint,
    aliases: [...new Set([
      ...(image.aliases ?? []).map((alias) => alias.name).filter((alias): alias is string => Boolean(alias)),
      ...(image.update_source?.alias ? [image.update_source.alias] : []),
    ])],
    cached: Boolean(image.cached),
  }));
}

app.get('/healthz', async (c) => {
  try {
    const [server, instances, images] = await Promise.all([
      queryIncusFast<{ environment?: { server_version?: string } }>('/1.0'),
      queryIncusFast<string[]>('/1.0/instances'),
      queryIncusFast<string[]>('/1.0/images'),
    ]);

    return c.json({
      status: 'ok',
      runnerd: 'ok',
      incus: {
        status: 'ok',
        serverVersion: server.environment?.server_version ?? null,
        instanceCount: instances.length,
        imageCount: images.length,
      },
      warm_pool: {
        size: [...warmPools.values()].reduce((sum, arr) => sum + arr.length, 0),
        target: trackedCpuBuckets.size * WARM_POOL_PER_CPU,
        ready: [...warmPools.values()].reduce((sum, arr) => sum + arr.length, 0),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({
      status: 'degraded',
      runnerd: 'ok',
      incus: {
        status: 'error',
        error: message,
      },
    }, 503);
  }
});

app.post('/v1/instances', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;

  const body = await c.req.json();
  const instanceName = String(body.instanceName);
  const machineSlug = String(body.machineSlug || instanceName.replace(/^justavps-/, ''));
  const image = String(body.image);
  const diskGb = Number(body.diskGb);
  const vcpu = Number(body.vcpu);
  const memoryGb = Number(body.memoryGb);
  const cloudInitUserData = String(body.cloudInitUserData || '');
  const machineMode = String(body.machineMode || 'vm') === 'container' ? 'container' : 'vm';
  const sshProxyEnabled = body.sshProxyEnabled !== false;
  const containerIpv4Address = typeof body.containerIpv4Address === 'string' && body.containerIpv4Address.trim()
    ? body.containerIpv4Address.trim()
    : null;
  const requestedSshPort = sshProxyEnabled ? resolveExplicitPort(body.sshPort, sshPortForInstance(instanceName)) : null;
  const requestedHttpPort = resolveExplicitPort(body.httpPort, httpPortForInstance(instanceName));

  try {
    if (machineMode === 'container') {
      const startTs = Date.now();
      const stageTimings: Record<string, number> = {};
      const resolvedImage = await resolveContainerImageReference(image, { runIncus });
      const requestedStaticIpv4 = containerIpv4Address ?? await allocateStaticBridgeIpv4({ queryIncus });
      stageTimings.resolve_image_ms = Date.now() - startTs;
      await retryTransient(() => runIncusPty(['delete', incusTarget(instanceName), '--force'], 20000).catch(() => ({ stdout: '', stderr: '' })), 20000);
      const launchArgs = buildContainerLaunchArgs({
        resolvedImage,
        instanceName,
        vcpu,
        memoryGb,
        diskGb,
        staticIpv4: requestedStaticIpv4,
        cloudInitUserData,
        incusTarget,
      });
      await retryTransient(() => runIncusPty(launchArgs, 300000), 310000);
      stageTimings.launch_ms = Date.now() - startTs;
      await waitForInstance({ instanceName, queryIncus, delay });
      stageTimings.instance_visible_ms = Date.now() - startTs;
      const inspected = await waitForPrivateIpv4({ instanceName, inspectInstance: (target) => inspectInstance({ instanceName: target, queryIncus }), delay, timeoutMs: 120000, intervalMs: 100 });
      stageTimings.ip_ready_ms = Date.now() - startTs;
      stageTimings.hardening_ms = stageTimings.launch_ms;
      stageTimings.config_ms = stageTimings.launch_ms;
      stageTimings.start_ms = stageTimings.launch_ms;
      const sshPort = requestedSshPort;
      const httpPort = requestedHttpPort;
      if (inspected.privateIpv4 && RUNNERD_PUBLIC_IPV4) {
        await setupContainerProxyDevices({ instanceName, containerIp: inspected.privateIpv4, sshPort, httpPort, publicIpv4: RUNNERD_PUBLIC_IPV4, runIncus, incusTarget }).catch((err) =>
          console.warn(`[runnerd] container proxy setup failed for ${instanceName}: ${err instanceof Error ? err.message : err}`)
        );
      }
      stageTimings.proxy_ms = Date.now() - startTs;
      regenerateNginxMap().catch(() => {});
      console.log(`[runnerd] container ready ${instanceName} total=+${Date.now() - startTs}ms stages=${JSON.stringify(stageTimings)} image=${resolvedImage}`);
      return c.json({
        instanceId: instanceName,
        hostIpv4: RUNNERD_PUBLIC_IPV4,
        hostIpv6: RUNNERD_PUBLIC_IPV6,
        privateIpv4: inspected.privateIpv4,
        sshPort,
        httpPort,
        metadata: buildContainerCreateMetadata({
          status: inspected.status,
          requestedStaticIpv4,
          totalMs: Date.now() - startTs,
          stageTimings,
        }),
      }, 201);
    }
    const isGoldenImage = image === 'justavps-golden' || image.startsWith('justavps-golden');
    console.log(`[runnerd] create ${instanceName} from ${image}${isGoldenImage ? ' (golden fast-path)' : ''}`);

    // ── WARM POOL: check BEFORE cold init to avoid wasting 2s on incus init ──
    if (isGoldenImage) {
      const startTs = Date.now();
      const sshPort = requestedSshPort;
      const httpPort = requestedHttpPort;
      trackedCpuBuckets.add(vcpu);
      const warmVM = await claimWarmVM(vcpu);
      if (warmVM) {
        const claimedName = warmVM.name;
        console.log(`[runnerd] WARM POOL claim ${warmVM.name} → ${instanceName} +${Date.now() - startTs}ms`);

        await applyClaimResources(claimedName, memoryGb, diskGb);
        console.log(`[runnerd] claim resources applied +${Date.now() - startTs}ms`);
        void setIncusConfig(claimedName, 'user.justavps.role', 'machine', 10_000).catch(() => {});
        void setIncusConfig(claimedName, 'user.justavps.machine_slug', machineSlug, 10_000).catch(() => {});

        // Rebuild proxy devices idempotently. Warm claims must remove any stale
        // listener/device state from the reserve lifecycle before exposing the
        // claimed machine publicly.
        if (warmVM.privateIpv4 && RUNNERD_PUBLIC_IPV4) {
          await setupWarmClaimProxyDevices({ instanceName: claimedName, vmIp: warmVM.privateIpv4, sshPort, httpPort, publicIpv4: RUNNERD_PUBLIC_IPV4, runIncus, incusTarget });
          console.log(`[runnerd] proxies ready +${Date.now() - startTs}ms ssh:${sshPort} http:${httpPort}`);
        }

        // Identity injection last: this restarts machine-local services/daemon and can
        // trigger readiness callbacks. Do it only after resources + public proxy
        // devices are all in place.
        if (cloudInitUserData.trim()) {
          console.log(`[runnerd] warm claim identity injection starting +${Date.now() - startTs}ms`);
          const b64 = Buffer.from(cloudInitUserData).toString('base64');
          await runIncus(['exec', incusTarget(claimedName), '--', 'bash', '-c',
            `echo '${b64}' | base64 -d > /tmp/init.sh && chmod +x /tmp/init.sh && /tmp/init.sh`], 60000);
          console.log(`[runnerd] identity injected +${Date.now() - startTs}ms`);
        }

        console.log(`[runnerd] WARM CLAIM COMPLETE ${claimedName} total=+${Date.now() - startTs}ms`);
        regenerateNginxMap().catch(() => {});
        return c.json({
          instanceId: claimedName,
          hostIpv4: RUNNERD_PUBLIC_IPV4,
          hostIpv6: RUNNERD_PUBLIC_IPV6,
          privateIpv4: warmVM.privateIpv4,
          sshPort,
          httpPort,
          metadata: buildWarmPoolVmCreateMetadata({ machineMode, totalMs: Date.now() - startTs }),
        }, 201);
      }

      // ── COLD BOOT FALLBACK (pool empty, ~18s) ──────────────────────
      console.log(`[runnerd] cold boot ${instanceName} (warm pool empty)`);

      // Last resort: full cold boot from image alias.
      const resolvedImage = await resolveVmImageReference(image, { runIncus });
      await retryTransient(() => runIncusPty(['delete', incusTarget(instanceName), '--force'], 20000).catch(() => ({ stdout: '', stderr: '' })), 20000);
      await retryTransient(() => runIncusPty(['init', resolvedImage, incusTarget(instanceName), '--vm'], 300000), 310000);
      await waitForInstance({ instanceName, queryIncus, delay });
      await applyVmBootTuning(instanceName);
      await ensureRootDiskSize(instanceName, diskGb);
      await setIncusConfig(instanceName, 'limits.cpu', String(vcpu));
      await setIncusConfig(instanceName, 'limits.memory', `${memoryGb}GiB`);
      console.log(`[runnerd] cold init complete ${instanceName} +${Date.now() - startTs}ms`);

      await retryBusy(() => runIncus(['start', incusTarget(instanceName)]));
      console.log(`[runnerd] started ${instanceName} +${Date.now() - startTs}ms`);
      const inspected = await waitForPrivateIpv4({ instanceName, inspectInstance: (target) => inspectInstance({ instanceName: target, queryIncus }), delay });
      console.log(`[runnerd] ip ready ${instanceName} +${Date.now() - startTs}ms ip=${inspected.privateIpv4 ?? 'none'}`);

      // Wait for incus agent
      const agentDeadline = Date.now() + 30000;
      let agentReady = false;
      while (Date.now() < agentDeadline) {
        try {
          await runIncus(['exec', incusTarget(instanceName), '--', 'true'], 3000);
          agentReady = true;
          break;
        } catch {
          await delay(200);
        }
      }
      if (!agentReady) throw new Error('Timed out waiting for incus agent');
      console.log(`[runnerd] agent ready ${instanceName} +${Date.now() - startTs}ms`);

      // Inject identity
      if (cloudInitUserData.trim()) {
        const b64 = Buffer.from(cloudInitUserData).toString('base64');
        await runIncus(['exec', incusTarget(instanceName), '--', 'bash', '-c',
          `echo '${b64}' | base64 -d > /tmp/init.sh && chmod +x /tmp/init.sh && /tmp/init.sh`], 30000);
        console.log(`[runnerd] identity injected ${instanceName} +${Date.now() - startTs}ms`);
      }

      // Set up proxies
      if (inspected.privateIpv4 && RUNNERD_PUBLIC_IPV4) {
        await setupProxyDevices({ instanceName, vmIp: inspected.privateIpv4, sshPort, httpPort, publicIpv4: RUNNERD_PUBLIC_IPV4, runIncus, incusTarget }).catch((err) =>
          console.warn(`[runnerd] proxy setup failed for ${instanceName}: ${err instanceof Error ? err.message : err}`)
        );
        console.log(`[runnerd] proxies ready ${instanceName} +${Date.now() - startTs}ms ssh:${sshPort} http:${httpPort}`);
      }

      console.log(`[runnerd] inspected ${instanceName} privateIpv4=${inspected.privateIpv4 ?? 'none'} status=${inspected.status ?? 'unknown'} total=+${Date.now() - startTs}ms`);
      regenerateNginxMap().catch(() => {});
      return c.json({
        instanceId: instanceName,
        hostIpv4: RUNNERD_PUBLIC_IPV4,
        hostIpv6: RUNNERD_PUBLIC_IPV6,
        privateIpv4: inspected.privateIpv4,
        sshPort,
        httpPort,
        metadata: buildVmCreateMetadata({ status: inspected.status, machineMode, scenario: 'cold_create', totalMs: Date.now() - startTs }),
      }, 201);
    }

    // Standard cloud-init path (raw images — non-golden)
    const resolvedImageStd = await resolveVmImageReference(image, { runIncus });
    await retryTransient(() => runIncusPty(['delete', incusTarget(instanceName), '--force'], 20000).catch(() => ({ stdout: '', stderr: '' })), 20000);
    await retryTransient(() => runIncusPty(['init', resolvedImageStd, incusTarget(instanceName), '--vm'], 300000), 310000);
    await waitForInstance({ instanceName, queryIncus, delay });
    await applyVmBootTuning(instanceName);
    await ensureRootDiskSize(instanceName, diskGb);
    await setIncusConfig(instanceName, 'limits.cpu', String(vcpu));
    await setIncusConfig(instanceName, 'limits.memory', `${memoryGb}GiB`);
    if (cloudInitUserData.trim()) {
      await setIncusConfig(instanceName, 'cloud-init.user-data', cloudInitUserData);
    }
    await retryBusy(() => runIncus(['start', incusTarget(instanceName)]));
    console.log(`[runnerd] started ${instanceName}`);
    const inspected = await waitForPrivateIpv4({ instanceName, inspectInstance: (target) => inspectInstance({ instanceName: target, queryIncus }), delay });
    await waitForCloudInit(instanceName);
    console.log(`[runnerd] inspected ${instanceName} privateIpv4=${inspected.privateIpv4 ?? 'none'} status=${inspected.status ?? 'unknown'}`);

    const sshPort = requestedSshPort;
    const httpPort = requestedHttpPort;
    if (inspected.privateIpv4 && RUNNERD_PUBLIC_IPV4) {
      await setupProxyDevices({ instanceName, vmIp: inspected.privateIpv4, sshPort, httpPort, publicIpv4: RUNNERD_PUBLIC_IPV4, runIncus, incusTarget }).catch((err) =>
        console.warn(`[runnerd] proxy setup failed for ${instanceName}: ${err instanceof Error ? err.message : err}`)
      );
      console.log(`[runnerd] proxies ready ${instanceName} ssh:${sshPort} http:${httpPort}`);
    }

    regenerateNginxMap().catch(() => {});
    return c.json({
      instanceId: instanceName,
      hostIpv4: RUNNERD_PUBLIC_IPV4,
      hostIpv6: RUNNERD_PUBLIC_IPV6,
      privateIpv4: inspected.privateIpv4,
      sshPort,
      httpPort,
      metadata: buildVmCreateMetadata({ status: inspected.status, machineMode, scenario: 'user_image_cold_create', totalMs: null }),
    }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'failed to create instance' }, 500);
  }
});

app.post('/v1/instances/:id/exec', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;

  const instanceId = c.req.param('id');
  const body = await c.req.json();
  const command = String(body.command || '').trim();
  if (!command) {
    return c.json({ error: 'command is required' }, 400);
  }

  const args = Array.isArray(body.args) ? body.args.map((value: unknown) => String(value)) : [];
  const envVars = body.envVars && typeof body.envVars === 'object' && !Array.isArray(body.envVars)
    ? Object.entries(body.envVars as Record<string, unknown>).filter(([, value]) => typeof value === 'string')
    : [];
  const execArgs = ['exec', incusTarget(instanceId)];

  for (const [key, value] of envVars) {
    execArgs.push('--env', `${key}=${value}`);
  }

  if (typeof body.cwd === 'string' && body.cwd.trim()) {
    execArgs.push('--cwd', body.cwd.trim());
  }
  if (typeof body.user === 'string' && body.user.trim()) {
    execArgs.push('--user', body.user.trim());
  }
  if (typeof body.group === 'string' && body.group.trim()) {
    execArgs.push('--group', body.group.trim());
  }

  execArgs.push('--', command, ...args);

  try {
    const timeoutMs = typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
      ? Math.max(1_000, Math.min(body.timeoutMs, 300_000))
      : 120_000;
    const result = await runIncusAllowingFailure(execArgs, timeoutMs);
    return c.json(result, 200);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'failed to exec in instance' }, 500);
  }
});

app.get('/v1/state', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;

  const [server, instances, images] = await Promise.all([
    queryIncusFast<{ environment?: { server_version?: string } }>('/1.0'),
    listInstancesDetailed(),
    listImagesDetailed(),
  ]);

  return c.json({
    checkedAt: new Date().toISOString(),
    runnerd: 'ok',
    incus: {
      status: 'ok',
      serverVersion: server.environment?.server_version ?? null,
      instanceCount: instances.length,
      imageCount: images.length,
    },
    instances,
    images,
  });
});

app.post('/v1/instances/:id/start', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  try {
    await runIncus(['start', incusTarget(c.req.param('id'))]);
  } catch (error) {
    if (!isBenignLifecycleMessage(error, 'running')) throw error;
  }
  return c.json({ ok: true });
});

app.post('/v1/instances/:id/stop', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  try {
    await runIncus(['stop', incusTarget(c.req.param('id'))]);
  } catch (error) {
    if (!isBenignLifecycleMessage(error, 'stopped')) throw error;
  }
  return c.json({ ok: true });
});

app.post('/v1/instances/:id/reboot', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  const instanceId = c.req.param('id');
  try {
    await runIncus(['stop', incusTarget(instanceId), '--force']);
  } catch (error) {
    if (!isBenignLifecycleMessage(error, 'stopped')) throw error;
  }
  await runIncus(['start', incusTarget(instanceId)]);
  return c.json({ ok: true });
});

app.delete('/v1/instances/:id', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  try {
    await retryTransient(() => runIncus(['delete', incusTarget(c.req.param('id')), '--force'], 300000), 310000);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes('instance not found')) throw error;
  }
  regenerateNginxMap().catch(() => {});
  return c.body(null, 204);
});

app.get('/v1/instances/:id/snapshots', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  return c.json(await listInstanceSnapshots(c.req.param('id')));
});

app.post('/v1/instances/:id/snapshots', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  const body = await c.req.json().catch(() => ({}));
  const instanceId = c.req.param('id');
  const snapshotName = String(body.name || `snap-${Date.now()}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || `snap-${Date.now()}`;
  // VM snapshot create can finish host-side while the plain execFile Incus CLI stays hung on its pipes.
  // Running through a PTY matches the proven host invocation path and lets the command exit reliably.
  await retryTransient(() => runIncusPty(['snapshot', 'create', incusTarget(instanceId), snapshotName], 900000), 910000);
  const [snapshot] = (await listInstanceSnapshots(instanceId)).filter((item) => item.id === snapshotName);
  return c.json(snapshot ?? { id: snapshotName, name: snapshotName, createdAt: new Date().toISOString(), status: 'ready' }, 202);
});

app.post('/v1/instances/:id/snapshots/:snapshotId/restore', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  const { id, snapshotId } = c.req.param();
  await retryTransient(() => runIncus(['snapshot', 'restore', incusTarget(id), snapshotId], 900000), 910000);
  return c.json({ ok: true });
});

app.delete('/v1/instances/:id/snapshots/:snapshotId', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  const { id, snapshotId } = c.req.param();
  try {
    await retryTransient(() => runIncus(['snapshot', 'delete', incusTarget(id), snapshotId], 300000), 310000);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes('instance not found') && !message.includes('snapshot not found')) throw error;
  }
  return c.json({ ok: true });
});

app.post('/v1/images/publish', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  const body = await c.req.json();
  const instanceId = String(body.instanceId);
  const alias = String(body.alias);
  await runDetachedPublish(instanceId, alias);
  return c.json({ imageId: alias });
});

app.delete('/v1/images/:id', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  try {
    await retryTransient(() => runIncus(['image', 'delete', c.req.param('id')]));
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes('not found')) throw error;
  }
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: RUNNERD_PORT });

console.log(`[runnerd] listening on :${RUNNERD_PORT}`);

// Regenerate nginx map on startup so proxy routing is always correct
regenerateNginxMap().catch(() => {});

// On startup, wipe any old reserve VMs and rebuild pools cleanly.
// These are internal pool artifacts only — safe to recreate.
Promise.resolve()
  .then(() => prunePrefix('justavps-warm-'))
  .catch(() => {})
  .finally(() => {
    console.log(`[pool] initializing warm pools for CPU buckets: ${[...trackedCpuBuckets].join(',')}`);
    replenishPools().catch((err) => console.warn('[pool] initial replenish failed:', err));
    setInterval(() => replenishPools().catch(() => {}), 30000);
  });
