import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '../../db';
import { accounts, baremetalHosts, images, machines, subscriptions, users } from '../../db/schema';
import { config } from '../config';
import { DEFAULT_TEMPLATE_NAME, resolveRequestedProviderImage, serializeImageRow } from '../image-catalog';
import { backupSurcharge, planIdFromProviderSku, resolvePlanForDisplay } from '@/lib/plan-catalog';
import { getProvider } from '../providers';
import { stripeClient } from '../stripe';
import { eventBus } from '../event-bus';
import {
  autoGenerateAndSaveSSHKey,
  buildMachineUserData,
  cleanupMachineResources,
  createMachineRecord,
  generateMachineIdentity,
  lookupPriceAndSpecs,
  resolveMachineCallbackConfig,
  resolveSSHKeyPublicKeys,
  setupProxyDNS,
  syncMachineStatus,
  uploadSSHKeyToProvider,
} from '../machine-lifecycle';
import { checkMachineLimit } from '../account-limits';
import { decryptSecret } from '../crypto';
import { pickBaremetalHostForPlan } from '../baremetal/scheduler';

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
  plan: {
    id: string;
    label: string | null;
    vcpu: number | null;
    ram_gb: number | null;
    disk_gb: number | null;
    price_monthly: number | null;
  };
  billing: {
    mode: 'flat_monthly';
    price_monthly: number | null;
    compute_seconds: number | null;
    storage_gb: number | null;
    current_period_end: string | null;
  };
  image: ReturnType<typeof serializeImageRow> | null;
  connectivity: {
    public_ip: string | null;
    private_ipv4: string | null;
    ssh_command: string | null;
    ssh_port: number | null;
    urls: {
      proxy: string;
      terminal: string;
      port_template: string;
    } | null;
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
  plan: string;
  region: string;
  name?: string;
  image_id?: string | null;
  env_vars?: Record<string, string>;
  cloud_init_script?: string;
  ssh_key_ids?: string[];
  billing_interval?: 'monthly' | 'yearly' | '2year';
  billing_mode?: 'flat_monthly' | 'metered';
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
  const sshHost = machine.ip || (typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null);
  const sshKeyPath = `~/.ssh/justavps_${machine.slug}`;

  if (machine.sshPrivateKey) {
    try {
      decryptSecret(machine.sshPrivateKey);
    } catch {
      // ignore key decrypt failures for listing
    }
  }

  const sshCommand = sshHost
    ? `ssh -i ${sshKeyPath}${sshPort ? ` -p ${sshPort}` : ''} -o StrictHostKeyChecking=no root@${sshHost}`
    : null;

  return {
    publicIp: sshHost,
    privateIpv4: typeof meta.private_ipv4 === 'string' ? meta.private_ipv4 : null,
    sshPort,
    sshCommand,
  };
}

export async function serializeMachineV2(machine: MachineRow, sub?: SubscriptionRow | null): Promise<V2MachineView> {
  const planId = planIdFromProviderSku(machine.serverType) ?? machine.serverType;
  const planMeta = resolvePlanForDisplay(machine.serverType);
  const ssh = readSshAccess(machine);
  const proxyDomain = config.PROXY_DOMAIN;
  const image = await resolveImageSummary(machine.imageId);
  const provider = getProvider(machine.provider);
  const supportsResize = machine.provider !== 'baremetal';
  const meta = providerMeta(machine);
  const providerProgressRaw = typeof meta.create_progress === 'number' ? meta.create_progress : null;
  const providerProgress = providerProgressRaw != null && providerProgressRaw <= 1
    ? Math.round(providerProgressRaw * 100)
    : providerProgressRaw;
  const providerStatus = typeof meta.create_status === 'string' ? meta.create_status : null;
  const callbackExpected = typeof meta.callback_expected === 'boolean' ? meta.callback_expected : null;
  const callbackUrl = typeof meta.callback_url === 'string' ? meta.callback_url : null;
  const publicIp = ssh.publicIp ?? (typeof meta.public_ipv4 === 'string' ? meta.public_ipv4 : null);
  const privateIpv4 = ssh.privateIpv4 ?? (typeof meta.private_ipv4 === 'string' ? meta.private_ipv4 : null);
  const sshPort = ssh.sshPort ?? (typeof meta.ssh_port === 'number' ? meta.ssh_port : null);
  const sshCommand = publicIp ? `ssh -i ~/.ssh/justavps_${machine.slug}${sshPort ? ` -p ${sshPort}` : ''} -o StrictHostKeyChecking=no root@${publicIp}` : ssh.sshCommand;

  return {
    id: machine.id,
    slug: machine.slug,
    name: machine.name,
    status: machine.status as V2MachineView['status'],
    provisioning_stage: machine.provisioningStage ?? null,
    provisioning_stage_updated_at: machine.provisioningStageUpdatedAt?.toISOString() ?? null,
    api_version: 'v2',
    region: machine.region,
    plan: {
      id: planId,
      label: planMeta?.label ?? null,
      vcpu: planMeta?.vcpu ?? null,
      ram_gb: planMeta?.memory ?? null,
      disk_gb: planMeta?.disk ?? null,
      price_monthly: machine.priceMonthly ?? null,
    },
    billing: {
      mode: 'flat_monthly',
      price_monthly: machine.priceMonthly ?? null,
      compute_seconds: null,
      storage_gb: planMeta?.disk ?? null,
      current_period_end: sub?.currentPeriodEnd?.toISOString() ?? null,
    },
    image,
    connectivity: {
      public_ip: publicIp,
      private_ipv4: privateIpv4,
      ssh_command: sshCommand,
      ssh_port: sshPort,
      urls: publicIp ? {
        proxy: `https://${machine.slug}.${proxyDomain}`,
        terminal: `https://${machine.slug}.${proxyDomain}/_terminal`,
        port_template: `https://{port}--${machine.slug}.${proxyDomain}`,
      } : null,
    },
    capabilities: {
      can_start: machine.status === 'stopped',
      can_stop: machine.status === 'ready',
      can_reboot: machine.status === 'ready',
      can_resize: supportsResize && (machine.status === 'ready' || machine.status === 'stopped'),
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

async function selectProvisioningProvider(region: string, serverType: string): Promise<string> {
  if (config.BAREMETAL_ENABLED) {
    const { baremetalHosts } = await import('../../db/schema');
    const hostRows = await db.select().from(baremetalHosts);
    const placement = pickBaremetalHostForPlan({
      region,
      serverType,
      hosts: hostRows.map((row) => ({
        id: row.id,
        region: row.region,
        status: row.status as 'requested' | 'ordering' | 'bootstrapping' | 'active' | 'draining' | 'disabled' | 'error' | 'deleted',
        runnerBaseUrl: row.runnerBaseUrl,
        publicIpv4: row.publicIpv4,
        publicIpv6: row.publicIpv6,
        runnerToken: row.runnerToken,
        capacity: {
          totalVcpu: row.totalVcpu ?? 0,
          totalMemoryGb: row.totalMemoryGb ?? 0,
          totalDiskGb: row.totalDiskGb ?? 0,
          usedVcpu: row.usedVcpu ?? 0,
          usedMemoryGb: row.usedMemoryGb ?? 0,
          usedDiskGb: row.usedDiskGb ?? 0,
        },
      })),
    });
    if (placement) return 'baremetal';
  }
  return 'cloud';
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
  const billingMode = data.billing_mode ?? 'flat_monthly';
  if (billingMode !== 'flat_monthly') {
    throw new Error('Metered billing mode is not enabled yet');
  }

  const machineLimit = await checkMachineLimit(input.accountId, input.userId, input.isAdmin);
  if (!machineLimit.allowed) {
    throw new Error(`Machine limit reached (${machineLimit.current}/${machineLimit.max})`);
  }

  const providerName = await selectProvisioningProvider(data.region, data.plan);
  const provider = getProvider(providerName);

  let resolvedImage = 'ubuntu-24.04';
  let machineImageId: string | null = null;
  if (data.image_id) {
    const [img] = await db.select().from(images).where(eq(images.id, data.image_id));
    if (!img || (img.accountId !== input.accountId && !img.isTemplate)) {
      throw new Error('Image not found');
    }
    const resolved = resolveRequestedProviderImage({ explicitImage: img });
    if (!resolved.ok) throw new Error(resolved.message);
    resolvedImage = resolved.selection.providerImage;
    machineImageId = resolved.selection.machineImageId;
  } else if (data.image_id === null) {
    resolvedImage = 'ubuntu-24.04';
    machineImageId = null;
  } else {
    if (providerName === 'baremetal') {
      resolvedImage = 'ubuntu-24.04';
      machineImageId = null;
    } else {
      const [baseImage] = await db.select().from(images)
        .where(and(eq(images.isTemplate, true), eq(images.status, 'ready'), eq(images.name, DEFAULT_TEMPLATE_NAME)))
        .orderBy(desc(images.createdAt))
        .limit(1);
      const resolved = resolveRequestedProviderImage({ fallbackPublicImage: baseImage });
      if (!resolved.ok) throw new Error(resolved.message);
      resolvedImage = resolved.selection.providerImage;
      machineImageId = resolved.selection.machineImageId;
    }
  }

  resolvedImage = normalizeResolvedImageForProvider(providerName, resolvedImage);

  if (resolvedImage !== 'ubuntu-24.04') {
    const exists = await provider.validateImage(resolvedImage);
    if (!exists) throw new Error('Selected image is no longer available on the provider');
  }

  const { priceMonthly, specs } = await lookupPriceAndSpecs(provider, data.region, data.plan);
  const wantBackups = data.enable_backups === true;
  const monthlyPrice = wantBackups ? priceMonthly + backupSurcharge(priceMonthly) : priceMonthly;
  let stripeSubId: string | null = null;
  let stripeSubItemId: string | null = null;

  if (stripeClient.isConfigured()) {
    const [[user], [account]] = await Promise.all([
      db.select().from(users).where(eq(users.id, input.userId)),
      db.select().from(accounts).where(eq(accounts.id, input.accountId)),
    ]);
    if (!user || !account) throw new Error('Account context not found');
    const customerId = await stripeClient.getOrCreateCustomer(input.accountId, account.billingEmail || user.email, account.stripeCustomerId);
    if (!account.stripeCustomerId) {
      await db.update(accounts).set({ stripeCustomerId: customerId }).where(eq(accounts.id, input.accountId));
    }
    const billingInterval = data.billing_interval ?? 'monthly';
    if (input.isAdmin) {
      const result = await stripeClient.createAdminMachineSubscription(customerId, '', `pending-${Date.now()}`, monthlyPrice, data.plan, specs, billingInterval);
      stripeSubId = result.subscriptionId;
      stripeSubItemId = result.subscriptionItemId;
    } else {
      const hasPM = await stripeClient.hasPaymentMethod(customerId);
      if (hasPM) {
        try {
          const result = await stripeClient.createMachineSubscription(customerId, '', `pending-${Date.now()}`, monthlyPrice, data.plan, specs, billingInterval);
          stripeSubId = result.subscriptionId;
          stripeSubItemId = result.subscriptionItemId;
        } catch {
          // fallback below
        }
      }
      if (!stripeSubId) {
        const { url } = await stripeClient.createCheckoutSession({
          customerId,
          userId: input.userId,
          accountId: input.accountId,
          machineConfig: {
            provider: providerName,
            server_type: data.plan,
            region: data.region,
            name: data.name,
            image_id: data.image_id ?? machineImageId,
            env_vars: data.env_vars,
            ssh_key_ids: data.ssh_key_ids,
            specs,
            billing_interval: billingInterval,
            enable_backups: wantBackups,
          },
          priceMonthlyUsd: monthlyPrice,
          billingInterval,
          successUrl: `${config.APP_URL}/machines`,
          cancelUrl: `${config.APP_URL}/machines`,
        });
        return { kind: 'checkout', requires_checkout: true, checkout_url: url, message: 'Payment required. Complete checkout to provision your machine.' };
      }
    }
  }

  const { slug, machineToken } = await generateMachineIdentity();
  const autoKey = await autoGenerateAndSaveSSHKey(input.userId, input.accountId, slug);
  const extraSSHKeys = data.ssh_key_ids?.length ? await resolveSSHKeyPublicKeys(input.accountId, data.ssh_key_ids) : [];
  const providerKeyId = await uploadSSHKeyToProvider(provider, slug, autoKey.publicKey);
  const callbackConfig = resolveMachineCallbackConfig(input.requestUrl);
  const userdata = buildMachineUserData(slug, autoKey.publicKey, machineToken, callbackConfig.url, data.env_vars, extraSSHKeys, data.cloud_init_script);

  try {
    const machine = await createMachineRecord({
      ownerId: input.userId,
      accountId: input.accountId,
      slug,
      name: data.name || `machine-${slug}`,
      provider: providerName,
      imageId: machineImageId,
      serverType: data.plan,
      region: data.region,
      ip: null,
      providerServerId: null,
      machineToken,
      sshPublicKey: autoKey.publicKey,
      sshPrivateKey: autoKey.privateKey,
      priceMonthly: monthlyPrice,
      backupsEnabled: wantBackups,
    });

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

    const nextProviderMeta: Record<string, unknown> = {
      callback_expected: callbackConfig.callbackExpected,
      callback_url: callbackConfig.url,
      create_status: 'running',
      create_progress: 0,
    };

    if (providerName === 'baremetal') {
      const hostRows = await db.select().from(baremetalHosts);
      const placement = pickBaremetalHostForPlan({
        region: data.region,
        serverType: data.plan,
        hosts: hostRows.map((row) => ({
          id: row.id,
          region: row.region,
          status: row.status as 'requested' | 'ordering' | 'bootstrapping' | 'active' | 'draining' | 'disabled' | 'error' | 'deleted',
          runnerBaseUrl: row.runnerBaseUrl,
          publicIpv4: row.publicIpv4,
          publicIpv6: row.publicIpv6,
          runnerToken: row.runnerToken,
          capacity: {
            totalVcpu: row.totalVcpu ?? 0,
            totalMemoryGb: row.totalMemoryGb ?? 0,
            totalDiskGb: row.totalDiskGb ?? 0,
            usedVcpu: row.usedVcpu ?? 0,
            usedMemoryGb: row.usedMemoryGb ?? 0,
            usedDiskGb: row.usedDiskGb ?? 0,
          },
        })),
      });

      if (placement) {
        Object.assign(nextProviderMeta, {
          baremetal_host_id: placement.host.id,
          runner_base_url: placement.host.runnerBaseUrl,
          public_ipv4: placement.host.publicIpv4 ?? null,
          public_ipv6: placement.host.publicIpv6 ?? null,
        });
      }
    }

    await db.update(machines).set({
      providerMeta: nextProviderMeta,
    }).where(eq(machines.id, machine.id));

    await eventBus.emitStageChange(machine.id, input.accountId, 'server_creating', 'Creating server on selected substrate...');

    after(async () => {
      try {
        const server = await provider.createServer({
          name: `justavps-${slug}`,
          image: resolvedImage,
          serverType: data.plan,
          region: data.region,
          userData: userdata,
          sshKeyIds: [providerKeyId],
          enableBackups: wantBackups,
          labels: {
            justavps: 'true',
            slug,
            owner: input.userId.slice(0, 63),
          },
        });
        provider.deleteSSHKey(providerKeyId).catch(() => {});

        await db.update(machines).set({
          ip: server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp,
          providerServerId: server.serverId,
          providerMeta: {
            callback_expected: callbackConfig.callbackExpected,
            callback_url: callbackConfig.url,
            create_action_id: server.createActionId ?? null,
            create_status: 'running',
            create_progress: 1,
            public_ipv4: server.publicIpv4 ?? null,
            public_ipv6: server.publicIpv6 ?? null,
            ...(server.metadata ?? {}),
          },
        }).where(eq(machines.id, machine.id));

        await eventBus.emitStageChange(machine.id, input.accountId, 'server_created', `Server created (${server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp})`);

        if (config.isCloudflareConfigured()) {
          await setupProxyDNS(machine.id, slug, { ipv4: server.publicIpv4, ipv6: server.publicIpv6 }, input.accountId, data.plan);
        }
      } catch (error) {
        if (providerName === 'baremetal') {
          await provider.deleteServer(`justavps-${slug}`).catch(() => {});
        }
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

    return { kind: 'machine', machine: await serializeMachineV2(machine) };
  } catch (error) {
    if (stripeSubId) await stripeClient.cancelMachineSubscription(stripeSubId).catch(() => {});
    throw error;
  }
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
