import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const execFileAsync = promisify(execFile);
const app = new Hono();

const RUNNERD_TOKEN = process.env.RUNNERD_TOKEN || '';
const RUNNERD_PORT = Number(process.env.RUNNERD_PORT || 7779);
const INCUS_REMOTE = (process.env.INCUS_REMOTE || '').trim();
const RUNNERD_PUBLIC_IPV4 = (process.env.RUNNERD_PUBLIC_IPV4 || '').trim() || null;
const RUNNERD_PUBLIC_IPV6 = (process.env.RUNNERD_PUBLIC_IPV6 || '').trim() || null;
const RUNNERD_STATE_DIR = '/run/justavps-runnerd';

mkdirSync(RUNNERD_STATE_DIR, { recursive: true });

function incusTarget(name?: string) {
  return INCUS_REMOTE ? `${INCUS_REMOTE}:${name ?? ''}` : (name ?? '');
}

async function runIncus(args: string[], timeoutMs = 15000) {
  const { stdout, stderr } = await execFileAsync('incus', args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { stdout, stderr };
}

async function runIncusPty(args: string[], timeoutMs = 300000) {
  const command = `incus ${args.map((arg) => JSON.stringify(arg)).join(' ')}`;
  const { stdout, stderr } = await execFileAsync('script', ['-qec', command, '/dev/null'], {
    maxBuffer: 50 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { stdout, stderr };
}

function normalizeImageAlias(image: string) {
  return image.startsWith('images:') ? image.slice('images:'.length) : image;
}

async function resolveVmImageReference(image: string) {
  const alias = normalizeImageAlias(image);
  const { stdout } = await runIncus(['image', 'list', 'images:', '--format', 'csv']);
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const match = lines.find((line) => line.toLowerCase().includes(alias.toLowerCase()) && line.includes('VIRTUAL-MACHINE'));
  if (!match) return image;
  const fingerprint = match.split(',')[1]?.trim();
  return fingerprint ? `images:${fingerprint}` : image;
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

async function waitForInstance(instanceName: string, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await queryIncus(`/1.0/instances/${encodeURIComponent(instanceName)}`);
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error(`Timed out waiting for instance ${instanceName} to appear`);
}

async function waitForPrivateIpv4(instanceName: string, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const inspected = await inspectInstance(instanceName);
    if (inspected.privateIpv4) return inspected;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for private IPv4 on ${instanceName}`);
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

async function setIncusConfig(instanceName: string, key: string, value: string) {
  await retryBusy(() => runIncus(['config', 'set', incusTarget(instanceName), key, value]));
}

async function ensureRootDiskSize(instanceName: string, sizeGiB: number) {
  await retryBusy(() => runIncus(['config', 'device', 'override', incusTarget(instanceName), 'root', `size=${sizeGiB}GiB`]));
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

async function inspectInstance(instanceName: string) {
  const state = await queryIncus<{
    status: string;
    network?: Record<string, { addresses?: Array<{ family?: string; scope?: string; address?: string }> }>;
  }>(`/1.0/instances/${encodeURIComponent(instanceName)}/state`);
  const network = state?.network ?? {};
  let privateIpv4: string | null = null;
  for (const iface of Object.values(network)) {
    const addresses = iface.addresses ?? [];
    const ipv4 = addresses.find((addr) => addr.family === 'inet' && addr.scope === 'global');
    if (ipv4?.address) {
      privateIpv4 = ipv4.address;
      break;
    }
  }
  return {
    privateIpv4,
    status: state.status || null,
  };
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
    const network = instance.state?.network ?? {};
    let privateIpv4: string | null = null;
    for (const iface of Object.values(network)) {
      const ipv4 = (iface.addresses ?? []).find((addr) => addr.family === 'inet' && addr.scope === 'global');
      if (ipv4?.address) {
        privateIpv4 = ipv4.address;
        break;
      }
    }

    const rootDevice = instance.devices?.root ?? instance.expanded_devices?.root ?? {};
    return {
      instanceId: instance.name,
      status: instance.status ?? null,
      privateIpv4,
      vcpu: parseNumber(instance.config?.['limits.cpu']),
      memoryGb: parseGiB(instance.config?.['limits.memory']),
      diskGb: parseGiB(rootDevice.size),
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
  const image = String(body.image);
  const diskGb = Number(body.diskGb);
  const vcpu = Number(body.vcpu);
  const memoryGb = Number(body.memoryGb);
  const cloudInitUserData = String(body.cloudInitUserData || '');

  try {
    const isGoldenImage = image === 'justavps-golden' || image.startsWith('justavps-golden');
    console.log(`[runnerd] create ${instanceName} from ${image}${isGoldenImage ? ' (golden fast-path)' : ''}`);
    const resolvedImage = await resolveVmImageReference(image);
    await retryTransient(() => runIncusPty(['delete', incusTarget(instanceName), '--force'], 20000).catch(() => ({ stdout: '', stderr: '' })), 20000);
    await retryTransient(() => runIncusPty(['init', resolvedImage, incusTarget(instanceName), '--vm'], 300000), 310000);
    await waitForInstance(instanceName);
    console.log(`[runnerd] init complete ${instanceName}`);
    await ensureRootDiskSize(instanceName, diskGb);
    await setIncusConfig(instanceName, 'limits.cpu', String(vcpu));
    await setIncusConfig(instanceName, 'limits.memory', `${memoryGb}GiB`);

    if (isGoldenImage) {
      // Golden fast-path: cloud-init still runs but our user-data is minimal (~3s)
      // because all heavy deps are pre-installed in the image
      if (cloudInitUserData.trim()) {
        await setIncusConfig(instanceName, 'cloud-init.user-data', cloudInitUserData);
      }
      await retryBusy(() => runIncus(['start', incusTarget(instanceName)]));
      console.log(`[runnerd] started ${instanceName}`);
      const inspected = await waitForPrivateIpv4(instanceName);
      // Don't wait for full cloud-init — our script is <3s and the daemon handles readiness callbacks
      console.log(`[runnerd] inspected ${instanceName} privateIpv4=${inspected.privateIpv4 ?? 'none'} status=${inspected.status ?? 'unknown'}`);
      return c.json({
        instanceId: instanceName,
        hostIpv4: RUNNERD_PUBLIC_IPV4,
        hostIpv6: RUNNERD_PUBLIC_IPV6,
        privateIpv4: inspected.privateIpv4,
        sshPort: sshPortForInstance(instanceName),
        metadata: { incus_status: inspected.status },
      }, 201);
    }

    // Standard cloud-init path (raw images)
    if (cloudInitUserData.trim()) {
      await setIncusConfig(instanceName, 'cloud-init.user-data', cloudInitUserData);
    }
    await retryBusy(() => runIncus(['start', incusTarget(instanceName)]));
    console.log(`[runnerd] started ${instanceName}`);
    const inspected = await waitForPrivateIpv4(instanceName);
    await waitForCloudInit(instanceName);
    console.log(`[runnerd] inspected ${instanceName} privateIpv4=${inspected.privateIpv4 ?? 'none'} status=${inspected.status ?? 'unknown'}`);
    return c.json({
      instanceId: instanceName,
      hostIpv4: RUNNERD_PUBLIC_IPV4,
      hostIpv6: RUNNERD_PUBLIC_IPV6,
      privateIpv4: inspected.privateIpv4,
      sshPort: sshPortForInstance(instanceName),
      metadata: { incus_status: inspected.status },
    }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'failed to create instance' }, 500);
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
