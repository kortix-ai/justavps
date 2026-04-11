import { db } from '@/server/db';
import { apiKeys, proxyTokens } from '@/server/db/schema';
import { or, lt, isNotNull, eq, sql } from 'drizzle-orm';
import { syncApiKeyHashToKV } from '@/server/lib/proxy-kv';

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from './service-state';

export const CONTROL_PLANE_AUTH_CACHE_SERVICE = 'auth_cache' as const;
export const AUTH_CACHE_SCOPE = 'api_keys';
const AUTH_CACHE_PASS_TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

export async function runAuthCacheServicePass(options?: {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
}) {
  const lease = await acquireControlPlaneServiceLease({
    service: CONTROL_PLANE_AUTH_CACHE_SERVICE,
    scope: AUTH_CACHE_SCOPE,
    leaseMs: options?.leaseMs,
    leaseOwner: options?.leaseOwner,
  });
  if (!lease.acquired) {
    return {
      acquired: false,
      synced: 0,
      leaseOwner: lease.leaseOwner,
      scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_AUTH_CACHE_SERVICE, scope: AUTH_CACHE_SCOPE }),
    };
  }

  const now = new Date();
  let synced = 0;
  let proxyTokensPruned = 0;
  try {
    const pruneResult = await db.execute(sql<{ id: string }>`
      delete from ${proxyTokens}
      where (${proxyTokens.expiresAt} < ${now.toISOString()}::timestamp)
         or (${proxyTokens.revokedAt} is not null)
      returning ${proxyTokens.id}
    `);
    proxyTokensPruned = Array.isArray(pruneResult)
      ? pruneResult.length
      : pruneResult && typeof pruneResult === 'object' && 'rows' in pruneResult && Array.isArray((pruneResult as { rows?: unknown }).rows)
        ? (pruneResult as { rows: Array<{ id: string }> }).rows.length
        : 0;

    const rows = await db.select().from(apiKeys).limit(options?.limit ?? 250);
    const candidates = rows.filter((key) => key.keySha256 && key.accountId && (!key.expiresAt || key.expiresAt >= now));
    const results = await withTimeout(Promise.allSettled(candidates.map(async (key) => {
      await syncApiKeyHashToKV(key.keySha256!, key.accountId!, key.name, {
        scope: key.scope,
        machineIds: key.machineIds ?? null,
        permissions: key.permissions,
        expiresAt: key.expiresAt?.toISOString() ?? null,
      });
    })), AUTH_CACHE_PASS_TIMEOUT_MS, 'auth cache sync');
    synced = results.filter((result) => result.status === 'fulfilled').length;
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) {
      throw rejected.reason;
    }

    await releaseControlPlaneServiceLease({
      service: CONTROL_PLANE_AUTH_CACHE_SERVICE,
      scope: AUTH_CACHE_SCOPE,
      leaseOwner: lease.leaseOwner,
      checkpoint: {
        last_synced_at: new Date().toISOString(),
        last_synced_count: synced,
        last_proxy_tokens_pruned_count: proxyTokensPruned,
      },
    });
  } catch (error) {
    await releaseControlPlaneServiceLease({
      service: CONTROL_PLANE_AUTH_CACHE_SERVICE,
      scope: AUTH_CACHE_SCOPE,
      leaseOwner: lease.leaseOwner,
      checkpoint: {
        last_synced_at: new Date().toISOString(),
        last_synced_count: synced,
        last_proxy_tokens_pruned_count: proxyTokensPruned,
      },
      metadata: {
        last_error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  return {
    acquired: true,
    synced,
    proxyTokensPruned,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_AUTH_CACHE_SERVICE, scope: AUTH_CACHE_SCOPE }),
  };
}
