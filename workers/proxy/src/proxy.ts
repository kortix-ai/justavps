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
 * Proxy an HTTP request to the VPS via origin hostname.
 *
 * CF Workers cannot fetch raw IPs that are behind CF's own proxy (error 1003).
 * Instead, we use a DNS-only (grey-cloud) origin record:
 *   origin.slug.kortix.cloud → VPS_IP (not proxied)
 * This bypasses CF's proxy layer and reaches the VPS directly.
 */
export async function proxyHTTPRequest(
  request: Request,
  machineInfo: MachineInfo,
  port: number,
  rewrittenPath?: string,
): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Use origin hostname (DNS-only, grey-cloud) to bypass CF proxy
    // origin-slug.kortix.cloud → VPS_IP (not proxied)
    // ALL traffic goes through Caddy on port 80 — Caddy proxies to localhost:PORT
    // This handles services that bind to 127.0.0.1 (not 0.0.0.0)
    const originHost = machineInfo.origin_hostname || machineInfo.ip;
    const path = rewrittenPath || url.pathname;
    const search = rewrittenPath ? '' : url.search;
    const targetPort = port === 80 ? 80 : 80; // Always through Caddy
    const targetPath = port === 80 ? `${path}${search}` : `/_caddy_port/${port}${path}${search}`;
    const targetUrl = `http://${originHost}:${targetPort}${targetPath}`;

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
    if (init.body && typeof (init as any).duplex === 'undefined') {
      (init as any).duplex = 'half';
    }

    const response = await fetch(targetUrl, init);

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
    // Route WebSocket through Caddy on port 80 too (same as HTTP)
    const wsPath = port === 80 ? url.pathname : `/_caddy_port/${port}${url.pathname}`;
    const targetUrl = `http://${originHost}:80${wsPath}${url.search}`;

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
