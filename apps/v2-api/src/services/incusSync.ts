import type { PrismaClient } from '@prisma/client';
import type { IncusClusterConfig } from '../config.js';
import type { IncusClusterMember, IncusImage, IncusInstance, IncusServer } from '../incus/types.js';

export type IncusObservation = {
  server: IncusServer;
  members: IncusClusterMember[];
  images: IncusImage[];
  instances: IncusInstance[];
};

function memberAddress(member: IncusClusterMember) {
  try {
    return new URL(member.url).hostname;
  } catch {
    return null;
  }
}

export async function syncIncusObservation(db: PrismaClient, cluster: IncusClusterConfig, observed: IncusObservation) {
  await db.incusCluster.upsert({
    where: { id: cluster.id },
    create: {
      id: cluster.id,
      name: cluster.name,
      region: cluster.region,
      endpoint: cluster.endpoint,
      project: cluster.project,
      lastSyncedAt: new Date(),
      observed: observed.server,
    },
    update: {
      name: cluster.name,
      region: cluster.region,
      endpoint: cluster.endpoint,
      project: cluster.project,
      lastSyncedAt: new Date(),
      observed: observed.server,
    },
  });

  for (const member of observed.members) {
    await db.incusMember.upsert({
      where: { clusterId_name: { clusterId: cluster.id, name: member.server_name } },
      create: {
        clusterId: cluster.id,
        name: member.server_name,
        url: member.url,
        status: member.status,
        roles: member.roles ?? [],
        observed: member,
        lastSyncedAt: new Date(),
      },
      update: {
        url: member.url,
        status: member.status,
        roles: member.roles ?? [],
        observed: member,
        lastSyncedAt: new Date(),
      },
    });

    const address = memberAddress(member);
    if (address) {
      await db.host.updateMany({
        where: { OR: [{ publicIpv4: address }, { publicIpv6: address }] },
        data: {
          incusClusterId: cluster.id,
          incusMemberName: member.server_name,
          status: member.status === 'Online' ? 'incus_member_online' : 'incus_member_unavailable',
          schedulable: member.status === 'Online',
        },
      });
    }
  }

  for (const instance of observed.instances) {
    await db.incusInstance.upsert({
      where: { clusterId_project_name: { clusterId: cluster.id, project: cluster.project, name: instance.name } },
      create: {
        clusterId: cluster.id,
        project: cluster.project,
        name: instance.name,
        type: instance.type,
        status: instance.status,
        location: instance.location ?? null,
        observed: instance,
        lastSyncedAt: new Date(),
      },
      update: {
        type: instance.type,
        status: instance.status,
        location: instance.location ?? null,
        observed: instance,
        lastSyncedAt: new Date(),
      },
    });
  }

  for (const image of observed.images) {
    await db.incusImage.upsert({
      where: { clusterId_project_fingerprint: { clusterId: cluster.id, project: cluster.project, fingerprint: image.fingerprint } },
      create: {
        clusterId: cluster.id,
        project: cluster.project,
        fingerprint: image.fingerprint,
        aliases: image.aliases ?? [],
        observed: image,
        lastSyncedAt: new Date(),
      },
      update: {
        aliases: image.aliases ?? [],
        observed: image,
        lastSyncedAt: new Date(),
      },
    });
  }

  return {
    cluster_id: cluster.id,
    members: observed.members.length,
    instances: observed.instances.length,
    images: observed.images.length,
  };
}
