import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { machines, users, sshKeys, subscriptions } from '../db/schema';
import { generateMachineToken, fingerprintSSHKey, encryptSecret } from './crypto';
import { generateSSHKeyPair } from './ssh-keygen';
import { buildCloudInit } from './cloud-init';
import { config } from './config';
import { cloudflareClient } from './cloudflare';
import { stripeClient, type MachineSpecs } from './stripe';
import { signProxyToken } from './proxy-token';
import { getProvider, type ComputeProvider } from './providers';
import { getPlanBySku, STARTING_MONTHLY_PRICE } from '@/lib/hetzner-pricing';

interface ProvisionProviderMeta {
  create_action_id?: string | null;
  create_progress?: number | null;
  create_status?: string | null;
  callback_expected?: boolean;
  callback_url?: string | null;
  last_callback_at?: string | null;
  last_probe_at?: string | null;
  ready_via?: 'heartbeat' | 'probe' | null;
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
  const candidates = [
    config.MACHINE_CALLBACK_URL,
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

function normalizeProvisionedMachineIp(machine: typeof machines.$inferSelect): string | null {
  if (machine.provider !== 'cloud' || !machine.ip) return null;
  if (machine.ip.endsWith('::')) return `${machine.ip}1`;
  return null;
}

async function updateProviderMeta(machineId: string, patch: Partial<ProvisionProviderMeta>) {
  const [current] = await db.select({ providerMeta: machines.providerMeta }).from(machines).where(eq(machines.id, machineId));
  const merged = {
    ...((current?.providerMeta ?? {}) as ProvisionProviderMeta),
    ...patch,
  };
  await db.update(machines).set({ providerMeta: merged }).where(eq(machines.id, machineId));
  return merged;
}

async function probeMachineDaemon(machine: typeof machines.$inferSelect): Promise<boolean> {
  if (!config.isCloudflareConfigured()) return false;
  const token = await signProxyToken(machine.ownerId);
  const url = `https://${machine.slug}.${config.PROXY_DOMAIN}/daemon/health?token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null) as { status?: string } | null;
    return data?.status === 'ok';
  } catch {
    return false;
  }
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
 * Register machine in Cloudflare: DNS AAAA records + KV.
 * - Creates AAAA record slug.kortix.cloud → VPS_IPv6 (proxied)
 * - Creates wildcard AAAA *.slug.kortix.cloud → VPS_IPv6 (for port subdomains)
 * - Writes machine:{slug} to KV for Worker auth
 */
export async function setupProxyDNS(
  slug: string,
  ip: string,
  ownerId: string,
  serverType: string,
) {
  if (!config.isCloudflareConfigured()) return;
  
  // DNS AAAA records (slug + wildcard for port subdomains)
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
  const mapped = getPlanBySku(serverType);
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
  backupsEnabled?: boolean;
}

export async function createMachineRecord(input: CreateMachineInput) {
  const [machine] = await db.insert(machines).values({
    ...input,
    backupsEnabled: input.backupsEnabled ?? true,
    // Encrypt secrets at rest — decrypted on read via decryptSecret()
    machineToken: encryptSecret(input.machineToken),
    sshPrivateKey: encryptSecret(input.sshPrivateKey),
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
  isAdmin = false,
) {
  if (!stripeClient.isConfigured()) return;
  try {
    const [user] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!user) return;

    const customerId = await stripeClient.getOrCreateCustomer(ownerId, user.email, user.stripeCustomerId);
    if (!user.stripeCustomerId) {
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, ownerId));
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
  const canRecoverTimeout = machine.status === 'error' && machine.provisioningStage === 'timeout';
  if ((machine.status !== 'provisioning' && !canRecoverTimeout) || !machine.providerServerId) return machine;

  const healedIp = normalizeProvisionedMachineIp(machine);
  if (healedIp) {
    await db.update(machines).set({ ip: healedIp }).where(eq(machines.id, machine.id));
    machine = { ...machine, ip: healedIp };

    if (config.isCloudflareConfigured()) {
      await cloudflareClient.addMachineDNS(machine.slug, healedIp).catch((err) => {
        console.warn(`[MACHINES] Failed to heal DNS for ${machine.slug}:`, err);
      });
      await cloudflareClient.writeKVMachine(machine.slug, {
        owner_id: machine.ownerId,
        ip: healedIp,
        origin_hostname: `origin-${machine.slug}.${config.PROXY_DOMAIN}`,
        status: machine.status,
        server_type: machine.serverType,
      }).catch((err) => {
        console.warn(`[MACHINES] Failed to heal KV for ${machine.slug}:`, err);
      });
    }
  }

  const elapsed = Date.now() - machine.createdAt.getTime();
  const timeoutMs = machine.dockerImage ? PROVISION_TIMEOUT_DOCKER_MS : PROVISION_TIMEOUT_MS;
  const meta = readProviderMeta(machine);

  if (machine.provider === 'cloud' && meta.create_action_id) {
    try {
      const provider = getProvider(machine.provider);
      if (provider.getActionProgress) {
        const action = await provider.getActionProgress(meta.create_action_id);
        const nextMeta = await updateProviderMeta(machine.id, {
          create_status: action.status,
          create_progress: action.progress,
        });
        machine = { ...machine, providerMeta: nextMeta };
      }
    } catch (err) {
      console.warn(`[MACHINES] Failed to refresh provider action for ${machine.slug}:`, err);
    }
  }

  // Fast path: if we already got a heartbeat but status is still stale, promote now.
  if (machine.lastHeartbeatAt) {
    const now = new Date();
    await db.update(machines).set({
      status: 'ready',
      readyAt: now,
      provisioningStage: machine.provisioningStage ?? 'services_ready',
    }).where(eq(machines.id, machine.id));
    return { ...machine, status: 'ready' as const, readyAt: now };
  }

  const createFinished = meta.create_status === 'success' || meta.create_progress === 100;
  const shouldProbeDaemon = !!machine.ip && (
    createFinished
    || machine.provisioningStage === 'server_created'
    || elapsed > 30_000
  );

  if (shouldProbeDaemon) {
    const daemonReady = await probeMachineDaemon(machine);
    const probedMeta = await updateProviderMeta(machine.id, {
      last_probe_at: new Date().toISOString(),
    });
    machine = { ...machine, providerMeta: probedMeta };

    if (daemonReady) {
      const now = new Date();
      const nextMeta = await updateProviderMeta(machine.id, {
        ready_via: 'probe',
      });
      await db.update(machines).set({
        status: 'ready',
        readyAt: now,
        provisioningStage: 'services_ready',
        providerMeta: nextMeta,
      }).where(eq(machines.id, machine.id));

      const { eventBus } = await import('./event-bus');
      await eventBus.emitStageChange(machine.id, machine.ownerId, 'services_ready', 'Daemon is reachable via proxy health check');
      await eventBus.emitStatusChange(machine.id, machine.ownerId, 'ready', 'Machine is ready');

      if (config.isCloudflareConfigured() && machine.ip) {
        cloudflareClient.writeKVMachine(machine.slug, {
          owner_id: machine.ownerId,
          ip: machine.ip,
          origin_hostname: `origin-${machine.slug}.${config.PROXY_DOMAIN}`,
          status: 'ready',
          server_type: machine.serverType,
        }).catch(() => {});
      }

      return {
        ...machine,
        status: 'ready' as const,
        readyAt: now,
        provisioningStage: 'services_ready',
        providerMeta: nextMeta,
      };
    }
  }

  // If provisioning has exceeded the timeout and we still haven't received
  // a heartbeat or a successful active probe, mark it as error.
  if (elapsed > timeoutMs) {
    console.warn(`[MACHINES] Provisioning timeout for ${machine.slug} (${Math.round(elapsed / 1000)}s elapsed, no heartbeat or successful probe)`);
    await db.update(machines).set({
      status: 'error',
      provisioningStage: 'timeout',
    }).where(eq(machines.id, machine.id));

    const { eventBus } = await import('./event-bus');
    await eventBus.emitStatusChange(machine.id, machine.ownerId, 'error', 'Provisioning timed out — machine never became reachable');

    return { ...machine, status: 'error' as const, provisioningStage: 'timeout' };
  }

  return machine;
}
