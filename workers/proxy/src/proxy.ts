/**
 * Direct IP proxy — forwards authenticated requests to VPS_IP:port.
 *
 * No Cloudflare Tunnels. No origin.slug DNS trick. The Worker fetches
 * the VPS IP directly: fetch("http://1.2.3.4:80/path").
 *
 * Handles:
 *   - HTTP/HTTPS requests (transparent proxy)
 *   - WebSocket upgrades (OpenCode, PTY)
 *   - SSE streams (no buffering)
 *   - CORS preflight (before auth)
 *   - Hop-by-hop header stripping
 */

import type { MachineInfo } from './auth';

// Hop-by-hop headers that must not be forwarded
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authentication',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Strip hop-by-hop headers that shouldn't be forwarded.
 */
export function stripHopByHopHeaders(headers: Headers): Headers {
  const clean = new Headers();
  headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      clean.set(name, value);
    }
  });
  return clean;
}

/**
 * Handle CORS preflight requests (before auth).
 */
export function handleCORSPreflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;

  const origin = request.headers.get('Origin');
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');

  const corsHeaders = new Headers();
  corsHeaders.set('Access-Control-Allow-Origin', origin || '*');
  corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  corsHeaders.set('Access-Control-Allow-Headers', requestHeaders || 'Content-Type, Authorization');
  corsHeaders.set('Access-Control-Max-Age', '86400');
  corsHeaders.set('Vary', 'Origin');

  return new Response(null, { status: 200, headers: corsHeaders });
}

/**
 * Proxy an HTTP request to the VPS via the DNS-only origin hostname.
 *
 * All traffic goes through port 80 (the daemon's ProxyRouter).
 * Non-default ports are forwarded via the daemon's /_port/PORT/path handler,
 * which proxies to localhost:PORT on the machine. This way services bound to
 * 127.0.0.1 (like opencode on :4096) are reachable without opening extra ports.
 */
export async function proxyHTTPRequest(
  request: Request,
  machineInfo: MachineInfo,
  port: number,
  rewrittenPath?: string,
): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Use origin hostname (DNS-only, grey-cloud) to bypass CF proxy.
    // All traffic goes to port 80. Non-default ports are routed via daemon's port proxy.
    const originHost = machineInfo.origin_hostname || machineInfo.ip;
    let targetPath: string;
    if (port === 80) {
      // Default port — direct path through daemon's router
      const path = rewrittenPath || url.pathname;
      const search = rewrittenPath ? '' : url.search;
      targetPath = `${path}${search}`;
    } else {
      // Non-default port — route through daemon's /_port proxy (handles localhost-bound services)
      const path = rewrittenPath || url.pathname;
      const search = rewrittenPath ? '' : url.search;
      targetPath = `/_port/${port}${path === '/' ? '' : path}${search}`;
    }
    const targetUrl = `http://${originHost}:80${targetPath}`;

    // Build forwarded headers
    const headers = stripHopByHopHeaders(new Headers(request.headers));
    headers.set('X-Forwarded-Host', url.hostname);
    headers.set('X-Forwarded-Proto', 'https');
    headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');

    const init: RequestInit = {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
      redirect: 'manual',
    };

    // Duplex for streaming bodies
    const streamingInit = init as RequestInit & { duplex?: 'half' };
    if (streamingInit.body && typeof streamingInit.duplex === 'undefined') {
      streamingInit.duplex = 'half';
    }

    const response = await fetch(targetUrl, streamingInit);

    // Build response with CORS
    const responseHeaders = new Headers(response.headers);
    addCORSHeaders(responseHeaders, request);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy request failed:', error);
    return new Response(JSON.stringify({
      error: 'Proxy request failed',
      target: `http://${machineInfo.ip}:${port}`,
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Error': 'true',
      },
    });
  }
}

/**
 * Proxy a WebSocket upgrade request to the VPS.
 *
 * CF Workers WebSocket proxy:
 *   1. fetch(origin, { headers: { Upgrade: 'websocket' } }) → gets origin WebSocket
 *   2. Create WebSocketPair for client side
 *   3. Pipe bidirectionally: client ↔ origin
 */
export async function proxyWebSocket(
  request: Request,
  machineInfo: MachineInfo,
  port: number,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const originHost = machineInfo.origin_hostname || machineInfo.ip;
    // Route all WS through port 80 (daemon's ProxyRouter), using /_port for non-default ports
    const wsPath = port === 80
      ? `${url.pathname}${url.search}`
      : `/_port/${port}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
    const targetUrl = `http://${originHost}:80${wsPath}`;

    // Connect to origin WebSocket (CF Workers pattern: fetch with Upgrade header)
    const originResp = await fetch(targetUrl, {
      headers: { 'Upgrade': 'websocket' },
    });

    const originWs = originResp.webSocket;
    if (!originWs) {
      return new Response(`WebSocket upgrade to origin failed (${originResp.status})`, { status: 502 });
    }
    originWs.accept();

    // Create client-side pair
    const [clientWs, serverWs] = Object.values(new WebSocketPair());
    serverWs.accept();

    // Pipe: client → origin
    serverWs.addEventListener('message', (e) => { try { originWs.send(e.data); } catch {} });
    serverWs.addEventListener('close', (e) => { try { originWs.close(e.code, e.reason); } catch {} });

    // Pipe: origin → client
    originWs.addEventListener('message', (e) => { try { serverWs.send(e.data); } catch {} });
    originWs.addEventListener('close', (e) => { try { serverWs.close(e.code, e.reason); } catch {} });

    return new Response(null, { status: 101, webSocket: clientWs });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'WebSocket proxy failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Check if request is a WebSocket upgrade.
 */
export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get('Upgrade');
  const connection = request.headers.get('Connection');
  return !!(
    upgrade?.toLowerCase() === 'websocket' &&
    connection?.toLowerCase().includes('upgrade')
  );
}

/**
 * Add CORS headers to response.
 */
function addCORSHeaders(headers: Headers, request: Request): void {
  const origin = request.headers.get('Origin');
  headers.set('Access-Control-Allow-Origin', origin || '*');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Vary', 'Origin');
}
