import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Scalar } from '@scalar/hono-api-reference';

import { v1 } from './routes/v1';
import { enrichOpenAPISpec } from './lib/openapi-enrichment';

export const app = new OpenAPIHono().basePath('/api');

app.use('*', cors({
  origin: [
    'https://justavps.com',
    'https://www.justavps.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ],
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

## SDKs

\`\`\`bash
# TypeScript / Node.js
npm install @justavps/sdk

# Python
pip install justavps
\`\`\`

\`\`\`typescript
import { JustAVPS } from "@justavps/sdk";
const client = new JustAVPS({ apiKey: "sk_live_..." });

// Create a machine
const machine = await client.machines.create({ server_type: "cpx32", region: "hel1" });

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
machine = client.machines.create(server_type="cpx32", region="hel1")

# Execute commands
tb = client.toolbox(machine["id"])
result = tb.process.exec("echo hello")

# Manage files
tb.files.upload("/root/app.py", 'print("hello")')
content = tb.files.download("/root/app.py")
\`\`\`
`,
    contact: { name: 'JustAVPS', url: 'https://justavps.com', email: 'support@justavps.com' },
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
