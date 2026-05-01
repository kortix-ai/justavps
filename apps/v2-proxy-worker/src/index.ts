import { validateProxyToken, PROXY_TOKEN_COOKIE } from './auth';
import { cookieDomainFor, parseHostname } from './hostname';
import { isWebSocketUpgrade, json, proxyHttp, proxyWebSocket } from './proxy';
import type { Env } from './types';

function isBrowserGet(request: Request) {
  return request.method === 'GET' && (request.headers.get('Accept') ?? '').includes('text/html');
}

function setProxyTokenCookie(requestUrl: URL, env: Env, token: string, expiresAt: string) {
  const ttl = Math.min(14_400, Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  if (ttl <= 0) return null;
  requestUrl.searchParams.delete('__proxy_token');
  return new Response(null, {
    status: 302,
    headers: {
      Location: requestUrl.toString(),
      'Set-Cookie': `${PROXY_TOKEN_COOKIE}=${encodeURIComponent(token)}; Domain=${cookieDomainFor(requestUrl.hostname, env.PROXY_DOMAINS)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`,
      'Cache-Control': 'no-store',
    },
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parsed = parseHostname(url.hostname, url.pathname, env.PROXY_DOMAINS);
    if (!parsed) {
      return json({ error: 'Invalid V2 sandbox URL', expected: 'https://v2.kortix-dev.cloud/{uuid}/ or https://v2.kortix-dev.cloud/{port}--{uuid}/' }, 400);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type, X-Proxy-Token',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const auth = await validateProxyToken(request, parsed.slug, parsed.port, env.KV);
    if (!auth.ok || !auth.machine) {
      if (isBrowserGet(request) && auth.status === 401) {
        return new Response(`<!doctype html><title>Sandbox access required</title><p>${auth.error ?? 'Proxy token required'}</p>`, {
          status: auth.status,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return json({ error: auth.error ?? 'Proxy token required' }, auth.status ?? 401);
    }

    if (auth.source === 'query' && auth.rawToken && auth.token && request.method === 'GET') {
      const redirect = setProxyTokenCookie(url, env, auth.rawToken, auth.token.expires_at);
      if (redirect) return redirect;
    }

    if (isWebSocketUpgrade(request)) return proxyWebSocket(request, auth.machine, parsed.slug, parsed.port);
    return proxyHttp(request, auth.machine, parsed.slug, parsed.port, parsed.rewrittenPath);
  },
};

export default worker;
export type { Env } from './types';
