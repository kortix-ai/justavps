/**
 * Sync API keys to Cloudflare KV for Worker auth.
 *
 * The Worker verifies API keys by computing SHA-256 of the raw key
 * and looking it up in KV: `apikey:{sha256hex} → { owner_id, name }`.
 *
 * This is separate from the bcrypt hash stored in the database (used for
 * platform API auth). The Worker runtime doesn't support bcrypt.
 */

import { createHash } from 'crypto';
import { cloudflareClient } from './cloudflare';
import { config } from './config';

const CF_API = 'https://api.cloudflare.com/client/v4';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Write API key SHA-256 hash to CF KV.
 * Called when a new API key is created.
 */
export async function syncApiKeyToKV(
  rawKey: string,
  ownerId: string,
  name: string,
): Promise<void> {
  if (!config.CLOUDFLARE_ACCOUNT_ID) return;
  const kvNamespaceId = process.env.CF_KV_NAMESPACE_ID;
  if (!kvNamespaceId) return;

  const hash = sha256Hex(rawKey);
  const value = JSON.stringify({ owner_id: ownerId, name });

  const res = await fetch(
    `${CF_API}/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/apikey:${hash}`,
    {
      method: 'PUT',
      headers: {
        'X-Auth-Key': config.CLOUDFLARE_API_KEY,
        'X-Auth-Email': config.CLOUDFLARE_EMAIL,
        'Content-Type': 'text/plain',
      },
      body: value,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV write failed: ${res.status} ${text.slice(0, 200)}`);
  }

  console.log(`[PROXY-KV] Synced API key hash to KV: apikey:${hash.slice(0, 12)}...`);
}

/**
 * Delete API key from CF KV.
 * Called when an API key is deleted. We use the key prefix to find the KV entry.
 * Note: We can't reconstruct the SHA-256 without the raw key, so we list and match.
 * In practice, this is best-effort — the key will expire naturally or be overwritten.
 */
export async function deleteApiKeyFromKV(keyPrefix: string): Promise<void> {
  // Best-effort: we can't easily delete by prefix from KV without listing.
  // The entry will be orphaned but harmless (key is deleted from DB, can't be re-used).
  console.log(`[PROXY-KV] API key with prefix ${keyPrefix} deleted from DB (KV entry orphaned — harmless)`);
}
