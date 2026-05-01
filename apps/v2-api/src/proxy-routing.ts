import { createHash, randomBytes } from 'node:crypto';

import type { AppConfig, IncusClusterConfig } from './config.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
const MAX_CF_RETRIES = 5;
const CF_TIMEOUT_MS = 15_000;

export type ProxyTokenDescriptor = {
  id: string;
  token_sha256: string;
  token_prefix: string;
  label: string | null;
  machine_id: string;
  machine_slug: string;
  ports: number[] | null;
  expires_at: string;
  revoked_at?: string | null;
  created_at: string;
};

export function proxySlugForMachineId(machineId: string) {
  const slug = machineId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || machineId.toLowerCase();
}

export function proxyUrls(config: Pick<AppConfig, 'appUrl'>, slug: string) {
  const appUrl = new URL(config.appUrl);
  const basePortUrl = (port: string) => {
    if (appUrl.hostname === 'localhost') {
      const url = new URL(appUrl.toString());
      url.hostname = `${port}--${slug}.localhost`;
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    const url = new URL(`/proxy/${port}--${slug}/`, appUrl);
    return url.toString();
  };
  return {
    proxy: basePortUrl('80'),
    terminal: new URL(`/machines/${encodeURIComponent(slug)}/pty`, appUrl).toString(),
    port_template: basePortUrl('{port}'),
  };
}

export function proxyOriginHost(config: AppConfig, cluster: IncusClusterConfig) {
  if (config.proxyOriginHost) return config.proxyOriginHost;
  try {
    return new URL(cluster.endpoint).hostname;
  } catch {
    return null;
  }
}

export function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

export function generateProxyToken() {
  const token = `pt_${randomBytes(24).toString('base64url')}`;
  const sha256 = sha256Hex(token);
  return { token, sha256, prefix: `${token.slice(0, 10)}…` };
}

function cloudflareConfigured(config: AppConfig) {
  return Boolean(config.cloudflare);
}

async function cfWrite(config: AppConfig, key: string, value: unknown, ttlSeconds?: number) {
  const cf = config.cloudflare;
  if (!cf) return { synced: false as const, reason: 'Cloudflare KV is not configured' };

  const url = new URL(`${CF_API}/accounts/${cf.accountId}/storage/kv/namespaces/${cf.kvNamespaceId}/values/${encodeURIComponent(key)}`);
  if (ttlSeconds) url.searchParams.set('expiration_ttl', String(ttlSeconds));
  const body = typeof value === 'string' ? value : JSON.stringify(value);

  for (let attempt = 0; attempt < MAX_CF_RETRIES; attempt += 1) {
    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        'X-Auth-Key': cf.apiKey,
        'X-Auth-Email': cf.email,
        'Content-Type': 'text/plain',
      },
      body,
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    });
    if (response.ok) return { synced: true as const };

    const text = await response.text().catch(() => '');
    const retry = response.status === 429 || response.status >= 500;
    if (!retry || attempt === MAX_CF_RETRIES - 1) {
      throw new Error(`Cloudflare KV write ${key} failed: ${response.status} ${text.slice(0, 240)}`);
    }
    const retryAfter = Number.parseFloat(response.headers.get('retry-after') || '0');
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(15_000, 750 * (2 ** attempt));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return { synced: false as const, reason: 'Cloudflare KV write exhausted retries' };
}

async function cfDelete(config: AppConfig, key: string) {
  const cf = config.cloudflare;
  if (!cf) return { synced: false as const, reason: 'Cloudflare KV is not configured' };
  const url = `${CF_API}/accounts/${cf.accountId}/storage/kv/namespaces/${cf.kvNamespaceId}/values/${encodeURIComponent(key)}`;
  for (let attempt = 0; attempt < MAX_CF_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Auth-Key': cf.apiKey, 'X-Auth-Email': cf.email },
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    });
    if (response.ok || response.status === 404) return { synced: true as const };
    const text = await response.text().catch(() => '');
    const retry = response.status === 429 || response.status >= 500;
    if (!retry || attempt === MAX_CF_RETRIES - 1) {
      throw new Error(`Cloudflare KV delete ${key} failed: ${response.status} ${text.slice(0, 240)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 750 * (2 ** attempt))));
  }
  return { synced: false as const, reason: 'Cloudflare KV delete exhausted retries' };
}

export async function syncMachineToProxyKV(config: AppConfig, input: {
  machineId: string;
  slug: string;
  accountId: string;
  status: string;
  serverType: string;
  originHost: string;
}) {
  if (!cloudflareConfigured(config)) return { synced: false as const, reason: 'Cloudflare KV is not configured' };
  return cfWrite(config, `machine:${input.slug}`, {
    machine_id: input.machineId,
    account_id: input.accountId,
    ip: input.originHost,
    origin_hostname: input.originHost,
    status: input.status,
    server_type: input.serverType,
    platform_url: config.appUrl,
    updated_at: new Date().toISOString(),
    routing_version: 3,
    routing_state: 'active',
  });
}

export async function deleteMachineFromProxyKV(config: AppConfig, slug: string) {
  return cfDelete(config, `machine:${slug}`);
}

export async function syncProxyTokenToKV(config: AppConfig, token: string, data: {
  account_id: string;
  machine_id: string;
  machine_slug: string;
  ports: number[] | null;
  expires_at: string;
}, ttlSeconds: number) {
  return cfWrite(config, `pt:${sha256Hex(token)}`, data, ttlSeconds);
}

export async function deleteProxyTokenFromKV(config: AppConfig, tokenSha256: string) {
  return cfDelete(config, `pt:${tokenSha256}`);
}
