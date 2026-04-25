import dotenv from 'dotenv';
import nodeHttp from 'node:http';
import https from 'node:https';

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/server/db';
import { apiKeys, baremetalHosts, hostCapacityReservations, machines, users } from '@/server/db/schema';
import { ensureUserAccountGraph } from '@/server/auth/accounts';
import { generateApiKey, hashPassword } from '@/server/core/crypto';
import { syncApiKeyHashToKV } from '@/server/v1/services/proxy-kv';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

export const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://localhost:4100';
export const DEFAULT_API_BASE = `${DEFAULT_BASE_URL}/api/v2`;
export const DEFAULT_TARGET_HOST_ID = process.env.E2E_BAREMETAL_HOST_ID || undefined;
export const DEFAULT_TARGET_HOST_IP = process.env.E2E_BAREMETAL_HOST_IP || undefined;

export type HarnessIdentityState = {
  email: string;
  password: string;
  userId: string | null;
  accountId: string | null;
  apiKey: string | null;
  apiKeyId: string | null;
};

export type TargetHostRow = typeof baremetalHosts.$inferSelect;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestJson<T>(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 15 * 60_000): Promise<{ status: number; data: T | null }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : nodeHttp;
    const req = transport.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data: T | null = null;
        try { data = text ? JSON.parse(text) as T : null; } catch { data = null; }
        resolve({ status: res.statusCode ?? 500, data });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

export function authHeaders(state: HarnessIdentityState) {
  if (!state.apiKey) throw new Error('API key not initialized');
  return {
    Authorization: `Bearer ${state.apiKey}`,
    'Content-Type': 'application/json',
  };
}

export async function apiRequest<T>(state: HarnessIdentityState, path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, apiBase = DEFAULT_API_BASE) {
  const res = await requestJson<T>(`${apiBase}${path}`, {
    method: init.method,
    body: init.body,
    headers: { ...authHeaders(state), ...(init.headers ?? {}) },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { status: res.status, data: res.data as T };
}

export async function waitFor<T>(label: string, fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs: number, intervalMs: number): Promise<T> {
  const start = Date.now();
  let lastValue: T | undefined;
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      lastValue = await fn();
      if (predicate(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}. lastValue=${JSON.stringify(lastValue)} lastError=${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function ensureApiHealthy(baseUrl = DEFAULT_BASE_URL) {
  const health = await requestJson<{ status?: string }>(`${baseUrl}/api/health`, {}, 30_000);
  if (health.status < 200 || health.status >= 300) {
    throw new Error(`Local API health failed: ${health.status}`);
  }
  return health.data;
}

export async function createAdminHarnessUser(state: HarnessIdentityState, name: string) {
  if (state.apiKey && state.apiKeyId && state.userId && state.accountId) return state;

  const passwordHash = await hashPassword(state.password);
  const [user] = await db.insert(users).values({
    email: state.email,
    passwordHash,
    name,
    isAdmin: true,
  }).returning();

  const account = await ensureUserAccountGraph(user);
  const { key, hash, sha256, prefix } = await generateApiKey();
  const [apiKey] = await db.insert(apiKeys).values({
    ownerId: user.id,
    accountId: account.id,
    name: `${name}-${Date.now()}`.slice(0, 120),
    keyPrefix: prefix,
    keyHash: hash,
    keySha256: sha256,
    scope: 'account',
    permissions: ['*'],
  }).returning();

  await syncApiKeyHashToKV(sha256, account.id, apiKey.name, {
    scope: 'account',
    machineIds: null,
    permissions: ['*'],
    expiresAt: null,
  }).catch(() => undefined);

  state.userId = user.id;
  state.accountId = account.id;
  state.apiKey = key;
  state.apiKeyId = apiKey.id;
  return state;
}

export async function cleanupHarnessApiKey(state: HarnessIdentityState) {
  if (state.apiKeyId) {
    await db.delete(apiKeys).where(eq(apiKeys.id, state.apiKeyId)).catch(() => undefined);
  }
}

export async function getTargetHost(targetHostId = DEFAULT_TARGET_HOST_ID, targetHostIp = DEFAULT_TARGET_HOST_IP): Promise<TargetHostRow> {
  const [explicit] = targetHostId
    ? await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, targetHostId)).limit(1)
    : [];
  if (explicit) return explicit;

  if (targetHostIp) {
    const [byIp] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.publicIpv4, targetHostIp)).limit(1);
    if (byIp) return byIp;
  }

  const rows = await db.select().from(baremetalHosts);
  const active = rows
    .filter((row) => row.status === 'active' && row.runnerBaseUrl && (((row.metadata as Record<string, unknown> | null)?.scheduler as Record<string, unknown> | undefined)?.schedulable === true))
    .sort((a, b) => Number(Boolean(a.publicIpv6)) - Number(Boolean(b.publicIpv6)))[0];
  if (!active) throw new Error('No active schedulable host found');
  return active;
}

export async function reconcileLocalHostCapacity(hostId: string) {
  const reservations = await db.select().from(hostCapacityReservations).where(eq(hostCapacityReservations.hostId, hostId));
  const machineIds = reservations.map((row) => row.machineId).filter((id): id is string => Boolean(id));
  const machineRows = machineIds.length
    ? await db.select({ id: machines.id, status: machines.status }).from(machines)
        .where(inArray(machines.id, machineIds))
    : [];
  const activeMachineIds = new Set(machineRows.filter((row) => row.status !== 'deleted').map((row) => row.id));
  const committed = reservations.filter((row) => row.state === 'committed' && row.machineId && activeMachineIds.has(row.machineId));
  const usedVcpu = committed.reduce((sum, row) => sum + (row.vcpu ?? 0), 0);
  const usedMemoryGb = committed.reduce((sum, row) => sum + (row.memoryGb ?? 0), 0);
  const usedDiskGb = committed.reduce((sum, row) => sum + (row.diskGb ?? 0), 0);
  await db.update(baremetalHosts).set({
    usedVcpu,
    usedMemoryGb,
    usedDiskGb,
    updatedAt: new Date(),
  }).where(eq(baremetalHosts.id, hostId));
}
