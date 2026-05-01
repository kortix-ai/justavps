import type { MachineInfo } from './types';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authentication',
  'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host',
]);

export function stripHopByHop(headers: Headers) {
  const clean = new Headers();
  headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) clean.set(name, value);
  });
  return clean;
}

export function buildTargetPath(url: URL, port: number, rewrittenPath?: string) {
  const path = rewrittenPath || url.pathname;
  const search = url.search;
  if (port === 80) return `${path}${search}`;
  return `/_port/${port}${path === '/' ? '' : path}${search}`;
}

function rootHost(hostname: string, slug: string, port: number) {
  const lower = hostname.toLowerCase();
  if (port === 80) return lower;
  const prefix = `${port}--${slug}.`;
  return lower.startsWith(prefix) ? `${slug}.${lower.slice(prefix.length)}` : lower;
}

function upstreamHeaders(request: Request, machine: MachineInfo, slug: string, port: number) {
  const headers = stripHopByHop(new Headers(request.headers));
  const originalHost = rootHost(new URL(request.url).hostname, slug, port);
  headers.set('Host', originalHost);
  headers.set('X-JustAVPS-V2-Sandbox-Slug', slug);
  headers.set('X-JustAVPS-V2-Sandbox-Id', machine.machine_id);
  headers.set('X-JustAVPS-V2-Original-Host', originalHost);
  return headers;
}

export function isWebSocketUpgrade(request: Request) {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    && Boolean(request.headers.get('Connection')?.toLowerCase().includes('upgrade'));
}

export async function proxyHttp(request: Request, machine: MachineInfo, slug: string, port: number, rewrittenPath?: string) {
  const url = new URL(request.url);
  const targetPath = buildTargetPath(url, port, rewrittenPath);
  const originHost = machine.origin_hostname || machine.ip;
  if (!originHost) return json({ error: 'Sandbox origin is not configured' }, 502);
  const target = `http://${originHost}${targetPath}`;
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const headers = upstreamHeaders(request, machine, slug, port);
  if (body) headers.set('Content-Length', String(body.byteLength));

  const response = await fetch(target, { method: request.method, headers, body, redirect: 'manual' });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function proxyWebSocket(request: Request, machine: MachineInfo, slug: string, port: number) {
  const url = new URL(request.url);
  const targetPath = buildTargetPath(url, port);
  const originHost = machine.origin_hostname || machine.ip;
  if (!originHost) return new Response('Sandbox origin is not configured', { status: 502 });
  const response = await fetch(`http://${originHost}${targetPath}`, { headers: upstreamHeaders(request, machine, slug, port) });
  if (!response.webSocket) return new Response(`WebSocket origin upgrade failed (${response.status})`, { status: 502 });
  return new Response(null, { status: 101, webSocket: response.webSocket });
}

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
