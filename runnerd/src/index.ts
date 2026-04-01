import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';

const execFileAsync = promisify(execFile);
const app = new Hono();

const RUNNERD_TOKEN = process.env.RUNNERD_TOKEN || '';
const RUNNERD_PORT = Number(process.env.RUNNERD_PORT || 7779);
const INCUS_REMOTE = (process.env.INCUS_REMOTE || '').trim();
const RUNNERD_PUBLIC_IPV4 = (process.env.RUNNERD_PUBLIC_IPV4 || '').trim() || null;
const RUNNERD_PUBLIC_IPV6 = (process.env.RUNNERD_PUBLIC_IPV6 || '').trim() || null;

function incusTarget(name?: string) {
  return INCUS_REMOTE ? `${INCUS_REMOTE}:${name ?? ''}` : (name ?? '');
}

async function runIncus(args: string[]) {
  const { stdout, stderr } = await execFileAsync('incus', args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function setIncusConfig(instanceName: string, key: string, value: string) {
  await runIncus(['config', 'set', incusTarget(instanceName), key, value]);
}

function requireAuth(c: Context) {
  if (!RUNNERD_TOKEN) return c.json({ error: 'runnerd token not configured' }, 500);
  const auth = c.req.header('authorization') || '';
  if (auth !== `Bearer ${RUNNERD_TOKEN}`) return c.json({ error: 'unauthorized' }, 401);
  return null;
}

function sshPortForInstance(instanceId: string) {
  const digest = createHash('sha1').update(instanceId).digest();
  const offset = digest.readUInt16BE(0) % 1000;
  return 22000 + offset;
}

async function inspectInstance(instanceName: string) {
  const { stdout } = await runIncus(['list', incusTarget(instanceName), '--format', 'json']);
  const parsed = JSON.parse(stdout) as Array<{
    status?: string;
    state?: {
      status?: string;
      network?: Record<string, { addresses?: Array<{ family?: string; scope?: string; address?: string }> }>;
    };
  }>;
  const instance = parsed[0];
  const state = instance?.state ?? {};
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
    status: state.status || instance?.status || null,
  };
}

app.get('/healthz', (c) => c.json({ status: 'ok' }));

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
    await runIncus(['init', image, incusTarget(instanceName), '--vm', '--device', `root,size=${diskGb}GiB`]);
    await setIncusConfig(instanceName, 'limits.cpu', String(vcpu));
    await setIncusConfig(instanceName, 'limits.memory', `${memoryGb}GiB`);
    if (cloudInitUserData.trim()) {
      await setIncusConfig(instanceName, 'cloud-init.user-data', cloudInitUserData);
    }
    await runIncus(['start', incusTarget(instanceName)]);
    const inspected = await inspectInstance(instanceName);
    return c.json({
      instanceId: instanceName,
      hostIpv4: RUNNERD_PUBLIC_IPV4,
      hostIpv6: RUNNERD_PUBLIC_IPV6,
      privateIpv4: inspected.privateIpv4,
      sshPort: sshPortForInstance(instanceName),
      metadata: {
        incus_status: inspected.status,
      },
    }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'failed to create instance' }, 500);
  }
});

app.post('/v1/instances/:id/start', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  await runIncus(['start', incusTarget(c.req.param('id'))]);
  return c.json({ ok: true });
});

app.post('/v1/instances/:id/stop', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  await runIncus(['stop', incusTarget(c.req.param('id'))]);
  return c.json({ ok: true });
});

app.post('/v1/instances/:id/reboot', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  await runIncus(['restart', incusTarget(c.req.param('id'))]);
  return c.json({ ok: true });
});

app.delete('/v1/instances/:id', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  await runIncus(['delete', incusTarget(c.req.param('id')), '--force']);
  return c.body(null, 204);
});

app.post('/v1/images/publish', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;
  const body = await c.req.json();
  const instanceId = String(body.instanceId);
  const alias = String(body.alias);
  await runIncus(['publish', incusTarget(instanceId), '--alias', alias]);
  return c.json({ imageId: alias });
});

serve({ fetch: app.fetch, port: RUNNERD_PORT });

console.log(`[runnerd] listening on :${RUNNERD_PORT}`);
