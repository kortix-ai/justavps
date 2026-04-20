import { eq } from 'drizzle-orm';
import net from 'node:net';
import { nanoid } from 'nanoid';
import { db } from "@/server/db/index";
import { machines } from "@/server/db/schema";
import { generateMachineToken, encryptSecret } from "@/server/core/crypto";
import { buildCloudInitV2 } from "@/server/v2/services/cloud-init";
import { config } from "@/server/core/config";
import { getProvider, type ComputeProvider } from "@/server/platform/providers/index";
import { syncMachineRoutingState } from "@/server/platform/control-plane/routing-state";
import { releaseMachinePortAllocations } from "@/server/platform/baremetal/port-allocations";
import { getHostCapacityReservationForMachine, releaseHostCapacityReservation } from "@/server/platform/baremetal/reservations";
import { updateProviderMeta } from "@/server/platform/provider-meta";
import { shouldMarkReadyFromHttpProbe } from "@/server/v2/domains/machine/readiness";
import { deriveMachineRuntimeKind } from "@/server/v2/domains/machine/types";

interface ProvisionProviderMeta {
  create_action_id?: string | null;
  create_progress?: number | null;
  create_status?: string | null;
  public_ipv4?: string | null;
  public_ipv6?: string | null;
  http_port?: number | null;
  callback_expected?: boolean;
  callback_url?: string | null;
  last_callback_at?: string | null;
  last_probe_at?: string | null;
  ready_via?: 'heartbeat' | 'probe' | null;
  daemon_reachable_at?: string | null;
  requested_image_kind?: 'golden' | 'catalog' | 'docker' | null;
  requested_image_ref?: string | null;
}

async function canConnect(host: string | null | undefined, port: number | null | undefined, timeoutMs = 1500) {
  if (!host || !port) return false;
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
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

function resolvePlatformCallbackUrl(requestUrl?: string): string {
  return resolveMachineCallbackConfig(requestUrl).url;
}

function readProviderMeta(machine: typeof machines.$inferSelect): ProvisionProviderMeta {
  return (machine.providerMeta ?? {}) as ProvisionProviderMeta;
}

export function buildMachineUserData(
  slug: string,
  machineToken: string,
  platformCallbackUrl: string,
  envVars?: Record<string, string>,
  cloudInitScript?: string,
) {
  return buildCloudInitV2({
    slug,
    machineToken,
    platformCallbackUrl,
    proxyDomain: config.PROXY_DOMAIN,
    envVars,
    cloudInitScript,
  });
}

/**
 * Register machine in Cloudflare:
 * - Writes machine:{slug} to KV for Worker auth/routing (HTTP proxy)
 * - Creates unproxied A record at `origin-{slug}.<PROXY_DOMAIN>` so the access
 *   plane can reach the host via a stable hostname instead of raw IP.
 */
export async function setupProxyDNS(
  machineId: string,
  slug: string,
  addresses: { ipv4?: string | null; ipv6?: string | null },
  accountId: string,
  serverType: string,
  options?: { routingIp?: string | null; routingPort?: number | null },
) {
  const primaryIp = options?.routingIp ?? addresses.ipv4 ?? addresses.ipv6;
  await syncMachineRoutingState({
    machineId,
    accountId,
    machineSlug: slug,
    machineStatus: 'provisioning',
    serverType,
    desiredIp: primaryIp,
    desiredOriginPort: options?.routingPort ?? null,
    publicIpv4: addresses.ipv4 ?? null,
    publicIpv6: addresses.ipv6 ?? null,
    originHostname: `origin-${slug}.${config.PROXY_DOMAIN}`,
    source: 'machine_setup_proxy_dns',
  }).catch((err: unknown) => {
    console.warn(`[ROUTING] Failed to sync routing state for ${slug}:`, err);
  });
}

interface CreateMachineInput {
  ownerId: string;
  accountId: string;
  slug: string;
  name: string;
  provider: string;
  machineMode?: 'vm' | 'container';
  requestedImageKind?: 'golden' | 'catalog' | 'docker' | null;
  requestedImageRef?: string | null;
  imageId: string | null;
  serverType: string;
  region: string;
  baremetalHostId?: string | null;
  ip: string | null;
  publicIpv4?: string | null;
  publicIpv6?: string | null;
  sshPort?: number | null;
  httpPort?: number | null;
  readyVia?: 'heartbeat' | 'probe' | null;
  providerServerId: string | null;
  machineToken: string;
  priceMonthly: number | null;
  backupsEnabled?: boolean;
  executor?: Pick<typeof db, 'insert'>;
}

export async function createMachineRecord(input: CreateMachineInput) {
  const { executor = db, ...values } = input;
  const [machine] = await executor.insert(machines).values({
    ...values,
    // Pinning api_version='v2' so this row is only visible through /api/v2/*
    // and never leaks into v1 list/get/mutation endpoints. Keeps the two
    // API surfaces cleanly separated even though they share the machines table.
    apiVersion: 'v2',
    machineMode: input.machineMode ?? 'vm',
    requestedImageKind: input.requestedImageKind ?? 'golden',
    requestedImageRef: input.requestedImageRef ?? null,
    sshPublicKey: '',
    backupsEnabled: input.backupsEnabled ?? true,
    // Encrypt secrets at rest — decrypted on read via decryptSecret()
    machineToken: encryptSecret(input.machineToken),
    sshPrivateKey: '',
    codeServerPassword: '',
  }).returning();
  return machine;
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
    const meta = readProviderMeta(machine);
    await syncMachineRoutingState({
      machineId: machine.id,
      accountId: machine.accountId ?? machine.ownerId,
      machineSlug: machine.slug,
      machineStatus: 'deleted',
      serverType: machine.serverType,
      desiredIp: null,
      desiredOriginPort: typeof meta.http_port === 'number' ? meta.http_port : null,
      publicIpv4: typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null,
      publicIpv6: typeof meta.public_ipv6 === 'string' ? meta.public_ipv6 : null,
      originHostname: `origin-${machine.slug}.${config.PROXY_DOMAIN}`,
      source: 'machine_cleanup',
    }).catch(() => {});
  }

  if (machine.provider === 'baremetal') {
    const reservation = await getHostCapacityReservationForMachine(machine.id).catch(() => null);
    if (reservation && ['reserved', 'committed'].includes(reservation.state)) {
      await releaseHostCapacityReservation({
        reservationId: reservation.id,
        metadata: {
          ...(reservation.metadata ?? {}),
          released_by: 'machine_cleanup',
        },
      }).catch(() => {});
    }
    await releaseMachinePortAllocations(machine.id).catch(() => {});
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
          await db.update(machines).set({ ip: nextIp, publicIpv4: network.publicIpv4 ?? null, publicIpv6: network.publicIpv6 ?? null }).where(eq(machines.id, machine.id));
        }

        machine = { ...machine, ip: nextIp, publicIpv4: network.publicIpv4 ?? null, publicIpv6: network.publicIpv6 ?? null, providerMeta: nextMeta };

        if (config.isCloudflareConfigured() && nextIp) {
          await syncMachineRoutingState({
            machineId: machine.id,
            accountId: machine.accountId ?? machine.ownerId,
            machineSlug: machine.slug,
            machineStatus: machine.status,
            serverType: machine.serverType,
            desiredIp: nextIp,
            desiredOriginPort: typeof nextMeta.http_port === 'number' ? nextMeta.http_port : null,
            publicIpv4: typeof nextMeta.public_ipv4 === 'string' ? nextMeta.public_ipv4 : null,
            publicIpv6: typeof nextMeta.public_ipv6 === 'string' ? nextMeta.public_ipv6 : null,
            originHostname: `origin-${machine.slug}.${config.PROXY_DOMAIN}`,
            source: 'machine_network_refresh',
          }).catch((err) => {
            console.warn(`[MACHINES] Failed to sync routing state for ${machine.slug}:`, err);
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

  const requestedImageKind = machine.requestedImageKind ?? (typeof meta.requested_image_kind === 'string' ? meta.requested_image_kind : null);
  const requestedImageRef = machine.requestedImageRef ?? (typeof meta.requested_image_ref === 'string' ? meta.requested_image_ref : null);
  const runtimeKind = deriveMachineRuntimeKind({
    machineMode: (machine.machineMode as 'vm' | 'container') ?? 'vm',
    requestedImageKind: requestedImageKind === 'catalog' || requestedImageKind === 'docker' ? requestedImageKind : 'golden',
  });
  const host = machine.publicIpv4 ?? (typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : machine.ip);
  const port = machine.httpPort ?? (typeof meta.http_port === 'number' ? meta.http_port : null);
  const shouldProbeReady = shouldMarkReadyFromHttpProbe({ runtimeKind, host, port })
    || (requestedImageKind === 'docker' || /^(docker|oci):/i.test(requestedImageRef ?? ''));
  if (shouldProbeReady) {
    if (await canConnect(host, port)) {
      const now = new Date();
      const nextMeta = await updateProviderMeta(machine.id, {
        last_probe_at: now.toISOString(),
        ready_via: 'probe',
        daemon_reachable_at: now.toISOString(),
      });
      await db.update(machines).set({
        status: 'ready',
        readyAt: now,
        readyVia: 'probe',
        provisioningStage: 'services_ready',
        providerMeta: nextMeta,
      }).where(eq(machines.id, machine.id));
      return { ...machine, status: 'ready' as const, readyAt: now, readyVia: 'probe' as const, provisioningStage: 'services_ready', providerMeta: nextMeta };
    }
  }

  // ── Provisioning timeout ─────────────────────────────────────────────────
  if (Date.now() - machine.createdAt.getTime() > PROVISION_TIMEOUT_MS) {
    console.warn(`[MACHINES] Provisioning timeout for ${machine.slug} (${Math.round((Date.now() - machine.createdAt.getTime()) / 1000)}s elapsed, no heartbeat)`);
    await db.update(machines).set({
      status: 'error',
      provisioningStage: 'timeout',
    }).where(eq(machines.id, machine.id));
    const { eventBus } = await import("@/server/core/event-bus");
    await eventBus.emitStatusChange(machine.id, machine.accountId ?? machine.ownerId, 'error', 'Provisioning timed out');
    return { ...machine, status: 'error' as const, provisioningStage: 'timeout' };
  }

  return machine;
}
