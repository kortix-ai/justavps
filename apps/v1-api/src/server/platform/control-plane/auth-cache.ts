import { db } from '@/server/db';
import { apiKeys, proxyTokens } from '@/server/db/schema';
import { gte, isNull, lt, sql } from 'drizzle-orm';
import { deleteApiKeyFromKV, deleteProxyTokenFromKV, syncApiKeyHashToKV } from "@/server/v1/services/proxy-kv";

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from "@/server/platform/control-plane/service-state";

const CONTROL_PLANE_AUTH_CACHE_SERVICE = 'auth_cache' as const;
const AUTH_CACHE_SCOPE = 'api_keys';
const AUTH_CACHE_PASS_TIMEOUT_MS = 30_000;

function rowsFromExecute<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

function summarizeFailures(results: PromiseSettledResult<unknown>[]) {
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

  return {
    failed: failures.length,
    summary: failures.length > 0 ? failures.slice(0, 3).join('; ') : null,
  };
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
  let syncFailed = 0;
  let expiredApiKeysPruned = 0;
  let expiredApiKeyKvDeleted = 0;
  let expiredApiKeyKvDeleteFailed = 0;
  let proxyTokensPruned = 0;
  let proxyTokenKvDeleted = 0;
  let proxyTokenKvDeleteFailed = 0;
  try {
    const rowLimit = options?.limit ?? 250;
    const expiredApiKeyRows = await db.select().from(apiKeys).where(lt(apiKeys.expiresAt, now)).limit(rowLimit);
    const expiredApiKeyCandidates = expiredApiKeyRows.filter((key) => key.keySha256);
    expiredApiKeysPruned = expiredApiKeyCandidates.length;
    const expiredApiKeyDeleteResults = await withTimeout(Promise.allSettled(expiredApiKeyCandidates.map(async (key) => {
      await deleteApiKeyFromKV(key.keySha256!);
    })), AUTH_CACHE_PASS_TIMEOUT_MS, 'expired api key prune');
    expiredApiKeyKvDeleted = expiredApiKeyDeleteResults.filter((result) => result.status === 'fulfilled').length;
    const expiredApiKeyFailureSummary = summarizeFailures(expiredApiKeyDeleteResults);
    expiredApiKeyKvDeleteFailed = expiredApiKeyFailureSummary.failed;

    const pruneRows = rowsFromExecute<{ id: string; token_sha256?: string; tokenSha256?: string }>(await db.execute(sql<{ id: string; token_sha256?: string; tokenSha256?: string }>`
      delete from ${proxyTokens}
      where (${proxyTokens.expiresAt} < ${now.toISOString()}::timestamp)
          or (${proxyTokens.revokedAt} is not null)
      returning ${proxyTokens.id}, ${proxyTokens.tokenSha256}
    `));
    proxyTokensPruned = pruneRows.length;
    const pruneResults = await withTimeout(Promise.allSettled(pruneRows
      .map((row) => row.token_sha256 ?? row.tokenSha256 ?? '')
      .filter((tokenSha256) => typeof tokenSha256 === 'string' && tokenSha256.length > 0)
      .map(async (tokenSha256) => {
        await deleteProxyTokenFromKV(tokenSha256);
      })), AUTH_CACHE_PASS_TIMEOUT_MS, 'proxy token prune');
    proxyTokenKvDeleted = pruneResults.filter((result) => result.status === 'fulfilled').length;
    const pruneFailureSummary = summarizeFailures(pruneResults);
    proxyTokenKvDeleteFailed = pruneFailureSummary.failed;

    const activeApiKeyRows = await db.select().from(apiKeys).where(sql`${isNull(apiKeys.expiresAt)} or ${gte(apiKeys.expiresAt, now)}`).limit(rowLimit);
    const candidates = activeApiKeyRows.filter((key) => key.keySha256 && key.accountId);
    const results = await withTimeout(Promise.allSettled(candidates.map(async (key) => {
      await syncApiKeyHashToKV(key.keySha256!, key.accountId!, key.name, {
        scope: key.scope,
        machineIds: key.machineIds ?? null,
        permissions: key.permissions,
        expiresAt: key.expiresAt?.toISOString() ?? null,
      });
    })), AUTH_CACHE_PASS_TIMEOUT_MS, 'auth cache sync');
    synced = results.filter((result) => result.status === 'fulfilled').length;
    const syncFailureSummary = summarizeFailures(results);
    syncFailed = syncFailureSummary.failed;
    const errorSummary = [expiredApiKeyFailureSummary.summary, pruneFailureSummary.summary, syncFailureSummary.summary].filter(Boolean).join('; ') || null;

    await releaseControlPlaneServiceLease({
      service: CONTROL_PLANE_AUTH_CACHE_SERVICE,
      scope: AUTH_CACHE_SCOPE,
      leaseOwner: lease.leaseOwner,
      checkpoint: {
        last_synced_at: new Date().toISOString(),
        last_synced_count: synced,
        last_sync_failed_count: syncFailed,
        last_expired_api_keys_pruned_count: expiredApiKeysPruned,
        last_expired_api_key_kv_deleted_count: expiredApiKeyKvDeleted,
        last_expired_api_key_kv_delete_failed_count: expiredApiKeyKvDeleteFailed,
        last_proxy_tokens_pruned_count: proxyTokensPruned,
        last_proxy_token_kv_deleted_count: proxyTokenKvDeleted,
        last_proxy_token_kv_delete_failed_count: proxyTokenKvDeleteFailed,
      },
      metadata: {
        last_error: errorSummary,
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
        last_sync_failed_count: syncFailed,
        last_expired_api_keys_pruned_count: expiredApiKeysPruned,
        last_expired_api_key_kv_deleted_count: expiredApiKeyKvDeleted,
        last_expired_api_key_kv_delete_failed_count: expiredApiKeyKvDeleteFailed,
        last_proxy_tokens_pruned_count: proxyTokensPruned,
        last_proxy_token_kv_deleted_count: proxyTokenKvDeleted,
        last_proxy_token_kv_delete_failed_count: proxyTokenKvDeleteFailed,
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
    syncFailed,
    expiredApiKeysPruned,
    expiredApiKeyKvDeleted,
    expiredApiKeyKvDeleteFailed,
    proxyTokensPruned,
    proxyTokenKvDeleted,
    proxyTokenKvDeleteFailed,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_AUTH_CACHE_SERVICE, scope: AUTH_CACHE_SCOPE }),
  };
}
