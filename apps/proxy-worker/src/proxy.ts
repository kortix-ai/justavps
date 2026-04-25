/**
 * Direct machine proxy.
 *
 * The Worker authenticates the request, then proxies directly to the machine
 * origin IP + port stored in KV.
 */

import type { MachineInfo } from './auth';

export interface ProxyEnv {
  BROKER_ORIGIN?: string;
  BROKER_SHARED_SECRET?: string;
}

// Hop-by-hop headers that must not be forwarded.
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
  'host',
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

export function buildTargetPath(url: URL, port: number, rewrittenPath?: string): string {
  if (port === 80) {
    const path = rewrittenPath || url.pathname;
    const search = rewrittenPath ? '' : url.search;
    return `${path}${search}`;
  }

  const path = rewrittenPath || url.pathname;
  const search = rewrittenPath ? '' : url.search;
  return `/_port/${port}${path === '/' ? '' : path}${search}`;
}

function normalizeUpstreamHost(hostname: string, slug: string, port: number): string {
  const lowerHostname = hostname.toLowerCase();
  if (port === 80) return lowerHostname;

  const dashedPrefix = `${port}--${slug}.`;
  if (lowerHostname.startsWith(dashedPrefix)) {
    return `${slug}.${lowerHostname.slice(dashedPrefix.length)}`;
  }

  const dottedPrefix = `${port}.${slug}.`;
  if (lowerHostname.startsWith(dottedPrefix)) {
    return `${slug}.${lowerHostname.slice(dottedPrefix.length)}`;
  }

  return lowerHostname;
}

function createUpstreamHeaders(
  request: Request,
  machineInfo: MachineInfo,
  slug: string,
  port: number,
): Headers {
  const url = new URL(request.url);
  const headers = stripHopByHopHeaders(new Headers(request.headers));
  const originalHost = normalizeUpstreamHost(url.hostname, slug, port);
  headers.set('Host', originalHost);
  headers.set('X-Kortix-Machine-Slug', slug);
  headers.set('X-Kortix-Original-Host', originalHost);
  if (machineInfo.machine_id) headers.set('X-Kortix-Machine-Id', machineInfo.machine_id);

  return headers;
}

/**
 * Proxy an HTTP request directly to the machine origin.
 */
export async function proxyHTTPRequest(
  request: Request,
  machineInfo: MachineInfo,
  slug: string,
  port: number,
  env: ProxyEnv,
  rewrittenPath?: string,
): Promise<Response> {
  try {
    void env;
    const url = new URL(request.url);
    const targetPath = buildTargetPath(url, port, rewrittenPath);
    const upstreamHeaders = createUpstreamHeaders(request, machineInfo, slug, port);
    const upstreamHost = machineInfo.origin_hostname || machineInfo.ip;
    const upstreamURL = `http://${upstreamHost}${targetPath}`;

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const body = hasBody ? await request.arrayBuffer() : null;

    if (body && body.byteLength > 0) {
      upstreamHeaders.set('Content-Length', String(body.byteLength));
    }

    const response = await fetch(upstreamURL, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      redirect: 'manual',
    });
    const responseHeaders = new Headers(response.headers);
    addCORSHeaders(responseHeaders, request);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Direct proxy request failed:', error);
    return new Response(JSON.stringify({
      error: 'Direct proxy request failed',
      target: `${machineInfo.origin_hostname || machineInfo.ip}:80`,
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
 * Proxy a WebSocket upgrade request directly to the machine origin.
 */
export async function proxyWebSocket(
  request: Request,
  machineInfo: MachineInfo,
  slug: string,
  port: number,
  env: ProxyEnv,
): Promise<Response> {
  try {
    void env;
    const url = new URL(request.url);
    const targetPath = buildTargetPath(url, port);
    const upstreamHeaders = createUpstreamHeaders(request, machineInfo, slug, port);
    upstreamHeaders.set('Connection', 'Upgrade');
    upstreamHeaders.set('Upgrade', 'websocket');
    const upstreamHost = machineInfo.origin_hostname || machineInfo.ip;
    const upstreamURL = `http://${upstreamHost}${targetPath}`;

    const originResp = await fetch(upstreamURL, {
      headers: upstreamHeaders,
    });

    const originWs = originResp.webSocket;
    if (!originWs) {
      return new Response(`WebSocket upgrade to broker failed (${originResp.status})`, { status: 502 });
    }
    originWs.accept();

    const [clientWs, serverWs] = Object.values(new WebSocketPair());
    serverWs.accept();

    serverWs.addEventListener('message', (e) => { try { originWs.send(e.data); } catch {} });
    serverWs.addEventListener('close', (e) => { try { originWs.close(e.code, e.reason); } catch {} });

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
