/**
 * Machine lifecycle — step functions extracted from the machines POST handler.
 * Each function handles one discrete step of machine creation/teardown.
 */

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { machines, users } from '../db/schema';
import { generateMachineToken, generatePassword } from './crypto';
import { buildCloudInit } from './cloud-init';
import { config } from './config';
import { cloudflareClient } from './cloudflare';
import { stripeClient } from './stripe';
import type { ComputeProvider, ProviderSnapshot } from './providers';

// ─── Identity ────────────────────────────────────────────────────────────────

export async function generateMachineIdentity() {
  const slug = nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const machineToken = generateMachineToken();
  const codeServerPassword = generatePassword(20);

  const { generateSSHKeyPair } = await import('./ssh-keygen');
  const keyPair = generateSSHKeyPair(`${slug}@justavps`);

  return { slug, machineToken, codeServerPassword, keyPair };
}

// ─── SSH Key Upload ──────────────────────────────────────────────────────────

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

// ─── Cloud-Init ──────────────────────────────────────────────────────────────

export function buildMachineUserData(
  slug: string,
  codeServerPassword: string,
  sshPublicKey: string,
  machineToken: string,
) {
  return buildCloudInit({
    slug,
    codeServerPassword,
    sshPublicKey,
    machineToken,
    platformCallbackUrl: config.PLATFORM_URL,
    proxyDomain: config.PROXY_DOMAIN,
  });
}

// ─── DNS + KV ────────────────────────────────────────────────────────────────

export async function setupDNSAndKV(
  slug: string,
  ip: string,
  ownerId: string,
  serverType: string,
) {
  if (!config.isCloudflareConfigured()) return;
  await cloudflareClient.createDNSRecord(slug, ip);
  await cloudflareClient.writeKVMachine(slug, {
    owner_id: ownerId,
    ip,
    status: 'provisioning',
    server_type: serverType,
  }).catch(() => {});
}

// ─── Price Lookup ────────────────────────────────────────────────────────────

export async function lookupPrice(
  provider: ComputeProvider,
  region: string,
  serverType: string,
  snapshot?: ProviderSnapshot,
): Promise<number> {
  try {
    const serverTypes = await provider.listServerTypes(region, snapshot);
    const st = serverTypes.find(t => t.name === serverType);
    return st?.priceMonthly ?? 30;
  } catch {
    return 30;
  }
}

// ─── DB Record ───────────────────────────────────────────────────────────────

interface CreateMachineInput {
  ownerId: string;
  slug: string;
  name: string;
  provider: string;
  snapshotId: string;
  serverType: string;
  region: string;
  ip: string;
  providerServerId: string;
  machineToken: string;
  codeServerPassword: string;
  sshPublicKey: string;
  sshPrivateKey: string;
  priceMonthly: number;
}

export async function createMachineRecord(input: CreateMachineInput) {
  const [machine] = await db.insert(machines).values(input).returning();
  return machine;
}

// ─── Stripe Subscription ────────────────────────────────────────────────────

export async function createStripeSubscription(
  ownerId: string,
  machineId: string,
  slug: string,
  priceMonthly: number,
  serverType: string,
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
      customerId, machineId, slug, priceMonthly, serverType,
    );
    await db.update(machines).set({
      stripeSubItemId: `${subscriptionId}|${subscriptionItemId}`,
    }).where(eq(machines.id, machineId));
  } catch (err) {
    console.error('[MACHINES] Stripe subscription creation failed (non-fatal):', err);
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function cleanupMachineResources(
  machine: typeof machines.$inferSelect,
  provider: ComputeProvider,
) {
  if (machine.providerServerId) {
    await provider.deleteServer(machine.providerServerId);
  }

  if (config.isCloudflareConfigured()) {
    await cloudflareClient.deleteDNSRecord(machine.slug);
  }

  if (stripeClient.isConfigured() && machine.stripeSubItemId) {
    const subId = machine.stripeSubItemId.split('|')[0];
    await stripeClient.cancelMachineSubscription(subId).catch(() => {});
  }

  await db.update(machines)
    .set({ status: 'deleted', deletedAt: new Date() })
    .where(eq(machines.id, machine.id));
}

// ─── Status Sync ─────────────────────────────────────────────────────────────

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
  } catch {}

  return machine;
}
