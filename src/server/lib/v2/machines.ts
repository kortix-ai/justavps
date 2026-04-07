import { and, eq, inArray, ne } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '../../db';
import { accounts, baremetalHosts, images, machines, subscriptions, users } from '../../db/schema';
import { config } from '../config';
import { resolveRequestedProviderImage, serializeImageRow } from '../image-catalog';
import { backupSurcharge } from '@/lib/plan-catalog';
import { getProvider } from '../providers';
import { stripeClient } from '../stripe';
import { eventBus } from '../event-bus';
import {
  autoGenerateAndSaveSSHKey,
  cleanupMachineResources,
  createMachineRecord,
  generateMachineIdentity,
  resolveMachineCallbackConfig,
  resolveSSHKeyPublicKeys,
  setupProxyDNS,
  syncMachineStatus,
  uploadSSHKeyToProvider,
} from '../machine-lifecycle';
import { checkMachineLimit } from '../account-limits';
import { decryptSecret } from '../crypto';
// v2-pricing is imported dynamically in createMachineV2

type MachineRow = typeof machines.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;
export interface V2MachineView {
  id: string;
  slug: string;
  name: string;
  status: 'provisioning' | 'ready' | 'error' | 'stopped' | 'deleted';
  provisioning_stage: string | null;
  provisioning_stage_updated_at: string | null;
  api_version: 'v2';
  region: string;
  resources: {
    vcpu: number;
    ram_gb: number;
    disk_gb: number;
  };
  billing: {
    mode: 'flat_monthly';
    price_monthly: number | null;
    current_period_end: string | null;
  };
  image: ReturnType<typeof serializeImageRow> | null;
  connectivity: {
    /** SSH host (always the proxy domain, never the raw host IP) */
    ssh_host: string | null;
    /** SSH port (NAT-forwarded by Incus proxy device on host) */
    ssh_port: number | null;
    /** Ready-to-paste SSH command */
    ssh_command: string | null;
    /** One-liner: write key to ~/.ssh, fix perms, ssh in immediately */
    ssh_setup_command: string | null;
    /** Block to append to ~/.ssh/config */
    ssh_config_block: string | null;
    /** Plain-text SSH private key (PEM format). Only returned to the machine owner. */
    ssh_private_key: string | null;
    /** Public key (optional, useful for clients adding extra keys) */
    ssh_public_key: string | null;
    /** Public proxy URLs */
    urls: {
      proxy: string;
      terminal: string;
      port_template: string;
    };
  };
  capabilities: {
    can_start: boolean;
    can_stop: boolean;
    can_reboot: boolean;
    can_resize: boolean;
    can_snapshot: boolean;
    can_create_image: boolean;
  };
  health: {
    cpu: number;
    memory: number;
    disk: number;
    services: Record<string, boolean>;
    last_heartbeat_at: string | null;
  } | null;
  provider_progress: number | null;
  provider_status: string | null;
  callback_expected: boolean | null;
  callback_url: string | null;
  created_at: string;
  ready_at: string | null;
}

export interface V2CreateMachineInput {
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  host_id?: string;
  region?: string;
  name?: string;
  image_id?: string | null;
  env_vars?: Record<string, string>;
  cloud_init_script?: string;
  ssh_key_ids?: string[];
  enable_backups?: boolean;
}

export type V2CreateMachineResult =
  | { kind: 'machine'; machine: V2MachineView }
  | { kind: 'checkout'; requires_checkout: true; checkout_url: string; message: string };

function isBenignLifecycleError(error: unknown, expected: 'stopped' | 'running') {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return expected === 'stopped'
    ? message.includes('already stopped')
    : message.includes('already running');
}

export function normalizeResolvedImageForProvider(providerName: string, resolvedImage: string) {
  if (providerName === 'baremetal') {
    if (resolvedImage === 'ubuntu-24.04') return 'images:ubuntu/noble/cloud';
    if (/^\d+$/.test(resolvedImage)) return 'images:ubuntu/noble/cloud';
  }
  return resolvedImage;
}

function providerMeta(machine: MachineRow) {
  return (machine.providerMeta ?? {}) as Record<string, unknown>;
}

function inferProviderServerId(machine: MachineRow) {
  return machine.providerServerId || (machine.provider === 'baremetal' ? `justavps-${machine.slug}` : null);
}

async function ensureBaremetalHostBinding(machine: MachineRow) {
  if (machine.provider !== 'baremetal') return machine;
  const meta = providerMeta(machine);
  if (typeof meta.baremetal_host_id === 'string' && typeof meta.runner_base_url === 'string') return machine;

  const { baremetalHosts } = await import('../../db/schema');
  const [host] = await db.select().from(baremetalHosts)
    .where(and(eq(baremetalHosts.region, machine.region), eq(baremetalHosts.status, 'active')));
  if (!host || !host.runnerBaseUrl) return machine;

  const nextMeta = {
    ...meta,
    baremetal_host_id: host.id,
    runner_base_url: host.runnerBaseUrl,
    public_ipv4: meta.public_ipv4 ?? host.publicIpv4 ?? null,
  };

  const [updated] = await db.update(machines).set({ providerMeta: nextMeta }).where(eq(machines.id, machine.id)).returning();
  return updated ?? machine;
}

async function resolveImageSummary(imageId: string | null): Promise<ReturnType<typeof serializeImageRow> | null> {
  if (!imageId) return null;
  const [img] = await db.select().from(images).where(eq(images.id, imageId));
  return img ? serializeImageRow(img) : null;
}

function readSshAccess(machine: MachineRow) {
  const meta = providerMeta(machine);
  const sshPort = typeof meta.ssh_port === 'number'
    ? meta.ssh_port
    : typeof meta.ssh_port === 'string' && meta.ssh_port.trim()
      ? Number(meta.ssh_port)
      : null;
  // SSH hostname: prefer the pretty origin DNS record over the raw host IP.
  // The DNS record is created unproxied on machine create, and points directly
  // at the baremetal host where Incus NAT forwards the per-machine port to vm:22.
  const hostIp = typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null;
  const originHost = `origin-${machine.slug}.${config.PROXY_DOMAIN}`;
  return {
    sshHost: hostIp ? originHost : null,
    sshHostFallbackIp: hostIp,
    privateIpv4: typeof meta.private_ipv4 === 'string' ? meta.private_ipv4 : null,
    sshPort,
  };
}

function decryptSshPrivateKey(machine: MachineRow): string | null {
  if (!machine.sshPrivateKey) return null;
  // V2 stores plaintext PEM; V1 stores encrypted. Handle both.
  if (machine.sshPrivateKey.startsWith('-----BEGIN')) return machine.sshPrivateKey;
  try {
    return decryptSecret(machine.sshPrivateKey);
  } catch {
    return null;
  }
}

export async function serializeMachineV2(machine: MachineRow, sub?: SubscriptionRow | null): Promise<V2MachineView> {
  const ssh = readSshAccess(machine);
  const proxyDomain = config.PROXY_DOMAIN;
  const image = await resolveImageSummary(machine.imageId);
  const provider = getProvider(machine.provider);
  const meta = providerMeta(machine);
  const providerProgressRaw = typeof meta.create_progress === 'number' ? meta.create_progress : null;
  const providerProgress = providerProgressRaw != null && providerProgressRaw <= 1
    ? Math.round(providerProgressRaw * 100)
    : providerProgressRaw;
  const providerStatus = typeof meta.create_status === 'string' ? meta.create_status : null;
  const callbackExpected = typeof meta.callback_expected === 'boolean' ? meta.callback_expected : null;
  const callbackUrl = typeof meta.callback_url === 'string' ? meta.callback_url : null;
  const sshPort = ssh.sshPort;
  const sshHost = ssh.sshHost;
  const sshKeyPath = `~/.ssh/justavps_${machine.slug}`;
  const sshPrivateKey = decryptSshPrivateKey(machine);

  // Build the user-facing SSH command (port-forwarded via Incus proxy NAT on host)
  const sshCommand = sshHost && sshPort
    ? `ssh -i ${sshKeyPath} -p ${sshPort} -o StrictHostKeyChecking=no root@${sshHost}`
    : null;

  // One-liner that writes the key to disk and connects immediately
  const sshSetupCommand = sshPrivateKey && sshHost && sshPort
    ? `mkdir -p ~/.ssh && cat > ${sshKeyPath} << 'JUSTAVPSKEY'\n${sshPrivateKey.trim()}\nJUSTAVPSKEY\nchmod 600 ${sshKeyPath} && ssh -i ${sshKeyPath} -p ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${sshHost}`
    : null;

  // Block to append to ~/.ssh/config for editor integration
  const sshConfigBlock = sshHost && sshPort
    ? `Host ${machine.slug}\n  HostName ${sshHost}\n  Port ${sshPort}\n  User root\n  IdentityFile ${sshKeyPath}\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null`
    : null;

  // Resources: from machine columns, fallback to provider_meta for legacy rows
  const vcpu = machine.vcpu ?? (typeof meta.vcpu === 'number' ? meta.vcpu : 2);
  const ramGb = machine.ramGb ?? (typeof meta.ram_gb === 'number' ? meta.ram_gb : 4);
  const diskGb = machine.diskGb ?? (typeof meta.disk_gb === 'number' ? meta.disk_gb : 80);

  return {
    id: machine.id,
    slug: machine.slug,
    name: machine.name,
    status: machine.status as V2MachineView['status'],
    provisioning_stage: machine.provisioningStage ?? null,
    provisioning_stage_updated_at: machine.provisioningStageUpdatedAt?.toISOString() ?? null,
    api_version: 'v2',
    region: machine.region,
    resources: { vcpu, ram_gb: ramGb, disk_gb: diskGb },
    billing: {
      mode: 'flat_monthly',
      price_monthly: machine.priceMonthly ?? null,
      current_period_end: sub?.currentPeriodEnd?.toISOString() ?? null,
    },
    image,
    connectivity: {
      ssh_host: sshHost,
      ssh_port: sshPort,
      ssh_command: sshCommand,
      ssh_setup_command: sshSetupCommand,
      ssh_config_block: sshConfigBlock,
      ssh_private_key: sshPrivateKey,
      ssh_public_key: machine.sshPublicKey || null,
      urls: (() => {
        // V2 baremetal: use the direct origin hostname + http NAT port
        const httpPort = typeof meta.http_port === 'number' ? meta.http_port : null;
        const originHost = ssh.sshHostFallbackIp
          ? `origin-${machine.slug}.${proxyDomain}`
          : null;
        if (originHost && httpPort) {
          return {
            proxy: `http://${originHost}:${httpPort}`,
            terminal: `http://${originHost}:${httpPort}/_terminal`,
            port_template: `http://${originHost}:${httpPort}/_port/{port}`,
          };
        }
        // Fallback: Cloudflare-proxied URLs (needs Worker to forward correctly)
        return {
          proxy: `https://${machine.slug}.${proxyDomain}`,
          terminal: `https://${machine.slug}.${proxyDomain}/_terminal`,
          port_template: `https://{port}--${machine.slug}.${proxyDomain}`,
        };
      })(),
    },
    capabilities: {
      can_start: machine.status === 'stopped',
      can_stop: machine.status === 'ready',
      can_reboot: machine.status === 'ready',
      can_resize: false,
      can_snapshot: provider.capabilities.backups || provider.capabilities.images,
      can_create_image: provider.capabilities.images,
    },
    health: machine.lastHeartbeat ? {
      ...machine.lastHeartbeat,
      last_heartbeat_at: machine.lastHeartbeatAt?.toISOString() ?? null,
    } : null,
    provider_progress: providerProgress,
    provider_status: providerStatus,
    callback_expected: callbackExpected,
    callback_url: callbackUrl,
    created_at: machine.createdAt.toISOString(),
    ready_at: machine.readyAt?.toISOString() ?? null,
  };
}

async function loadOwnedMachine(machineId: string, accountId: string): Promise<MachineRow> {
  const [machine] = await db.select().from(machines).where(and(eq(machines.id, machineId), eq(machines.accountId, accountId)));
  if (!machine || machine.status === 'deleted') throw new Error('Machine not found');
  return machine;
}

export async function listMachinesV2(input: { accountId: string }) {
  const rows = await db.select().from(machines).where(and(eq(machines.accountId, input.accountId), ne(machines.status, 'deleted')));
  const synced = await Promise.all(rows.map((machine) => syncMachineStatus(machine)));
  const machineIds = synced.map((machine) => machine.id);
  const subs = machineIds.length ? await db.select().from(subscriptions).where(inArray(subscriptions.machineId, machineIds)) : [];
  const subsByMachineId = new Map(subs.map((sub) => [sub.machineId, sub]));
  return Promise.all(synced.map((machine) => serializeMachineV2(machine, subsByMachineId.get(machine.id) ?? null)));
}

export async function getMachineV2(input: { accountId: string; machineId: string }) {
  const machine = await syncMachineStatus(await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId)));
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, machine.id));
  return serializeMachineV2(machine, sub ?? null);
}

export async function createMachineV2(input: { accountId: string; userId: string; isAdmin: boolean; requestUrl?: string; input: V2CreateMachineInput }): Promise<V2CreateMachineResult> {
  const data = input.input;
  const { computeMonthlyPrice } = await import('@/lib/v2-pricing');
  const tStart = Date.now();
  const ms = () => Date.now() - tStart;

  // ── 1. Quota check (single DB query) ─────────────────────────────────────
  const machineLimit = await checkMachineLimit(input.accountId, input.userId, input.isAdmin);
  if (!machineLimit.allowed) {
    throw new Error(`Machine limit reached (${machineLimit.current}/${machineLimit.max})`);
  }
  console.log(`[v2-create] +${ms()}ms quota ok`);

  const reqVcpu = data.vcpu;
  const reqRam = data.ram_gb;
  const reqDisk = data.disk_gb;
  const region = data.region ?? 'hel1';

  // ── 2. Pick host (single DB query) ───────────────────────────────────────
  const hostRows = await db.select().from(baremetalHosts);
  const host = data.host_id
    ? hostRows.find((h) => h.id === data.host_id)
    : hostRows
        .filter((h) => h.status === 'active' && h.region === region && h.runnerBaseUrl)
        .find((h) => {
          const fv = (h.totalVcpu ?? 0) - (h.usedVcpu ?? 0);
          const fm = (h.totalMemoryGb ?? 0) - (h.usedMemoryGb ?? 0);
          const fd = (h.totalDiskGb ?? 0) - (h.usedDiskGb ?? 0);
          return fv >= reqVcpu && fm >= reqRam && fd >= reqDisk;
        });
  if (!host || host.status !== 'active') {
    throw new Error(`No host with enough capacity (need ${reqVcpu} vCPU, ${reqRam} GB RAM, ${reqDisk} GB disk)`);
  }
  const freeV = (host.totalVcpu ?? 0) - (host.usedVcpu ?? 0);
  const freeR = (host.totalMemoryGb ?? 0) - (host.usedMemoryGb ?? 0);
  const freeD = (host.totalDiskGb ?? 0) - (host.usedDiskGb ?? 0);
  if (reqVcpu > freeV || reqRam > freeR || reqDisk > freeD) {
    throw new Error(`Not enough capacity on host (need ${reqVcpu}/${reqRam}GB/${reqDisk}GB, have ${freeV}/${freeR}GB/${freeD}GB)`);
  }
  console.log(`[v2-create] +${ms()}ms host picked`);

  // ── 3. Pricing (pure compute) ────────────────────────────────────────────
  const priceMonthly = computeMonthlyPrice(reqVcpu, reqRam, reqDisk);
  const specs = { vcpus: reqVcpu, ramGb: reqRam, diskGb: reqDisk, cpuType: 'dedicated' as const };
  const wantBackups = data.enable_backups === true;
  const monthlyPrice = wantBackups ? priceMonthly + backupSurcharge(priceMonthly) : priceMonthly;

  // ── 4. Generate slug + machineToken (sync, fast) ─────────────────────────
  const { slug, machineToken } = await generateMachineIdentity();
  console.log(`[v2-create] +${ms()}ms identity generated slug=${slug}`);

  // ── 5. Create DB row immediately ─────────────────────────────────────────
  const callbackConfig = resolveMachineCallbackConfig(input.requestUrl);
  const machine = await createMachineRecord({
    ownerId: input.userId,
    accountId: input.accountId,
    slug,
    name: data.name || `machine-${slug}`,
    provider: 'baremetal',
    imageId: null,
    serverType: 'custom',
    region,
    ip: null,
    providerServerId: null,
    machineToken,
    sshPublicKey: null,
    sshPrivateKey: null,
    priceMonthly: monthlyPrice,
    backupsEnabled: wantBackups,
  });

  // Persist allocated resources + initial provider meta in one update
  const providerMeta: Record<string, unknown> = {
    callback_expected: callbackConfig.callbackExpected,
    callback_url: callbackConfig.url,
    create_status: 'running',
    create_progress: 0,
    baremetal_host_id: host.id,
    runner_base_url: host.runnerBaseUrl,
    public_ipv4: host.publicIpv4 ?? null,
    public_ipv6: host.publicIpv6 ?? null,
    vcpu: reqVcpu,
    ram_gb: reqRam,
    disk_gb: reqDisk,
  };
  await db.update(machines).set({
    vcpu: reqVcpu,
    ramGb: reqRam,
    diskGb: reqDisk,
    providerMeta,
  }).where(eq(machines.id, machine.id));
  (machine as Record<string, unknown>).vcpu = reqVcpu;
  (machine as Record<string, unknown>).ramGb = reqRam;
  (machine as Record<string, unknown>).diskGb = reqDisk;
  (machine as Record<string, unknown>).providerMeta = providerMeta;
  console.log(`[v2-create] +${ms()}ms db row created`);

  // ── 6. Background: Stripe + SSH gen + provisioning + Cloudflare DNS ─────
  // EVERYTHING below this line happens AFTER the API returns
  after(async () => {
    const tBg = Date.now();
    const bgMs = () => Date.now() - tBg;
    let stripeSubId: string | null = null;
    let stripeSubItemId: string | null = null;
    const provider = getProvider('baremetal');

    try {
      // Resolve image (small DB query if user-provided image)
      let resolvedImage = 'justavps-golden';
      let machineImageId: string | null = null;
      if (data.image_id) {
        const [img] = await db.select().from(images).where(eq(images.id, data.image_id));
        if (!img || (img.accountId !== input.accountId && !img.isTemplate)) throw new Error('Image not found');
        const resolved = resolveRequestedProviderImage({ explicitImage: img });
        if (!resolved.ok) throw new Error(resolved.message);
        resolvedImage = resolved.selection.providerImage;
        machineImageId = resolved.selection.machineImageId;
        await db.update(machines).set({ imageId: machineImageId }).where(eq(machines.id, machine.id));
      }

      // SSH key generation (~2s)
      const autoKey = await autoGenerateAndSaveSSHKey(input.userId, input.accountId, slug);
      console.log(`[v2-bg ${slug}] +${bgMs()}ms ssh key generated`);

      // Update machine row with SSH keys
      await db.update(machines).set({
        sshPublicKey: autoKey.publicKey,
        sshPrivateKey: autoKey.privateKey,
      }).where(eq(machines.id, machine.id));

      const extraSSHKeys = data.ssh_key_ids?.length
        ? await resolveSSHKeyPublicKeys(input.accountId, data.ssh_key_ids)
        : [];

      // Build cloud-init payload (pure compute)
      const { buildCloudInitV2 } = await import('../cloud-init-v2');
      const userdata = buildCloudInitV2({
        slug,
        sshPublicKey: autoKey.publicKey,
        machineToken,
        platformCallbackUrl: callbackConfig.url,
        proxyDomain: config.PROXY_DOMAIN,
        envVars: data.env_vars,
        extraSSHKeys,
        cloudInitScript: data.cloud_init_script,
      });

      // Stripe in parallel with provisioning (don't block VM boot on Stripe)
      const stripePromise = (async () => {
        if (!stripeClient.isConfigured()) return;
        try {
          const [[user], [account]] = await Promise.all([
            db.select().from(users).where(eq(users.id, input.userId)),
            db.select().from(accounts).where(eq(accounts.id, input.accountId)),
          ]);
          if (!user || !account) return;
          const customerId = await stripeClient.getOrCreateCustomer(
            input.accountId,
            account.billingEmail || user.email,
            account.stripeCustomerId,
          );
          if (!account.stripeCustomerId) {
            await db.update(accounts).set({ stripeCustomerId: customerId }).where(eq(accounts.id, input.accountId));
          }
          if (input.isAdmin) {
            const result = await stripeClient.createAdminMachineSubscription(
              customerId, '', `pending-${Date.now()}`, monthlyPrice, 'custom', specs, 'monthly',
            );
            stripeSubId = result.subscriptionId;
            stripeSubItemId = result.subscriptionItemId;
          } else {
            const hasPM = await stripeClient.hasPaymentMethod(customerId);
            if (hasPM) {
              const result = await stripeClient.createMachineSubscription(
                customerId, '', `pending-${Date.now()}`, monthlyPrice, 'custom', specs, 'monthly',
              );
              stripeSubId = result.subscriptionId;
              stripeSubItemId = result.subscriptionItemId;
            }
          }
        } catch (err) {
          console.warn(`[v2-bg ${slug}] stripe error:`, err);
        }
      })();

      // Provisioning runs in parallel with Stripe
      await eventBus.emitStageChange(machine.id, input.accountId, 'server_creating', 'Creating server...');

      // Provider SSH key upload + create server
      const providerKeyId = await uploadSSHKeyToProvider(provider, slug, autoKey.publicKey);
      console.log(`[v2-bg ${slug}] +${bgMs()}ms provider key uploaded`);

      const server = await provider.createServer({
        name: `justavps-${slug}`,
        image: resolvedImage,
        serverType: 'custom',
        region,
        userData: userdata,
        sshKeyIds: [providerKeyId],
        enableBackups: wantBackups,
        labels: { justavps: 'true', slug, owner: input.userId.slice(0, 63) },
        vcpu: reqVcpu,
        memoryGb: reqRam,
        diskGb: reqDisk,
      });
      console.log(`[v2-bg ${slug}] +${bgMs()}ms runnerd returned`);
      provider.deleteSSHKey(providerKeyId).catch(() => {});

      await db.update(machines).set({
        ip: server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp,
        providerServerId: server.serverId,
        providerMeta: {
          ...providerMeta,
          create_action_id: server.createActionId ?? null,
          create_status: 'running',
          create_progress: 1,
          public_ipv4: server.publicIpv4 ?? null,
          public_ipv6: server.publicIpv6 ?? null,
          ...(server.metadata ?? {}),
        },
      }).where(eq(machines.id, machine.id));

      // For warm pool claims, the VM is already running with identity injected
      // Mark it ready immediately — don't wait for daemon heartbeat
      const isWarmClaim = server.metadata?.warm_pool === true;
      if (isWarmClaim) {
        await db.update(machines).set({
          status: 'ready',
          readyAt: new Date(),
          provisioningStage: 'services_ready',
        }).where(eq(machines.id, machine.id));
        await eventBus.emitStatusChange(machine.id, input.accountId, 'ready', 'Machine ready (warm pool)');
        console.log(`[v2-bg ${slug}] WARM POOL → marked ready immediately`);
      } else {
        await eventBus.emitStageChange(machine.id, input.accountId, 'server_created', `Server created`);
      }

      // Wait for Stripe in parallel (already started above)
      await stripePromise;
      if (stripeSubId) {
        await stripeClient.linkSubscriptionToMachine(stripeSubId, machine.id, slug).catch(() => {});
        await db.insert(subscriptions).values({
          machineId: machine.id,
          ownerId: input.userId,
          accountId: input.accountId,
          stripeSubscriptionId: stripeSubId,
          stripeSubscriptionItemId: stripeSubItemId,
          status: 'active',
        });
      }

      // Cloudflare DNS (best effort, non-blocking for ready)
      if (config.isCloudflareConfigured()) {
        setupProxyDNS(
          machine.id,
          slug,
          { ipv4: server.publicIpv4, ipv6: server.publicIpv6 },
          input.accountId,
          'custom',
        ).catch((err) => console.warn(`[v2-bg ${slug}] dns setup error:`, err));
      }

      console.log(`[v2-bg ${slug}] +${bgMs()}ms TOTAL background work done`);
    } catch (error) {
      console.error(`[v2-bg ${slug}] error:`, error);
      await provider.deleteServer(`justavps-${slug}`).catch(() => {});
      if (stripeSubId) await stripeClient.cancelMachineSubscription(stripeSubId).catch(() => {});
      const [current] = await db.select({ providerMeta: machines.providerMeta }).from(machines).where(eq(machines.id, machine.id)).limit(1);
      await db.update(machines).set({
        status: 'error',
        providerMeta: {
          ...((current?.providerMeta ?? {}) as Record<string, unknown>),
          error: error instanceof Error ? error.message : String(error),
        },
      }).where(eq(machines.id, machine.id));
      await eventBus.emitStatusChange(machine.id, input.accountId, 'error', `Provisioning failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  console.log(`[v2-create] +${ms()}ms returning to client`);
  return { kind: 'machine', machine: await serializeMachineV2(machine) };
}

export async function startMachineV2(input: { accountId: string; machineId: string }) {
  const machine = await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId));
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine not found');
  if (machine.status !== 'stopped') throw new Error('Machine must be stopped to start');
  try {
    await getProvider(machine.provider).startServer(providerServerId);
  } catch (error) {
    if (!isBenignLifecycleError(error, 'running')) throw error;
  }
  await db.update(machines).set({ status: 'ready' }).where(eq(machines.id, machine.id));
  return { ok: true };
}

export async function stopMachineV2(input: { accountId: string; machineId: string }) {
  const machine = await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId));
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine not found');
  if (machine.status !== 'ready') throw new Error('Machine must be running to stop');
  try {
    await getProvider(machine.provider).stopServer(providerServerId);
  } catch (error) {
    if (!isBenignLifecycleError(error, 'stopped')) throw error;
  }
  await db.update(machines).set({ status: 'stopped' }).where(eq(machines.id, machine.id));
  return { ok: true };
}

export async function rebootMachineV2(input: { accountId: string; machineId: string }) {
  const machine = await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId));
  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) throw new Error('Machine not found');
  await getProvider(machine.provider).rebootServer(providerServerId);
  return { ok: true };
}

export async function deleteMachineV2(input: { accountId: string; machineId: string }) {
  const machine = await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId));
  await cleanupMachineResources(machine, getProvider(machine.provider));
  return { ok: true };
}

export async function cancelMachineV2(input: { accountId: string; machineId: string }) {
  const machine = await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId));
  if (machine.status === 'deleted') throw new Error('Machine is already deleted');
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, input.machineId));
  if (!sub) throw new Error('No active subscription found for this machine');
  if (sub.cancelAtPeriodEnd) throw new Error('Subscription is already scheduled for cancellation');
  const updated = await stripeClient.cancelAtPeriodEnd(sub.stripeSubscriptionId);
  const cancelAt = updated.cancel_at ? new Date(updated.cancel_at * 1000) : null;
  const cancelledAt = updated.canceled_at ? new Date(updated.canceled_at * 1000) : null;
  const periodEnd = (updated as unknown as { current_period_end?: number }).current_period_end;
  await db.update(subscriptions).set({
    cancelAtPeriodEnd: true,
    cancelAt,
    cancelledAt,
    ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
    updatedAt: new Date(),
  }).where(eq(subscriptions.id, sub.id));
  return { action: 'cancel', status: 'scheduled' };
}

export async function reactivateMachineV2(input: { accountId: string; machineId: string }) {
  await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId));
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, input.machineId));
  if (!sub) throw new Error('No subscription found for this machine');
  if (!sub.cancelAtPeriodEnd) throw new Error('Subscription is not scheduled for cancellation');
  await stripeClient.reactivateSubscription(sub.stripeSubscriptionId);
  await db.update(subscriptions).set({
    cancelAtPeriodEnd: false,
    cancelAt: null,
    cancelledAt: null,
    updatedAt: new Date(),
  }).where(eq(subscriptions.id, sub.id));
  return { action: 'reactivate', status: 'active' };
}
