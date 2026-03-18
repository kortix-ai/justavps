/**
 * Cloudflare Worker — *.kortix.cloud auth gateway + direct IP proxy.
 *
 * All machine traffic flows:
 *   Browser/API → CF CDN → THIS WORKER (auth) → fetch(http://VPS_IP:port)
 *
 * No Cloudflare Tunnels. No subrequest hacks. The Worker authenticates,
 * then proxies directly to the VPS IP stored in KV.
 *
 * Auth methods: JWT cookie, API key (SHA-256 in KV), query token
 * Unauthenticated browser → redirect to platform login
 * Unauthenticated API → 401
 */

import { parseHostname } from './hostname';
import { validateAuth, createUnauthorizedResponse, createLoginRedirect } from './auth';
import { handleCORSPreflight, proxyHTTPRequest, proxyWebSocket, isWebSocketUpgrade } from './proxy';

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

      const { slug, port, rewrittenPath } = parsed;

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

      // Auth passed — proxy directly to VPS IP
      const { machineInfo } = authResult;
      if (!machineInfo) {
        return new Response(JSON.stringify({ error: 'Machine info unavailable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // WebSocket upgrade
      if (isWebSocketUpgrade(request)) {
        return proxyWebSocket(request, machineInfo, port);
      }

      // HTTP proxy (pass rewrittenPath for path-based port routing)
      const response = await proxyHTTPRequest(request, machineInfo, port, rewrittenPath);

      // Silent cookie refresh hint
      if (authResult.shouldRefresh) {
        const refreshed = new Response(response.body, response);
        refreshed.headers.set('X-Proxy-Auth-Refresh', 'true');
        return refreshed;
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
