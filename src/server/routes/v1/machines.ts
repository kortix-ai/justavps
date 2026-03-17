/**
 * Machine routes — CRUD + lifecycle operations.
 * Machines are created from user snapshots on any available provider.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { machines, snapshots } from '../../db/schema';
import { config } from '../../lib/config';

type Machine = typeof machines.$inferSelect;
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { stripeClient } from '../../lib/stripe';
import { requireOwnedResource, requireProvider, errorResponse, handleRouteError } from '../../lib/route-helpers';
import {
  generateMachineIdentity,
  uploadSSHKeyToProvider,
  buildMachineUserData,
  setupDNSAndKV,
  lookupPrice,
  createMachineRecord,
  createStripeSubscription,
  cleanupMachineResources,
  syncMachineStatus,
} from '../../lib/machine-lifecycle';
import { z } from 'zod';

export const machinesApp = new Hono<{ Variables: AuthVariables }>();

machinesApp.use('*', apiGuard);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateMachineSchema = z.object({
  snapshot_id: z.string().uuid().describe('Snapshot to boot from'),
  provider: z.string().min(1).describe('Cloud provider (e.g. "hetzner")'),
  server_type: z.string().min(1).describe('Provider-specific server type (e.g. "cpx22")'),
  region: z.string().min(1).describe('Provider-specific region (e.g. "nbg1")'),
  name: z.string().min(1).max(64).optional().describe('Human-readable name'),
  env_vars: z.record(z.string()).optional().describe('Extra environment variables written to /etc/justavps/env on the machine'),
  docker_image: z.string().optional().describe('Docker image to run on boot (e.g. "myapp:latest"). Starts with --env-file /etc/justavps/env'),
});

const ResizeMachineSchema = z.object({
  server_type: z.string().min(1).describe('New server type'),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function serializeMachine(m: typeof machines.$inferSelect) {
  const proxyDomain = config.PROXY_DOMAIN;
  const sshKeyPath = `~/.ssh/justavps_${m.slug}`;

  const setupCommand = m.sshPrivateKey && m.ip
    ? `mkdir -p ~/.ssh && echo '${m.sshPrivateKey.replace(/'/g, "'\\''")}' > ${sshKeyPath} && chmod 600 ${sshKeyPath} && ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${m.ip}`
    : null;

  const sshCommand = m.ip ? `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no root@${m.ip}` : null;

  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    status: m.status,
    provider: m.provider,
    snapshot_id: m.snapshotId,
    server_type: m.serverType,
    region: m.region,
    ip: m.ip,
    price_monthly: m.priceMonthly || null,
    created_at: m.createdAt.toISOString(),
    ready_at: m.readyAt?.toISOString() ?? null,
    urls: m.ip ? {
      vscode: `https://${m.slug}.${proxyDomain}`,
      pty: `wss://${m.slug}.${proxyDomain}/_pty`,
    } : null,
    ssh: sshCommand,
    ssh_key: m.sshPrivateKey ? {
      private_key: m.sshPrivateKey,
      public_key: m.sshPublicKey,
      setup_command: setupCommand,
      key_path: sshKeyPath,
    } : null,
    connect: {
      ssh_command: sshCommand,
      setup_command: setupCommand,
      vscode_url: `https://${m.slug}.${proxyDomain}`,
      vscode_password: m.codeServerPassword,
      cursor_ssh: m.ip ? `ssh -i ${sshKeyPath} root@${m.ip}` : null,
    },
    health: m.lastHeartbeat ? {
      ...m.lastHeartbeat,
      last_heartbeat_at: m.lastHeartbeatAt?.toISOString() ?? null,
    } : null,
  };
}

// ─── POST / — Create Machine ────────────────────────────────────────────────

machinesApp.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = CreateMachineSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(c, 400, parsed.error.message);
  }

  const data = parsed.data;
  const ownerId = c.get('userId');

  // 1. Validate provider
  const lookup = requireProvider(c, data.provider);
  if (lookup.response) return lookup.response;
  const provider = lookup.provider;

  // 2. Validate snapshot exists and belongs to user
  const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.id, data.snapshot_id));
  if (!snapshot || snapshot.ownerId !== ownerId) {
    return errorResponse(c, 404, 'Snapshot not found');
  }
  if (snapshot.status !== 'ready') {
    return errorResponse(c, 400, `Snapshot is not ready (status: ${snapshot.status})`);
  }

  // 3. Check snapshot is built on this provider
  const providerSnap = snapshot.providerData?.[data.provider];
  if (!providerSnap) {
    const available = Object.keys(snapshot.providerData ?? {}).join(', ') || 'none';
    return errorResponse(c, 400, `Snapshot not built on '${data.provider}'. Available providers: ${available}. Build it first via POST /snapshots/${snapshot.id}/build`);
  }

  try {
    // 4. Generate identity (slug, token, password, SSH keypair)
    const { slug, machineToken, codeServerPassword, keyPair } = await generateMachineIdentity();

    // 5. Upload SSH key to provider
    const providerKeyId = await uploadSSHKeyToProvider(provider, slug, keyPair.publicKey);

    // 6. Build cloud-init
    const userdata = buildMachineUserData(slug, codeServerPassword, keyPair.publicKey, machineToken, data.env_vars, data.docker_image);

    // 7. Create server via provider
    const server = await provider.createServer({
      name: `justavps-${slug}`,
      serverType: data.server_type,
      snapshotId: providerSnap.snapshotId,
      region: data.region,
      userData: userdata,
      sshKeyIds: providerKeyId ? [providerKeyId] : [],
      enableBackups: true,
      labels: {
        'justavps': 'true',
        'slug': slug,
        'owner': ownerId.slice(0, 63),
      },
    });

    // 8. DNS + KV
    await setupDNSAndKV(slug, server.publicIp, ownerId, data.server_type);

    // 9. Look up price
    const priceMonthly = await lookupPrice(provider, data.region, data.server_type, providerSnap);

    // 10. Create DB record
    const machine = await createMachineRecord({
      ownerId,
      slug,
      name: data.name || `machine-${slug}`,
      provider: data.provider,
      snapshotId: snapshot.id,
      serverType: data.server_type,
      region: data.region,
      ip: server.publicIp,
      providerServerId: server.serverId,
      machineToken,
      codeServerPassword,
      sshPublicKey: keyPair.publicKey,
      sshPrivateKey: keyPair.privateKey,
      priceMonthly,
    });

    // 11. Create Stripe subscription (async, non-blocking)
    createStripeSubscription(ownerId, machine.id, slug, priceMonthly, data.server_type);

    return c.json(serializeMachine(machine), 201);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES');
  }
});

// ─── GET / — List Machines ──────────────────────────────────────────────────

machinesApp.get('/', async (c) => {
  const ownerId = c.get('userId');
  const result = await db.select().from(machines).where(
    eq(machines.ownerId, ownerId),
  ).then(rows => rows.filter(r => r.status !== 'deleted'));

  // Auto-transition provisioning machines to ready if provider says running
  const synced = await Promise.all(result.map(syncMachineStatus));

  return c.json({ machines: synced.map(m => serializeMachine(m)) });
});

// ─── GET /:id — Get Machine ────────────────────────────────────────────────

machinesApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  const machine = await syncMachineStatus(owned.resource);

  return c.json(serializeMachine(machine));
});

// ─── DELETE /:id — Destroy Machine ──────────────────────────────────────────

machinesApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  try {
    const lookup = requireProvider(c, owned.resource.provider);
    if (lookup.response) return lookup.response;

    await cleanupMachineResources(owned.resource, lookup.provider);
    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES');
  }
});

// ─── POST /:id/reboot ───────────────────────────────────────────────────────

machinesApp.post('/:id/reboot', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  if (!owned.resource.providerServerId) {
    return errorResponse(c, 404, 'Machine not found');
  }

  const lookup = requireProvider(c, owned.resource.provider);
  if (lookup.response) return lookup.response;

  await lookup.provider.rebootServer(owned.resource.providerServerId);
  return c.json({ action: 'reboot', status: 'initiated' }, 202);
});

// ─── POST /:id/resize ───────────────────────────────────────────────────────

machinesApp.post('/:id/resize', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const body = await c.req.json();
  const parsed = ResizeMachineSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, 'Invalid request');
  }

  const owned = await requireOwnedResource<Machine>(c, machines, machines.id, id, ownerId, 'Machine');
  if (owned.response) return owned.response;

  const machine = owned.resource;
  if (!machine.providerServerId) {
    return errorResponse(c, 404, 'Machine not found');
  }

  try {
    const lookup = requireProvider(c, machine.provider);
    if (lookup.response) return lookup.response;

    await lookup.provider.resizeServer(machine.providerServerId, parsed.data.server_type);
    await db.update(machines)
      .set({ serverType: parsed.data.server_type })
      .where(eq(machines.id, id));

    // Update Stripe subscription price
    if (stripeClient.isConfigured() && machine.stripeSubItemId) {
      const subItemId = machine.stripeSubItemId.split('|')[1];
      const serverTypes = await lookup.provider.listServerTypes(machine.region);
      const st = serverTypes.find(t => t.name === parsed.data.server_type);
      if (st && subItemId) {
        await stripeClient.updateMachineSubscription(subItemId, st.priceMonthly, parsed.data.server_type, machine.id)
          .catch(err => console.error('[MACHINES] Stripe resize failed:', err));
      }
    }

    return c.json({
      action: 'resize',
      old_type: machine.serverType,
      new_type: parsed.data.server_type,
      status: 'initiated',
    }, 202);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES');
  }
});
