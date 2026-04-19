import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { images, machines } from '@/server/db/schema';
import { DEFAULT_TEMPLATE_NAME, resolveRequestedProviderImage } from '@/server/core/image-catalog';
import { decryptSecret } from '@/server/core/crypto';
import {
  buildMachineUserData,
  resolveMachineCallbackConfig,
  setupProxyDNS,
  uploadSSHKeyToProvider,
} from '@/server/v1/services/machine-lifecycle';
import { getProvider } from '@/server/platform/providers';

function getArg(flag: string): string | null {
  const exact = process.argv.find((arg) => arg === flag);
  if (exact) return process.argv[process.argv.indexOf(exact) + 1] ?? null;
  const prefixed = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : null;
}

const machineId = getArg('--machine-id');
if (!machineId) {
  throw new Error('--machine-id is required');
}

const provider = getProvider('cloud');
const [machine] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
if (!machine) {
  throw new Error(`Machine ${machineId} not found`);
}

if (!machine.sshPublicKey) {
  throw new Error(`Machine ${machineId} has no sshPublicKey`);
}

let resolvedImage = 'ubuntu-24.04';
if (machine.imageId) {
  const [img] = await db.select().from(images).where(eq(images.id, machine.imageId)).limit(1);
  if (img) {
    const resolved = resolveRequestedProviderImage({ explicitImage: img });
    if (resolved.ok) resolvedImage = resolved.selection.providerImage;
  }
} else {
  const [baseImage] = await db.select().from(images)
    .where(and(eq(images.isTemplate, true), eq(images.status, 'ready'), eq(images.name, DEFAULT_TEMPLATE_NAME)))
    .orderBy(desc(images.createdAt))
    .limit(1);
  if (baseImage) {
    const resolved = resolveRequestedProviderImage({ fallbackPublicImage: baseImage });
    if (resolved.ok) resolvedImage = resolved.selection.providerImage;
  }
}

const callbackUrl = resolveMachineCallbackConfig().url;
const machineToken = decryptSecret(machine.machineToken);
const userData = buildMachineUserData(
  machine.slug,
  machine.sshPublicKey,
  machineToken,
  callbackUrl,
  undefined,
  [],
  undefined,
);

const providerKeyId = await uploadSSHKeyToProvider(provider, machine.slug, machine.sshPublicKey);

try {
  const server = await provider.createServer({
    name: `justavps-${machine.slug}`,
    image: resolvedImage,
    serverType: machine.serverType,
    region: machine.region,
    userData,
    sshKeyIds: [providerKeyId],
    enableBackups: machine.backupsEnabled,
    labels: {
      justavps: 'true',
      slug: machine.slug,
      owner: machine.ownerId.slice(0, 63),
    },
  });

  await db.update(machines).set({
    ip: server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp,
    providerServerId: server.serverId,
    status: 'provisioning',
    providerMeta: {
      callback_expected: true,
      callback_url: callbackUrl,
      create_action_id: server.createActionId ?? null,
      create_status: 'running',
      create_progress: 1,
      public_ipv4: server.publicIpv4 ?? null,
      public_ipv6: server.publicIpv6 ?? null,
      reprovisioned_at: new Date().toISOString(),
    },
    provisioningStage: 'server_created',
    provisioningStageUpdatedAt: new Date(),
  }).where(eq(machines.id, machine.id));

  if (server.publicIpv4 || server.publicIpv6) {
    await setupProxyDNS(machine.id, machine.slug, { ipv4: server.publicIpv4, ipv6: server.publicIpv6 }, machine.accountId ?? machine.ownerId, machine.serverType);
  }

  console.log(JSON.stringify({
    machineId: machine.id,
    slug: machine.slug,
    providerServerId: server.serverId,
    ip: server.publicIpv4 ?? server.publicIpv6 ?? server.publicIp,
    createActionId: server.createActionId ?? null,
    status: 'reprovisioned',
  }, null, 2));
} finally {
  provider.deleteSSHKey(providerKeyId).catch((error) => {
    console.warn(`[retry-machine-provision] Failed to delete ephemeral SSH key ${providerKeyId}:`, error);
  });
}
