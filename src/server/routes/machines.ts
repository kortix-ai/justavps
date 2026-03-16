/**
 * Machine routes — CRUD + lifecycle operations.
 * All machines use a single unified image (code-server + Claude Code + OpenCode).
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { machines } from '../db/schema';
import { nanoid } from 'nanoid';
import { hetznerClient } from '../lib/hetzner';
import { cloudflareClient } from '../lib/cloudflare';
import { generateMachineToken, generatePassword } from '../lib/crypto';
import { buildCloudInit } from '../lib/cloud-init';
import { config } from '../lib/config';
import { apiGuard, type AuthVariables } from '../lib/api-guard';
import { stripeClient } from '../lib/stripe';
import { CreateMachineSchema, ResizeMachineSchema } from '@/lib/schemas';
import { users } from '../db/schema';

export const machinesApp = new Hono<{ Variables: AuthVariables }>();

// All machine routes require auth
machinesApp.use('*', apiGuard);

// ─── Helpers ────────────────────────────────────────────────────────────────

function serializeMachine(m: typeof machines.$inferSelect, includePrivateKey = false) {
  const proxyDomain = config.PROXY_DOMAIN;

  // SSH key path on user's machine
  const sshKeyPath = `~/.ssh/justavps_${m.slug}`;

  // 1-click setup: saves key + connects (handles StrictHostKeyChecking)
  const setupCommand = m.sshPrivateKey && m.ip
    ? `mkdir -p ~/.ssh && echo '${m.sshPrivateKey.replace(/'/g, "'\\''")}' > ${sshKeyPath} && chmod 600 ${sshKeyPath} && ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${m.ip}`
    : null;

  // Quick SSH command (after key already saved)
  const sshCommand = m.ip ? `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no root@${m.ip}` : null;

  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    status: m.status,
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
      claude_code: m.ip ? `ssh -i ${sshKeyPath} root@${m.ip}` : null,
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
    return c.json({ error: true, message: parsed.error.message, status: 400 }, 400);
  }

  const data = parsed.data;
  const ownerId = c.get('userId');
  const slug = nanoid(8).toLowerCase();
  const machineToken = generateMachineToken();
  const codeServerPassword = generatePassword(20);

  try {
    // 1. Auto-generate SSH keypair for this machine
    const { generateSSHKeyPair } = await import('../lib/ssh-keygen');
    const keyPair = generateSSHKeyPair(`${slug}@justavps`);

    // 2. Upload public key to Hetzner
    let hetznerKeyId: number | undefined;
    try {
      const result = await hetznerClient.uploadSSHKey(`justavps-${slug}`, keyPair.publicKey);
      hetznerKeyId = result.keyId;
    } catch (err: any) {
      console.warn('[MACHINES] SSH key upload to Hetzner failed (non-fatal):', err.message?.slice(0, 100));
    }

    // 3. Resolve snapshot
    const snapshot = await hetznerClient.resolveSnapshot();

    // 4. Build cloud-init (unified: code-server + Claude Code + OpenCode)
    const userdata = buildCloudInit({
      slug,
      codeServerPassword,
      sshPublicKey: keyPair.publicKey,
      machineToken,
      platformCallbackUrl: config.PLATFORM_URL,
      proxyDomain: config.PROXY_DOMAIN,
    });

    // 5. Create Hetzner server with SSH key + backups enabled
    const server = await hetznerClient.createServer({
      name: `justavps-${slug}`,
      serverType: data.server_type,
      image: snapshot.snapshotId,
      location: data.region,
      userData: userdata,
      sshKeyIds: hetznerKeyId ? [hetznerKeyId] : [],
      enableBackups: true,
      labels: {
        'justavps': 'true',
        'slug': slug,
        'owner': ownerId.slice(0, 63),
      },
    });

    // 6. Create DNS record + write KV entry for proxy Worker
    if (config.isCloudflareConfigured()) {
      await cloudflareClient.createDNSRecord(slug, server.publicIp);
      await cloudflareClient.writeKVMachine(slug, {
        owner_id: ownerId,
        ip: server.publicIp,
        status: 'provisioning',
        server_type: data.server_type,
      }).catch(() => {});
    }

    // 7. Look up price for this server type (includes backup cost)
    let priceMonthly = 30; // default for ccx13
    try {
      const serverTypes = await hetznerClient.listServerTypes(data.region);
      const st = serverTypes.find(t => t.name === data.server_type);
      if (st) {
        // Our price + 20% backup cost on Hetzner side (already in our markup)
        priceMonthly = st.priceMonthlyOurs;
      }
    } catch {}

    // 8. Create DB record
    const [machine] = await db.insert(machines).values({
      ownerId,
      slug,
      name: data.name || `machine-${slug}`,
      status: 'provisioning',
      serverType: data.server_type,
      region: data.region,
      ip: server.publicIp,
      hetznerId: server.serverId,
      machineToken,
      codeServerPassword,
      sshPublicKey: keyPair.publicKey,
      sshPrivateKey: keyPair.privateKey,
      priceMonthly,
      baseSnapshotId: snapshot.snapshotId,
    }).returning();

    // 9. Create Stripe subscription (async, non-blocking)
    if (stripeClient.isConfigured()) {
      try {
        const [user] = await db.select().from(users).where(eq(users.id, ownerId));
        if (user) {
          const customerId = await stripeClient.getOrCreateCustomer(ownerId, user.email);
          // Update user's stripe_customer_id if not set
          if (!user.stripeCustomerId) {
            await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, ownerId));
          }

          const { subscriptionId, subscriptionItemId } = await stripeClient.createMachineSubscription(
            customerId, machine.id, slug, priceMonthly, data.server_type,
          );
          await db.update(machines).set({
            stripeSubItemId: `${subscriptionId}|${subscriptionItemId}`,
          }).where(eq(machines.id, machine.id));
        }
      } catch (err) {
        console.error('[MACHINES] Stripe subscription creation failed (non-fatal):', err);
      }
    }

    // Include private key on creation response (shown to user ONCE)
    return c.json(serializeMachine(machine, true), 201);
  } catch (err) {
    console.error('[MACHINES] create error:', err);
    const message = err instanceof Error ? err.message : 'Failed to create machine';
    return c.json({ error: true, message, status: 500 }, 500);
  }
});

// ─── GET / — List Machines ──────────────────────────────────────────────────

machinesApp.get('/', async (c) => {
  const ownerId = c.get('userId');
  const result = await db.select().from(machines).where(
    eq(machines.ownerId, ownerId),
  ).then(rows => rows.filter(r => r.status !== 'deleted'));

  // Auto-transition provisioning machines to ready if Hetzner says running
  for (const m of result) {
    if (m.status === 'provisioning' && m.hetznerId) {
      try {
        const hetznerStatus = await hetznerClient.getServerStatus(m.hetznerId);
        if (hetznerStatus === 'running') {
          await db.update(machines).set({ status: 'ready', readyAt: new Date() }).where(eq(machines.id, m.id));
          m.status = 'ready';
          m.readyAt = new Date();
        }
      } catch {}
    }
  }

  return c.json({ machines: result.map(m => serializeMachine(m)) });
});

// ─── GET /:id — Get Machine ────────────────────────────────────────────────

machinesApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  let [machine] = await db.select().from(machines).where(eq(machines.id, id));
  if (!machine || machine.ownerId !== ownerId) {
    return c.json({ error: true, message: 'Machine not found', status: 404 }, 404);
  }

  // Auto-transition: if provisioning + Hetzner says running → mark ready
  if (machine.status === 'provisioning' && machine.hetznerId) {
    try {
      const hetznerStatus = await hetznerClient.getServerStatus(machine.hetznerId);
      if (hetznerStatus === 'running') {
        await db.update(machines).set({ status: 'ready', readyAt: new Date() }).where(eq(machines.id, id));
        [machine] = await db.select().from(machines).where(eq(machines.id, id));
      }
    } catch {
      // Hetzner check failed — keep current status
    }
  }

  return c.json(serializeMachine(machine));
});

// ─── DELETE /:id — Destroy Machine ──────────────────────────────────────────

machinesApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const [machine] = await db.select().from(machines).where(eq(machines.id, id));
  if (!machine || machine.ownerId !== ownerId) {
    return c.json({ error: true, message: 'Machine not found', status: 404 }, 404);
  }

  try {
    // Delete Hetzner server
    if (machine.hetznerId) {
      await hetznerClient.deleteServer(machine.hetznerId);
    }

    // Delete DNS record
    if (config.isCloudflareConfigured()) {
      await cloudflareClient.deleteDNSRecord(machine.slug);
    }

    // Cancel Stripe subscription
    if (stripeClient.isConfigured() && machine.stripeSubItemId) {
      const subId = machine.stripeSubItemId.split('|')[0];
      await stripeClient.cancelMachineSubscription(subId).catch(() => {});
    }

    // Mark as deleted in DB
    await db.update(machines)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(machines.id, id));

    return c.body(null, 204);
  } catch (err) {
    console.error('[MACHINES] delete error:', err);
    return c.json({ error: true, message: 'Failed to delete machine', status: 500 }, 500);
  }
});

// ─── POST /:id/reboot ───────────────────────────────────────────────────────

machinesApp.post('/:id/reboot', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const [machine] = await db.select().from(machines).where(eq(machines.id, id));
  if (!machine || machine.ownerId !== ownerId || !machine.hetznerId) {
    return c.json({ error: true, message: 'Machine not found', status: 404 }, 404);
  }
  await hetznerClient.rebootServer(machine.hetznerId);
  return c.json({ action: 'reboot', status: 'initiated' }, 202);
});

// ─── POST /:id/resize ───────────────────────────────────────────────────────

machinesApp.post('/:id/resize', async (c) => {
  const id = c.req.param('id');
  const ownerId = c.get('userId');
  const body = await c.req.json();
  const parsed = ResizeMachineSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: true, message: 'Invalid request', status: 400 }, 400);
  }

  const [machine] = await db.select().from(machines).where(eq(machines.id, id));
  if (!machine || machine.ownerId !== ownerId || !machine.hetznerId) {
    return c.json({ error: true, message: 'Machine not found', status: 404 }, 404);
  }

  try {
    await hetznerClient.resizeServer(machine.hetznerId, parsed.data.server_type);
    await db.update(machines)
      .set({ serverType: parsed.data.server_type })
      .where(eq(machines.id, id));

    // Update Stripe subscription price
    if (stripeClient.isConfigured() && machine.stripeSubItemId) {
      const subItemId = machine.stripeSubItemId.split('|')[1];
      const serverTypes = await hetznerClient.listServerTypes(machine.region);
      const st = serverTypes.find(t => t.name === parsed.data.server_type);
      if (st && subItemId) {
        await stripeClient.updateMachineSubscription(subItemId, st.priceMonthlyOurs, parsed.data.server_type, machine.id)
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
    console.error('[MACHINES] resize error:', err);
    return c.json({ error: true, message: 'Failed to resize machine', status: 500 }, 500);
  }
});
