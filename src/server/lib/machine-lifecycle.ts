import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { machines, users } from '../db/schema';
import { generateMachineToken, generatePassword } from './crypto';
import { buildCloudInit } from './cloud-init';
import { config } from './config';
import { cloudflareClient } from './cloudflare';
import { stripeClient, type MachineSpecs } from './stripe';
import type { ComputeProvider } from './providers';

export async function generateMachineIdentity() {
  const slug = nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const machineToken = generateMachineToken();
  const codeServerPassword = generatePassword(20);

  const { generateSSHKeyPair } = await import('./ssh-keygen');
  const keyPair = generateSSHKeyPair(`${slug}@justavps`);

  return { slug, machineToken, codeServerPassword, keyPair };
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
  codeServerPassword: string,
  sshPublicKey: string,
  machineToken: string,
  envVars?: Record<string, string>,
  dockerImage?: string,
  entrypoint?: string,
) {
  return buildCloudInit({
    slug,
    codeServerPassword,
    sshPublicKey,
    machineToken,
    platformCallbackUrl: config.PLATFORM_URL,
    proxyDomain: config.PROXY_DOMAIN,
    envVars,
    dockerImage,
    entrypoint,
  });
}

/**
 * Register machine in Cloudflare: DNS records + KV for proxy Worker.
 * Creates: slug.kortix.cloud + origin.slug.kortix.cloud → VPS IP
 * Writes: machine:{slug} → { owner_id, ip, status, server_type } to KV
 */
export async function setupProxyKV(
  slug: string,
  ip: string,
  ownerId: string,
  serverType: string,
) {
  if (!config.isCloudflareConfigured()) return;
  
  // DNS records (slug + origin.slug)
  await cloudflareClient.createDNSRecords(slug, ip).catch((err: unknown) => {
    console.warn(`[CF DNS] Failed to create DNS for ${slug}:`, err);
  });

  // KV entry for Worker auth
  await cloudflareClient.writeKVMachine(slug, {
    owner_id: ownerId,
    ip,
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
  codeServerPassword: string;
  sshPublicKey: string;
  sshPrivateKey: string;
  priceMonthly: number | null;
  dockerImage?: string | null;
  entrypoint?: string | null;
}

export async function createMachineRecord(input: CreateMachineInput) {
  const [machine] = await db.insert(machines).values(input).returning();
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
    await cloudflareClient.deleteDNSRecords(machine.slug).catch(() => {});
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
