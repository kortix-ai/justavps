import type { PrismaClient } from '@prisma/client';
import type { HetznerRobotServer } from '../vendors/hetznerRobot.js';

function regionFromHetznerDc(dc: string) {
  const upper = dc.toUpperCase();
  if (upper.startsWith('HEL') || upper.startsWith('FSN') || upper.startsWith('NBG')) return 'eu';
  return 'unknown';
}

function publicIpv6(server: HetznerRobotServer['server']) {
  return server.server_ipv6_net ?? server.subnet?.find((item) => item.ip.includes(':'))?.ip ?? null;
}

function hostStatus(server: HetznerRobotServer['server']) {
  if (server.cancelled) return 'cancelled';
  if (server.status.toLowerCase() === 'ready') return 'robot_ready';
  return `robot_${server.status.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

export function mapHetznerServer(server: HetznerRobotServer) {
  const item = server.server;
  return {
    id: `hetzner-${item.server_number}`,
    vendor: 'hetzner_robot',
    providerServerNumber: String(item.server_number),
    hostClass: item.product.toLowerCase(),
    productId: item.product,
    region: regionFromHetznerDc(item.dc),
    location: item.dc,
    name: item.server_name || `hetzner-${item.server_number}`,
    status: hostStatus(item),
    schedulable: false,
    publicIpv4: item.server_ip,
    publicIpv6: publicIpv6(item),
    metadata: {
      inventory_source: 'hetzner_robot',
      robot: item,
    },
  };
}

export async function syncHetznerServers(db: PrismaClient, servers: HetznerRobotServer[]) {
  const hosts = [];
  for (const server of servers) {
    const host = mapHetznerServer(server);
    hosts.push(await db.host.upsert({
      where: {
        vendor_providerServerNumber: {
          vendor: host.vendor,
          providerServerNumber: host.providerServerNumber,
        },
      },
      create: host,
      update: {
        hostClass: host.hostClass,
        productId: host.productId,
        region: host.region,
        location: host.location,
        name: host.name,
        status: host.status,
        publicIpv4: host.publicIpv4,
        publicIpv6: host.publicIpv6,
        metadata: host.metadata,
      },
    }));
  }
  return hosts;
}
