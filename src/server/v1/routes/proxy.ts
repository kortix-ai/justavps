/**
 * ⚠️  DEPRECATED — SCHEDULED FOR DELETION
 *
 * Machine proxy — authenticated passthrough to a machine's Docker container ports.
 *
 * Route: ALL /machines/:machineId/proxy/:port/*
 *
 * This route proxies through the platform (justavps.com) directly to the machine IP,
 * bypassing the Cloudflare Worker. This is architecturally wrong because:
 *
 *   1. Bypasses the CF Worker — skips CORS, WebSocket, error pages, cookie refresh
 *   2. Routes through platform server — bad for latency/bandwidth vs CF edge
 *   3. Duplicates auth logic — inline key validation instead of using apiGuard
 *   4. The CF Worker already supports API keys — no gap to fill
 *
 * USE INSTEAD:
 *   - CF Worker proxy: https://{port}--{slug}.kortix.cloud with Bearer sk_live_xxx header
 *   - Proxy tokens: https://{port}--{slug}.kortix.cloud?__proxy_token=pt_xxx
 *   - If you only have machine UUID (not slug): GET /api/v1/machines/:id → use slug from response
 *
 * Currently kept because Kortix Computer API (Saumya) has a dependency on it.
 * Remove once Kortix Computer migrates to the CF Worker proxy path.
 *
 * @deprecated Use CF Worker proxy at {port}--{slug}.kortix.cloud instead
 */

import { Hono } from 'hono';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from "@/server/db/index";
import { machines, apiKeys } from "@/server/db/schema";
import { validateApiKey } from "@/server/core/crypto";

const PROXY_TIMEOUT_MS = 30_000;

const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
]);

export const proxyApp = new Hono();

proxyApp.all('/:machineId/proxy/:port/*', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer sk_live_')) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const key = authHeader.slice(7);
  const hash = createHash('sha256').update(key).digest('hex');

  const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.keySha256, hash)).limit(1);
  let accountId: string | undefined;

  if (apiKey) {
    accountId = apiKey.accountId ?? undefined;
  } else {
    const allKeys = await db.select().from(apiKeys);
    for (const k of allKeys) {
      if (await validateApiKey(key, k.keyHash)) {
        db.update(apiKeys).set({ keySha256: hash, lastUsed: new Date() }).where(eq(apiKeys.id, k.id)).catch(() => {});
        accountId = k.accountId ?? undefined;
        break;
      }
    }
  }

  if (!accountId) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  const machineId = c.req.param('machineId');
  const portStr = c.req.param('port');
  const port = parseInt(portStr, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    return c.json({ error: `Invalid port: ${portStr}` }, 400);
  }

  const [machine] = await db.select().from(machines).where(eq(machines.id, machineId));
  if (!machine || machine.accountId !== accountId) {
    return c.json({ error: 'Machine not found' }, 404);
  }
  if (!machine.ip) {
    return c.json({ error: 'Machine has no IP address' }, 400);
  }

  const fullPath = new URL(c.req.url).pathname;
  const proxyPrefix = `/${machineId}/proxy/${portStr}`;
  const idx = fullPath.indexOf(proxyPrefix);
  const remainingPath = idx !== -1
    ? fullPath.slice(idx + proxyPrefix.length) || '/'
    : '/';
  const queryString = new URL(c.req.url).search;

  const targetUrl = `http://${machine.ip}/_port/${port}${remainingPath}${queryString}`;

  const headers = new Headers();
  for (const [key, value] of c.req.raw.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection') continue;
    headers.set(key, value);
  }
  headers.set('Host', `${machine.ip}`);

  // Forward X-Sandbox-Auth as Authorization to the machine
  const sandboxAuth = c.req.header('X-Sandbox-Auth');
  if (sandboxAuth) {
    headers.set('Authorization', sandboxAuth);
    headers.delete('x-sandbox-auth');
  } else {
    headers.delete('authorization');
  }

  const method = c.req.method;
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await c.req.raw.arrayBuffer();
  }

  const response = await fetch(targetUrl, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
});
