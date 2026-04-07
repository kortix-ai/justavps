import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { accounts, machines, users, sshKeys, subscriptions } from '../db/schema';
import { generateMachineToken, fingerprintSSHKey, encryptSecret } from './crypto';
import { generateSSHKeyPair } from './ssh-keygen';
import { buildCloudInit } from './cloud-init';
import { config } from './config';
import { cloudflareClient, type MachineRoutingKVRecord } from './cloudflare';
import { stripeClient, type MachineSpecs } from './stripe';
import { getProvider, type ComputeProvider } from './providers';
import { updateProviderMeta } from './provider-meta';
import { resolvePlanForDisplay, STARTING_MONTHLY_PRICE, marketForRegion } from '@/lib/plan-catalog';

interface ProvisionProviderMeta {
  create_action_id?: string | null;
  create_progress?: number | null;
  create_status?: string | null;
  public_ipv4?: string | null;
  public_ipv6?: string | null;
  callback_expected?: boolean;
  callback_url?: string | null;
  last_callback_at?: string | null;
  last_probe_at?: string | null;
  ready_via?: 'heartbeat' | 'probe' | null;
  daemon_reachable_at?: string | null;
}

export async function generateMachineIdentity() {
  const slug = nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const machineToken = generateMachineToken();
  return { slug, machineToken };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isPrivateIpv4(hostname: string): boolean {
  return /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isPublicCallbackOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    if (isLoopbackHostname(hostname) || isPrivateIpv4(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function resolveMachineCallbackConfig(requestUrl?: string): { url: string; callbackExpected: boolean } {
  if (config.MACHINE_CALLBACK_URL) {
    return { url: config.MACHINE_CALLBACK_URL, callbackExpected: true };
  }

  const candidates = [
    requestUrl ? (() => {
      try {
        return new URL(requestUrl).origin;
      } catch {
        return '';
      }
    })() : '',
    config.PLATFORM_URL,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isPublicCallbackOrigin(candidate)) {
      return { url: candidate, callbackExpected: true };
    }
  }

  return { url: config.PLATFORM_URL, callbackExpected: false };
}

export function resolvePlatformCallbackUrl(requestUrl?: string): string {
  return resolveMachineCallbackConfig(requestUrl).url;
}

function readProviderMeta(machine: typeof machines.$inferSelect): ProvisionProviderMeta {
  return (machine.providerMeta ?? {}) as ProvisionProviderMeta;
}

export async function uploadSSHKeyToProvider(
  provider: ComputeProvider,
  slug: string,
  publicKey: string,
): Promise<string> {
  const maxRetries = 3;
  let lastError: Error | undefined;
  let didGC = false;

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

      // If we hit the SSH key limit, auto-GC orphaned keys and retry
      if (!didGC && err instanceof Error && (err.message.includes('resource_limit_exceeded') || err.message.includes('ssh_key_limit') || err.message.includes('ssh_key limit'))) {
        didGC = true;
        console.warn(`[MACHINES] SSH key limit reached — running GC to prune orphaned keys...`);
        try {
          const { HetznerProvider } = await import('./providers/hetzner');
          if (provider instanceof HetznerProvider) {
            const gc = await provider.gcSSHKeys();
            console.log(`[MACHINES] SSH key GC complete: ${gc.deleted} deleted, ${gc.total} total`);
            if (gc.deleted > 0) {
              // Retry immediately after GC
              try {
                const result = await provider.uploadSSHKey(`justavps-${slug}`, publicKey);
                return result.keyId;
              } catch (retryErr: unknown) {
                lastError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
              }
            }
          }
        } catch (gcErr) {
          console.error(`[MACHINES] SSH key GC failed:`, gcErr);
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
  extraSSHKeys?: string[],
  cloudInitScript?: string,
) {
  return buildCloudInit({
    slug,
    sshPublicKey,
    machineToken,
    platformCallbackUrl,
    proxyDomain: config.PROXY_DOMAIN,
    envVars,
    extraSSHKeys,
    cloudInitScript,
    daemonChannel: config.DAEMON_CHANNEL,
  });
}

function buildMachineRoutingKVData(input: {
  machineId: string;
  slug: string;
  accountId: string;
  ip: string;
  status: string;
  serverType: string;
}): MachineRoutingKVRecord {
  return {
    machine_id: input.machineId,
    account_id: input.accountId,
    ip: input.ip,
    status: input.status,
    server_type: input.serverType,
  };
}

/**
 * Register machine in Cloudflare:
 * - Writes machine:{slug} to KV for Worker auth/routing (HTTP proxy)
 * - Creates unproxied A record at `origin-{slug}.<PROXY_DOMAIN>` so SSH can
 *   reach the baremetal host via a pretty hostname instead of the raw IP.
 *   The host's Incus proxy device NATs the per-machine SSH port to the VM.
 */
export async function setupProxyDNS(
  machineId: string,
  slug: string,
  addresses: { ipv4?: string | null; ipv6?: string | null },
  accountId: string,
  serverType: string,
) {
  if (!config.isCloudflareConfigured()) return;

  const primaryIp = addresses.ipv4 ?? addresses.ipv6;
  if (!primaryIp) return;

  // 1. KV entry for HTTP routing via Worker
  await cloudflareClient.writeKVMachine(slug, buildMachineRoutingKVData({
    machineId,
    slug,
    accountId,
    ip: primaryIp,
    status: 'provisioning',
    serverType,
  })).catch((err: unknown) => {
    console.warn(`[CF KV] Failed to write machine:${slug}:`, err);
  });

  // 2. Unproxied DNS record for SSH access (origin-<slug>.<domain>)
  await cloudflareClient.addMachineDNS(slug, addresses).catch((err: unknown) => {
    console.warn(`[CF DNS] Failed to create origin record for ${slug}:`, err);
  });
}

export async function lookupPriceAndSpecs(
  provider: ComputeProvider,
  region: string,
  serverType: string,
): Promise<{ priceMonthly: number; specs?: MachineSpecs }> {
  // serverType can be a plan ID ("pro") or a legacy provider SKU ("cpx42").
  // resolvePlanForDisplay handles both.
  const market = marketForRegion(region) ?? undefined;
  const mapped = resolvePlanForDisplay(serverType, market);
  if (mapped) {
    return {
      priceMonthly: mapped.priceMonthly,
      specs: { vcpus: mapped.vcpu, ramGb: mapped.memory, diskGb: mapped.disk, cpuType: 'shared' },
    };
  }

  try {
    const serverTypes = await provider.listServerTypes(region);
    const st = serverTypes.find(t => t.name === serverType);
    if (!st) return { priceMonthly: STARTING_MONTHLY_PRICE };
    return {
      priceMonthly: st.priceMonthly,
      specs: { vcpus: st.cores, ramGb: st.memory, diskGb: st.disk, cpuType: st.cpuType },
    };
  } catch {
    return { priceMonthly: STARTING_MONTHLY_PRICE };
  }
}

/**
 * Resolve SSH key IDs to their public keys.
 * Only returns keys belonging to the specified owner.
 */
export async function resolveSSHKeyPublicKeys(
  accountId: string,
  sshKeyIds: string[],
): Promise<string[]> {
  if (!sshKeyIds.length) return [];
  const keys = await db.select({ publicKey: sshKeys.publicKey })
    .from(sshKeys)
    .where(and(eq(sshKeys.accountId, accountId), inArray(sshKeys.id, sshKeyIds)));
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
  accountId: string,
  slug: string,
): Promise<{ publicKey: string; privateKey: string; keyId: string }> {
  const keyPair = generateSSHKeyPair(`${slug}@justavps`);
  const fingerprint = fingerprintSSHKey(keyPair.publicKey);

  const [saved] = await db.insert(sshKeys).values({
    ownerId,
    accountId,
    name: `auto-${slug}`,
    publicKey: keyPair.publicKey,
    fingerprint,
    providerKeyId: null,
  }).returning();

  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, keyId: saved.id };
}

interface CreateMachineInput {
  ownerId: string;
  accountId: string;
  slug: string;
  name: string;
  provider: string;
  imageId: string | null;
  serverType: string;
  region: string;
  ip: string | null;
  providerServerId: string | null;
  machineToken: string;
  sshPublicKey: string | null;
  sshPrivateKey: string | null;
  priceMonthly: number | null;
  backupsEnabled?: boolean;
}

export async function createMachineRecord(input: CreateMachineInput) {
  const [machine] = await db.insert(machines).values({
    ...input,
    sshPublicKey: input.sshPublicKey ?? '',
    backupsEnabled: input.backupsEnabled ?? true,
    // Encrypt secrets at rest — decrypted on read via decryptSecret()
    machineToken: encryptSecret(input.machineToken),
    sshPrivateKey: input.sshPrivateKey ? encryptSecret(input.sshPrivateKey) : '',
    codeServerPassword: '',
  }).returning();
  return machine;
}

export async function createStripeSubscription(
  ownerId: string,
  accountId: string,
  machineId: string,
  slug: string,
  priceMonthly: number,
  serverType: string,
  specs?: MachineSpecs,
  isAdmin = false,
) {
  if (!stripeClient.isConfigured()) return;
  try {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    const [user] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!account || !user) return;

    const customerId = await stripeClient.getOrCreateCustomer(accountId, account.billingEmail || user.email, account.stripeCustomerId);
    if (!account.stripeCustomerId) {
      await db.update(accounts).set({ stripeCustomerId: customerId }).where(eq(accounts.id, accountId));
    }

    const createSub = isAdmin
      ? stripeClient.createAdminMachineSubscription
      : stripeClient.createMachineSubscription;

    const { subscriptionId, subscriptionItemId } = await createSub.call(
      stripeClient, customerId, machineId, slug, priceMonthly, serverType, specs,
    );
    await db.insert(subscriptions).values({
      machineId,
      ownerId,
      accountId,
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

  const providerServerId = machine.providerServerId
    ?? (machine.provider === 'baremetal' ? `justavps-${machine.slug}` : null);

  if (providerServerId) {
    await provider.deleteServer(providerServerId);
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
 * Cloud-init downloads daemon + sandbox-agent,
 * so 20 minutes is a reasonable upper bound.
 */
const PROVISION_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

export async function syncMachineStatus(machine: typeof machines.$inferSelect) {
  const meta = readProviderMeta(machine);
  const missingPublicNetwork = !machine.ip && !meta.public_ipv4 && !meta.public_ipv6;
  const shouldRefreshCloudNetwork = machine.provider === 'cloud'
    && !!machine.providerServerId
    && missingPublicNetwork;

  if (shouldRefreshCloudNetwork) {
    try {
      const provider = getProvider(machine.provider);
      if (provider.getServerNetwork) {
        const network = await provider.getServerNetwork(machine.providerServerId!);
        const nextIp = network.publicIpv4 ?? network.publicIpv6 ?? machine.ip;
        const nextMeta = await updateProviderMeta(machine.id, {
          public_ipv4: network.publicIpv4,
          public_ipv6: network.publicIpv6,
        });

        if (nextIp !== machine.ip) {
          await db.update(machines).set({ ip: nextIp }).where(eq(machines.id, machine.id));
        }

        machine = { ...machine, ip: nextIp, providerMeta: nextMeta };

        if (config.isCloudflareConfigured() && nextIp) {
          await cloudflareClient.writeKVMachine(machine.slug, buildMachineRoutingKVData({
            machineId: machine.id,
            slug: machine.slug,
            accountId: machine.accountId ?? machine.ownerId,
            ip: nextIp,
            status: machine.status,
            serverType: machine.serverType,
          })).catch((err) => {
            console.warn(`[MACHINES] Failed to sync KV for ${machine.slug}:`, err);
          });
        }
      }
    } catch (err) {
      console.warn(`[MACHINES] Failed to refresh public network for ${machine.slug}:`, err);
    }
  }

  // Only run sync logic for provisioning machines (or timeout-recoverable errors)
  const canRecoverTimeout = machine.status === 'error' && machine.provisioningStage === 'timeout';
  if ((machine.status !== 'provisioning' && !canRecoverTimeout) || !machine.providerServerId) return machine;

  // ── Heartbeat arrived → mark ready ──────────────────────────────────────
  if (machine.lastHeartbeatAt) {
    const now = new Date();
    await db.update(machines).set({
      status: 'ready',
      readyAt: now,
      provisioningStage: machine.provisioningStage ?? 'services_ready',
    }).where(eq(machines.id, machine.id));
    return { ...machine, status: 'ready' as const, readyAt: now };
  }

  // ── Provisioning timeout ─────────────────────────────────────────────────
  if (Date.now() - machine.createdAt.getTime() > PROVISION_TIMEOUT_MS) {
    console.warn(`[MACHINES] Provisioning timeout for ${machine.slug} (${Math.round((Date.now() - machine.createdAt.getTime()) / 1000)}s elapsed, no heartbeat)`);
    await db.update(machines).set({
      status: 'error',
      provisioningStage: 'timeout',
    }).where(eq(machines.id, machine.id));
    const { eventBus } = await import('./event-bus');
    await eventBus.emitStatusChange(machine.id, machine.accountId ?? machine.ownerId, 'error', 'Provisioning timed out');
    return { ...machine, status: 'error' as const, provisioningStage: 'timeout' };
  }

  return machine;
}
