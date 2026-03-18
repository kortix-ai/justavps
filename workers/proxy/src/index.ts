/**
 * Cloudflare Worker — *.kortix.cloud proxy gateway.
 *
 * All machine access goes through this Worker. It handles:
 *   - Auth: JWT cookie, API key, query token
 *   - Routing: slug → VPS IP from KV
 *   - Proxying: HTTP + WebSocket to VPS
 *   - Cookie refresh: silently refreshes JWT when < 6h remaining
 *
 * Unauthenticated browser requests → redirect to platform /api/proxy-auth
 * Unauthenticated API requests → 401
 */

import { parseHostname } from './hostname';
import { validateAuth, createUnauthorizedResponse, createLoginRedirect } from './auth';
import { handleCORSPreflight, isWebSocketUpgrade, proxyHTTPRequest, proxyWebSocket } from './proxy';

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

      // Proxy the request
      let response: Response;

      if (isWebSocketUpgrade(request)) {
        response = await proxyWebSocket(request, authResult.machineInfo!, port);
      } else {
        response = await proxyHTTPRequest(request, authResult.machineInfo!, port);
      }

      // Silent cookie refresh — if JWT is within 6h of expiry, re-sign and set updated cookie
      // (Only for non-WebSocket responses where we can add headers)
      if (authResult.shouldRefresh && !isWebSocketUpgrade(request)) {
        // We can't sign JWTs in the Worker (no jose), so we inject a refresh hint.
        // The browser will call /api/proxy-auth to get a fresh cookie.
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
