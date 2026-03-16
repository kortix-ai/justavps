/**
 * Hono app — the API layer.
 * Mounted at /api/[[...route]] in Next.js.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

import { machinesApp } from './routes/machines';
import { snapshotsApp } from './routes/snapshots';

import { sshKeysApp } from './routes/ssh-keys';
import { apiKeysApp } from './routes/api-keys';
import { serverTypesApp } from './routes/server-types';
import { accountApp } from './routes/account';
import { internalApp } from './routes/internal';
import { sseApp } from './routes/sse';

// ─── App Setup ──────────────────────────────────────────────────────────────

export const app = new Hono().basePath('/api');

// Global middleware
app.use('*', cors({
  origin: [
    'https://justavps.com',
    'https://www.justavps.com',
    'http://localhost:3000',
    'http://localhost:4100',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4100',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use('*', logger());
app.use('*', prettyJSON());

// ─── Health Check ───────────────────────────────────────────────────────────

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'justavps-api',
    timestamp: new Date().toISOString(),
  });
});

// ─── Mount Routes ───────────────────────────────────────────────────────────

app.route('/v1/machines', machinesApp);
app.route('/v1/snapshots', snapshotsApp);

app.route('/v1/ssh-keys', sshKeysApp);
app.route('/v1/api-keys', apiKeysApp);
app.route('/v1/server-types', serverTypesApp);
app.route('/v1/account', accountApp);
app.route('/v1/internal', internalApp);
app.route('/v1/machines', sseApp);

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
