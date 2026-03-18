/**
 * Direct IP proxy — forwards authenticated requests to VPS_IP:port.
 *
 * No Cloudflare Tunnels. No origin.slug DNS trick. The Worker fetches
 * the VPS IP directly: fetch("http://1.2.3.4:80/path").
 *
 * Handles:
 *   - HTTP/HTTPS requests (transparent proxy)
 *   - WebSocket upgrades (code-server, PTY, OpenCode Web UI)
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
    const originHost = machineInfo.origin_hostname || machineInfo.ip;
    const path = rewrittenPath || url.pathname;
    const search = rewrittenPath ? '' : url.search;
    const targetUrl = `http://${originHost}:${port}${path}${search}`;

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
 */
export async function proxyWebSocket(
  request: Request,
  machineInfo: MachineInfo,
  port: number,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const originHost = machineInfo.origin_hostname || machineInfo.ip;
    const targetUrl = `http://${originHost}:${port}${url.pathname}${url.search}`;

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Connect to target WebSocket on VPS
    const targetWebSocket = new WebSocket(targetUrl);

    // Pipe client → target
    server.addEventListener('message', (event) => {
      if (targetWebSocket.readyState === WebSocket.OPEN) {
        targetWebSocket.send(event.data);
      }
    });
    server.addEventListener('close', () => {
      targetWebSocket.close();
    });

    // Pipe target → client
    targetWebSocket.addEventListener('message', (event) => {
      if (server.readyState === WebSocket.OPEN) {
        server.send(event.data);
      }
    });
    targetWebSocket.addEventListener('close', () => {
      server.close();
    });

    // Accept
    server.accept();

    return new Response(null, { status: 101, webSocket: client });
  } catch (error) {
    console.error('WebSocket proxy failed:', error);
    return new Response(JSON.stringify({
      error: 'WebSocket proxy failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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
