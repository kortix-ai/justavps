import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Scalar } from '@scalar/hono-api-reference';

import { v1 } from './routes/v1';
import { enrichOpenAPISpec } from './lib/openapi-enrichment';
import { config } from './lib/config';

export const app = new OpenAPIHono().basePath('/api');

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

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'justavps-api',
    timestamp: new Date().toISOString(),
  });
});

app.route('/v1', v1);

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

app.get(
  '/docs',
  Scalar({
    sources: [
      {
        title: 'JustAVPS API',
        url: '/api/docs/openapi.json',
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
