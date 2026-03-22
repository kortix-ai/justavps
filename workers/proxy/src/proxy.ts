/**
 * Shared-broker proxy.
 *
 * The Worker remains the public auth + routing layer, but it no longer fetches
 * machine IPs directly. Instead it sends a signed internal request to a shared
 * broker origin, and the broker dials the target machine IP.
 */

import type { MachineInfo } from './auth';

export interface ProxyEnv {
  BROKER_ORIGIN: string;
  BROKER_SHARED_SECRET: string;
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

async function createBrokerHeaders(
  request: Request,
  machineInfo: MachineInfo,
  slug: string,
  port: number,
  targetPath: string,
  env: ProxyEnv,
): Promise<Headers> {
  const url = new URL(request.url);
  const headers = stripHopByHopHeaders(new Headers(request.headers));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const originalHost = url.hostname;
  const targetIP = machineInfo.ip;
  const machineId = machineInfo.machine_id || `slug:${slug}`;

  const canonical = [
    timestamp,
    nonce,
    machineId,
    slug,
    targetIP,
    String(port),
    originalHost,
    targetPath,
  ].join('\n');
  const signature = await signBrokerPayload(env.BROKER_SHARED_SECRET, canonical);

  headers.set('X-Kortix-Target-IP', targetIP);
  headers.set('X-Kortix-Target-Port', String(port));
  headers.set('X-Kortix-Target-Path', targetPath);
  headers.set('X-Kortix-Machine-Id', machineId);
  headers.set('X-Kortix-Machine-Slug', slug);
  headers.set('X-Kortix-Original-Host', originalHost);
  headers.set('X-Kortix-Request-Ts', timestamp);
  headers.set('X-Kortix-Request-Nonce', nonce);
  headers.set('X-Kortix-Signature', signature);

  return headers;
}

async function signBrokerPayload(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Proxy an HTTP request to the shared broker, which dials the target machine.
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
    const url = new URL(request.url);
    const targetPath = buildTargetPath(url, port, rewrittenPath);
    const brokerHeaders = await createBrokerHeaders(request, machineInfo, slug, port, targetPath, env);
    const brokerURL = `${env.BROKER_ORIGIN.replace(/\/$/, '')}/_broker_proxy`;

    const init: RequestInit = {
      method: request.method,
      headers: brokerHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
      redirect: 'manual',
    };

    const streamingInit = init as RequestInit & { duplex?: 'half' };
    if (streamingInit.body && typeof streamingInit.duplex === 'undefined') {
      streamingInit.duplex = 'half';
    }

    const response = await fetch(brokerURL, streamingInit);
    const responseHeaders = new Headers(response.headers);
    addCORSHeaders(responseHeaders, request);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Broker proxy request failed:', error);
    return new Response(JSON.stringify({
      error: 'Broker proxy request failed',
      target: `${machineInfo.ip}:${port}`,
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
 * Proxy a WebSocket upgrade request through the shared broker.
 */
export async function proxyWebSocket(
  request: Request,
  machineInfo: MachineInfo,
  slug: string,
  port: number,
  env: ProxyEnv,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const targetPath = buildTargetPath(url, port);
    const brokerHeaders = await createBrokerHeaders(request, machineInfo, slug, port, targetPath, env);
    brokerHeaders.set('Connection', 'Upgrade');
    brokerHeaders.set('Upgrade', 'websocket');
    const brokerURL = `${env.BROKER_ORIGIN.replace(/\/$/, '')}/_broker_proxy`;

    const originResp = await fetch(brokerURL, {
      headers: brokerHeaders,
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
