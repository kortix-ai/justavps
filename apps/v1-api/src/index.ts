import './load-env';

import { serve } from '@hono/node-server';

import { createV1ApiApp } from './app';

const port = Number(process.env.V1_API_PORT || 4101);
const app = createV1ApiApp();

serve({ fetch: app.fetch, port });

console.log(`[v1-api] listening on :${port}`);
