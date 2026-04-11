import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../db';
import { accounts, baremetalHosts, images, machines, subscriptions, users } from '../../db/schema';
import { config } from '../config';
import { resolveRequestedProviderImage, serializeImageRow } from '../image-catalog';
import { backupSurcharge } from '@/lib/plan-catalog';
import { getProvider } from '../providers';
import { stripeClient } from '../stripe';
import { eventBus } from '../event-bus';
import type { ControlPlaneJobHandlerResult } from '../control-plane-jobs';
import {
  autoGenerateAndSaveSSHKey,
  buildMachineUserData,
  cleanupMachineResources,
  createMachineRecord,
  generateMachineIdentity,
  resolveMachineCallbackConfig,
  resolveSSHKeyPublicKeys,
  setupProxyDNS,
  syncMachineStatus,
  uploadSSHKeyToProvider,
} from '../machine-lifecycle';
import { commitHostCapacityReservation, getHostCapacityReservationForMachine, releaseHostCapacityReservation } from '../baremetal/reservations';
import { recordHostImageLocalityIntent } from '../baremetal/image-locality';
import { getMachinePortAllocations, releaseMachinePortAllocations, reserveMachinePortAllocations } from '../baremetal/port-allocations';
import { deriveBaremetalCellIdentity } from '../baremetal/cells';
import { checkMachineLimit } from '../account-limits';
import { decryptSecret } from '../crypto';
import { buildMachinePlacementProviderMeta, reserveCapacityForMachineCreate } from '../control-plane/allocator';
import {
  enqueueMachineCreateJob,
  ensureProvisionerServiceWorker,
  kickProvisionerServiceWorker,
  MACHINE_CREATE_JOB_TYPE,
  machineCreateJobIdempotencyKey,
  registerMachineCreateJobHandler,
} from '../control-plane/provisioner';
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

const MACHINE_CREATE_RETRY_DELAY_MS = 15_000;

interface MachineCreateJobPayload {
  accountId: string;
  userId: string;
  isAdmin: boolean;
  reservationId: string;
  requestUrl?: string;
  imageId?: string | null;
  envVars?: Record<string, string>;
  cloudInitScript?: string;
  sshKeyIds?: string[];
  enableBackups?: boolean;
}

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
  if ((machine.baremetalHostId || typeof meta.baremetal_host_id === 'string') && typeof meta.runner_base_url === 'string') return machine;

  const { baremetalHosts } = await import('../../db/schema');
  const [host] = machine.baremetalHostId
    ? await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, machine.baremetalHostId))
    : await db.select().from(baremetalHosts)
        .where(and(eq(baremetalHosts.region, machine.region), eq(baremetalHosts.status, 'active')));
  if (!host || !host.runnerBaseUrl) return machine;

  const nextMeta = {
    ...meta,
    baremetal_host_id: host.id,
    baremetal_cell_id: host.cellId,
    baremetal_cell_slug: deriveBaremetalCellIdentity(host)?.slug ?? null,
    baremetal_cell_generation: host.generation,
    runner_base_url: host.runnerBaseUrl,
    public_ipv4: meta.public_ipv4 ?? host.publicIpv4 ?? null,
  };

  const [updated] = await db.update(machines).set({ baremetalHostId: host.id, providerMeta: nextMeta }).where(eq(machines.id, machine.id)).returning();
  return updated ?? { ...machine, baremetalHostId: host.id, providerMeta: nextMeta };
}

async function resolveImageSummary(imageId: string | null): Promise<ReturnType<typeof serializeImageRow> | null> {
  if (!imageId) return null;
  const [img] = await db.select().from(images).where(eq(images.id, imageId));
  return img ? serializeImageRow(img) : null;
}

async function readSshAccess(machine: MachineRow) {
  const meta = providerMeta(machine);
  const portAllocations = await getMachinePortAllocations(machine.id).catch(() => ({ ssh: null, http: null, rows: [] }));
  const sshPort = portAllocations.ssh?.publicPort ?? (typeof meta.ssh_port === 'number'
    ? meta.ssh_port
    : typeof meta.ssh_port === 'string' && meta.ssh_port.trim()
      ? Number(meta.ssh_port)
      : null);
  // SSH should use the actual bare-metal host gateway IP. This is the only
  // consistently reliable path for VM NAT forwarding. The pretty origin-* DNS
  // hostname may exist, but DNS/proxy precedence can still make it unreliable.
  // We keep SSH honest: connect to the gateway host and forwarded port.
  const hostIp = typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null;
  const originHost = `origin-${machine.slug}.${config.PROXY_DOMAIN}`;
  return {
    sshHost: hostIp,
    sshOriginHost: hostIp ? originHost : null,
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
  const ssh = await readSshAccess(machine);
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
      urls: {
        // Public-facing proxy URLs should always use the clean worker-style hostname.
        // The host IP + NAT port stays an internal transport detail.
        proxy: `https://${machine.slug}.${proxyDomain}`,
        terminal: `https://${machine.slug}.${proxyDomain}/_terminal`,
        port_template: `https://{port}--${machine.slug}.${proxyDomain}`,
      },
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

export function defaultPlacementImageAlias(imageId?: string | null) {
  return imageId ? null : 'justavps-golden';
}

function sanitizeJobError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function resolveMachineCreateImage(machine: MachineRow, payload: MachineCreateJobPayload) {
  const provider = getProvider('baremetal');
  let resolvedImage = 'justavps-golden';
  let machineImageId = machine.imageId;

  if (payload.imageId) {
    const [img] = await db.select().from(images).where(eq(images.id, payload.imageId));
    if (!img || (img.accountId !== payload.accountId && !img.isTemplate)) {
      throw new Error('Image not found');
    }
    const resolved = resolveRequestedProviderImage({ explicitImage: img });
    if (!resolved.ok) throw new Error(resolved.message);
    resolvedImage = normalizeResolvedImageForProvider(provider.name, resolved.selection.providerImage);
    machineImageId = resolved.selection.machineImageId;
    if (machineImageId !== machine.imageId) {
      await db.update(machines).set({ imageId: machineImageId }).where(eq(machines.id, machine.id));
    }
  }

  return { resolvedImage, machineImageId };
}

async function ensureMachineCreateSshKeys(machine: MachineRow, payload: MachineCreateJobPayload) {
  if (machine.sshPublicKey && machine.sshPrivateKey) {
    return {
      publicKey: machine.sshPublicKey,
      privateKey: decryptSecret(machine.sshPrivateKey),
    };
  }

  const generated = await autoGenerateAndSaveSSHKey(payload.userId, payload.accountId, machine.slug);
  await db.update(machines).set({
    sshPublicKey: generated.publicKey,
    sshPrivateKey: generated.privateKey,
  }).where(eq(machines.id, machine.id));

  return generated;
}

async function ensureMachineSubscription(machine: MachineRow, payload: MachineCreateJobPayload, specs: { vcpus: number; ramGb: number; diskGb: number; cpuType: 'dedicated' }) {
  if (!stripeClient.isConfigured()) return;
  const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.machineId, machine.id));
  if (existingSub) return;

  try {
    const [[user], [account]] = await Promise.all([
      db.select().from(users).where(eq(users.id, payload.userId)),
      db.select().from(accounts).where(eq(accounts.id, payload.accountId)),
    ]);
    if (!user || !account || machine.priceMonthly == null) return;

    const customerId = await stripeClient.getOrCreateCustomer(
      payload.accountId,
      account.billingEmail || user.email,
      account.stripeCustomerId,
    );
    if (!account.stripeCustomerId) {
      await db.update(accounts).set({ stripeCustomerId: customerId }).where(eq(accounts.id, payload.accountId));
    }

    let stripeSubId: string | null = null;
    let stripeSubItemId: string | null = null;
    if (payload.isAdmin) {
      const result = await stripeClient.createAdminMachineSubscription(
        customerId, '', `pending-${Date.now()}`, machine.priceMonthly, 'custom', specs, 'monthly',
      );
      stripeSubId = result.subscriptionId;
      stripeSubItemId = result.subscriptionItemId;
    } else {
      const hasPM = await stripeClient.hasPaymentMethod(customerId);
      if (!hasPM) return;
      const result = await stripeClient.createMachineSubscription(
        customerId, '', `pending-${Date.now()}`, machine.priceMonthly, 'custom', specs, 'monthly',
      );
      stripeSubId = result.subscriptionId;
      stripeSubItemId = result.subscriptionItemId;
    }

    if (!stripeSubId) return;
    await stripeClient.linkSubscriptionToMachine(stripeSubId, machine.id, machine.slug).catch(() => {});
    await db.insert(subscriptions).values({
      machineId: machine.id,
      ownerId: payload.userId,
      accountId: payload.accountId,
      stripeSubscriptionId: stripeSubId,
      stripeSubscriptionItemId: stripeSubItemId,
      status: 'active',
    });
  } catch (error) {
    console.warn(`[v2-job ${machine.slug}] stripe error:`, error);
  }
}

async function markMachineCreateFailed(machine: MachineRow, reservationId: string, error: string, cleanupServerId?: string | null) {
  await releaseMachinePortAllocations(machine.id).catch(() => {});
  await releaseHostCapacityReservation({
    reservationId,
    metadata: { released_by: 'machine_create_job', error },
  }).catch(() => {});

  if (cleanupServerId) {
    await getProvider('baremetal').deleteServer(cleanupServerId).catch(() => {});
  }

  const [current] = await db.select({ providerMeta: machines.providerMeta }).from(machines).where(eq(machines.id, machine.id)).limit(1);
  await db.update(machines).set({
    status: 'error',
    providerMeta: {
      ...((current?.providerMeta ?? {}) as Record<string, unknown>),
      error,
      create_status: 'error',
    },
  }).where(eq(machines.id, machine.id));
  await eventBus.emitStatusChange(machine.id, machine.accountId ?? machine.ownerId, 'error', `Provisioning failed: ${error}`);
}

export async function handleMachineCreateJob(machineId: string, payload: MachineCreateJobPayload, jobAttempt = 0, maxAttempts = 3): Promise<ControlPlaneJobHandlerResult> {
  const [machine] = await db.select().from(machines).where(eq(machines.id, machineId));
  if (!machine) {
    return { status: 'dead_lettered', error: `Machine ${machineId} not found` };
  }
  if (machine.status === 'ready') {
    return { status: 'succeeded', result: { machineId } };
  }

  const reservation = await getHostCapacityReservationForMachine(machine.id);
  if (!reservation) {
    return { status: 'dead_lettered', error: `Machine ${machine.id} is missing a host capacity reservation` };
  }

  const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, reservation.hostId));
  if (!host || !host.runnerBaseUrl) {
    return { status: 'dead_lettered', error: `Reserved host ${reservation.hostId} is not active` };
  }

  const provider = getProvider('baremetal');
  const machineToken = decryptSecret(machine.machineToken);
  const { resolvedImage } = await resolveMachineCreateImage(machine, payload);
  const sshKeys = await ensureMachineCreateSshKeys(machine, payload);
  const extraSSHKeys = payload.sshKeyIds?.length
    ? await resolveSSHKeyPublicKeys(payload.accountId, payload.sshKeyIds)
    : [];
  const callbackConfig = resolveMachineCallbackConfig(payload.requestUrl);
  const isGoldenImage = resolvedImage === 'justavps-golden' || resolvedImage.startsWith('justavps-golden');
  const userdata = isGoldenImage
    ? (await import('../cloud-init-v2')).buildCloudInitV2({
        slug: machine.slug,
        sshPublicKey: sshKeys.publicKey,
        machineToken,
        platformCallbackUrl: callbackConfig.url,
        proxyDomain: config.PROXY_DOMAIN,
        envVars: payload.envVars,
        extraSSHKeys,
        cloudInitScript: payload.cloudInitScript,
      })
    : buildMachineUserData(
        machine.slug,
        sshKeys.publicKey,
        machineToken,
        callbackConfig.url,
        payload.envVars,
        extraSSHKeys,
        payload.cloudInitScript,
      );

  let machineForSideEffects = machine;
  let publicIpv4 = ((machine.providerMeta ?? {}) as Record<string, unknown>).public_ipv4 as string | null | undefined;
  let publicIpv6 = ((machine.providerMeta ?? {}) as Record<string, unknown>).public_ipv6 as string | null | undefined;
  let sshPort = ((machine.providerMeta ?? {}) as Record<string, unknown>).ssh_port as number | null | undefined;
  let routingPort = ((machine.providerMeta ?? {}) as Record<string, unknown>).http_port as number | null | undefined;

  if (!machine.providerServerId) {
    let providerKeyId: string | null = null;
    let createdServerId: string | null = null;
    try {
      await eventBus.emitStageChange(machine.id, payload.accountId, 'server_creating', 'Creating server...');
      providerKeyId = await uploadSSHKeyToProvider(provider, machine.slug, sshKeys.publicKey);
      const portAllocation = await reserveMachinePortAllocations({
        machineId: machine.id,
        hostId: host.id,
        hostPublicIp: host.publicIpv4 ?? null,
      });
      sshPort = portAllocation.sshPort;
      routingPort = portAllocation.httpPort;
      const server = await provider.createServer({
        name: `justavps-${machine.slug}`,
        image: resolvedImage,
        serverType: 'custom',
        region: machine.region,
        userData: userdata,
        sshKeyIds: [providerKeyId],
        enableBackups: payload.enableBackups === true,
        labels: { justavps: 'true', slug: machine.slug, owner: payload.userId.slice(0, 63) },
        hostId: host.id,
        vcpu: machine.vcpu ?? 0,
        memoryGb: machine.ramGb ?? 0,
        diskGb: machine.diskGb ?? 0,
        sshPort: sshPort ?? null,
        httpPort: routingPort ?? null,
      });
      createdServerId = server.serverId;
      publicIpv4 = server.publicIpv4 ?? null;
      publicIpv6 = server.publicIpv6 ?? null;
      sshPort = typeof server.metadata?.ssh_port === 'number' ? server.metadata.ssh_port : sshPort ?? null;
      routingPort = typeof server.metadata?.http_port === 'number' ? server.metadata.http_port : null;

      const nextProviderMeta = {
        ...((machine.providerMeta ?? {}) as Record<string, unknown>),
        create_action_id: server.createActionId ?? null,
        create_status: 'running',
        create_progress: 1,
        baremetal_host_id: host.id,
        baremetal_cell_id: host.cellId,
        baremetal_cell_slug: deriveBaremetalCellIdentity(host)?.slug ?? null,
        baremetal_cell_generation: host.generation,
        runner_base_url: host.runnerBaseUrl,
        reservation_id: reservation.id,
        public_ipv4: publicIpv4,
        public_ipv6: publicIpv6,
        ssh_port: sshPort ?? null,
        ...(server.metadata ?? {}),
      };

      const [updatedMachine] = await db.update(machines).set({
        ip: publicIpv4 ?? publicIpv6 ?? server.publicIp,
        providerServerId: server.serverId,
        providerMeta: nextProviderMeta,
      }).where(eq(machines.id, machine.id)).returning();
      machineForSideEffects = updatedMachine ?? { ...machine, providerServerId: server.serverId, providerMeta: nextProviderMeta };

      if (reservation.state === 'reserved') {
        await commitHostCapacityReservation({
          reservationId: reservation.id,
          metadata: {
            ...(reservation.metadata ?? {}),
            committed_by: 'machine_create_job',
            provider_server_id: server.serverId,
          },
        });
      }

      const isWarmClaim = server.metadata?.warm_pool === true;
      if (isWarmClaim) {
        await db.update(machines).set({
          status: 'ready',
          readyAt: new Date(),
          provisioningStage: 'services_ready',
        }).where(eq(machines.id, machine.id));
        await eventBus.emitStatusChange(machine.id, payload.accountId, 'ready', 'Machine ready (warm pool)');
      } else {
        await eventBus.emitStageChange(machine.id, payload.accountId, 'server_created', 'Server created');
      }
    } catch (error) {
      if (providerKeyId) {
        provider.deleteSSHKey(providerKeyId).catch(() => {});
      }
      const message = sanitizeJobError(error);
      if (!createdServerId && jobAttempt + 1 < maxAttempts) {
        return {
          status: 'retry',
          error: message,
          runAfter: new Date(Date.now() + MACHINE_CREATE_RETRY_DELAY_MS),
          result: { machineId: machine.id, reservationId: reservation.id },
        };
      }
      await markMachineCreateFailed(machine, reservation.id, message, createdServerId);
      return { status: 'dead_lettered', error: message, result: { machineId: machine.id, reservationId: reservation.id } };
    } finally {
      if (providerKeyId) {
        provider.deleteSSHKey(providerKeyId).catch(() => {});
      }
    }
  } else if (reservation.state === 'reserved') {
    await commitHostCapacityReservation({
      reservationId: reservation.id,
      metadata: {
        ...(reservation.metadata ?? {}),
        committed_by: 'machine_create_job_recovery',
        provider_server_id: machine.providerServerId,
      },
    });
  }

  await ensureMachineSubscription(machineForSideEffects, payload, {
    vcpus: machineForSideEffects.vcpu ?? 0,
    ramGb: machineForSideEffects.ramGb ?? 0,
    diskGb: machineForSideEffects.diskGb ?? 0,
    cpuType: 'dedicated',
  });

  if (config.isCloudflareConfigured() && (publicIpv4 || publicIpv6)) {
    setupProxyDNS(
      machine.id,
      machine.slug,
      { ipv4: publicIpv4 ?? null, ipv6: publicIpv6 ?? null },
      payload.accountId,
      'custom',
      { routingPort: routingPort ?? null },
    ).catch((error) => console.warn(`[v2-job ${machine.slug}] dns setup error:`, error));
  }

  return {
    status: 'succeeded',
    result: {
      machineId: machine.id,
      reservationId: reservation.id,
      providerServerId: machineForSideEffects.providerServerId,
    },
  };
}

registerMachineCreateJobHandler({
  handle: (job) => handleMachineCreateJob(job.subjectId, job.payload as unknown as MachineCreateJobPayload, job.attempt, job.maxAttempts),
});
ensureProvisionerServiceWorker();

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

  // ── 2. Pricing (pure compute) ────────────────────────────────────────────
  const priceMonthly = computeMonthlyPrice(reqVcpu, reqRam, reqDisk);
  const wantBackups = data.enable_backups === true;
  const monthlyPrice = wantBackups ? priceMonthly + backupSurcharge(priceMonthly) : priceMonthly;

  // ── 3. Generate slug + machineToken (sync, fast) ─────────────────────────
  const { slug, machineToken } = await generateMachineIdentity();
  console.log(`[v2-create] +${ms()}ms identity generated slug=${slug}`);

  const callbackConfig = resolveMachineCallbackConfig(input.requestUrl);
  let machine!: MachineRow;
  await db.transaction(async (tx) => {
    machine = await createMachineRecord({
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
      executor: tx,
    });

    const lease = await reserveCapacityForMachineCreate({
      machineId: machine.id,
      region,
      requestedHostId: data.host_id,
      resources: { vcpu: reqVcpu, memoryGb: reqRam, diskGb: reqDisk },
      imageId: data.image_id ?? null,
      imageAlias: defaultPlacementImageAlias(data.image_id),
      executor: tx,
    });
    const selectedCandidate = lease.decision.candidates.find((candidate) => candidate.hostId === lease.host.id);
    if (selectedCandidate) {
      await recordHostImageLocalityIntent({
        hostId: lease.host.id,
        imageId: data.image_id ?? null,
        imageAlias: defaultPlacementImageAlias(data.image_id),
        state: selectedCandidate.schedulingHints.imageLocality === 'local' ? 'local' : 'warming',
        source: 'placement',
        metadata: {
          machine_id: machine.id,
          reservation_id: lease.reservation.id,
        },
        executor: tx,
      });
    }

    const providerMeta: Record<string, unknown> = {
      callback_expected: callbackConfig.callbackExpected,
      callback_url: callbackConfig.url,
      create_status: 'queued',
      create_progress: 0,
      ...buildMachinePlacementProviderMeta(lease, {
        vcpu: reqVcpu,
        memoryGb: reqRam,
        diskGb: reqDisk,
      }),
    };

    const [updatedMachine] = await tx.update(machines).set({
      baremetalHostId: lease.host.id,
      vcpu: reqVcpu,
      ramGb: reqRam,
      diskGb: reqDisk,
      providerMeta,
    }).where(eq(machines.id, machine.id)).returning();
    machine = updatedMachine ?? { ...machine, baremetalHostId: lease.host.id, vcpu: reqVcpu, ramGb: reqRam, diskGb: reqDisk, providerMeta };

    await enqueueMachineCreateJob({
      jobType: MACHINE_CREATE_JOB_TYPE,
      subjectType: 'machine',
      subjectId: machine.id,
      idempotencyKey: machineCreateJobIdempotencyKey(machine.id),
      payload: {
        accountId: input.accountId,
        userId: input.userId,
        isAdmin: input.isAdmin,
        reservationId: lease.reservation.id,
        requestUrl: input.requestUrl,
        imageId: data.image_id ?? null,
        envVars: data.env_vars,
        cloudInitScript: data.cloud_init_script,
        sshKeyIds: data.ssh_key_ids,
        enableBackups: wantBackups,
      },
      executor: tx,
    });
  });

  kickProvisionerServiceWorker(1);

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
