import { and, eq, inArray, ne } from 'drizzle-orm';
import net from 'node:net';
import { db } from "@/server/db/index";
import { accounts, baremetalHosts, machines, subscriptions, users } from "@/server/db/schema";
import { config } from "@/server/core/config";
import { serializeImageRow } from "@/server/core/image-catalog";
import { backupSurcharge } from '@/shared/lib/plan-catalog';
import { getProvider } from "@/server/platform/providers/index";
import { stripeClient } from "@/server/v1/services/stripe";
import { eventBus } from "@/server/core/event-bus";
import type { ControlPlaneJobHandlerResult } from "@/server/v2/services/control-plane-jobs";
import {
  buildMachineUserData,
  cleanupMachineResources,
  createMachineRecord,
  generateMachineIdentity,
  resolveMachineCallbackConfig,
  setupProxyDNS,
  syncMachineStatus,
} from "@/server/v2/services/machine-lifecycle";
import { commitHostCapacityReservation, getHostCapacityReservationForMachine, releaseHostCapacityReservation } from "@/server/platform/baremetal/reservations";
import { recordHostImageLocalityIntent } from "@/server/platform/baremetal/image-locality";
import { getMachinePortAllocations, releaseMachinePortAllocations, reserveMachinePortAllocations } from "@/server/platform/baremetal/port-allocations";
import { deriveBaremetalCellIdentity } from "@/server/platform/baremetal/cells";
import { checkMachineLimit } from "@/server/auth/account-limits";
import { decryptSecret } from "@/server/core/crypto";
import { recordMachineBenchmark } from "@/server/v2/services/machine-benchmarks";
import { buildMachinePlacementProviderMeta, reserveCapacityForMachineCreate } from "@/server/platform/control-plane/allocator";
import { HttpBaremetalRunnerClient } from "@/server/platform/baremetal/runner-client";
import {
  defaultPlacementImageAlias,
  normalizeDockerImageRef,
  resolveMachineCreateImage,
} from "@/server/v2/domains/machine/image-source";
import { serializeMachineV2 as serializeMachineViewV2 } from "@/server/v2/domains/machine/serialization";
import type { MachineImageSourceKind, MachineRuntimeKind } from "@/server/v2/domains/machine/types";
import {
  enqueueMachineCreateJob,
  ensureProvisionerServiceWorker,
  kickProvisionerServiceWorker,
  MACHINE_CREATE_JOB_TYPE,
  machineCreateJobIdempotencyKey,
  registerMachineCreateJobHandler,
} from "@/server/platform/control-plane/provisioner";
// v2-pricing is imported dynamically in createMachineV2

type MachineRow = typeof machines.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;
type V2MachineMode = 'vm' | 'container';
interface V2MachineView {
  id: string;
  slug: string;
  name: string;
  status: 'provisioning' | 'ready' | 'error' | 'stopped' | 'deleted';
  provisioning_stage: string | null;
  provisioning_stage_updated_at: string | null;
  api_version: 'v2';
  machine_mode: V2MachineMode;
  requested_image_kind: MachineImageSourceKind | null;
  requested_image_ref: string | null;
  runtime_kind?: MachineRuntimeKind;
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
    access: {
      mode: 'rest_exec';
      exec_endpoint: string;
    };
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

interface V2CreateMachineInput {
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  host_id?: string;
  machine_mode?: V2MachineMode;
  region?: string;
  name?: string;
  image_id?: string | null;
  docker_image?: string | null;
  env_vars?: Record<string, string>;
  cloud_init_script?: string;
  enable_backups?: boolean;
}

type V2CreateMachineResult =
  | { kind: 'machine'; machine: V2MachineView }
  | { kind: 'checkout'; requires_checkout: true; checkout_url: string; message: string };

const MACHINE_CREATE_RETRY_DELAY_MS = 15_000;

interface MachineCreateJobPayload {
  accountId: string;
  userId: string;
  isAdmin: boolean;
  reservationId: string;
  requestUrl?: string;
  machineMode?: V2MachineMode;
  imageId?: string | null;
  dockerImage?: string | null;
  envVars?: Record<string, string>;
  cloudInitScript?: string;
  enableBackups?: boolean;
}

interface ExecMachineV2Input {
  command: string;
  args?: string[];
  cwd?: string;
  env_vars?: Record<string, string>;
  user?: string;
  group?: string;
  timeout_ms?: number;
}

interface ExecMachineV2Result {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

function shellQuotePart(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildToolboxCommand(command: string, args?: string[]) {
  const parts = [command, ...(args ?? [])].map((part) => shellQuotePart(part));
  return parts.join(' ');
}

function isRunnerExecFallbackError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.includes('/exec -> 404') || error.message.includes('HTTP 404') || error.message.includes('404 Not Found');
}

async function execMachineViaToolbox(machine: MachineRow, input: ExecMachineV2Input, routingIp: string, routingPort: number): Promise<ExecMachineV2Result> {
  const reachable = await waitForTcpListener(routingIp, routingPort, 15_000, 500);
  if (!reachable) {
    throw new Error(`toolbox fallback port ${routingIp}:${routingPort} did not become reachable`);
  }
  const response = await fetch(`http://${routingIp}:${routingPort}/toolbox/process/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: buildToolboxCommand(input.command, input.args),
      cwd: input.cwd,
      timeout: typeof input.timeout_ms === 'number' ? Math.max(1, Math.ceil(input.timeout_ms / 1000)) : undefined,
      env: input.env_vars,
      user: input.user,
    }),
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) as { exit_code?: number; stdout?: string; stderr?: string } : {};
  if (!response.ok) {
    throw new Error(`toolbox fallback POST /toolbox/process/execute -> ${response.status}: ${text.slice(0, 300)}`);
  }

  const exitCode = typeof parsed.exit_code === 'number' ? parsed.exit_code : 1;
  return {
    ok: exitCode === 0,
    stdout: typeof parsed.stdout === 'string' ? parsed.stdout : '',
    stderr: typeof parsed.stderr === 'string' ? parsed.stderr : '',
    exit_code: exitCode,
  };
}

function isBenignLifecycleError(error: unknown, expected: 'stopped' | 'running') {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return expected === 'stopped'
    ? message.includes('already stopped')
    : message.includes('already running');
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

  const { baremetalHosts } = await import("@/server/db/schema");
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

async function serializeMachineV2(machine: MachineRow, sub?: SubscriptionRow | null): Promise<V2MachineView> {
  return serializeMachineViewV2(machine, sub);
}

class MachineNotFoundError extends Error {
  statusCode = 404;
  constructor() { super('Machine not found'); }
}

async function loadOwnedMachine(machineId: string, accountId: string): Promise<MachineRow> {
  // Only v2 machines are visible through v2 endpoints. Treating a v1 machine
  // as "not found" here keeps v1 and v2 truly separate at the API surface.
  const [machine] = await db.select().from(machines).where(and(
    eq(machines.id, machineId),
    eq(machines.accountId, accountId),
    eq(machines.apiVersion, 'v2'),
  ));
  if (!machine || machine.status === 'deleted') throw new MachineNotFoundError();
  return machine;
}

export async function listMachinesV2(input: { accountId: string }) {
  const rows = await db.select().from(machines).where(and(
    eq(machines.accountId, input.accountId),
    eq(machines.apiVersion, 'v2'),
    ne(machines.status, 'deleted'),
  ));
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

class MachineExecUnavailableError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
  }
}

export async function execMachineV2(input: { accountId: string; machineId: string; exec: ExecMachineV2Input }): Promise<ExecMachineV2Result> {
  const machine = await ensureBaremetalHostBinding(await loadOwnedMachine(input.machineId, input.accountId));
  const execAllowed = machine.status === 'ready'
    || (machine.status === 'provisioning' && ['server_created', 'services_ready'].includes(machine.provisioningStage ?? ''));
  if (!execAllowed) {
    throw new MachineExecUnavailableError('Instance must be ready before exec is available');
  }
  if (!machine.baremetalHostId) {
    throw new MachineExecUnavailableError('Instance is not assigned to a bare metal host');
  }

  const [host] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, machine.baremetalHostId));
  if (!host?.runnerBaseUrl || !host.runnerToken) {
    throw new MachineExecUnavailableError('Host runner is not available for this instance');
  }

  const providerServerId = inferProviderServerId(machine);
  if (!providerServerId) {
    throw new MachineExecUnavailableError('Instance provider ID is missing');
  }

  const runner = new HttpBaremetalRunnerClient(host.runnerBaseUrl, host.runnerToken);
  try {
    const result = await runner.execInstance(providerServerId, {
      command: input.exec.command,
      args: input.exec.args,
      cwd: input.exec.cwd,
      envVars: input.exec.env_vars,
      user: input.exec.user,
      group: input.exec.group,
      timeoutMs: input.exec.timeout_ms,
    });
    return {
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exitCode,
    };
  } catch (error) {
    const meta = (machine.providerMeta ?? {}) as Record<string, unknown>;
    const portAllocations = await getMachinePortAllocations(machine.id).catch(() => ({ http: null }));
    const routingPort = machine.httpPort
      ?? (typeof meta.http_port === 'number' ? meta.http_port : null)
      ?? portAllocations.http?.publicPort
      ?? null;
    const routingIp = host.publicIpv4 ?? machine.publicIpv4 ?? null;
    if (!routingIp || !routingPort) {
      throw error;
    }
    try {
      return await execMachineViaToolbox(machine, input.exec, routingIp, routingPort);
    } catch (fallbackError) {
      if (error instanceof Error && isRunnerExecFallbackError(error) && fallbackError instanceof Error) {
        throw new Error(`${error.message}; toolbox fallback failed: ${fallbackError.message}`);
      }
      throw error;
    }
  }
}

function sanitizeJobError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function waitForTcpListener(host: string | null | undefined, port: number | null | undefined, timeoutMs = 15_000, intervalMs = 500) {
  if (!host || !port) return false;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(Math.min(1_000, intervalMs));
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

    if (connected) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
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

    // Admin machines skip Stripe — $0 subs added no billing signal and
    // burned slots against Stripe's 500-active-sub-per-customer cap.
    if (payload.isAdmin) return;

    const hasPM = await stripeClient.hasPaymentMethod(customerId);
    if (!hasPM) return;
    const result = await stripeClient.createMachineSubscription(
      customerId, '', `pending-${Date.now()}`, machine.priceMonthly, 'custom', specs, 'monthly',
    );
    const stripeSubId = result.subscriptionId;
    const stripeSubItemId = result.subscriptionItemId;
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
  const { resolvedImage } = await resolveMachineCreateImage({ machine, payload });
  const callbackConfig = payload.dockerImage
    ? { callbackExpected: false, url: null }
    : resolveMachineCallbackConfig(payload.requestUrl);
  const callbackUrl = callbackConfig.url ?? config.PLATFORM_URL;
  const isGoldenImage = resolvedImage === 'justavps-golden' || resolvedImage.startsWith('justavps-golden');
  const isDockerImage = /^(docker|oci):/i.test(resolvedImage);
  const userdata = isDockerImage
    ? ''
    : isGoldenImage
    ? (await import("@/server/v2/services/cloud-init")).buildCloudInitV2({
        slug: machine.slug,
        machineToken,
        platformCallbackUrl: callbackUrl,
        proxyDomain: config.PROXY_DOMAIN,
        envVars: payload.envVars,
        cloudInitScript: payload.cloudInitScript,
      })
    : buildMachineUserData(
        machine.slug,
        machineToken,
        callbackUrl,
        payload.envVars,
        payload.cloudInitScript,
      );

  let machineForSideEffects = machine;
  let publicIpv4 = ((machine.providerMeta ?? {}) as Record<string, unknown>).public_ipv4 as string | null | undefined;
  let publicIpv6 = ((machine.providerMeta ?? {}) as Record<string, unknown>).public_ipv6 as string | null | undefined;
  let routingPort = ((machine.providerMeta ?? {}) as Record<string, unknown>).http_port as number | null | undefined;

  if (!machine.providerServerId) {
    let createdServerId: string | null = null;
    try {
      await eventBus.emitStageChange(machine.id, payload.accountId, 'server_creating', 'Creating server...');
      const portAllocation = await reserveMachinePortAllocations({
        machineId: machine.id,
        hostId: host.id,
        hostPublicIp: host.publicIpv4 ?? null,
        sshEnabled: false,
      });
      routingPort = portAllocation.httpPort;
      const server = await provider.createServer({
        name: `justavps-${machine.slug}`,
        image: resolvedImage,
        serverType: 'custom',
        region: machine.region,
        userData: userdata,
        sshKeyIds: [],
        enableBackups: payload.enableBackups === true,
        machineMode: payload.machineMode ?? (machine.machineMode as V2MachineMode),
        labels: { justavps: 'true', slug: machine.slug, owner: payload.userId.slice(0, 63) },
        hostId: host.id,
        vcpu: machine.vcpu ?? 0,
        memoryGb: machine.ramGb ?? 0,
        diskGb: machine.diskGb ?? 0,
        httpPort: routingPort ?? null,
        sshProxyEnabled: false,
      });
      createdServerId = server.serverId;
      publicIpv4 = server.publicIpv4 ?? null;
      publicIpv6 = server.publicIpv6 ?? null;
      routingPort = typeof server.metadata?.http_port === 'number' ? server.metadata.http_port : null;

      const nextProviderMeta = {
        ...((machine.providerMeta ?? {}) as Record<string, unknown>),
        create_action_id: server.createActionId ?? null,
        create_status: 'running',
        create_progress: 1,
        machine_mode: payload.machineMode ?? (machine.machineMode as V2MachineMode),
        baremetal_host_id: host.id,
        baremetal_cell_id: host.cellId,
        baremetal_cell_slug: deriveBaremetalCellIdentity(host)?.slug ?? null,
        baremetal_cell_generation: host.generation,
        runner_base_url: host.runnerBaseUrl,
        reservation_id: reservation.id,
        public_ipv4: publicIpv4,
        public_ipv6: publicIpv6,
        ...(server.metadata ?? {}),
        access_mode: 'exec',
        ssh_proxy_enabled: false,
        ssh_port: null,
      };

      const [updatedMachine] = await db.update(machines).set({
        ip: publicIpv4 ?? publicIpv6 ?? server.publicIp,
        publicIpv4: publicIpv4 ?? null,
        publicIpv6: publicIpv6 ?? null,
        sshPort: null,
        httpPort: routingPort ?? null,
        providerProgress: 100,
        providerStatus: 'running',
        callbackExpected: callbackConfig.callbackExpected,
        callbackUrl: callbackUrl,
        providerServerId: server.serverId,
        providerMeta: nextProviderMeta,
      }).where(eq(machines.id, machine.id)).returning();
      machineForSideEffects = updatedMachine ?? { ...machine, providerServerId: server.serverId, providerMeta: nextProviderMeta };

      await recordMachineBenchmark({
        machineId: machine.id,
        accountId: payload.accountId,
        baremetalHostId: host.id,
        machineMode: payload.machineMode ?? (machine.machineMode as V2MachineMode),
        metadata: nextProviderMeta,
      }).catch((error) => console.warn(`[v2-job ${machine.slug}] benchmark persist error:`, error));

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
        const routingReady = await waitForTcpListener(host.publicIpv4 ?? publicIpv4 ?? publicIpv6, routingPort ?? null);
        await db.update(machines).set({
          status: routingReady ? 'ready' : 'provisioning',
          readyAt: routingReady ? new Date() : null,
          provisioningStage: routingReady ? 'services_ready' : 'server_created',
        }).where(eq(machines.id, machine.id));
        if (routingReady) {
          await eventBus.emitStatusChange(machine.id, payload.accountId, 'ready', 'Machine ready (warm pool)');
        } else {
          await eventBus.emitStageChange(machine.id, payload.accountId, 'server_created', 'Warm pool claimed, waiting for public proxy readiness');
        }
      } else {
        await eventBus.emitStageChange(machine.id, payload.accountId, 'server_created', 'Server created');
      }
    } catch (error) {
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
      {
        routingIp: host.publicIpv4 ?? publicIpv4 ?? publicIpv6 ?? null,
        routingPort: routingPort ?? null,
      },
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
  const { computeMonthlyPrice } = await import('@/v2/lib/v2-pricing');
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
  const machineMode = data.machine_mode ?? 'vm';
  const dockerImage = normalizeDockerImageRef(data.docker_image);
  const region = data.region ?? 'hel1';

  if (dockerImage && machineMode !== 'container') {
    throw new Error('Docker image refs are only supported for container machines');
  }
  if (dockerImage && data.image_id) {
    throw new Error('Choose either an image template or a Docker image, not both');
  }

  // ── 2. Pricing (pure compute) ────────────────────────────────────────────
  const priceMonthly = computeMonthlyPrice(reqVcpu, reqRam, reqDisk);
  const wantBackups = data.enable_backups === true;
  const monthlyPrice = wantBackups ? priceMonthly + backupSurcharge(priceMonthly) : priceMonthly;

  // ── 3. Generate slug + machineToken (sync, fast) ─────────────────────────
  const { slug, machineToken } = await generateMachineIdentity();
  console.log(`[v2-create] +${ms()}ms identity generated slug=${slug}`);

  const callbackConfig = dockerImage
    ? { callbackExpected: false, url: null }
    : resolveMachineCallbackConfig(input.requestUrl);
  let machine!: MachineRow;
  await db.transaction(async (tx) => {
    machine = await createMachineRecord({
      ownerId: input.userId,
      accountId: input.accountId,
      slug,
      name: data.name || `machine-${slug}`,
      provider: 'baremetal',
      machineMode,
      requestedImageKind: dockerImage ? 'docker' : data.image_id ? 'catalog' : 'golden',
      requestedImageRef: dockerImage,
      imageId: null,
      serverType: 'custom',
      region,
      ip: null,
      providerServerId: null,
      machineToken,
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
      imageAlias: defaultPlacementImageAlias(data.image_id, dockerImage),
      executor: tx,
    });
    const selectedCandidate = lease.decision.candidates.find((candidate) => candidate.hostId === lease.host.id);
    if (selectedCandidate) {
      await recordHostImageLocalityIntent({
        hostId: lease.host.id,
        imageId: data.image_id ?? null,
        imageAlias: defaultPlacementImageAlias(data.image_id, dockerImage),
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
      machine_mode: machineMode,
      requested_image_ref: dockerImage,
      requested_image_kind: dockerImage ? 'docker' : data.image_id ? 'catalog' : 'golden',
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
        machineMode,
        imageId: data.image_id ?? null,
        dockerImage,
        envVars: data.env_vars,
        cloudInitScript: data.cloud_init_script,
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
