#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Generate OpenAPI 3.1 spec from Zod schemas (SINGLE SOURCE OF TRUTH).
 *
 * - Schemas come from src/lib/schemas.ts (Zod → JSON Schema via zod-to-json-schema)
 * - Route map is defined here (path + method + operationId + which schemas apply)
 * - SDK code samples are auto-injected per operationId
 *
 * Usage: pnpm tsx scripts/extract-openapi.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { type ZodType } from 'zod';
import {
  // Machine
  CreateMachineSchema, ResizeMachineSchema, CreateImageSchema,
  MachineResponseSchema, MachineListResponseSchema,
  CheckoutRequiredSchema, ActionResponseSchema, ResizeResponseSchema,
  // Image
  ImageResponseSchema, ImageListResponseSchema,
  // SSH Keys
  CreateSSHKeySchema, SSHKeyResponseSchema, SSHKeyListResponseSchema,
  // API Keys
  CreateAPIKeySchema, APIKeyResponseSchema, APIKeyListResponseSchema,
  // Webhooks
  CreateWebhookSchema, WebhookResponseSchema, WebhookListResponseSchema,
  // Server Types
  ServerTypeResponseSchema, ServerTypeListResponseSchema,
  ProviderSchema, ProviderListResponseSchema,
  RegionSchema, RegionListResponseSchema,
  // Account
  AccountResponseSchema, AccountUsageResponseSchema,
  BillingResponseSchema, BillingSetupResponseSchema,
  // Internal
  HeartbeatSchema, StageReportSchema,
  AckResponseSchema, ValidateKeyResponseSchema,
  // Error
  ErrorResponseSchema,
} from '../src/lib/schemas';

// ─── Convert Zod schemas to JSON Schema ────────────────────────────────────

function zod(schema: ZodType): any {
  const jsonSchema = (schema as any).toJSONSchema();
  // Strip $schema — OpenAPI 3.1 doesn't need it at component level
  const { $schema, ...rest } = jsonSchema;
  return rest;
}

function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonResponse(description: string, schema: any) {
  return { description, content: { 'application/json': { schema } } };
}

function errorResponses(...codes: number[]) {
  const map: Record<number, string> = {
    400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required',
    403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
    500: 'Internal Server Error', 503: 'Service Unavailable',
  };
  const result: any = {};
  for (const code of codes) {
    result[String(code)] = jsonResponse(map[code] || `Error ${code}`, ref('Error'));
  }
  return result;
}

const uuidParam = (name: string, description: string) => ({
  name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' },
});

const queryParam = (name: string, description: string, opts?: { required?: boolean; default?: string }) => ({
  name, in: 'query', required: opts?.required ?? false, description,
  schema: { type: 'string', ...(opts?.default ? { default: opts.default } : {}) },
});

const bearerSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];

// ─── Build the spec ────────────────────────────────────────────────────────

const spec: any = {
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
  paths: {
    // ═══ MACHINES ═══════════════════════════════════════════════════════════
    '/machines': {
      get: {
        operationId: 'listMachines', summary: 'List machines', tags: ['Machines'], security: bearerSecurity,
        description: 'Returns all non-deleted machines owned by the authenticated user.',
        responses: { '200': jsonResponse('List of machines', ref('MachineListResponse')), ...errorResponses(401) },
      },
      post: {
        operationId: 'createMachine', summary: 'Create a machine', tags: ['Machines'], security: bearerSecurity,
        description: 'Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots from Ubuntu 24.04.\n\nReturns 202 if provisioning starts immediately (user has payment method), or 402 with a `checkout_url` if payment is required first.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('CreateMachine') } } },
        responses: {
          '202': jsonResponse('Machine provisioning started', ref('Machine')),
          '402': jsonResponse('Payment required — redirect to checkout', ref('CheckoutRequired')),
          ...errorResponses(400, 404),
        },
      },
    },
    '/machines/{id}': {
      get: {
        operationId: 'getMachine', summary: 'Get a machine', tags: ['Machines'], security: bearerSecurity,
        description: 'Returns full details of a machine including connection info, health metrics, and SSH keys.',
        parameters: [uuidParam('id', 'Machine ID')],
        responses: { '200': jsonResponse('Machine details', ref('Machine')), ...errorResponses(401, 404) },
      },
      delete: {
        operationId: 'destroyMachine', summary: 'Delete a machine', tags: ['Machines'], security: bearerSecurity,
        description: 'Permanently destroys the machine, removes DNS records, cancels billing, and deletes the provider server. **Irreversible.**',
        parameters: [uuidParam('id', 'Machine ID')],
        responses: { '204': { description: 'Machine deleted' }, ...errorResponses(401, 404) },
      },
    },
    '/machines/{id}/reboot': {
      post: {
        operationId: 'rebootMachine', summary: 'Reboot a machine', tags: ['Machines'], security: bearerSecurity,
        description: 'Initiates a hard reboot via the provider API (~30s downtime).',
        parameters: [uuidParam('id', 'Machine ID')],
        responses: { '202': jsonResponse('Reboot initiated', ref('ActionResponse')), ...errorResponses(401, 404) },
      },
    },
    '/machines/{id}/resize': {
      post: {
        operationId: 'resizeMachine', summary: 'Resize a machine', tags: ['Machines'], security: bearerSecurity,
        description: 'Changes the machine to a different server type. Requires reboot (~30s downtime). Billing is prorated.',
        parameters: [uuidParam('id', 'Machine ID')],
        requestBody: { required: true, content: { 'application/json': { schema: ref('ResizeMachine') } } },
        responses: { '202': jsonResponse('Resize initiated', ref('ResizeResponse')), ...errorResponses(400, 401, 404) },
      },
    },
    '/machines/{id}/image': {
      post: {
        operationId: 'createImageFromMachine', summary: 'Create image from machine', tags: ['Machines', 'Images'], security: bearerSecurity,
        description: 'Creates a point-in-time image (snapshot) from a running machine. Machine must be in `ready` status. Returns 202 — poll `GET /images/{id}` until status is `ready`.',
        parameters: [uuidParam('id', 'Machine ID')],
        requestBody: { required: true, content: { 'application/json': { schema: ref('CreateImage') } } },
        responses: { '202': jsonResponse('Image creation started', ref('Image')), ...errorResponses(400, 401, 404) },
      },
    },
    '/machines/{id}/status/stream': {
      get: {
        operationId: 'streamMachineStatus', summary: 'Stream machine status (SSE)', tags: ['Events'], security: bearerSecurity,
        description: 'Opens a Server-Sent Events stream for real-time provisioning updates.\n\n**Event types:** `status`, `stage`, `done`, `ping`, `error`\n\nAuto-closes on terminal state or after 10 minutes.',
        parameters: [uuidParam('id', 'Machine ID')],
        responses: { '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }, ...errorResponses(401, 404) },
      },
    },

    // ═══ IMAGES ═════════════════════════════════════════════════════════════
    '/images': {
      get: {
        operationId: 'listImages', summary: 'List images', tags: ['Images'], security: bearerSecurity,
        description: 'Returns all non-deleted images owned by the authenticated user.',
        responses: { '200': jsonResponse('List of images', ref('ImageListResponse')), ...errorResponses(401) },
      },
    },
    '/images/{id}': {
      get: {
        operationId: 'getImage', summary: 'Get an image', tags: ['Images'], security: bearerSecurity,
        description: 'Returns image details including status and provider artifact info.',
        parameters: [uuidParam('id', 'Image ID')],
        responses: { '200': jsonResponse('Image details', ref('Image')), ...errorResponses(401, 404) },
      },
      delete: {
        operationId: 'deleteImage', summary: 'Delete an image', tags: ['Images'], security: bearerSecurity,
        description: 'Deletes the image and its provider-side artifact.',
        parameters: [uuidParam('id', 'Image ID')],
        responses: { '204': { description: 'Image deleted' }, ...errorResponses(401, 404) },
      },
    },

    // ═══ SSH KEYS ═══════════════════════════════════════════════════════════
    '/ssh-keys': {
      get: {
        operationId: 'listSSHKeys', summary: 'List SSH keys', tags: ['SSH Keys'], security: bearerSecurity,
        description: 'Returns all SSH public keys registered by the authenticated user.',
        responses: { '200': jsonResponse('List of SSH keys', ref('SSHKeyListResponse')), ...errorResponses(401) },
      },
      post: {
        operationId: 'createSSHKey', summary: 'Add an SSH key', tags: ['SSH Keys'], security: bearerSecurity,
        description: 'Registers a new SSH public key. Automatically uploaded to all providers.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('CreateSSHKey') } } },
        responses: { '201': jsonResponse('SSH key added', ref('SSHKey')), ...errorResponses(400, 401) },
      },
    },
    '/ssh-keys/{id}': {
      delete: {
        operationId: 'deleteSSHKey', summary: 'Delete an SSH key', tags: ['SSH Keys'], security: bearerSecurity,
        parameters: [uuidParam('id', 'SSH Key ID')],
        responses: { '204': { description: 'SSH key deleted' }, ...errorResponses(401, 404) },
      },
    },

    // ═══ API KEYS ═══════════════════════════════════════════════════════════
    '/api-keys': {
      get: {
        operationId: 'listAPIKeys', summary: 'List API keys', tags: ['API Keys'], security: bearerSecurity,
        description: 'Returns all API keys. Full key value is never returned after creation.',
        responses: { '200': jsonResponse('List of API keys', ref('APIKeyListResponse')), ...errorResponses(401) },
      },
      post: {
        operationId: 'createAPIKey', summary: 'Create an API key', tags: ['API Keys'], security: bearerSecurity,
        description: '**The full key is only returned once in this response.** Store it securely.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('CreateAPIKey') } } },
        responses: { '201': jsonResponse('API key created', ref('APIKey')), ...errorResponses(400, 401) },
      },
    },
    '/api-keys/{id}': {
      delete: {
        operationId: 'deleteAPIKey', summary: 'Delete an API key', tags: ['API Keys'], security: bearerSecurity,
        description: 'Permanently revokes the API key. Requests using it will immediately fail.',
        parameters: [uuidParam('id', 'API Key ID')],
        responses: { '204': { description: 'API key deleted' }, ...errorResponses(401, 404) },
      },
    },

    // ═══ WEBHOOKS ═══════════════════════════════════════════════════════════
    '/webhooks': {
      get: {
        operationId: 'listWebhooks', summary: 'List webhooks', tags: ['Webhooks'], security: bearerSecurity,
        responses: { '200': jsonResponse('List of webhooks', ref('WebhookListResponse')), ...errorResponses(401) },
      },
      post: {
        operationId: 'createWebhook', summary: 'Create a webhook', tags: ['Webhooks'], security: bearerSecurity,
        description: 'Subscribes a URL to receive POST requests for specified events. Payloads are signed with HMAC-SHA256 (`X-Signature-256` header).\n\n**Events:** `*`, `machine.stage_changed`, `machine.status_changed`, `machine.heartbeat`',
        requestBody: { required: true, content: { 'application/json': { schema: ref('CreateWebhook') } } },
        responses: { '201': jsonResponse('Webhook created (secret shown once)', ref('Webhook')), ...errorResponses(400, 401) },
      },
    },
    '/webhooks/{id}': {
      delete: {
        operationId: 'deleteWebhook', summary: 'Delete a webhook', tags: ['Webhooks'], security: bearerSecurity,
        parameters: [uuidParam('id', 'Webhook ID')],
        responses: { '204': { description: 'Webhook deleted' }, ...errorResponses(401, 404) },
      },
    },

    // ═══ SERVER TYPES ═══════════════════════════════════════════════════════
    '/server-types': {
      get: {
        operationId: 'listServerTypes', summary: 'List server types', tags: ['Server Types'],
        description: 'Returns available server types for a provider + region, with pricing.',
        parameters: [
          queryParam('provider', 'Cloud provider', { default: 'hetzner' }),
          queryParam('region', 'Region ID (e.g. nbg1)', { required: true }),
        ],
        responses: { '200': jsonResponse('Available server types', ref('ServerTypeListResponse')), ...errorResponses(400) },
      },
    },
    '/server-types/providers': {
      get: {
        operationId: 'listProviders', summary: 'List providers', tags: ['Server Types'],
        responses: { '200': jsonResponse('Available providers', ref('ProviderListResponse')) },
      },
    },
    '/server-types/regions': {
      get: {
        operationId: 'listRegions', summary: 'List regions', tags: ['Server Types'],
        parameters: [queryParam('provider', 'Cloud provider', { default: 'hetzner' })],
        responses: { '200': jsonResponse('Available regions', ref('RegionListResponse')), ...errorResponses(400) },
      },
    },

    // ═══ ACCOUNT ════════════════════════════════════════════════════════════
    '/account': {
      get: {
        operationId: 'getAccount', summary: 'Get account info', tags: ['Account'], security: bearerSecurity,
        responses: { '200': jsonResponse('Account details', ref('Account')), ...errorResponses(401, 404) },
      },
    },
    '/account/usage': {
      get: {
        operationId: 'getAccountUsage', summary: 'Get usage stats', tags: ['Account'], security: bearerSecurity,
        description: 'Returns current billing period usage including active machines and estimated cost.',
        responses: { '200': jsonResponse('Usage statistics', ref('AccountUsage')), ...errorResponses(401) },
      },
    },
    '/account/billing': {
      get: {
        operationId: 'getBilling', summary: 'Get billing info', tags: ['Account'], security: bearerSecurity,
        description: 'Returns Stripe billing portal URL and payment method status.',
        responses: { '200': jsonResponse('Billing info', ref('Billing')), ...errorResponses(401) },
      },
    },
    '/account/billing/setup': {
      post: {
        operationId: 'createBillingSetup', summary: 'Create billing setup session', tags: ['Account'], security: bearerSecurity,
        description: 'Creates a Stripe Checkout Session in setup mode to add a payment method.',
        responses: { '200': jsonResponse('Checkout URL', ref('BillingSetup')), ...errorResponses(401, 404, 503) },
      },
    },

    // ═══ INTERNAL ═══════════════════════════════════════════════════════════
    '/internal/heartbeat': {
      post: {
        operationId: 'machineHeartbeat', summary: 'Agent heartbeat', tags: ['Internal'],
        description: 'Called by the justavps-agent on each machine every 60s. Authenticated via `machine_token` in body.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('Heartbeat') } } },
        responses: { '200': jsonResponse('Acknowledged', ref('Ack')), ...errorResponses(400, 401, 500) },
      },
    },
    '/internal/stage': {
      post: {
        operationId: 'reportProvisioningStage', summary: 'Report provisioning stage', tags: ['Internal'],
        description: 'Called by the machine agent to report provisioning progress.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('StageReport') } } },
        responses: { '200': jsonResponse('Acknowledged', ref('Ack')), ...errorResponses(400, 401, 500) },
      },
    },
    '/internal/validate-key': {
      get: {
        operationId: 'validateAPIKey', summary: 'Validate API key', tags: ['Internal'],
        description: 'Called by the Cloudflare Worker to validate API keys at the edge.',
        parameters: [
          queryParam('key', 'API key to validate', { required: true }),
          queryParam('machine_slug', 'Machine slug to check ownership'),
        ],
        responses: {
          '200': jsonResponse('Valid key', ref('ValidateKeyResponse')),
          '401': jsonResponse('Invalid key', ref('ValidateKeyResponse')),
          '403': jsonResponse('Key does not own machine', ref('ValidateKeyResponse')),
          ...errorResponses(400, 503),
        },
      },
    },
  },

  components: {
    schemas: {
      // Request schemas (from Zod)
      CreateMachine: zod(CreateMachineSchema),
      ResizeMachine: zod(ResizeMachineSchema),
      CreateImage: zod(CreateImageSchema),
      CreateSSHKey: zod(CreateSSHKeySchema),
      CreateAPIKey: zod(CreateAPIKeySchema),
      CreateWebhook: zod(CreateWebhookSchema),
      Heartbeat: zod(HeartbeatSchema),
      StageReport: zod(StageReportSchema),

      // Response schemas (from Zod)
      Machine: zod(MachineResponseSchema),
      MachineListResponse: zod(MachineListResponseSchema),
      CheckoutRequired: zod(CheckoutRequiredSchema),
      ActionResponse: zod(ActionResponseSchema),
      ResizeResponse: zod(ResizeResponseSchema),
      Image: zod(ImageResponseSchema),
      ImageListResponse: zod(ImageListResponseSchema),
      SSHKey: zod(SSHKeyResponseSchema),
      SSHKeyListResponse: zod(SSHKeyListResponseSchema),
      APIKey: zod(APIKeyResponseSchema),
      APIKeyListResponse: zod(APIKeyListResponseSchema),
      Webhook: zod(WebhookResponseSchema),
      WebhookListResponse: zod(WebhookListResponseSchema),
      ServerType: zod(ServerTypeResponseSchema),
      ServerTypeListResponse: zod(ServerTypeListResponseSchema),
      Provider: zod(ProviderSchema),
      ProviderListResponse: zod(ProviderListResponseSchema),
      Region: zod(RegionSchema),
      RegionListResponse: zod(RegionListResponseSchema),
      Account: zod(AccountResponseSchema),
      AccountUsage: zod(AccountUsageResponseSchema),
      Billing: zod(BillingResponseSchema),
      BillingSetup: zod(BillingSetupResponseSchema),
      Ack: zod(AckResponseSchema),
      ValidateKeyResponse: zod(ValidateKeyResponseSchema),
      Error: zod(ErrorResponseSchema),
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http', scheme: 'bearer',
        description: 'API key (e.g. `sk_live_abc123...`). Create at justavps.com/settings.',
      },
      cookieAuth: {
        type: 'apiKey', in: 'cookie', name: 'authjs.session-token',
        description: 'Session cookie set by the dashboard login flow.',
      },
    },
  },
};

// ─── Auto-inject SDK code samples ──────────────────────────────────────────

const sdkSamples: Record<string, { ts: string; py: string }> = {
  listMachines: {
    ts: `const { machines } = await client.machines.list();`,
    py: `response = list_machines.sync(client=client)`,
  },
  createMachine: {
    ts: `const machine = await client.machines.create({\n  provider: 'cloud',\n  server_type: 'pro',\n  region: 'hel1',\n});\nconst ready = await client.machines.waitForReady(machine.id);`,
    py: `body = CreateMachineBody(provider="cloud", server_type="pro", region="hel1")\nmachine = create_machine.sync(client=client, body=body)`,
  },
  getMachine: {
    ts: `const machine = await client.machines.get('machine-uuid');`,
    py: `machine = get_machine.sync(client=client, id="machine-uuid")`,
  },
  destroyMachine: {
    ts: `await client.machines.delete('machine-uuid');`,
    py: `delete_machine.sync_detailed(client=client, id="machine-uuid")`,
  },
  rebootMachine: {
    ts: `await client.machines.reboot('machine-uuid');`,
    py: `reboot_machine.sync(client=client, id="machine-uuid")`,
  },
  resizeMachine: {
    ts: `await client.machines.resize('machine-uuid', { server_type: 'power' });`,
    py: `body = ResizeMachineBody(server_type="power")\nresize_machine.sync(client=client, id="machine-uuid", body=body)`,
  },
  createImageFromMachine: {
    ts: `const image = await client.machines.createImage('machine-uuid', { name: 'my-backup' });`,
    py: `body = CreateImageBody(name="my-backup")\ncreate_image_from_machine.sync(client=client, id="machine-uuid", body=body)`,
  },
  streamMachineStatus: {
    ts: `for await (const event of client.machines.stream('machine-uuid')) {\n  if (event.type === 'done') break;\n}`,
    py: `stream_machine_status.sync_detailed(client=client, id="machine-uuid")`,
  },
  listImages: {
    ts: `const { images } = await client.images.list();`,
    py: `response = list_images.sync(client=client)`,
  },
  getImage: {
    ts: `const image = await client.images.get('image-uuid');`,
    py: `image = get_image.sync(client=client, id="image-uuid")`,
  },
  deleteImage: {
    ts: `await client.images.delete('image-uuid');`,
    py: `delete_image.sync_detailed(client=client, id="image-uuid")`,
  },
  listSSHKeys: {
    ts: `const { ssh_keys } = await client.sshKeys.list();`,
    py: `response = list_ssh_keys.sync(client=client)`,
  },
  createSSHKey: {
    ts: `const key = await client.sshKeys.create({ name: 'my-laptop', public_key: 'ssh-ed25519 AAAA...' });`,
    py: `body = CreateSshKeyBody(name="my-laptop", public_key="ssh-ed25519 AAAA...")\ncreate_ssh_key.sync(client=client, body=body)`,
  },
  deleteSSHKey: {
    ts: `await client.sshKeys.delete('key-uuid');`,
    py: `delete_ssh_key.sync_detailed(client=client, id="key-uuid")`,
  },
  listAPIKeys: {
    ts: `const { api_keys } = await client.apiKeys.list();`,
    py: `response = list_api_keys.sync(client=client)`,
  },
  createAPIKey: {
    ts: `const apiKey = await client.apiKeys.create({ name: 'production' });\nconsole.log(apiKey.key); // Only shown once!`,
    py: `body = CreateApiKeyBody(name="production")\napi_key = create_api_key.sync(client=client, body=body)`,
  },
  deleteAPIKey: {
    ts: `await client.apiKeys.delete('key-uuid');`,
    py: `delete_api_key.sync_detailed(client=client, id="key-uuid")`,
  },
  listWebhooks: {
    ts: `const { webhooks } = await client.webhooks.list();`,
    py: `response = list_webhooks.sync(client=client)`,
  },
  createWebhook: {
    ts: `const webhook = await client.webhooks.create({\n  url: 'https://example.com/hook',\n  events: ['machine.status_changed'],\n});`,
    py: `body = CreateWebhookBody(url="https://example.com/hook", events=["machine.status_changed"])\nwebhook = create_webhook.sync(client=client, body=body)`,
  },
  deleteWebhook: {
    ts: `await client.webhooks.delete('webhook-uuid');`,
    py: `delete_webhook.sync_detailed(client=client, id="webhook-uuid")`,
  },
  listServerTypes: {
    ts: `const { server_types } = await client.serverTypes.list('nbg1');`,
    py: `response = list_server_types.sync(client=client, region="nbg1")`,
  },
  listProviders: {
    ts: `const { providers } = await client.serverTypes.providers();`,
    py: `response = list_providers.sync(client=client)`,
  },
  listRegions: {
    ts: `const { regions } = await client.serverTypes.regions('cloud');`,
    py: `response = list_regions.sync(client=client, provider="cloud")`,
  },
  getAccount: {
    ts: `const account = await client.account.get();`,
    py: `account = get_account.sync(client=client)`,
  },
  getAccountUsage: {
    ts: `const usage = await client.account.usage();`,
    py: `usage = get_account_usage.sync(client=client)`,
  },
  getBilling: {
    ts: `const billing = await client.account.billing();`,
    py: `billing = get_billing.sync(client=client)`,
  },
  createBillingSetup: {
    ts: `const { checkout_url } = await client.account.billingSetup();`,
    py: `response = create_billing_setup.sync(client=client)`,
  },
};

function injectSDKSamples() {
  const tsHeader = `import { JustAVPS } from '@justavps/sdk';\n\nconst client = new JustAVPS({ apiKey: 'sk_live_YOUR_KEY' });\n\n`;
  const pyHeader = (tag: string, fn: string) =>
    `from just_avps_api_client import AuthenticatedClient\nfrom just_avps_api_client.api.${tag} import ${fn}\n\nclient = AuthenticatedClient(base_url="https://justavps.com/api/v1", token="sk_live_YOUR_KEY")\n\n`;

  for (const pathItem of Object.values(spec.paths)) {
    for (const op of Object.values(pathItem as any)) {
      if (!op || typeof op !== 'object' || !(op as any).operationId) continue;
      const operation = op as any;
      const sample = sdkSamples[operation.operationId];
      if (!sample) continue;

      const tag = (operation.tags?.[0] || 'default').toLowerCase().replace(/\s+/g, '_');
      const pyFn = operation.operationId.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');

      operation['x-codeSamples'] = [
        { lang: 'JavaScript', label: '@justavps/sdk', source: tsHeader + sample.ts },
        { lang: 'Python', label: 'justavps (PyPI)', source: pyHeader(tag, pyFn) + sample.py },
      ];
    }
  }
}

injectSDKSamples();

// ─── Write output ──────────────────────────────────────────────────────────

const outPath = join(process.cwd(), 'src', 'sdk', 'openapi.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');

// Stats
const allOps: string[] = [];
for (const pathItem of Object.values(spec.paths)) {
  for (const op of Object.values(pathItem as any)) {
    if ((op as any)?.operationId) allOps.push((op as any).operationId);
  }
}
const covered = allOps.filter(id => sdkSamples[id]);
const uncovered = allOps.filter(id => !sdkSamples[id]);

console.log(`✓ OpenAPI spec written to ${outPath}`);
console.log(`  ${Object.keys(spec.paths).length} paths, ${allOps.length} operations, ${Object.keys(spec.components.schemas).length} schemas`);
console.log(`  ${covered.length}/${allOps.length} operations have SDK samples`);
if (uncovered.length > 0) console.log(`  ⚠ Missing: ${uncovered.join(', ')}`);
console.log(`  📐 All schemas derived from Zod (single source of truth)`);
