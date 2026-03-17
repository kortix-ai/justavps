import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { swaggerUI } from '@hono/swagger-ui';

import { v1 } from './routes/v1';

export const app = new Hono().basePath('/api');

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

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'justavps-api',
    timestamp: new Date().toISOString(),
  });
});

app.route('/v1', v1);

// ─── API Docs (dev only) ────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.get('/docs/openapi.json', (c) => {
    return c.json({
      openapi: '3.1.0',
      info: {
        title: 'JustAVPS API',
        version: '1.0.0',
        description: 'API for managing VPS machines, snapshots, SSH keys, and billing.',
      },
      servers: [{ url: '/api/v1', description: 'V1 API' }],
      paths: {
        '/machines': {
          get: {
            summary: 'List machines',
            tags: ['Machines'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            responses: { '200': { description: 'List of machines' } },
          },
          post: {
            summary: 'Create machine',
            tags: ['Machines'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['snapshot_id', 'provider', 'server_type', 'region'],
                    properties: {
                      snapshot_id: { type: 'string', format: 'uuid' },
                      provider: { type: 'string', example: 'hetzner' },
                      server_type: { type: 'string', example: 'cx23' },
                      region: { type: 'string', example: 'nbg1' },
                      name: { type: 'string', example: 'my-machine' },
                    },
                  },
                },
              },
            },
            responses: { '201': { description: 'Machine created' } },
          },
        },
        '/machines/{id}': {
          get: {
            summary: 'Get machine',
            tags: ['Machines'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '200': { description: 'Machine details' } },
          },
          delete: {
            summary: 'Delete machine',
            tags: ['Machines'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '204': { description: 'Machine deleted' } },
          },
        },
        '/machines/{id}/reboot': {
          post: {
            summary: 'Reboot machine',
            tags: ['Machines'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '202': { description: 'Reboot initiated' } },
          },
        },
        '/machines/{id}/resize': {
          post: {
            summary: 'Resize machine',
            tags: ['Machines'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['server_type'],
                    properties: { server_type: { type: 'string', example: 'cx33' } },
                  },
                },
              },
            },
            responses: { '202': { description: 'Resize initiated' } },
          },
        },
        '/snapshots': {
          get: {
            summary: 'List snapshots',
            tags: ['Snapshots'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            responses: { '200': { description: 'List of snapshots' } },
          },
          post: {
            summary: 'Create snapshot',
            tags: ['Snapshots'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['docker_image', 'name', 'provider'],
                    properties: {
                      docker_image: { type: 'string', example: 'nginx:latest' },
                      name: { type: 'string', example: 'my-snapshot' },
                      provider: { type: 'string', example: 'hetzner' },
                    },
                  },
                },
              },
            },
            responses: { '201': { description: 'Snapshot build started' } },
          },
        },
        '/snapshots/{id}': {
          get: {
            summary: 'Get snapshot',
            tags: ['Snapshots'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '200': { description: 'Snapshot details' } },
          },
          delete: {
            summary: 'Delete snapshot',
            tags: ['Snapshots'],
            security: [{ bearerAuth: [] }, { cookieAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '204': { description: 'Snapshot deleted' } },
          },
        },
        '/ssh-keys': {
          get: { summary: 'List SSH keys', tags: ['SSH Keys'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'List of SSH keys' } } },
          post: {
            summary: 'Add SSH key',
            tags: ['SSH Keys'],
            security: [{ bearerAuth: [] }],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object', required: ['name', 'public_key'], properties: { name: { type: 'string' }, public_key: { type: 'string' } } } } },
            },
            responses: { '201': { description: 'SSH key added' } },
          },
        },
        '/ssh-keys/{id}': {
          delete: {
            summary: 'Delete SSH key',
            tags: ['SSH Keys'],
            security: [{ bearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '204': { description: 'SSH key deleted' } },
          },
        },
        '/api-keys': {
          get: { summary: 'List API keys', tags: ['API Keys'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'List of API keys' } } },
          post: {
            summary: 'Create API key',
            tags: ['API Keys'],
            security: [{ bearerAuth: [] }],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } },
            responses: { '201': { description: 'API key created (key shown once)' } },
          },
        },
        '/api-keys/{id}': {
          delete: {
            summary: 'Delete API key',
            tags: ['API Keys'],
            security: [{ bearerAuth: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '204': { description: 'API key deleted' } },
          },
        },
        '/server-types': {
          get: {
            summary: 'List server types',
            tags: ['Discovery'],
            parameters: [
              { name: 'provider', in: 'query', schema: { type: 'string', default: 'hetzner' } },
              { name: 'region', in: 'query', required: true, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'Available server types' } },
          },
        },
        '/server-types/providers': {
          get: { summary: 'List providers', tags: ['Discovery'], responses: { '200': { description: 'Available providers' } } },
        },
        '/server-types/regions': {
          get: {
            summary: 'List regions',
            tags: ['Discovery'],
            parameters: [{ name: 'provider', in: 'query', schema: { type: 'string', default: 'hetzner' } }],
            responses: { '200': { description: 'Available regions' } },
          },
        },
        '/account': {
          get: { summary: 'Get account info', tags: ['Account'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Account details' } } },
        },
        '/account/usage': {
          get: { summary: 'Get usage stats', tags: ['Account'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Usage statistics' } } },
        },
        '/account/billing': {
          get: { summary: 'Get billing portal URL', tags: ['Account'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Stripe portal URL' } } },
        },
        '/internal/heartbeat': {
          post: {
            summary: 'Agent heartbeat',
            tags: ['Internal'],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object', required: ['slug', 'machine_token'], properties: { slug: { type: 'string' }, machine_token: { type: 'string' }, uptime: { type: 'number' }, services: { type: 'object' }, load: { type: 'object' } } } } },
            },
            responses: { '200': { description: 'Heartbeat acknowledged' } },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'API key (sk_live_xxx)' },
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'authjs.session-token', description: 'Session cookie' },
        },
      },
    });
  });

  app.get('/docs', swaggerUI({ url: '/api/docs/openapi.json' }));
}

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
