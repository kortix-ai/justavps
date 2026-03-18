import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { sshKeys } from '../../db/schema';
import { fingerprintSSHKey } from '../../lib/crypto';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { broadcastToProviders } from '../../lib/provider-sync';
import { handleRouteError } from '../../lib/route-helpers';
import {
  CreateSSHKeySchema,
  SSHKeyResponseSchema,
  SSHKeyListResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const sshKeysApp = new OpenAPIHono<{ Variables: AuthVariables }>();
sshKeysApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

// ─── POST / — Create SSH Key ────────────────────────────────────────────────

const createSSHKeyRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['SSH Keys'],
  security: bearerSecurity,
  summary: 'Add an SSH key',
  description: 'Registers a new SSH public key. Automatically uploaded to all providers.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateSSHKeySchema } },
    },
  },
  responses: {
    201: {
      description: 'SSH key added',
      content: { 'application/json': { schema: SSHKeyResponseSchema } },
    },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

sshKeysApp.openapi(createSSHKeyRoute, async (c) => {
  const { name, public_key } = c.req.valid('json');
  const ownerId = c.get('userId');
  try {
    const fingerprint = fingerprintSSHKey(public_key);

    const uploaded = await broadcastToProviders(
      (provider) => provider.uploadSSHKey(`justavps-${name}`, public_key),
      'SSH-KEYS',
    );
    const providerKeyId = uploaded?.result.keyId ?? null;

    const [key] = await db.insert(sshKeys).values({
      ownerId,
      name,
      publicKey: public_key,
      fingerprint,
      providerKeyId,
    }).returning();

    return c.json({ id: key.id, name: key.name, fingerprint: key.fingerprint, created_at: key.createdAt.toISOString() }, 201);
  } catch (err) {
    return handleRouteError(c, err, 'SSH-KEYS') as any;
  }
});

// ─── GET / — List SSH Keys ──────────────────────────────────────────────────

const listSSHKeysRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['SSH Keys'],
  security: bearerSecurity,
  summary: 'List SSH keys',
  description: 'Returns all SSH public keys registered by the authenticated user.',
  responses: {
    200: {
      description: 'List of SSH keys',
      content: { 'application/json': { schema: SSHKeyListResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

sshKeysApp.openapi(listSSHKeysRoute, async (c) => {
  const ownerId = c.get('userId');
  const keys = await db.select().from(sshKeys).where(eq(sshKeys.ownerId, ownerId));
  return c.json({ ssh_keys: keys.map((k) => ({ id: k.id, name: k.name, fingerprint: k.fingerprint, created_at: k.createdAt.toISOString() })) }, 200);
});

// ─── DELETE /:id — Delete SSH Key ───────────────────────────────────────────

const deleteSSHKeyRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['SSH Keys'],
  security: bearerSecurity,
  summary: 'Delete an SSH key',
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: 'SSH Key ID' }) }),
  },
  responses: {
    204: { description: 'SSH key deleted' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

sshKeysApp.openapi(deleteSSHKeyRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ownerId = c.get('userId');
  const [key] = await db.select().from(sshKeys).where(and(eq(sshKeys.id, id), eq(sshKeys.ownerId, ownerId)));
  if (!key) return c.json({ error: true, message: 'SSH key not found', status: 404 }, 404);
  try {
    if (key.providerKeyId) {
      await broadcastToProviders(
        (provider) => provider.deleteSSHKey(key.providerKeyId!),
        'SSH-KEYS',
      );
    }
    await db.delete(sshKeys).where(eq(sshKeys.id, id));
    return c.body(null, 204);
  } catch (err) {
    return handleRouteError(c, err, 'SSH-KEYS') as any;
  }
});
