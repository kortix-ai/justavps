import type { AuthResult, MachineInfo, ProxyTokenData } from './types';

export const PROXY_TOKEN_COOKIE = '__justavps_v2_pt';

function parseCookie(header: string | null, name: string) {
  const match = (header ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function extractProxyToken(request: Request): { token: string; source: 'header' | 'query' | 'cookie' } | null {
  const headerToken = request.headers.get('X-Proxy-Token');
  if (headerToken?.startsWith('pt_')) return { token: headerToken, source: 'header' };

  const url = new URL(request.url);
  const queryToken = url.searchParams.get('__proxy_token');
  if (queryToken?.startsWith('pt_')) return { token: queryToken, source: 'query' };

  const cookieToken = parseCookie(request.headers.get('Cookie'), PROXY_TOKEN_COOKIE);
  if (cookieToken?.startsWith('pt_')) return { token: cookieToken, source: 'cookie' };
  return null;
}

export async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function validateProxyToken(request: Request, slug: string, port: number, kv: KVNamespace): Promise<AuthResult> {
  const extracted = extractProxyToken(request);
  if (!extracted) return { ok: false, status: 401, error: 'Proxy token required' };

  const tokenData = await readJson<ProxyTokenData>(kv, `pt:${await sha256Hex(extracted.token)}`);
  if (!tokenData) return { ok: false, status: 401, error: 'Invalid proxy token', source: extracted.source };
  if (new Date(tokenData.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: 'Proxy token expired', source: extracted.source };
  }
  if (tokenData.machine_slug !== slug) {
    return { ok: false, status: 403, error: 'Proxy token is not valid for this sandbox', source: extracted.source };
  }
  if (tokenData.ports?.length && !tokenData.ports.includes(port)) {
    return { ok: false, status: 403, error: `Proxy token does not allow port ${port}`, source: extracted.source };
  }

  const machine = await readJson<MachineInfo>(kv, `machine:${slug}`);
  if (!machine) return { ok: false, status: 404, error: 'Sandbox routing record not found', source: extracted.source };
  if (machine.status === 'deleted' || machine.status === 'error') {
    return { ok: false, status: 409, error: `Sandbox is ${machine.status}`, source: extracted.source };
  }

  return { ok: true, source: extracted.source, machine, token: tokenData, rawToken: extracted.token };
}
