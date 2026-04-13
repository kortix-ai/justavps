import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Scalar } from '@scalar/hono-api-reference';

import { v1 } from './api/v1/legacy';
import { v2 } from './api/v2';
import { enrichOpenAPISpec } from './lib/openapi-enrichment';
import { filterOpenApiDocumentForPrefix, type OpenApiDoc } from './lib/openapi-versioning';
import { config } from './lib/config';
import { loadConfigAuditChecks, loadFleetHostAuditSummary, summarizeConfigAudit } from './lib/config-audit';
import { ensureControlPlaneRuntimeStarted } from './lib/control-plane/runtime';
import { CONTROL_PLANE_SERVICE_PROFILES, isControlPlaneServiceStale, listControlPlaneServiceStates } from './lib/control-plane/service-state';
import { db, resetDbConnection } from './db';

const DB_HEALTHCHECK_TIMEOUT_MS = 5_000;
const CONTROL_PLANE_SERVICE_TIMEOUT_MS = 5_000;

function emptyFleetHostAudit() {
  return {
    hostRows: [],
    summary: {
      total_hosts: 0,
      active_schedulable_hosts: 0,
      bootstrapping_hosts: 0,
      pending_validation_hosts: 0,
      quarantined_hosts: 0,
      warning_drift_hosts: 0,
      blocking_drift_hosts: 0,
    },
    quarantined: [],
    pendingValidation: [],
    warningDrift: [],
    blockingDrift: [],
  };
}

function summarizeControlPlaneServices(rows: Awaited<ReturnType<typeof listControlPlaneServiceStates>>) {
  return rows.map((row) => ({
    service: row.service,
    scope: row.scope,
    lease_owner: row.leaseOwner,
    last_completed_at: row.lastCompletedAt?.toISOString() ?? null,
  }));
}

async function probeDatabase() {
  const attempt = async () => Promise.race([
    db.execute('select 1'),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`database probe timed out after ${DB_HEALTHCHECK_TIMEOUT_MS}ms`)), DB_HEALTHCHECK_TIMEOUT_MS)),
  ]);
  try {
    await attempt();
    return { ok: true as const, error: null };
  } catch {
    await resetDbConnection().catch(() => {});
    try {
      await attempt();
      return { ok: true as const, error: null };
    } catch (retryError) {
      return { ok: false as const, error: retryError instanceof Error ? retryError.message : String(retryError) };
    }
  }
}

async function listControlPlaneServicesWithTimeout() {
  const attempt = async () => Promise.race([
    listControlPlaneServiceStates(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`control-plane service query timed out after ${CONTROL_PLANE_SERVICE_TIMEOUT_MS}ms`)), CONTROL_PLANE_SERVICE_TIMEOUT_MS)),
  ]);
  try {
    const rows = await attempt();
    return { rows: Array.isArray(rows) ? rows : [], error: null as string | null };
  } catch {
    await resetDbConnection().catch(() => {});
    try {
      const rows = await attempt();
      return { rows: Array.isArray(rows) ? rows : [], error: null as string | null };
    } catch (retryError) {
      return { rows: [] as Awaited<ReturnType<typeof listControlPlaneServiceStates>>, error: retryError instanceof Error ? retryError.message : String(retryError) };
    }
  }
}

export const app = new OpenAPIHono().basePath('/api');

ensureControlPlaneRuntimeStarted();

const corsOrigins = [
  'https://justavps.com',
  'https://www.justavps.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];
if (config.APP_URL && !corsOrigins.includes(config.APP_URL)) {
  corsOrigins.push(config.APP_URL);
}

app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use('*', logger());
app.use('*', prettyJSON());

app.get('/health', async (c) => {
  const dbProbe = await probeDatabase();
  const dbStatus = dbProbe.ok ? 'ok' : 'error';
  const serviceResult = dbProbe.ok ? await listControlPlaneServicesWithTimeout() : { rows: [] as Awaited<ReturnType<typeof listControlPlaneServiceStates>>, error: 'database unavailable' };
  const services = serviceResult.rows;
  const fleetHostAudit = dbProbe.ok ? await loadFleetHostAuditSummary().catch(() => emptyFleetHostAudit()) : emptyFleetHostAudit();
  const configAuditChecks = await loadConfigAuditChecks(fleetHostAudit.hostRows, { databaseReachable: dbStatus === 'ok' });
  const configAudit = { ...summarizeConfigAudit(configAuditChecks), checks: configAuditChecks };
  const status = dbStatus === 'error'
    ? 'degraded'
    : configAudit.status === 'degraded'
      ? 'degraded'
      : configAudit.status === 'warning' || fleetHostAudit.summary.pending_validation_hosts > 0 || fleetHostAudit.summary.quarantined_hosts > 0
        ? 'warning'
        : 'ok';
  return c.json({
    status,
    service: 'justavps-api',
    timestamp: new Date().toISOString(),
    database: { status: dbStatus, error: dbProbe.error },
    fleet_hosts: fleetHostAudit.summary,
    config_audit: configAudit,
    control_plane: {
      error: serviceResult.error,
      services: summarizeControlPlaneServices(services),
    },
  });
});

app.get('/readyz', async (c) => {
  const timestamp = new Date().toISOString();
  const dbProbe = await probeDatabase();
  const dbOk = dbProbe.ok;
  const fleetHostAudit = dbOk ? await loadFleetHostAuditSummary().catch(() => emptyFleetHostAudit()) : emptyFleetHostAudit();
  const serviceResult = dbOk ? await listControlPlaneServicesWithTimeout() : { rows: [] as Awaited<ReturnType<typeof listControlPlaneServiceStates>>, error: 'database unavailable' };
  const services = serviceResult.rows;
  const configAuditChecks = await loadConfigAuditChecks(fleetHostAudit.hostRows, { databaseReachable: dbOk }).catch(() => []);
  const configAuditErrorCount = configAuditChecks.filter((check) => check.severity === 'error').length;
  const now = Date.now();
  const requiredServices = (Object.entries(CONTROL_PLANE_SERVICE_PROFILES)
    .filter(([, profile]) => profile.critical)
    .map(([service]) => service)) as Array<keyof typeof CONTROL_PLANE_SERVICE_PROFILES>;
  const staleServices = requiredServices.filter((service) => {
    const rows = services.filter((row) => row.service === service);
    if (rows.length === 0) return true;
    return rows.some((row) => isControlPlaneServiceStale(row, now));
  });
  const blockingDriftHosts = fleetHostAudit.summary.blocking_drift_hosts;
  const quarantinedHosts = fleetHostAudit.summary.quarantined_hosts;
  const ready = dbOk && staleServices.length === 0 && quarantinedHosts === 0 && blockingDriftHosts === 0 && configAuditErrorCount === 0;

  return c.json({
    status: ready ? 'ready' : 'degraded',
    service: 'justavps-api',
    timestamp,
    database: { status: dbOk ? 'ok' : 'error', error: dbProbe.error },
    fleet_hosts: fleetHostAudit.summary,
    control_plane: {
      error: serviceResult.error,
      stale_services: staleServices,
      services: summarizeControlPlaneServices(services),
    },
    config_audit: {
      error_count: configAuditErrorCount,
    },
    blockers: {
      quarantined_hosts: quarantinedHosts,
      blocking_drift_hosts: blockingDriftHosts,
      config_audit_errors: configAuditErrorCount,
    },
  }, ready ? 200 : 503);
});

app.route('/v1', v1);
app.route('/v2', v2);

// ─── Security Scheme Registration ─────────────────────────────────────────

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'API key (e.g. `sk_live_abc123...`). Create at justavps.com/settings.',
});

app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'authjs.session-token',
  description: 'Session cookie set by the dashboard login flow.',
});

// ─── OpenAPI Spec (auto-generated from route definitions + enriched) ────────

const openAPIConfig = {
  openapi: '3.1.0' as const,
  info: {
    title: 'JustAVPS API',
    version: '1.0.0',
    description: `The JustAVPS API lets you programmatically create and manage VPS machines, run commands, manage files, and build infrastructure.

## Authentication

All authenticated endpoints accept:
- **Bearer token**: \`Authorization: Bearer sk_live_xxx\`

Generate API keys in the [dashboard](https://justavps.com/settings).

## Base URL
\`\`\`
https://justavps.com/api/v1
\`\`\`

## Authenticated Proxy (Cloudflare Edge)

Machine HTTP traffic does not go directly to random VPS ports. It always flows through the authenticated Cloudflare proxy on \`kortix.cloud\` / \`kortix-dev.cloud\`.

Runtime URL patterns:

\`\`\`text
https://{slug}.kortix.cloud
https://{port}--{slug}.kortix.cloud

https://{slug}.kortix-dev.cloud
https://{port}--{slug}.kortix-dev.cloud
\`\`\`

Examples:

\`\`\`bash
# Root proxy (default HTTP service)
curl https://my-machine.kortix.cloud \\
  -H "Authorization: Bearer sk_live_xxx"

# Specific port through the authenticated proxy
curl https://3000--my-machine.kortix.cloud/health \\
  -H "Authorization: Bearer sk_live_xxx"

# Share link using a proxy token
open "https://3000--my-machine.kortix.cloud?__proxy_token=pt_xxx"

# Programmatic proxy token access
curl https://3000--my-machine.kortix.cloud \\
  -H "X-Proxy-Token: pt_xxx"
\`\`\`

The authenticated proxy accepts:
- \`Authorization: Bearer sk_live_xxx\` — API key
- \`X-Proxy-Token: pt_xxx\` — short-lived proxy token
- \`?__proxy_token=pt_xxx\` — browser-friendly share link
- dashboard session cookies / proxy JWTs for logged-in users

Notes:
- API keys must include the \`proxy\` permission (or \`*\`) to access proxied services.
- Proxy tokens are machine-scoped, optionally port-scoped, and always expire.
- The proxy handles normal HTTP traffic and WebSocket upgrades on the same authenticated hostname.

## SDKs

\`\`\`bash
# TypeScript / Node.js
npm install @kortix/justavps

# Python
pip install kortix-justavps
\`\`\`

\`\`\`typescript
import { JustAVPS } from "@kortix/justavps";
const client = new JustAVPS({ apiKey: "sk_live_..." });

// Create a machine
const machine = await client.machines.create({ server_type: "starter", region: "eu" });

// Execute commands
const tb = client.toolbox(machine.id);
const result = await tb.process.exec("echo hello");

// Manage files
await tb.files.upload("/root/app.py", 'print("hello")');
const content = await tb.files.download("/root/app.py");
\`\`\`

\`\`\`python
from justavps import JustAVPS
client = JustAVPS("sk_live_...")

# Create a machine
machine = client.machines.create(server_type="starter", region="eu")

# Execute commands
tb = client.toolbox(machine["id"])
result = tb.process.exec("echo hello")

# Manage files
tb.files.upload("/root/app.py", 'print("hello")')
content = tb.files.download("/root/app.py")
\`\`\`
`,
    contact: { name: 'Kortix', url: 'https://kortix.com', email: 'support@justavps.com' },
  },
  servers: [
    { url: '/', description: 'Current' },
    { url: 'https://justavps.com', description: 'Production' },
  ],
  tags: [
    { name: 'Machines', description: 'Create, manage, and destroy VPS machines' },
    { name: 'Images', description: 'Point-in-time captures of running machines' },
    { name: 'SSH Keys', description: 'Manage SSH public keys for machine access' },
    { name: 'API Keys', description: 'Create and manage API keys for programmatic access' },
    { name: 'Proxy Tokens', description: 'Create and manage short-lived share links for machine proxy access' },
    { name: 'Webhooks', description: 'Subscribe to machine lifecycle events via webhooks' },
    { name: 'Server Types', description: 'Discover available providers, regions, and server types' },
    { name: 'Account', description: 'Account info, usage stats, and billing' },
    { name: 'Toolbox: Filesystem', description: 'Read, write, search, and manage files on a machine' },
    { name: 'Toolbox: Process', description: 'Execute commands, run code, and manage processes on a machine' },
    { name: 'Internal', description: 'Internal endpoints used by machine agents and infrastructure' },
  ],
};

// Register the spec for route generation (hono needs this)
app.doc('/docs/openapi-raw.json', openAPIConfig);

// Serve the enriched spec with SDK code samples, tag groups, etc.
app.get('/docs/openapi.json', (c) => {
  const rawSpec = app.getOpenAPI31Document(openAPIConfig);
  const enriched = enrichOpenAPISpec(rawSpec);
  return c.json(enriched);
});

app.get('/docs/openapi-v2.json', (c) => {
  const rawSpec = app.getOpenAPI31Document(openAPIConfig);
  const enriched = enrichOpenAPISpec(rawSpec);
  const filtered = filterOpenApiDocumentForPrefix(enriched as OpenApiDoc, '/api/v2');
  const info = (filtered.info as Record<string, unknown> | undefined) ?? {};
  return c.json({
    ...filtered,
    info: {
      ...info,
      title: 'JustAVPS API V2',
      version: '2.0.0',
    },
    servers: [
      { url: '/api/v2', description: 'Current V2' },
      { url: 'https://justavps.com/api/v2', description: 'Production V2' },
    ],
  });
});

app.get(
  '/docs',
  Scalar({
    sources: [
      {
        title: 'JustAVPS API',
        url: '/api/docs/openapi.json',
      },
      {
        title: 'JustAVPS API V2',
        url: '/api/docs/openapi-v2.json',
      },
    ],
    theme: 'kepler',
    hiddenClients: true,
    defaultHttpClient: {
      targetKey: 'shell',
      clientKey: 'curl',
    },
  }),
);

app.get(
  '/docs/v2',
  Scalar({
    url: '/api/docs/openapi-v2.json',
    theme: 'kepler',
    hiddenClients: true,
    defaultHttpClient: {
      targetKey: 'shell',
      clientKey: 'curl',
    },
  }),
);

// ─── Error Handling ─────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[API ERROR] ${c.req.method} ${c.req.path}:`, err);
  return c.json(
    { error: true, message: 'Internal server error', status: 500 },
    500,
  );
});

app.notFound((c) => {
  return c.json(
    { error: true, message: 'Not found', status: 404 },
    404,
  );
});

export type AppType = typeof app;
