/**
 * Cloudflare Worker — *.kortix.cloud auth gateway.
 *
 * Auth layer for all machine access. After auth, the request passes through
 * to the Cloudflare Tunnel (cloudflared on VPS → Caddy → code-server).
 * No origin fetch needed — Cloudflare routes via the tunnel CNAME.
 *
 * Auth methods: JWT cookie, API key (SHA-256 in KV), query token
 * Unauthenticated browser → redirect to platform login
 * Unauthenticated API → 401
 */

import { parseHostname } from './hostname';
import { validateAuth, createUnauthorizedResponse, createLoginRedirect } from './auth';
import { handleCORSPreflight } from './proxy';

export interface Env {
  KV: KVNamespace;
  PROXY_AUTH_SECRET: string;
  PLATFORM_URL: string; // e.g. https://justavps.com
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      // Detect our own subrequest (pass-through after auth).
      // When we fetch(modifiedRequest) after auth, the Worker is re-invoked.
      // The X-JustAVPS-Authed header means auth already passed — go to origin.
      if (request.headers.get('X-JustAVPS-Authed') === 'true') {
        // Strip our header and pass to the tunnel origin
        const clean = new Request(request);
        clean.headers.delete('X-JustAVPS-Authed');
        return fetch(clean);
      }

      const parsed = parseHostname(url.hostname, url.pathname);

      if (!parsed) {
        return new Response(JSON.stringify({
          error: 'Invalid hostname',
          expected: 'slug.kortix.cloud or port.slug.kortix.cloud',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const { slug, port } = parsed;

      // CORS preflight — let through without auth
      if (request.method === 'OPTIONS') {
        const cors = handleCORSPreflight(request);
        if (cors) return cors;
      }

      // Authenticate
      const authResult = await validateAuth(request, slug, env.KV, env.PROXY_AUTH_SECRET);

      if (!authResult.success) {
        // Browser request → redirect to login
        if (isBrowserRequest(request) && request.method === 'GET') {
          return createLoginRedirect(request, env.PLATFORM_URL);
        }
        // API request → 401
        return createUnauthorizedResponse(authResult.error || 'Authentication required');
      }

      // Auth passed — pass through to the Cloudflare Tunnel.
      // Add X-JustAVPS-Authed header so the Worker skips auth on the subrequest.
      // Cloudflare routes via CNAME → tunnel → cloudflared → Caddy → code-server.
      const headers = new Headers(request.headers);
      headers.set('X-JustAVPS-Authed', 'true');
      const authedRequest = new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      });
      let response = await fetch(authedRequest);

      // Silent cookie refresh hint
      if (authResult.shouldRefresh) {
        response = new Response(response.body, response);
        response.headers.set('X-Proxy-Auth-Refresh', 'true');
      }

      return response;

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        details: env.ENVIRONMENT === 'development' && error instanceof Error ? error.message : undefined,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

function isBrowserRequest(request: Request): boolean {
  const accept = request.headers.get('Accept') || '';
  const ua = request.headers.get('User-Agent') || '';
  return accept.includes('text/html') || ['Mozilla', 'Chrome', 'Safari', 'Firefox'].some(b => ua.includes(b));
}
