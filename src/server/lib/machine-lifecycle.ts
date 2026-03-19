import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { machines, users, sshKeys } from '../db/schema';
import { generateMachineToken, fingerprintSSHKey } from './crypto';
import { generateSSHKeyPair } from './ssh-keygen';
import { buildCloudInit } from './cloud-init';
import { config } from './config';
import { cloudflareClient } from './cloudflare';
import { stripeClient, type MachineSpecs } from './stripe';
import type { ComputeProvider } from './providers';
import { broadcastToProviders } from './provider-sync';

export async function generateMachineIdentity() {
  const slug = nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const machineToken = generateMachineToken();
  return { slug, machineToken };
}

export async function uploadSSHKeyToProvider(
  provider: ComputeProvider,
  slug: string,
  publicKey: string,
): Promise<string | undefined> {
  try {
    const result = await provider.uploadSSHKey(`justavps-${slug}`, publicKey);
    return result.keyId;
  } catch (err: any) {
    console.warn(`[MACHINES] SSH key upload to ${provider.name} failed (non-fatal):`, err.message?.slice(0, 100));
    return undefined;
  }
}

export function buildMachineUserData(
  slug: string,
  sshPublicKey: string,
  machineToken: string,
  envVars?: Record<string, string>,
  dockerImage?: string,
  entrypoint?: string,
  extraSSHKeys?: string[],
) {
  return buildCloudInit({
    slug,
    sshPublicKey,
    machineToken,
    platformCallbackUrl: config.PLATFORM_URL,
    proxyDomain: config.PROXY_DOMAIN,
    envVars,
    dockerImage,
    entrypoint,
    extraSSHKeys,
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
 */
export async function autoGenerateAndSaveSSHKey(
  ownerId: string,
  slug: string,
): Promise<{ publicKey: string; privateKey: string; keyId: string }> {
  const keyPair = generateSSHKeyPair(`${slug}@justavps`);
  const fingerprint = fingerprintSSHKey(keyPair.publicKey);

  // Upload to providers (best-effort)
  const uploaded = await broadcastToProviders(
    (provider) => provider.uploadSSHKey(`justavps-auto-${slug}`, keyPair.publicKey),
    'SSH-KEYS-AUTO',
  );
  const providerKeyId = uploaded?.result.keyId ?? null;

  const [saved] = await db.insert(sshKeys).values({
    ownerId,
    name: `auto-${slug}`,
    publicKey: keyPair.publicKey,
    fingerprint,
    providerKeyId,
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

    const customerId = await stripeClient.getOrCreateCustomer(ownerId, user.email);
    if (!user.stripeCustomerId) {
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, ownerId));
    }

    const { subscriptionId, subscriptionItemId } = await stripeClient.createMachineSubscription(
      customerId, machineId, slug, priceMonthly, serverType, specs,
    );
    await db.update(machines).set({
      stripeSubItemId: `${subscriptionId}|${subscriptionItemId}`,
    }).where(eq(machines.id, machineId));
  } catch (err) {
    console.error('[MACHINES] Stripe subscription creation failed (non-fatal):', err);
  }
}

export async function cleanupMachineResources(
  machine: typeof machines.$inferSelect,
  provider: ComputeProvider,
) {
  if (machine.providerServerId) {
    await provider.deleteServer(machine.providerServerId);
  }

  if (config.isCloudflareConfigured()) {
    await cloudflareClient.removeMachineDNS(machine.slug).catch(() => {});
    await cloudflareClient.deleteKVMachine(machine.slug);
  }

  if (stripeClient.isConfigured() && machine.stripeSubItemId) {
    const subId = machine.stripeSubItemId.split('|')[0];
    await stripeClient.cancelMachineSubscription(subId).catch(() => {});
  }

  await db.update(machines)
    .set({ status: 'deleted', deletedAt: new Date() })
    .where(eq(machines.id, machine.id));
}

export async function syncMachineStatus(machine: typeof machines.$inferSelect) {
  if (machine.status !== 'provisioning' || !machine.providerServerId) return machine;

  try {
    const { getProvider } = await import('./providers');
    const provider = getProvider(machine.provider);
    const providerStatus = await provider.getServerStatus(machine.providerServerId);
    if (providerStatus === 'running') {
      const now = new Date();
      await db.update(machines).set({ status: 'ready', readyAt: now }).where(eq(machines.id, machine.id));
      return { ...machine, status: 'ready' as const, readyAt: now };
    }
  } catch (err) {
    console.error(`[MACHINES] syncMachineStatus error for ${machine.id}:`, err);
  }

  return machine;
}
