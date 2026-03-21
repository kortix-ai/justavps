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
  PLATFORM_URL: string; // https://justavps.com (prod) or https://dev.justavps.com (dev)
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

      // Handle platform proxy-auth callback: platform redirects here with __proxy_token JWT in query.
      // The platform already verified the user's session — we just need to verify the JWT
      // signature (not ownership), set cookie on the proxy domain, and redirect to clean URL.
      // Ownership is checked on the NEXT request (after redirect) when the cookie is sent.
      const proxyTokenParam = url.searchParams.get('__proxy_token');
      if (proxyTokenParam && request.method === 'GET') {
        // Proxy tokens (pt_xxx) — handled by validateAuth below, not here
        if (!proxyTokenParam.startsWith('pt_')) {
          try {
            // Verify JWT signature only (decode + check expiry)
            const parts = proxyTokenParam.split('.');
            if (parts.length === 3) {
              const payloadB64 = parts[1];
              const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
              if (payload.sub && payload.exp && payload.exp > Date.now() / 1000) {
                // JWT is structurally valid + not expired — set cookie and redirect
                url.searchParams.delete('__proxy_token');
                // Derive cookie domain from hostname (e.g. "43179--slug.kortix-dev.cloud" → ".kortix-dev.cloud")
                const hostParts = url.hostname.split('.');
                const cookieDomain = '.' + hostParts.slice(-2).join('.');
                const cookieValue = `__justavps_proxy=${proxyTokenParam}; Domain=${cookieDomain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
                return new Response(null, {
                  status: 302,
                  headers: {
                    'Location': url.toString(),
                    'Set-Cookie': cookieValue,
                    'Cache-Control': 'no-store',
                  },
                });
              }
            }
          } catch { /* invalid token — fall through to normal auth */ }
        }
      }

      // CORS preflight — let through without auth
      if (request.method === 'OPTIONS') {
        const cors = handleCORSPreflight(request);
        if (cors) return cors;
      }

      // Authenticate (pass port for proxy token port-scoping)
      const authResult = await validateAuth(request, slug, env.KV, env.PROXY_AUTH_SECRET, port);

      if (!authResult.success) {
        const error = authResult.error || 'Authentication required';
        const isAccessDenied = error === 'Access denied' || error === 'Machine is deleted';

        // Each Worker (prod/dev) has its own PLATFORM_URL — no per-machine override needed.
        const platformUrl = env.PLATFORM_URL;

        // If user IS authenticated but doesn't own the machine → show error, don't redirect
        // (redirecting causes infinite loop: login → proxy-auth → JWT → ownership fail → redirect)
        if (isAccessDenied) {
          if (isBrowserRequest(request)) {
            return new Response(accessDeniedHTML(platformUrl), {
              status: 403,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
          return createUnauthorizedResponse(error);
        }

        // Not authenticated at all → redirect to login
        if (isBrowserRequest(request) && request.method === 'GET') {
          return createLoginRedirect(request, platformUrl);
        }
        return createUnauthorizedResponse(error);
      }

      // Auth passed — proxy directly to VPS IP
      const { machineInfo } = authResult;
      if (!machineInfo) {
        return new Response(JSON.stringify({ error: 'Machine info unavailable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // If auth was via ?__proxy_token=pt_xxx query param, set cookie and redirect to clean URL.
      // Do this BEFORE proxying so the user gets a clean URL and the cookie handles subsequent requests.
      if (authResult.proxyTokenData && authResult.authSource === 'proxytoken' && request.method === 'GET') {
        if (url.searchParams.has('__proxy_token')) {
          const ptData = authResult.proxyTokenData;
          const ttlSeconds = Math.min(
            Math.max(0, Math.floor((new Date(ptData.expires_at).getTime() - Date.now()) / 1000)),
            14400, // cap at 4h
          );
          if (ttlSeconds > 0) {
            const originalToken = url.searchParams.get('__proxy_token')!;
            url.searchParams.delete('__proxy_token');
            const hostParts = url.hostname.split('.');
            const cookieDomain = '.' + hostParts.slice(-2).join('.');
            const cookieValue = `__justavps_pt=${originalToken}; Domain=${cookieDomain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSeconds}`;
            return new Response(null, {
              status: 302,
              headers: {
                'Location': url.toString(),
                'Set-Cookie': cookieValue,
                'Cache-Control': 'no-store',
              },
            });
          }
        }
      }

      // WebSocket upgrade
      if (isWebSocketUpgrade(request)) {
        return proxyWebSocket(request, machineInfo, port);
      }

      // HTTP proxy (pass rewrittenPath for path-based port routing)
      const response = await proxyHTTPRequest(request, machineInfo, port, rewrittenPath);

      // Handle origin errors with friendly pages
      if (response.status === 521 || response.status === 523) {
        // 521/523 = origin unreachable. On port 80 = machine not started yet.
        // On non-default port = machine is up but that port's service isn't running.
        if (isBrowserRequest(request)) {
          if (port !== 80) {
            return new Response(PORT_NOT_LISTENING_HTML.replaceAll('{{PORT}}', String(port)), {
              status: 502,
              headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
            });
          }
          return new Response(MACHINE_STARTING_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' },
          });
        }
      }
      if (response.status === 502 && port !== 80) {
        // 502 on a non-default port = nothing listening on that port
        if (isBrowserRequest(request)) {
          return new Response(PORT_NOT_LISTENING_HTML.replaceAll('{{PORT}}', String(port)), {
            status: 502,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
      }
      if (response.status === 502 && port === 80) {
        // 502 on default port = daemon still starting
        if (isBrowserRequest(request)) {
          return new Response(MACHINE_STARTING_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' },
          });
        }
      }

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

function accessDeniedHTML(platformUrl: string) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Access Denied</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; max-width: 420px; padding: 40px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { color: #888; font-size: 14px; margin: 0 0 16px; }
  .links { display: flex; gap: 16px; justify-content: center; }
  a { color: #3b82f6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .logout { color: #ef4444; }
</style>
</head><body>
<div class="card">
  <h1>Access Denied</h1>
  <p>You don't have permission to access this machine. Make sure you're logged in with the correct account.</p>
  <div class="links">
    <a href="${platformUrl}/machines">← Dashboard</a>
    <a href="${platformUrl}/api/auth/signout" class="logout">Sign out & re-login</a>
  </div>
</div>
</body></html>`;
}

const PORT_NOT_LISTENING_HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Port {{PORT}} — Not Reachable</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; max-width: 420px; padding: 40px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { color: #888; font-size: 14px; margin: 0 0 16px; }
  code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  a { color: #3b82f6; text-decoration: none; }
</style>
</head><body>
<div class="card">
  <h1>Port {{PORT}} — Not Reachable</h1>
  <p>No service is responding on port <code>{{PORT}}</code>.</p>
  <p>Make sure the service is running, then try again.</p>
</div>
</body></html>`;

const MACHINE_STARTING_HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Machine Starting...</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; max-width: 400px; padding: 40px; }
  .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 24px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { color: #888; font-size: 14px; margin: 0; }
</style>
</head><body>
<div class="card">
  <div class="spinner"></div>
  <h1>Machine is starting up</h1>
  <p>Services are initializing. This page will auto-refresh.</p>
</div>
</body></html>`;

function isBrowserRequest(request: Request): boolean {
  const accept = request.headers.get('Accept') || '';
  const ua = request.headers.get('User-Agent') || '';
  return accept.includes('text/html') || ['Mozilla', 'Chrome', 'Safari', 'Firefox'].some(b => ua.includes(b));
}
