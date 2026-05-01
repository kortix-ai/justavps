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

function hostLifecycleState(status: string) {
  if (status === 'cancelled') return 'terminated';
  if (status === 'robot_ready') return 'delivered';
  return 'ordered';
}

function preserveOrAdvanceLifecycle(existing: { lifecycleState: string; incusMemberName: string | null } | null, next: string) {
  if (!existing) return next;
  if (existing.incusMemberName) return existing.lifecycleState;
  if (['bootstrapping', 'joining', 'draining', 'cordoned', 'terminated'].includes(existing.lifecycleState)) return existing.lifecycleState;
  return next;
}

function jsonRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function transactionServerNumber(value: unknown) {
  const result = jsonRecord(value);
  const tx = jsonRecord(result.transaction);
  const n = tx.server_number;
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  if (typeof n === 'string' && n) {
    const parsed = Number(n);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function targetClusterId(value: unknown) {
  const record = jsonRecord(value);
  const direct = record.target_cluster_id;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const request = jsonRecord(record.request);
  const requestTarget = request.target_cluster_id;
  return typeof requestTarget === 'string' && requestTarget.trim() ? requestTarget.trim() : null;
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
  const procurements = await db.procurement.findMany({
    where: { status: { in: ['ordered', 'approved', 'order_planned', 'bootstrap_planned', 'bootstrap_blocked'] } },
  }).catch(() => []);
  const procurementByServer = new Map<number, { id: string; targetClusterId: string | null }>();
  for (const procurement of procurements) {
    const serverNumber = transactionServerNumber(procurement.result);
    if (!serverNumber) continue;
    procurementByServer.set(serverNumber, {
      id: procurement.id,
      targetClusterId: targetClusterId(procurement.result) ?? targetClusterId(procurement.request),
    });
  }
  for (const server of servers) {
    const host = mapHetznerServer(server);
    const where = { vendor_providerServerNumber: { vendor: host.vendor, providerServerNumber: host.providerServerNumber } };
    const existing = await db.host.findUnique({ where });
    const procurement = procurementByServer.get(Number(host.providerServerNumber));
    const existingMeta = jsonRecord(existing?.metadata);
    const target = typeof existingMeta.target_cluster_id === 'string' && existingMeta.target_cluster_id.trim()
      ? existingMeta.target_cluster_id.trim()
      : procurement?.targetClusterId ?? null;
    const metadata = {
      ...existingMeta,
      ...host.metadata,
      ...(target ? { target_cluster_id: target } : {}),
      ...(procurement ? { procurement_id: procurement.id } : {}),
    };
    const lifecycleState = preserveOrAdvanceLifecycle(existing, hostLifecycleState(host.status));
    const saved = existing
      ? await db.host.update({
          where: { id: existing.id },
          data: {
            hostClass: host.hostClass,
            productId: host.productId,
            region: host.region,
            location: host.location,
            name: host.name,
            status: host.status,
            publicIpv4: host.publicIpv4,
            publicIpv6: host.publicIpv6,
            lifecycleState,
            metadata,
          },
        })
      : await db.host.create({ data: { ...host, lifecycleState, metadata } });
    if (procurement) {
      await db.procurement.update({ where: { id: procurement.id }, data: { hostId: saved.id } }).catch(() => undefined);
    }
    hosts.push(saved);
  }
  return hosts;
}
