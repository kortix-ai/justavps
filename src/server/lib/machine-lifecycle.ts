import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { machines, users, sshKeys, subscriptions } from '../db/schema';
import { generateMachineToken, fingerprintSSHKey } from './crypto';
import { generateSSHKeyPair } from './ssh-keygen';
import { buildCloudInit } from './cloud-init';
import { config } from './config';
import { cloudflareClient } from './cloudflare';
import { stripeClient, type MachineSpecs } from './stripe';
import type { ComputeProvider } from './providers';


export async function generateMachineIdentity() {
  const slug = nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const machineToken = generateMachineToken();
  return { slug, machineToken };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function resolvePlatformCallbackUrl(requestUrl?: string): string {
  const configured = config.PLATFORM_URL;

  if (requestUrl) {
    try {
      const requestOrigin = new URL(requestUrl).origin;
      const requestHostname = new URL(requestOrigin).hostname;
      if (!isLoopbackHostname(requestHostname)) {
        return requestOrigin;
      }
    } catch {
      // Ignore malformed request URLs and fall back to configured platform URL.
    }
  }

  return configured;
}

/**
 * Upload SSH key to provider. This is MANDATORY for server creation —
 * without it, the provider sets a temporary root password with forced expiry,
 * making SSH access impossible even with cloud-init injected keys.
 *
 * Retries up to 3 times before throwing.
 */
export async function uploadSSHKeyToProvider(
  provider: ComputeProvider,
  slug: string,
  publicKey: string,
): Promise<string> {
  const maxRetries = 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await provider.uploadSSHKey(`justavps-${slug}`, publicKey);
      return result.keyId;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If the key already exists (409/conflict or "already added"), try with a unique suffix
      if (err instanceof Error && (err.message.includes('already') || err.message.includes('409') || err.message.includes('uniqueness_error'))) {
        try {
          const result = await provider.uploadSSHKey(`justavps-${slug}-${Date.now()}`, publicKey);
          return result.keyId;
        } catch (retryErr: unknown) {
          lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
        }
      }
      if (attempt < maxRetries) {
        console.warn(`[MACHINES] SSH key upload attempt ${attempt}/${maxRetries} failed, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw new Error(
    `SSH key upload to ${provider.name} failed after ${maxRetries} attempts: ${lastError?.message?.slice(0, 200)}. ` +
    `Server creation aborted — without a provider-level SSH key, the machine would require a password change on first login.`
  );
}

export function buildMachineUserData(
  slug: string,
  sshPublicKey: string,
  machineToken: string,
  platformCallbackUrl: string,
  envVars?: Record<string, string>,
  dockerImage?: string,
  entrypoint?: string,
  command?: string,
  extraSSHKeys?: string[],
) {
  return buildCloudInit({
    slug,
    sshPublicKey,
    machineToken,
    platformCallbackUrl,
    proxyDomain: config.PROXY_DOMAIN,
    envVars,
    dockerImage,
    entrypoint,
    command,
    extraSSHKeys,
    daemonChannel: config.DAEMON_CHANNEL,
  });
}

/**
 * Register machine in Cloudflare: DNS A records + KV.
 * - Creates A record slug.kortix.cloud → VPS_IP (proxied)
 * - Creates wildcard A *.slug.kortix.cloud → VPS_IP (for port subdomains)
 * - Writes machine:{slug} to KV for Worker auth
 */
export async function setupProxyDNS(
  slug: string,
  ip: string,
  ownerId: string,
  serverType: string,
) {
  if (!config.isCloudflareConfigured()) return;
  
  // DNS A records (slug + wildcard for port subdomains)
  await cloudflareClient.addMachineDNS(slug, ip).catch((err: unknown) => {
    console.warn(`[CF] Failed to add DNS for ${slug}:`, err);
  });

  // KV for Worker auth (includes origin hostname for Worker fetch)
  await cloudflareClient.writeKVMachine(slug, {
    owner_id: ownerId,
    ip,
    origin_hostname: `origin-${slug}.${config.PROXY_DOMAIN}`,
    status: 'provisioning',
    server_type: serverType,
  }).catch((err: unknown) => {
    console.warn(`[CF KV] Failed to write machine:${slug}:`, err);
  });
}

export async function lookupPriceAndSpecs(
  provider: ComputeProvider,
  region: string,
  serverType: string,
): Promise<{ priceMonthly: number; specs?: MachineSpecs }> {
  try {
    const serverTypes = await provider.listServerTypes(region);
    const st = serverTypes.find(t => t.name === serverType);
    if (!st) return { priceMonthly: 30 };
    return {
      priceMonthly: st.priceMonthly,
      specs: { vcpus: st.cores, ramGb: st.memory, diskGb: st.disk, cpuType: st.cpuType },
    };
  } catch {
    return { priceMonthly: 30 };
  }
}

/**
 * Resolve SSH key IDs to their public keys.
 * Only returns keys belonging to the specified owner.
 */
export async function resolveSSHKeyPublicKeys(
  ownerId: string,
  sshKeyIds: string[],
): Promise<string[]> {
  if (!sshKeyIds.length) return [];
  const keys = await db.select({ publicKey: sshKeys.publicKey })
    .from(sshKeys)
    .where(and(eq(sshKeys.ownerId, ownerId), inArray(sshKeys.id, sshKeyIds)));
  return keys.map(k => k.publicKey);
}

/**
 * Auto-generate an SSH key and save it to the user's ssh_keys table.
 * The key is named "auto-{slug}" so users can identify which machine it was created for.
 *
 * NOTE: Does NOT upload to providers here — the caller must use
 * `uploadSSHKeyToProvider()` which has retries and hard-fails on error.
 * This avoids double-uploading and ensures the key ID used in createServer
 * is always valid.
 */
export async function autoGenerateAndSaveSSHKey(
  ownerId: string,
  slug: string,
): Promise<{ publicKey: string; privateKey: string; keyId: string }> {
  const keyPair = generateSSHKeyPair(`${slug}@justavps`);
  const fingerprint = fingerprintSSHKey(keyPair.publicKey);

  const [saved] = await db.insert(sshKeys).values({
    ownerId,
    name: `auto-${slug}`,
    publicKey: keyPair.publicKey,
    fingerprint,
    providerKeyId: null,
  }).returning();

  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, keyId: saved.id };
}

interface CreateMachineInput {
  ownerId: string;
  slug: string;
  name: string;
  provider: string;
  imageId: string | null;
  serverType: string;
  region: string;
  ip: string | null;
  providerServerId: string | null;
  machineToken: string;
  sshPublicKey: string;
  sshPrivateKey: string;
  priceMonthly: number | null;
  dockerImage?: string | null;
  entrypoint?: string | null;
  dockerCommand?: string | null;
}

export async function createMachineRecord(input: CreateMachineInput) {
  const [machine] = await db.insert(machines).values({
    ...input,
    codeServerPassword: '',
  }).returning();
  return machine;
}

export async function createStripeSubscription(
  ownerId: string,
  machineId: string,
  slug: string,
  priceMonthly: number,
  serverType: string,
  specs?: MachineSpecs,
) {
  if (!stripeClient.isConfigured()) return;
  try {
    const [user] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!user) return;

    const customerId = await stripeClient.getOrCreateCustomer(ownerId, user.email, user.stripeCustomerId);
    if (!user.stripeCustomerId) {
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, ownerId));
    }

    const { subscriptionId, subscriptionItemId } = await stripeClient.createMachineSubscription(
      customerId, machineId, slug, priceMonthly, serverType, specs,
    );
    await db.insert(subscriptions).values({
      machineId,
      ownerId,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionItemId: subscriptionItemId,
      status: 'active',
    });
  } catch (err) {
    console.error('[MACHINES] Stripe subscription creation failed (non-fatal):', err);
  }
}

export async function cleanupMachineResources(
  machine: typeof machines.$inferSelect,
  provider: ComputeProvider,
) {
  if (machine.source === 'kortix') {
    await db.update(machines)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(eq(machines.id, machine.id));
    return;
  }

  if (machine.providerServerId) {
    await provider.deleteServer(machine.providerServerId);
  }

  if (config.isCloudflareConfigured()) {
    await cloudflareClient.removeMachineDNS(machine.slug).catch(() => {});
    await cloudflareClient.deleteKVMachine(machine.slug);
  }

  if (stripeClient.isConfigured()) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, machine.id));
    if (sub) {
      await stripeClient.cancelMachineSubscription(sub.stripeSubscriptionId).catch(() => {});
    }
  }

  await db.update(machines)
    .set({ status: 'deleted', deletedAt: new Date() })
    .where(eq(machines.id, machine.id));
}

/**
 * Provisioning timeout — if a machine has been provisioning for longer than
 * this without receiving a heartbeat, mark it as error.
 *
 * Cloud-init downloads daemon + sandbox-agent + optionally Docker images,
 * so 5 minutes is a reasonable upper bound for non-Docker machines and
 * 10 minutes for Docker workloads.
 */
const PROVISION_TIMEOUT_MS = 20 * 60 * 1000; // 10 minutes
const PROVISION_TIMEOUT_DOCKER_MS = 30 * 60 * 1000; // 15 minutes for Docker workloads

export async function syncMachineStatus(machine: typeof machines.$inferSelect) {
  if (machine.status !== 'provisioning' || !machine.providerServerId) return machine;

  const elapsed = Date.now() - machine.createdAt.getTime();
  const timeoutMs = machine.dockerImage ? PROVISION_TIMEOUT_DOCKER_MS : PROVISION_TIMEOUT_MS;

  // If provisioning has exceeded the timeout and we still haven't received
  // a heartbeat, mark the machine as error so the user isn't stuck waiting.
  if (elapsed > timeoutMs && !machine.lastHeartbeatAt) {
    console.warn(`[MACHINES] Provisioning timeout for ${machine.slug} (${Math.round(elapsed / 1000)}s elapsed, no heartbeat)`);
    await db.update(machines).set({
      status: 'error',
      provisioningStage: 'timeout',
    }).where(eq(machines.id, machine.id));

    const { eventBus } = await import('./event-bus');
    await eventBus.emitStatusChange(machine.id, machine.ownerId, 'error', 'Provisioning timed out — no heartbeat received');

    return { ...machine, status: 'error' as const, provisioningStage: 'timeout' };
  }

  // Fallback: if Hetzner says running AND we have a heartbeat, promote to ready.
  // This handles the edge case where the heartbeat was received but the status
  // wasn't updated (shouldn't happen, but defensive).
  if (machine.lastHeartbeatAt) {
    const now = new Date();
    await db.update(machines).set({ status: 'ready', readyAt: now }).where(eq(machines.id, machine.id));
    return { ...machine, status: 'ready' as const, readyAt: now };
  }

  return machine;
}
