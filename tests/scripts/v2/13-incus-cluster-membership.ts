#!/usr/bin/env npx tsx

import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import nodeHttp from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { apiRequest, createAdminHarnessUser, DEFAULT_BASE_URL, ensureApiHealthy, HarnessIdentityState } from './lib/harness';

const execFileAsync = promisify(execFile);
const BASE_URL = DEFAULT_BASE_URL;
const HOST_IPS = (process.env.E2E_CLUSTER_HOST_IPS || '135.181.129.188,65.109.65.169')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const SSH_KEY_PATH = process.env.E2E_CLUSTER_SSH_KEY_PATH || '/Users/markokraemer/.ssh/justavps_host';
const EXPECTED_MEMBERS = (process.env.E2E_CLUSTER_MEMBER_NAMES || 'justavps-hel1-1,justavps-hel1-2')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .sort();

type HostView = {
  id: string;
  name: string;
  public_ipv4: string | null;
  status: string;
  runner_base_url: string | null;
  cluster: {
    id: string;
    name: string;
    region: string;
    incus_cluster_name: string;
    incus_member_name: string;
  };
};

type ClusterView = {
  id: string;
  host_count: number;
  active_host_count: number;
  member_names: string[];
  incus_cluster_name: string;
};

type IncusClusterMember = {
  server_name: string;
  url: string;
  status: string;
  message: string;
};

const state: HarnessIdentityState = {
  email: `e2e-v2-cluster-${Date.now()}@test.justavps.local`,
  password: 'TestPass123!',
  userId: null,
  accountId: null,
  apiKey: null,
  apiKeyId: null,
};

async function requestText(urlString: string, timeoutMs = 10_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : nodeHttp;
    const req = transport.request(url, { method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode ?? 500,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

async function sshJson<T>(hostIp: string, command: string): Promise<T> {
  const { stdout } = await execFileAsync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    '-i', SSH_KEY_PATH,
    `root@${hostIp}`,
    command,
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
  return JSON.parse(stdout) as T;
}

async function main() {
  console.log('=== JustAVPS V2 Incus cluster membership E2E ===');
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`HOST_IPS=${HOST_IPS.join(',')}`);

  if (HOST_IPS.length < 2) throw new Error('Expected at least two host IPs for cluster verification');

  await ensureApiHealthy(BASE_URL);
  await createAdminHarnessUser(state, 'E2E V2 Cluster Membership');

  const topology = await apiRequest<{ hosts: HostView[]; clusters: ClusterView[] }>(state, '/admin/fleet/hosts');
  const activeHosts = topology.data.hosts.filter((host) => host.public_ipv4 && HOST_IPS.includes(host.public_ipv4));
  if (activeHosts.length !== HOST_IPS.length) {
    throw new Error(`Expected ${HOST_IPS.length} matching hosts in admin fleet, got ${activeHosts.length}`);
  }

  const clusterIds = Array.from(new Set(activeHosts.map((host) => host.cluster.id)));
  if (clusterIds.length !== 1) {
    throw new Error(`Expected all verified hosts in one derived cluster, got ${clusterIds.join(', ')}`);
  }

  const fleetCluster = topology.data.clusters.find((cluster) => cluster.id === clusterIds[0]);
  if (!fleetCluster) throw new Error('Expected cluster to exist in admin fleet response');
  if (fleetCluster.host_count < HOST_IPS.length) {
    throw new Error(`Expected cluster host_count >= ${HOST_IPS.length}, got ${fleetCluster.host_count}`);
  }
  console.log(`[fleet] cluster=${fleetCluster.id} incus=${fleetCluster.incus_cluster_name} members=${fleetCluster.member_names.join(',')}`);

  for (const hostIp of HOST_IPS) {
    const health = await requestText(`http://${hostIp}:7779/healthz`);
    if (health.status !== 200) throw new Error(`Expected runner health 200 from ${hostIp}, got ${health.status}`);
    console.log(`[runner] ${hostIp} health ok`);
  }

  const expectedMemberKey = EXPECTED_MEMBERS.join(',');
  for (const hostIp of HOST_IPS) {
    const members = (await sshJson<IncusClusterMember[]>(hostIp, 'incus cluster list --format json'))
      .map((member) => ({
        server_name: member.server_name,
        url: member.url,
        status: member.status,
        message: member.message,
      }))
      .sort((a, b) => a.server_name.localeCompare(b.server_name));

    const memberKey = members.map((member) => member.server_name).join(',');
    if (memberKey !== expectedMemberKey) {
      throw new Error(`Expected ${hostIp} cluster members ${expectedMemberKey}, got ${memberKey}`);
    }
    const unhealthy = members.filter((member) => member.status !== 'Online');
    if (unhealthy.length > 0) {
      throw new Error(`Expected all cluster members online on ${hostIp}, got ${JSON.stringify(unhealthy)}`);
    }
    console.log(`[incus] ${hostIp} sees ${memberKey}`);
  }

  console.log('=== V2 Incus cluster membership E2E passed ===');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
