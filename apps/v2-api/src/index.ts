import dotenv from 'dotenv';

dotenv.config({ path: '../../.env', quiet: true });
dotenv.config({ path: '../../.env.local', override: true, quiet: true });
dotenv.config({ quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });

const { serve } = await import('@hono/node-server');
const { createApp } = await import('./app.js');
const { loadConfig } = await import('./config.js');

const config = loadConfig();
const app = createApp(config);

serve({ fetch: app.fetch, port: config.port });

console.log(`[v2-api] listening on :${config.port} with ${config.clusters.length} Incus cluster(s)`);
