import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Scalar } from '@scalar/hono-api-reference';

import { v1 } from './routes/v1';

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

// ─── OpenAPI Spec (auto-generated from route definitions) ───────────────────

app.doc('/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'JustAVPS API',
    version: '1.0.0',
    description: `The JustAVPS API lets you programmatically manage VPS machines, images, SSH keys, API keys, webhooks, and billing.

## Authentication

All authenticated endpoints accept either:
- **Bearer token**: \`Authorization: Bearer sk_live_xxx\` — your API key
- **Session cookie**: \`authjs.session-token\` — set by the dashboard login

## Base URL
\`\`\`
https://justavps.com/api/v1
\`\`\`

## SDKs
- **TypeScript**: \`npm install @justavps/sdk\`
- **Python**: \`pip install justavps\`
`,
    contact: { name: 'JustAVPS', url: 'https://justavps.com', email: 'support@justavps.com' },
  },
  servers: [
    { url: '/api/v1', description: 'API v1' },
    { url: 'https://justavps.com/api/v1', description: 'Production' },
  ],
  tags: [
    { name: 'Machines', description: 'Create, manage, and destroy VPS machines' },
    { name: 'Images', description: 'Point-in-time captures of running machines' },
    { name: 'SSH Keys', description: 'Manage SSH public keys for machine access' },
    { name: 'API Keys', description: 'Create and manage API keys for programmatic access' },
    { name: 'Webhooks', description: 'Subscribe to machine lifecycle events via webhooks' },
    { name: 'Server Types', description: 'Discover available providers, regions, and server types' },
    { name: 'Account', description: 'Account info, usage stats, and billing' },
    { name: 'Events', description: 'Real-time machine status via Server-Sent Events' },
    { name: 'Internal', description: 'Internal endpoints used by machine agents and infrastructure' },
  ],
});

app.get(
  '/docs',
  Scalar({
    url: '/api/docs/openapi.json',
    theme: 'kepler',
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
