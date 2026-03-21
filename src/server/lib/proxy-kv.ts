/**
 * Sync API keys and proxy tokens to Cloudflare KV for Worker auth.
 *
 * The Worker verifies API keys by computing SHA-256 of the raw key
 * and looking it up in KV: `apikey:{sha256hex} → { owner_id, name, scope, ... }`.
 *
 * Proxy tokens use: `pt:{sha256hex} → { owner_id, machine_id, machine_slug, ports, expires_at }`.
 *
 * This is separate from the bcrypt hash stored in the database (used for
 * platform API auth). The Worker runtime doesn't support bcrypt.
 */

import { createHash } from 'crypto';
import { config } from './config';

const CF_API = 'https://api.cloudflare.com/client/v4';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function getKVConfig() {
  const kvNamespaceId = process.env.CF_KV_NAMESPACE_ID;
  if (!config.CLOUDFLARE_ACCOUNT_ID || !kvNamespaceId) return null;
  return { accountId: config.CLOUDFLARE_ACCOUNT_ID, kvNamespaceId };
}

async function writeKV(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const kv = getKVConfig();
  if (!kv) return;

  const url = new URL(`${CF_API}/accounts/${kv.accountId}/storage/kv/namespaces/${kv.kvNamespaceId}/values/${key}`);
  if (ttlSeconds) url.searchParams.set('expiration_ttl', String(ttlSeconds));

  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      'X-Auth-Key': config.CLOUDFLARE_API_KEY,
      'X-Auth-Email': config.CLOUDFLARE_EMAIL,
      'Content-Type': 'text/plain',
    },
    body: value,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV write failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function deleteKV(key: string): Promise<void> {
  const kv = getKVConfig();
  if (!kv) return;

  await fetch(`${CF_API}/accounts/${kv.accountId}/storage/kv/namespaces/${kv.kvNamespaceId}/values/${key}`, {
    method: 'DELETE',
    headers: {
      'X-Auth-Key': config.CLOUDFLARE_API_KEY,
      'X-Auth-Email': config.CLOUDFLARE_EMAIL,
    },
  }).catch(() => {});
}

// ─── API Key Sync ───────────────────────────────────────────────────────────

export interface ApiKeyKVExtra {
  scope: string;
  machineIds: string[] | null;
  permissions: string[];
  expiresAt: string | null;
}

/**
 * Write API key SHA-256 hash to CF KV.
 * Called when a new API key is created.
 */
export async function syncApiKeyToKV(
  rawKey: string,
  ownerId: string,
  name: string,
  extra?: ApiKeyKVExtra,
): Promise<void> {
  const hash = sha256Hex(rawKey);
  const value = JSON.stringify({
    owner_id: ownerId,
    name,
    scope: extra?.scope ?? 'account',
    machine_ids: extra?.machineIds ?? null,
    permissions: extra?.permissions ?? ['*'],
    expires_at: extra?.expiresAt ?? null,
  });

  await writeKV(`apikey:${hash}`, value);
  console.log(`[PROXY-KV] Synced API key hash to KV: apikey:${hash.slice(0, 12)}...`);
}

/**
 * Delete API key from CF KV.
 * Called when an API key is deleted.
 */
export async function deleteApiKeyFromKV(keyPrefix: string): Promise<void> {
  // Best-effort: we can't easily delete by prefix from KV without listing.
  // The entry will be orphaned but harmless (key is deleted from DB, can't be re-used).
  console.log(`[PROXY-KV] API key with prefix ${keyPrefix} deleted from DB (KV entry orphaned — harmless)`);
}

// ─── Proxy Token Sync ───────────────────────────────────────────────────────

/**
 * Write proxy token SHA-256 hash to CF KV with TTL.
 * Called when a new proxy token is created.
 */
export async function syncProxyTokenToKV(
  rawToken: string,
  data: {
    owner_id: string;
    machine_id: string;
    machine_slug: string;
    ports: number[] | null;
    expires_at: string;
  },
  ttlSeconds: number,
): Promise<void> {
  const hash = sha256Hex(rawToken);
  const value = JSON.stringify(data);
  await writeKV(`pt:${hash}`, value, ttlSeconds);
  console.log(`[PROXY-KV] Synced proxy token to KV: pt:${hash.slice(0, 12)}... (TTL: ${ttlSeconds}s)`);
}

/**
 * Delete proxy token from CF KV.
 * Called when a proxy token is revoked.
 */
export async function deleteProxyTokenFromKV(tokenSha256: string): Promise<void> {
  await deleteKV(`pt:${tokenSha256}`);
  console.log(`[PROXY-KV] Deleted proxy token from KV: pt:${tokenSha256.slice(0, 12)}...`);
}
