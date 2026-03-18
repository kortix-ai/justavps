import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Scalar } from '@scalar/hono-api-reference';

import { v1 } from './routes/v1';

// The OpenAPI spec is generated at build time from Zod schemas (pnpm sdk:generate).
// At runtime we serve the pre-built JSON — no runtime spec generation needed.
import specJson from '../sdk/openapi.json';

export const app = new Hono().basePath('/api');

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

// ─── OpenAPI Spec + Scalar API Docs ─────────────────────────────────────────

app.get('/docs/openapi.json', (c) => {
  return c.json(specJson);
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
