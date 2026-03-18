/**
 * OpenAPI 3.1.0 specification — auto-generated from actual route definitions.
 * Single source of truth for API documentation, SDK generation, and Scalar docs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// We use plain objects intentionally — the openapi-types package is too strict
// for 3.1 nullable handling. The output is valid OpenAPI 3.1 JSON.
type Schema = Record<string, any>;
type Param = Record<string, any>;
type PathItem = Record<string, any>;

// ─── Reusable Schema Components ────────────────────────────────────────────

const UUIDParam = (name: string, description: string): Param => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
});

const QueryParam = (name: string, description: string, opts?: { required?: boolean; default?: string }): Param => ({
  name,
  in: 'query',
  required: opts?.required ?? false,
  description,
  schema: { type: 'string', ...(opts?.default ? { default: opts.default } : {}) },
});

// ─── Schema Definitions ────────────────────────────────────────────────────

const ErrorResponse: Schema = {
  type: 'object',
  required: ['error', 'message', 'status'],
  properties: {
    error: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Resource not found' },
    status: { type: 'integer', example: 404 },
  },
};

const MachineHealthServices: Schema = {
  type: 'object',
  additionalProperties: { type: 'boolean' },
  description: 'Service status map (e.g. code_server, caddy, docker)',
  example: { code_server: true, caddy: true, docker: true },
};

const MachineHealth: Schema = {
  type: ['object', 'null'],
  properties: {
    cpu: { type: 'number', example: 0.45, description: 'CPU usage (0-1)' },
    memory: { type: 'number', example: 0.62, description: 'Memory usage (0-1)' },
    disk: { type: 'number', example: 0.31, description: 'Disk usage (0-1)' },
    services: { $ref: '#/components/schemas/MachineHealthServices' },
    last_heartbeat_at: { type: ['string', 'null'], format: 'date-time' },
  },
};

const MachineConnect: Schema = {
  type: ['object', 'null'],
  properties: {
    ssh_command: { type: ['string', 'null'], example: 'ssh -i ~/.ssh/justavps_abc123 root@1.2.3.4' },
    setup_command: { type: ['string', 'null'], description: 'One-liner to save SSH key and connect' },
    vscode_url: { type: 'string', format: 'uri', example: 'https://abc123.kortix.cloud' },
    vscode_password: { type: 'string', example: 'randompassword123' },
    cursor_ssh: { type: ['string', 'null'], example: 'ssh -i ~/.ssh/justavps_abc123 root@1.2.3.4' },
  },
};

const MachineSSHKey: Schema = {
  type: ['object', 'null'],
  properties: {
    private_key: { type: ['string', 'null'], description: 'PEM-encoded private key (only returned on creation)' },
    public_key: { type: ['string', 'null'] },
    setup_command: { type: ['string', 'null'], description: 'Shell command to save the key and SSH in' },
    key_path: { type: 'string', example: '~/.ssh/justavps_abc123' },
  },
};

const MachineURLs: Schema = {
  type: ['object', 'null'],
  properties: {
    vscode: { type: 'string', format: 'uri', example: 'https://abc123.kortix.cloud' },
    pty: { type: 'string', format: 'uri', example: 'wss://abc123.kortix.cloud/_pty' },
  },
};

const Machine: Schema = {
  type: 'object',
  required: ['id', 'slug', 'name', 'status', 'provider', 'server_type', 'region', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    slug: { type: 'string', example: 'abc123', description: 'Unique 6-char identifier used in URLs' },
    name: { type: 'string', example: 'my-machine' },
    status: { type: 'string', enum: ['provisioning', 'ready', 'error', 'stopped', 'deleted'] },
    provisioning_stage: { type: ['string', 'null'], description: 'Current provisioning step', example: 'server_creating' },
    provisioning_stage_updated_at: { type: ['string', 'null'], format: 'date-time' },
    provider: { type: 'string', example: 'hetzner' },
    snapshot_id: { type: ['string', 'null'], format: 'uuid' },
    server_type: { type: 'string', example: 'cpx22' },
    region: { type: 'string', example: 'nbg1' },
    ip: { type: ['string', 'null'], example: '116.203.0.1' },
    price_monthly: { type: ['number', 'null'], example: 12, description: 'Monthly price in USD (cents)' },
    created_at: { type: 'string', format: 'date-time' },
    ready_at: { type: ['string', 'null'], format: 'date-time' },
    urls: { $ref: '#/components/schemas/MachineURLs' },
    ssh: { type: ['string', 'null'], example: 'ssh -i ~/.ssh/justavps_abc123 root@1.2.3.4' },
    ssh_key: { $ref: '#/components/schemas/MachineSSHKey' },
    connect: { $ref: '#/components/schemas/MachineConnect' },
    health: { $ref: '#/components/schemas/MachineHealth' },
  },
};

const Snapshot: Schema = {
  type: 'object',
  required: ['id', 'name', 'status', 'is_default', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: 'my-snapshot' },
    docker_image: { type: ['string', 'null'], example: 'nginx:latest' },
    entrypoint: { type: ['string', 'null'], example: 'sleep infinity' },
    is_default: { type: 'boolean', description: 'True for the platform base snapshot' },
    status: { type: 'string', enum: ['building', 'ready', 'failed', 'deleted'] },
    architecture: { type: ['string', 'null'], enum: ['x86', 'arm', null] },
    providers: {
      type: 'object',
      additionalProperties: { $ref: '#/components/schemas/ProviderArtifact' },
      description: 'Per-provider snapshot artifacts',
    },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    last_used_at: { type: ['string', 'null'], format: 'date-time' },
  },
};

const ProviderArtifact: Schema = {
  type: 'object',
  properties: {
    snapshotId: { type: 'string' },
    diskSize: { type: 'integer' },
    architecture: { type: 'string', enum: ['x86', 'arm'] },
  },
};

const SSHKey: Schema = {
  type: 'object',
  required: ['id', 'name', 'fingerprint', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: 'my-laptop' },
    fingerprint: { type: 'string', example: 'SHA256:abc...' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const APIKey: Schema = {
  type: 'object',
  required: ['id', 'name', 'key_prefix', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: 'production' },
    key: { type: 'string', description: 'Full API key — only returned on creation', example: 'sk_live_abc123...' },
    key_prefix: { type: 'string', example: 'sk_live_abc1' },
    created_at: { type: 'string', format: 'date-time' },
    last_used: { type: ['string', 'null'], format: 'date-time' },
  },
};

const ServerType: Schema = {
  type: 'object',
  required: ['name', 'description', 'vcpu', 'ram_gb', 'disk_gb', 'cpu_type', 'architecture', 'price_monthly', 'provider_price_monthly', 'available'],
  properties: {
    name: { type: 'string', example: 'cpx22' },
    description: { type: 'string', example: 'CPX22 — 2 vCPU, 4GB RAM' },
    vcpu: { type: 'integer', example: 2 },
    ram_gb: { type: 'number', example: 4 },
    disk_gb: { type: 'integer', example: 40 },
    cpu_type: { type: 'string', enum: ['shared', 'dedicated'] },
    architecture: { type: 'string', enum: ['x86', 'arm'] },
    price_monthly: { type: 'number', example: 12.00, description: 'Our price after markup (USD)' },
    provider_price_monthly: { type: 'number', example: 4.35, description: 'Raw provider price' },
    available: { type: 'boolean' },
  },
};

const Provider: Schema = {
  type: 'object',
  required: ['name', 'displayName'],
  properties: {
    name: { type: 'string', example: 'hetzner' },
    displayName: { type: 'string', example: 'Hetzner Cloud' },
  },
};

const Region: Schema = {
  type: 'object',
  required: ['id', 'name', 'country', 'city'],
  properties: {
    id: { type: 'string', example: 'nbg1' },
    name: { type: 'string', example: 'Nuremberg' },
    country: { type: 'string', example: 'DE' },
    city: { type: 'string', example: 'Nuremberg' },
  },
};

const Webhook: Schema = {
  type: 'object',
  required: ['id', 'url', 'events', 'active', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    url: { type: 'string', format: 'uri', example: 'https://example.com/webhooks/justavps' },
    events: { type: 'array', items: { type: 'string' }, example: ['machine.status_changed', 'machine.stage_changed'] },
    secret: { type: 'string', description: 'HMAC secret — only returned on creation', example: 'whsec_abc123...' },
    active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const Account: Schema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    name: { type: ['string', 'null'] },
    machines_count: { type: 'integer' },
    stripe_customer_id: { type: ['string', 'null'] },
    created_at: { type: 'string', format: 'date-time' },
  },
};

const AccountUsage: Schema = {
  type: 'object',
  properties: {
    current_period: {
      type: 'object',
      properties: {
        machines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              slug: { type: 'string' },
              server_type: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
        total_machines: { type: 'integer' },
        estimated_cost: { type: 'number', description: 'Estimated cost for current period (USD)' },
      },
    },
  },
};

const BillingPortal: Schema = {
  type: 'object',
  properties: {
    portal_url: { type: ['string', 'null'], format: 'uri' },
    message: { type: 'string' },
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function jsonResponse(description: string, schema: Schema): Record<string, any> {
  return { description, content: { 'application/json': { schema } } };
}

function errorResponses(...codes: Array<400 | 401 | 403 | 404 | 409 | 500>): Record<string, any> {
  const map: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    500: 'Internal Server Error',
  };
  const result: Record<string, any> = {};
  for (const code of codes) {
    result[String(code)] = jsonResponse(map[code], { $ref: '#/components/schemas/Error' });
  }
  return result;
}

const bearerSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];

// ─── Code Samples (SDK + cURL for every endpoint) ──────────────────────────

function sdk(code: string) {
  return { lang: 'JavaScript', label: 'TypeScript SDK', source: `import { JustAVPS } from '@justavps/sdk';\n\nconst client = new JustAVPS({ apiKey: 'sk_live_YOUR_KEY' });\n\n${code}` };
}

function curl(method: string, path: string, body?: string) {
  const base = 'https://justavps.com/api/v1';
  let cmd = `curl`;
  if (method !== 'GET') cmd += ` -X ${method}`;
  cmd += ` ${base}${path} \\\n  -H "Authorization: Bearer sk_live_YOUR_KEY"`;
  if (body) cmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
  return { lang: 'Shell', label: 'cURL', source: cmd };
}

// ─── The Full Spec ─────────────────────────────────────────────────────────

export function generateOpenAPISpec(baseUrl: string = '/api/v1'): Record<string, any> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'JustAVPS API',
      version: '1.0.0',
      description: `The JustAVPS API lets you programmatically manage VPS machines, images, SSH keys, API keys, webhooks, and billing.

## Authentication

All authenticated endpoints accept either:

- **Bearer token**: \`Authorization: Bearer sk_live_xxx\` — your API key
- **Session cookie**: \`authjs.session-token\` — set by the dashboard login

Create API keys at [justavps.com/settings](https://justavps.com/settings).

## Base URL

\`\`\`
https://justavps.com/api/v1
\`\`\`

## Quick Start

\`\`\`bash
# List your machines
curl https://justavps.com/api/v1/machines \\
  -H "Authorization: Bearer sk_live_YOUR_KEY"

# Create a machine
curl -X POST https://justavps.com/api/v1/machines \\
  -H "Authorization: Bearer sk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"provider": "hetzner", "server_type": "cpx22", "region": "nbg1"}'
\`\`\`

## Errors

All error responses follow the same shape:

\`\`\`json
{
  "error": true,
  "message": "Human-readable error description",
  "status": 400
}
\`\`\`

## SDKs

- **TypeScript/JavaScript**: \`npm install @justavps/sdk\` — fully typed SDK auto-generated from this spec
- **Python**: Coming soon
`,
      contact: {
        name: 'JustAVPS Support',
        url: 'https://justavps.com',
        email: 'support@justavps.com',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      { url: baseUrl, description: 'API v1' },
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
    paths: {
      // ═══════════════════════════════════════════════════════════════════════
      // MACHINES
      // ═══════════════════════════════════════════════════════════════════════
      '/machines': {
        get: {
          operationId: 'listMachines',
          summary: 'List machines',
          description: 'Returns all non-deleted machines owned by the authenticated user.',
          tags: ['Machines'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const { machines } = await client.machines.list();\nconsole.log(machines);`),
            curl('GET', '/machines'),
          ],
          responses: {
            '200': jsonResponse('List of machines', {
              type: 'object',
              required: ['machines'],
              properties: {
                machines: { type: 'array', items: { $ref: '#/components/schemas/Machine' } },
              },
            }),
            ...errorResponses(401),
          },
        },
        post: {
          operationId: 'createMachine',
          summary: 'Create a machine',
          description: `Provisions a new VPS machine. Returns immediately with status \`provisioning\` (HTTP 202).

If \`image_id\` is provided, boots from that image. If omitted or null, boots from a fresh Ubuntu 24.04 install.

The machine will transition to \`ready\` once cloud-init completes and the agent sends its first heartbeat.

Use the SSE endpoint \`GET /machines/{id}/status/stream\` to watch provisioning progress in real-time.`,
          tags: ['Machines'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const machine = await client.machines.create({\n  provider: 'hetzner',\n  server_type: 'cpx22',\n  region: 'nbg1',\n  name: 'my-machine',\n});\n\n// Wait for it to be ready\nconst ready = await client.machines.waitForReady(machine.id);\nconsole.log('Ready:', ready.connect?.vscode_url);`),
            curl('POST', '/machines', '{"provider":"hetzner","server_type":"cpx22","region":"nbg1"}'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['snapshot_id', 'provider', 'server_type', 'region'],
                  properties: {
                    snapshot_id: { type: 'string', format: 'uuid', description: 'Snapshot to boot from' },
                    provider: { type: 'string', description: 'Cloud provider', example: 'hetzner' },
                    server_type: { type: 'string', description: 'Provider-specific server type', example: 'cpx22' },
                    region: { type: 'string', description: 'Provider-specific region', example: 'nbg1' },
                    name: { type: 'string', description: 'Human-readable name (auto-generated if omitted)', example: 'my-machine', maxLength: 64 },
                    env_vars: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                      description: 'Extra environment variables written to /etc/justavps/env on the machine',
                      example: { API_KEY: 'sk-xxx', NODE_ENV: 'production' },
                    },
                    docker_image: { type: 'string', description: 'Docker image to run on boot', example: 'nginx:latest' },
                    entrypoint: { type: 'string', description: 'Container entrypoint override', example: 'sleep infinity' },
                  },
                },
              },
            },
          },
          responses: {
            '202': jsonResponse('Machine creation started', { $ref: '#/components/schemas/Machine' }),
            ...errorResponses(400, 401, 404),
          },
        },
      } satisfies PathItem,

      '/machines/{id}': {
        get: {
          operationId: 'getMachine',
          summary: 'Get a machine',
          description: 'Returns full details of a machine including connection info, health metrics, and SSH keys.',
          tags: ['Machines'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const machine = await client.machines.get('machine-uuid');\nconsole.log(machine.status, machine.connect?.vscode_url);`),
            curl('GET', '/machines/{id}'),
          ],
          parameters: [UUIDParam('id', 'Machine ID')],
          responses: {
            '200': jsonResponse('Machine details', { $ref: '#/components/schemas/Machine' }),
            ...errorResponses(401, 404),
          },
        },
        delete: {
          operationId: 'deleteMachine',
          summary: 'Delete a machine',
          description: 'Permanently destroys the machine, removes DNS records, cancels billing, and deletes the provider server. **This action is irreversible.**',
          tags: ['Machines'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`await client.machines.delete('machine-uuid');`),
            curl('DELETE', '/machines/{id}'),
          ],
          parameters: [UUIDParam('id', 'Machine ID')],
          responses: {
            '204': { description: 'Machine deleted' },
            ...errorResponses(401, 404),
          },
        },
      },

      '/machines/{id}/reboot': {
        post: {
          operationId: 'rebootMachine',
          summary: 'Reboot a machine',
          description: 'Initiates a hard reboot via the provider API. The machine will be briefly unavailable (~30s).',
          tags: ['Machines'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const result = await client.machines.reboot('machine-uuid');\nconsole.log(result.status); // 'initiated'`),
            curl('POST', '/machines/{id}/reboot'),
          ],
          parameters: [UUIDParam('id', 'Machine ID')],
          responses: {
            '202': jsonResponse('Reboot initiated', {
              type: 'object',
              properties: {
                action: { type: 'string', example: 'reboot' },
                status: { type: 'string', example: 'initiated' },
              },
            }),
            ...errorResponses(401, 404),
          },
        },
      },

      '/machines/{id}/resize': {
        post: {
          operationId: 'resizeMachine',
          summary: 'Resize a machine',
          description: `Changes the machine to a different server type. The machine will reboot during the resize (~30s downtime).

**Constraints:**
- Disk can only grow (no downsizing)
- Same architecture required (x86 ↔ ARM requires a new machine)
- Billing is updated with prorated pricing`,
          tags: ['Machines'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const result = await client.machines.resize('machine-uuid', {\n  server_type: 'cpx32',\n});\nconsole.log(result.old_type, '→', result.new_type);`),
            curl('POST', '/machines/{id}/resize', '{"server_type":"cpx32"}'),
          ],
          parameters: [UUIDParam('id', 'Machine ID')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['server_type'],
                  properties: {
                    server_type: { type: 'string', description: 'New server type', example: 'cpx32' },
                  },
                },
              },
            },
          },
          responses: {
            '202': jsonResponse('Resize initiated', {
              type: 'object',
              properties: {
                action: { type: 'string', example: 'resize' },
                old_type: { type: 'string', example: 'cpx22' },
                new_type: { type: 'string', example: 'cpx32' },
                status: { type: 'string', example: 'initiated' },
              },
            }),
            ...errorResponses(400, 401, 404),
          },
        },
      },

      '/machines/{id}/status/stream': {
        get: {
          operationId: 'streamMachineStatus',
          summary: 'Stream machine status (SSE)',
          description: `Opens a Server-Sent Events stream that pushes real-time provisioning updates.

**Event types:**
- \`status\` — Current machine status snapshot
- \`stage\` — Provisioning stage change (e.g. \`server_creating\`, \`cloud_init_running\`)
- \`done\` — Terminal event, stream will close
- \`ping\` — Keepalive (every 2s)
- \`error\` — Error event

The stream automatically closes when the machine reaches a terminal state (\`ready\`, \`error\`, \`deleted\`) or after 10 minutes.`,
          tags: ['Events'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`// Async iterator over SSE events\nfor await (const event of client.machines.stream('machine-uuid')) {\n  if (event.type === 'stage') {\n    console.log('Stage:', event.data.provisioning_stage);\n  }\n  if (event.type === 'done') break;\n}\n\n// Or use the convenience helper:\nconst machine = await client.machines.waitForReady('machine-uuid');`),
            curl('GET', '/machines/{id}/status/stream'),
          ],
          parameters: [UUIDParam('id', 'Machine ID')],
          responses: {
            '200': {
              description: 'SSE stream of machine events',
              content: {
                'text/event-stream': {
                  schema: { type: 'string' },
                },
              },
            },
            ...errorResponses(401, 404),
          },
        },
      },

      // ═══════════════════════════════════════════════════════════════════════
      // SNAPSHOTS
      // ═══════════════════════════════════════════════════════════════════════
      '/snapshots': {
        get: {
          operationId: 'listSnapshots',
          summary: 'List snapshots',
          description: 'Returns all non-deleted snapshots owned by the authenticated user, including the default platform snapshot.',
          tags: ['Snapshots'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const { snapshots } = await client.snapshots.list();\nconsole.log(snapshots);`),
            curl('GET', '/snapshots'),
          ],
          responses: {
            '200': jsonResponse('List of snapshots', {
              type: 'object',
              required: ['snapshots'],
              properties: {
                snapshots: { type: 'array', items: { $ref: '#/components/schemas/Snapshot' } },
              },
            }),
            ...errorResponses(401),
          },
        },
        post: {
          operationId: 'createSnapshot',
          summary: 'Create a snapshot',
          description: `Starts an asynchronous snapshot build from a Docker image. The snapshot will be in \`building\` status initially. Poll \`GET /snapshots/{id}\` until status is \`ready\`.`,
          tags: ['Snapshots'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const snapshot = await client.snapshots.create({\n  docker_image: 'nginx:latest',\n  name: 'my-nginx-snapshot',\n  provider: 'hetzner',\n});\nconst ready = await client.snapshots.waitForReady(snapshot.id);`),
            curl('POST', '/snapshots', '{"docker_image":"nginx:latest","name":"my-snapshot","provider":"hetzner"}'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['docker_image', 'name', 'provider'],
                  properties: {
                    docker_image: { type: 'string', description: 'Docker image to bake into the snapshot', example: 'nginx:latest' },
                    entrypoint: { type: 'string', description: 'Container entrypoint command', example: 'sleep infinity' },
                    name: { type: 'string', description: 'Human-readable name', example: 'my-nginx-snapshot', maxLength: 128 },
                    provider: { type: 'string', description: 'Provider to build on', example: 'hetzner' },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Snapshot build started', { $ref: '#/components/schemas/Snapshot' }),
            ...errorResponses(400, 401),
          },
        },
      },

      '/snapshots/{id}': {
        get: {
          operationId: 'getSnapshot',
          summary: 'Get a snapshot',
          description: 'Returns snapshot details including build status and per-provider artifacts.',
          tags: ['Snapshots'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const snapshot = await client.snapshots.get('snapshot-uuid');\nconsole.log(snapshot.status, snapshot.providers);`),
            curl('GET', '/snapshots/{id}'),
          ],
          parameters: [UUIDParam('id', 'Snapshot ID')],
          responses: {
            '200': jsonResponse('Snapshot details', { $ref: '#/components/schemas/Snapshot' }),
            ...errorResponses(401, 404),
          },
        },
        delete: {
          operationId: 'deleteSnapshot',
          summary: 'Delete a snapshot',
          description: 'Deletes the snapshot and all provider-side artifacts. Cannot delete the default platform snapshot.',
          tags: ['Snapshots'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`await client.snapshots.delete('snapshot-uuid');`),
            curl('DELETE', '/snapshots/{id}'),
          ],
          parameters: [UUIDParam('id', 'Snapshot ID')],
          responses: {
            '204': { description: 'Snapshot deleted' },
            ...errorResponses(400, 401, 404),
          },
        },
      },

      '/snapshots/{id}/build': {
        post: {
          operationId: 'buildSnapshotOnProvider',
          summary: 'Build snapshot on another provider',
          description: 'Triggers an async build of an existing snapshot on a new provider.',
          tags: ['Snapshots'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const result = await client.snapshots.build('snapshot-uuid', { provider: 'hetzner' });`),
            curl('POST', '/snapshots/{id}/build', '{"provider":"hetzner"}'),
          ],
          parameters: [UUIDParam('id', 'Snapshot ID')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['provider'],
                  properties: {
                    provider: { type: 'string', description: 'Provider to build on', example: 'hetzner' },
                  },
                },
              },
            },
          },
          responses: {
            '202': jsonResponse('Build started', {
              type: 'object',
              properties: {
                message: { type: 'string' },
                status: { type: 'string', example: 'building' },
              },
            }),
            ...errorResponses(400, 401, 404, 409),
          },
        },
      },

      // ═══════════════════════════════════════════════════════════════════════
      // SSH KEYS
      // ═══════════════════════════════════════════════════════════════════════
      '/ssh-keys': {
        get: {
          operationId: 'listSSHKeys',
          summary: 'List SSH keys',
          description: 'Returns all SSH public keys registered by the authenticated user.',
          tags: ['SSH Keys'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const { ssh_keys } = await client.sshKeys.list();\nconsole.log(ssh_keys);`),
            curl('GET', '/ssh-keys'),
          ],
          responses: {
            '200': jsonResponse('List of SSH keys', {
              type: 'object',
              required: ['ssh_keys'],
              properties: {
                ssh_keys: { type: 'array', items: { $ref: '#/components/schemas/SSHKey' } },
              },
            }),
            ...errorResponses(401),
          },
        },
        post: {
          operationId: 'createSSHKey',
          summary: 'Add an SSH key',
          description: 'Registers a new SSH public key. The key is automatically uploaded to all available providers.',
          tags: ['SSH Keys'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const key = await client.sshKeys.create({\n  name: 'my-laptop',\n  public_key: 'ssh-ed25519 AAAA...',\n});\nconsole.log(key.fingerprint);`),
            curl('POST', '/ssh-keys', '{"name":"my-laptop","public_key":"ssh-ed25519 AAAA..."}'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'public_key'],
                  properties: {
                    name: { type: 'string', description: 'Label for this key', example: 'my-laptop', maxLength: 128 },
                    public_key: { type: 'string', description: 'SSH public key', example: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample...' },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('SSH key added', { $ref: '#/components/schemas/SSHKey' }),
            ...errorResponses(400, 401),
          },
        },
      },

      '/ssh-keys/{id}': {
        delete: {
          operationId: 'deleteSSHKey',
          summary: 'Delete an SSH key',
          description: 'Removes the SSH key from JustAVPS and all providers. Existing machines are not affected.',
          tags: ['SSH Keys'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`await client.sshKeys.delete('key-uuid');`),
            curl('DELETE', '/ssh-keys/{id}'),
          ],
          parameters: [UUIDParam('id', 'SSH Key ID')],
          responses: {
            '204': { description: 'SSH key deleted' },
            ...errorResponses(401, 404),
          },
        },
      },

      // ═══════════════════════════════════════════════════════════════════════
      // API KEYS
      // ═══════════════════════════════════════════════════════════════════════
      '/api-keys': {
        get: {
          operationId: 'listAPIKeys',
          summary: 'List API keys',
          description: 'Returns all API keys for the authenticated user. The full key value is never returned after creation.',
          tags: ['API Keys'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const { api_keys } = await client.apiKeys.list();\nconsole.log(api_keys);`),
            curl('GET', '/api-keys'),
          ],
          responses: {
            '200': jsonResponse('List of API keys', {
              type: 'object',
              required: ['api_keys'],
              properties: {
                api_keys: { type: 'array', items: { $ref: '#/components/schemas/APIKey' } },
              },
            }),
            ...errorResponses(401),
          },
        },
        post: {
          operationId: 'createAPIKey',
          summary: 'Create an API key',
          description: '**The full key is only returned once in this response.** Store it securely — it cannot be retrieved again.',
          tags: ['API Keys'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const apiKey = await client.apiKeys.create({ name: 'production' });\nconsole.log('Save this key:', apiKey.key); // Only shown once!`),
            curl('POST', '/api-keys', '{"name":"production"}'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string', description: 'Label for this key', example: 'production', maxLength: 128 },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('API key created (key shown once)', { $ref: '#/components/schemas/APIKey' }),
            ...errorResponses(400, 401),
          },
        },
      },

      '/api-keys/{id}': {
        delete: {
          operationId: 'deleteAPIKey',
          summary: 'Delete an API key',
          description: 'Permanently revokes the API key. Any requests using this key will immediately fail.',
          tags: ['API Keys'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`await client.apiKeys.delete('key-uuid');`),
            curl('DELETE', '/api-keys/{id}'),
          ],
          parameters: [UUIDParam('id', 'API Key ID')],
          responses: {
            '204': { description: 'API key deleted' },
            ...errorResponses(401, 404),
          },
        },
      },

      // ═══════════════════════════════════════════════════════════════════════
      // WEBHOOKS
      // ═══════════════════════════════════════════════════════════════════════
      '/webhooks': {
        get: {
          operationId: 'listWebhooks',
          summary: 'List webhooks',
          description: 'Returns all webhook subscriptions for the authenticated user.',
          tags: ['Webhooks'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const { webhooks } = await client.webhooks.list();\nconsole.log(webhooks);`),
            curl('GET', '/webhooks'),
          ],
          responses: {
            '200': jsonResponse('List of webhooks', {
              type: 'object',
              required: ['webhooks'],
              properties: {
                webhooks: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } },
              },
            }),
            ...errorResponses(401),
          },
        },
        post: {
          operationId: 'createWebhook',
          summary: 'Create a webhook',
          description: `Subscribes a URL to receive POST requests for specified events. The webhook secret is used to sign payloads with HMAC-SHA256 in the \`X-Signature-256\` header.

**Available events:**
- \`*\` — All events
- \`machine.stage_changed\` — Provisioning stage updates
- \`machine.status_changed\` — Machine status transitions
- \`machine.heartbeat\` — Periodic health updates`,
          tags: ['Webhooks'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const webhook = await client.webhooks.create({\n  url: 'https://example.com/webhooks/justavps',\n  events: ['machine.status_changed'],\n});\nconsole.log('Secret:', webhook.secret); // Save this!`),
            curl('POST', '/webhooks', '{"url":"https://example.com/hook","events":["machine.status_changed"]}'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url', 'events'],
                  properties: {
                    url: { type: 'string', format: 'uri', description: 'HTTPS endpoint to receive events', example: 'https://example.com/webhooks/justavps' },
                    events: {
                      type: 'array',
                      items: { type: 'string', enum: ['*', 'machine.stage_changed', 'machine.status_changed', 'machine.heartbeat'] },
                      description: 'Event types to subscribe to',
                      example: ['machine.status_changed'],
                    },
                    secret: { type: 'string', description: 'HMAC secret (auto-generated if omitted, min 16 chars)', minLength: 16 },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Webhook created (secret shown once)', { $ref: '#/components/schemas/Webhook' }),
            ...errorResponses(400, 401),
          },
        },
      },

      '/webhooks/{id}': {
        delete: {
          operationId: 'deleteWebhook',
          summary: 'Delete a webhook',
          description: 'Removes the webhook subscription. No further events will be delivered.',
          tags: ['Webhooks'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`await client.webhooks.delete('webhook-uuid');`),
            curl('DELETE', '/webhooks/{id}'),
          ],
          parameters: [UUIDParam('id', 'Webhook ID')],
          responses: {
            '204': { description: 'Webhook deleted' },
            ...errorResponses(401, 404),
          },
        },
      },

      // ═══════════════════════════════════════════════════════════════════════
      // SERVER TYPES / DISCOVERY
      // ═══════════════════════════════════════════════════════════════════════
      '/server-types': {
        get: {
          operationId: 'listServerTypes',
          summary: 'List server types',
          description: 'Returns all available server types for a given provider and region, including pricing with markup.',
          tags: ['Server Types'],
          'x-codeSamples': [
            sdk(`const { server_types } = await client.serverTypes.list('nbg1');\nfor (const st of server_types) {\n  console.log(st.name, st.vcpu + ' vCPU', st.ram_gb + 'GB', '$' + st.price_monthly + '/mo');\n}`),
            curl('GET', '/server-types?provider=hetzner&region=nbg1'),
          ],
          parameters: [
            QueryParam('provider', 'Cloud provider name', { default: 'hetzner' }),
            QueryParam('region', 'Provider region ID (e.g. nbg1, fsn1)', { required: true }),
          ],
          responses: {
            '200': jsonResponse('Available server types', {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                region: { type: 'string' },
                server_types: { type: 'array', items: { $ref: '#/components/schemas/ServerType' } },
              },
            }),
            ...errorResponses(400),
          },
        },
      },

      '/server-types/providers': {
        get: {
          operationId: 'listProviders',
          summary: 'List providers',
          description: 'Returns all available cloud providers.',
          tags: ['Server Types'],
          'x-codeSamples': [
            sdk(`const { providers } = await client.serverTypes.providers();\nconsole.log(providers);`),
            curl('GET', '/server-types/providers'),
          ],
          responses: {
            '200': jsonResponse('Available providers', {
              type: 'object',
              properties: {
                providers: { type: 'array', items: { $ref: '#/components/schemas/Provider' } },
              },
            }),
          },
        },
      },

      '/server-types/regions': {
        get: {
          operationId: 'listRegions',
          summary: 'List regions',
          description: 'Returns all available regions for a given provider.',
          tags: ['Server Types'],
          'x-codeSamples': [
            sdk(`const { regions } = await client.serverTypes.regions('hetzner');\nfor (const r of regions) {\n  console.log(r.id, r.city, r.country);\n}`),
            curl('GET', '/server-types/regions?provider=hetzner'),
          ],
          parameters: [
            QueryParam('provider', 'Cloud provider name', { default: 'hetzner' }),
          ],
          responses: {
            '200': jsonResponse('Available regions', {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                regions: { type: 'array', items: { $ref: '#/components/schemas/Region' } },
              },
            }),
            ...errorResponses(400),
          },
        },
      },

      // ═══════════════════════════════════════════════════════════════════════
      // ACCOUNT
      // ═══════════════════════════════════════════════════════════════════════
      '/account': {
        get: {
          operationId: 'getAccount',
          summary: 'Get account info',
          description: 'Returns the authenticated user\'s account details.',
          tags: ['Account'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const account = await client.account.get();\nconsole.log(account.email, account.machines_count);`),
            curl('GET', '/account'),
          ],
          responses: {
            '200': jsonResponse('Account details', { $ref: '#/components/schemas/Account' }),
            ...errorResponses(401, 404),
          },
        },
      },

      '/account/usage': {
        get: {
          operationId: 'getAccountUsage',
          summary: 'Get usage stats',
          description: 'Returns current billing period usage including active machines and estimated cost.',
          tags: ['Account'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const usage = await client.account.usage();\nconsole.log('Machines:', usage.current_period.total_machines);\nconsole.log('Cost: $' + usage.current_period.estimated_cost);`),
            curl('GET', '/account/usage'),
          ],
          responses: {
            '200': jsonResponse('Usage statistics', { $ref: '#/components/schemas/AccountUsage' }),
            ...errorResponses(401),
          },
        },
      },

      '/account/billing': {
        get: {
          operationId: 'getBillingPortal',
          summary: 'Get billing portal URL',
          description: 'Returns a Stripe Customer Portal URL for self-service billing management.',
          tags: ['Account'],
          security: bearerSecurity,
          'x-codeSamples': [
            sdk(`const { portal_url } = await client.account.billing();\nif (portal_url) window.open(portal_url);`),
            curl('GET', '/account/billing'),
          ],
          responses: {
            '200': jsonResponse('Billing portal URL', { $ref: '#/components/schemas/BillingPortal' }),
            ...errorResponses(401),
          },
        },
      },

      // ═══════════════════════════════════════════════════════════════════════
      // INTERNAL
      // ═══════════════════════════════════════════════════════════════════════
      '/internal/heartbeat': {
        post: {
          operationId: 'agentHeartbeat',
          summary: 'Agent heartbeat',
          description: 'Called by the justavps-agent on each machine every 60s. Updates health metrics and can transition machines from `provisioning` to `ready`.',
          tags: ['Internal'],
          'x-codeSamples': [
            curl('POST', '/internal/heartbeat', '{"slug":"abc123","machine_token":"mt_xxx","uptime":3600,"services":{"code_server":true},"load":{"cpu":0.45,"memory":0.62,"disk":0.31}}'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['slug', 'machine_token', 'uptime', 'services', 'load'],
                  properties: {
                    slug: { type: 'string', example: 'abc123' },
                    machine_token: { type: 'string' },
                    uptime: { type: 'number', description: 'Uptime in seconds' },
                    services: {
                      type: 'object',
                      additionalProperties: { type: 'boolean' },
                      example: { code_server: true, caddy: true },
                    },
                    load: {
                      type: 'object',
                      required: ['cpu', 'memory', 'disk'],
                      properties: {
                        cpu: { type: 'number' },
                        memory: { type: 'number' },
                        disk: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Heartbeat acknowledged', {
              type: 'object',
              properties: { ack: { type: 'boolean', example: true } },
            }),
            ...errorResponses(400, 401),
          },
        },
      },

      '/internal/stage': {
        post: {
          operationId: 'agentStageReport',
          summary: 'Report provisioning stage',
          description: 'Called by the machine agent to report provisioning progress.',
          tags: ['Internal'],
          'x-codeSamples': [
            curl('POST', '/internal/stage', '{"slug":"abc123","machine_token":"mt_xxx","stage":"docker_pulling","message":"Pulling nginx:latest"}'),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['slug', 'machine_token', 'stage'],
                  properties: {
                    slug: { type: 'string' },
                    machine_token: { type: 'string' },
                    stage: { type: 'string', example: 'docker_pulling' },
                    message: { type: 'string' },
                    metadata: { type: 'object', additionalProperties: {} },
                  },
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Stage acknowledged', {
              type: 'object',
              properties: { ack: { type: 'boolean' } },
            }),
            ...errorResponses(400, 401),
          },
        },
      },

      '/internal/validate-key': {
        get: {
          operationId: 'validateAPIKey',
          summary: 'Validate API key',
          description: 'Called by the Cloudflare Worker to validate API keys at the edge. IP-restricted.',
          tags: ['Internal'],
          'x-codeSamples': [
            curl('GET', '/internal/validate-key?key=sk_live_xxx&machine_slug=abc123'),
          ],
          parameters: [
            QueryParam('key', 'API key to validate', { required: true }),
            QueryParam('machine_slug', 'Machine slug to check ownership'),
          ],
          responses: {
            '200': jsonResponse('Validation result', {
              type: 'object',
              properties: {
                valid: { type: 'boolean' },
                owner_id: { type: 'string', format: 'uuid' },
              },
            }),
            '401': jsonResponse('Invalid key', {
              type: 'object',
              properties: { valid: { type: 'boolean', example: false } },
            }),
            '403': jsonResponse('Key does not own machine', {
              type: 'object',
              properties: { valid: { type: 'boolean', example: false }, message: { type: 'string' } },
            }),
          },
        },
      },
    },

    components: {
      schemas: {
        Machine,
        MachineURLs,
        MachineSSHKey,
        MachineConnect,
        MachineHealth,
        MachineHealthServices,
        Snapshot,
        ProviderArtifact,
        SSHKey,
        APIKey,
        ServerType,
        Provider,
        Region,
        Webhook,
        Account,
        AccountUsage,
        BillingPortal,
        Error: ErrorResponse,
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key (e.g. `sk_live_abc123...`). Create at justavps.com/settings.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'authjs.session-token',
          description: 'Session cookie set by the dashboard login flow.',
        },
      },
    },
  };
}
