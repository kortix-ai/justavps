/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import {
  cancelMachineV2,
  createMachineV2,
  deleteMachineV2,
  getMachineV2,
  listMachinesV2,
  reactivateMachineV2,
  rebootMachineV2,
  startMachineV2,
  stopMachineV2,
} from '../../lib/v2/machines';
import { handleRouteError } from '../../lib/route-helpers';

export const machinesV2App = new OpenAPIHono<{ Variables: AuthVariables }>();
machinesV2App.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

const MachineV2Schema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['provisioning', 'ready', 'error', 'stopped', 'deleted']),
  provisioning_stage: z.string().nullable(),
  provisioning_stage_updated_at: z.string().nullable(),
  api_version: z.literal('v2'),
  region: z.string(),
  resources: z.object({
    vcpu: z.number(),
    ram_gb: z.number(),
    disk_gb: z.number(),
  }),
  billing: z.object({
    mode: z.literal('flat_monthly'),
    price_monthly: z.number().nullable(),
    current_period_end: z.string().nullable(),
  }),
  image: z.any().nullable(),
  connectivity: z.object({
    public_ip: z.string().nullable(),
    private_ipv4: z.string().nullable(),
    ssh_command: z.string().nullable(),
    ssh_port: z.number().nullable(),
    urls: z.object({
      proxy: z.string(),
      terminal: z.string(),
      port_template: z.string(),
    }).nullable(),
  }),
  capabilities: z.object({
    can_start: z.boolean(),
    can_stop: z.boolean(),
    can_reboot: z.boolean(),
    can_resize: z.boolean(),
    can_snapshot: z.boolean(),
    can_create_image: z.boolean(),
  }),
  health: z.any().nullable(),
  provider_progress: z.number().nullable(),
  provider_status: z.string().nullable(),
  callback_expected: z.boolean().nullable(),
  callback_url: z.string().nullable(),
  created_at: z.string(),
  ready_at: z.string().nullable(),
});

const MachineCreateV2Schema = z.object({
  // Resources — the core of V2. No preset plans required.
  vcpu: z.number().int().min(1).max(128).default(2),
  ram_gb: z.number().int().min(1).max(512).default(4),
  disk_gb: z.number().int().min(10).max(2000).default(80),
  host_id: z.string().uuid().optional(),
  region: z.string().min(1).optional().default('hel1'),
  name: z.string().min(1).max(64).optional(),
  image_id: z.string().optional().nullable(),
  env_vars: z.record(z.string(), z.string()).optional(),
  cloud_init_script: z.string().optional(),
  ssh_key_ids: z.array(z.string().uuid()).optional(),
  enable_backups: z.boolean().optional().default(false),
});

// @ts-expect-error mixed success/error response typing
machinesV2App.openapi(createRoute({
  method: 'get',
  path: '/',
  tags: ['Machines V2'],
  security: bearerSecurity,
  summary: 'List machines',
  responses: {
    200: { description: 'Machine list', content: { 'application/json': { schema: z.object({ machines: z.array(MachineV2Schema) }) } } },
  },
}), async (c) => {
  try {
    const machines = await listMachinesV2({ accountId: c.get('accountId') });
    return c.json({ machines });
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
machinesV2App.openapi(createRoute({
  method: 'post',
  path: '/',
  tags: ['Machines V2'],
  security: bearerSecurity,
  summary: 'Create machine',
  request: { body: { required: true, content: { 'application/json': { schema: MachineCreateV2Schema } } } },
  responses: {
    202: { description: 'Machine provisioning started', content: { 'application/json': { schema: MachineV2Schema } } },
    402: { description: 'Checkout required', content: { 'application/json': { schema: z.object({ requires_checkout: z.literal(true), checkout_url: z.string(), message: z.string() }) } } },
  },
}), async (c) => {
  try {
    const result = await createMachineV2({
      accountId: c.get('accountId'),
      userId: c.get('userId'),
      isAdmin: c.get('isAdmin'),
      requestUrl: c.req.url,
      input: c.req.valid('json'),
    });
    if (result.kind === 'checkout') return c.json(result, 402);
    return c.json(result.machine, 202);
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
machinesV2App.openapi(createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Machines V2'],
  security: bearerSecurity,
  summary: 'Get machine',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Machine', content: { 'application/json': { schema: MachineV2Schema } } } },
}), async (c) => {
  try {
    return c.json(await getMachineV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').id }));
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES-V2') as Response;
  }
});

for (const action of ['start', 'stop', 'reboot'] as const) {
  const fn = action === 'start' ? startMachineV2 : action === 'stop' ? stopMachineV2 : rebootMachineV2;
  // @ts-expect-error mixed success/error response typing
  machinesV2App.openapi(createRoute({
    method: 'post',
    path: `/{id}/${action}`,
    tags: ['Machines V2'],
    security: bearerSecurity,
    summary: `${action} machine`,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: `${action} ok`, content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
  }), async (c) => {
    try {
      return c.json(await fn({ accountId: c.get('accountId'), machineId: c.req.valid('param').id }));
    } catch (err) {
      return handleRouteError(c, err, 'MACHINES-V2') as Response;
    }
  });
}

// @ts-expect-error mixed success/error response typing
machinesV2App.openapi(createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Machines V2'],
  security: bearerSecurity,
  summary: 'Delete machine',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
}), async (c) => {
  try {
    return c.json(await deleteMachineV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').id }));
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
machinesV2App.openapi(createRoute({
  method: 'post',
  path: '/{id}/cancel',
  tags: ['Machines V2'],
  security: bearerSecurity,
  summary: 'Cancel machine subscription',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Cancellation scheduled', content: { 'application/json': { schema: z.object({ action: z.literal('cancel'), status: z.string() }) } } } },
}), async (c) => {
  try {
    return c.json(await cancelMachineV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').id }));
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES-V2') as Response;
  }
});

// @ts-expect-error mixed success/error response typing
machinesV2App.openapi(createRoute({
  method: 'post',
  path: '/{id}/reactivate',
  tags: ['Machines V2'],
  security: bearerSecurity,
  summary: 'Reactivate machine subscription',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: 'Subscription reactivated', content: { 'application/json': { schema: z.object({ action: z.literal('reactivate'), status: z.string() }) } } } },
}), async (c) => {
  try {
    return c.json(await reactivateMachineV2({ accountId: c.get('accountId'), machineId: c.req.valid('param').id }));
  } catch (err) {
    return handleRouteError(c, err, 'MACHINES-V2') as Response;
  }
});
