/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Toolbox routes — authenticated proxy to daemon's /toolbox/* endpoints.
 *
 * Every route:
 *   1. Validates the user owns the machine
 *   2. Proxies the request to the daemon via origin DNS hostname
 *   3. Returns the daemon's response with full OpenAPI typing
 *
 * Mounted at /machines/:machineId/toolbox/...
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { machines } from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { config } from '../../lib/config';
import { errorResponse, handleRouteError } from '../../lib/route-helpers';
import {
  // Filesystem
  ListFilesResponseSchema,
  FileEntrySchema,
  FileExistsResponseSchema,
  UploadFileResponseSchema,
  BulkDownloadRequestSchema,
  CreateFolderResponseSchema,
  DeleteFileResponseSchema,
  MoveFileResponseSchema,
  FindTextResponseSchema,
  ReplaceTextRequestSchema,
  ReplaceTextResponseSchema,
  SetPermissionsRequestSchema,
  SetPermissionsResponseSchema,
  // Process
  ExecuteCommandRequestSchema,
  ExecuteCommandResponseSchema,
  CodeRunRequestSchema,
  ListProcessesResponseSchema,
  KillProcessRequestSchema,
  KillProcessResponseSchema,
  // Shared
  ToolboxErrorSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';

export const toolboxApp = new OpenAPIHono<{ Variables: AuthVariables }>();

toolboxApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve machine by ID, verify ownership, ensure it's ready and has an IP.
 */
async function resolveMachine(c: any, machineId: string, accountId: string) {
  const [machine] = await db.select().from(machines).where(eq(machines.id, machineId));
  if (!machine || machine.accountId !== accountId) {
    return { error: errorResponse(c, 404, 'Machine not found') };
  }
  if (machine.status !== 'ready') {
    return { error: errorResponse(c, 400, `Machine is not ready (status: ${machine.status})`) };
  }
  if (!machine.ip) {
    return { error: errorResponse(c, 400, 'Machine has no IP address') };
  }
  return { machine };
}

/**
 * Proxy a JSON request to the daemon's toolbox endpoint.
 * Uses the origin DNS hostname (origin-slug.domain) to reach the VPS,
 * making this IP-version-agnostic (works with both IPv4 and IPv6).
 */
async function proxyToToolbox(
  machineSlug: string,
  method: string,
  daemonPath: string,
  body?: any,
  headers?: Record<string, string>,
): Promise<Response> {
  // Toolbox routes are served by ProxyRouter on port 80 (the main daemon port)
  // Use origin hostname (DNS-only record) to resolve the VPS address directly
  const originHost = `origin-${machineSlug}.${config.PROXY_DOMAIN}`;
  const url = `http://${originHost}${daemonPath}`;
  const opts: RequestInit = {
    method,
    headers: { ...headers },
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    if (typeof body === 'string' || body instanceof ArrayBuffer || body instanceof Uint8Array) {
      opts.body = body as any;
    } else {
      opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
  }

  const resp = await fetch(url, opts);
  return resp;
}

/**
 * Standard proxy handler: resolve machine → proxy GET/POST → return JSON.
 */
async function proxyJSON(c: any, machineId: string, accountId: string, method: string, daemonPath: string, body?: any) {
  const result = await resolveMachine(c, machineId, accountId);
  if ('error' in result) return result.error;

  try {
    const resp = await proxyToToolbox(result.machine.slug, method, daemonPath, body);
    const data = await resp.json();
    return c.json(data, resp.status as any);
  } catch (err) {
    return handleRouteError(c, err, 'Toolbox proxy');
  }
}

// Helper for machine ID param
const machineIdParam = z.object({
  machineId: z.string().uuid().openapi({ description: 'Machine ID', example: '550e8400-e29b-41d4-a716-446655440000' }),
});

// ═════════════════════════════════════════════════════════════════════════════
//  FILESYSTEM ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── GET /:machineId/toolbox/files — List files ──────────────────────────────

const listFilesRoute = createRoute({
  method: 'get',
  path: '/{machineId}/toolbox/files',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'List files in a directory',
  description: 'Lists files and directories at the given path on the machine. Supports recursive listing via `depth` parameter.',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().optional().openapi({ description: 'Directory path (default: /root)', example: '/root' }),
      depth: z.string().optional().openapi({ description: 'Depth for recursive listing (default: 1)', example: '1' }),
    }),
  },
  responses: {
    200: { description: 'File listing', content: { 'application/json': { schema: ListFilesResponseSchema } } },
    404: { description: 'Path or machine not found', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(listFilesRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const query = c.req.valid('query');
  const params = new URLSearchParams();
  if (query.path) params.set('path', query.path);
  if (query.depth) params.set('depth', query.depth);
  return proxyJSON(c, machineId, accountId, 'GET', `/toolbox/files?${params}`) as any;
});

// ── GET /:machineId/toolbox/files/info — File info ──────────────────────────

const fileInfoRoute = createRoute({
  method: 'get',
  path: '/{machineId}/toolbox/files/info',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Get file or directory info',
  description: 'Returns metadata about a file or directory: name, size, permissions, owner, group, modification time.',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'File or directory path', example: '/root/main.go' }),
    }),
  },
  responses: {
    200: { description: 'File info', content: { 'application/json': { schema: FileEntrySchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(fileInfoRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const { path } = c.req.valid('query');
  return proxyJSON(c, machineId, accountId, 'GET', `/toolbox/files/info?path=${encodeURIComponent(path)}`) as any;
});

// ── GET /:machineId/toolbox/files/exists — Check exists ─────────────────────

const fileExistsRoute = createRoute({
  method: 'get',
  path: '/{machineId}/toolbox/files/exists',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Check if file or directory exists',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'Path to check', example: '/root/.bashrc' }),
    }),
  },
  responses: {
    200: { description: 'Existence check result', content: { 'application/json': { schema: FileExistsResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(fileExistsRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const { path } = c.req.valid('query');
  return proxyJSON(c, machineId, accountId, 'GET', `/toolbox/files/exists?path=${encodeURIComponent(path)}`) as any;
});

// ── GET /:machineId/toolbox/files/download — Download file ──────────────────

const downloadFileRoute = createRoute({
  method: 'get',
  path: '/{machineId}/toolbox/files/download',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Download a file',
  description: 'Downloads the raw content of a file. Returns the file with appropriate Content-Type and Content-Disposition headers.',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'File path to download', example: '/root/main.go' }),
    }),
  },
  responses: {
    200: { description: 'File content (binary)' },
    404: { description: 'File not found', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(downloadFileRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const { path } = c.req.valid('query');

  const result = await resolveMachine(c, machineId, accountId);
  if ('error' in result) return result.error as any;

  try {
    const resp = await proxyToToolbox(result.machine.slug, 'GET', `/toolbox/files/download?path=${encodeURIComponent(path)}`);
    if (!resp.ok) {
      const data = await resp.json();
      return c.json(data, resp.status as any);
    }
    // Stream the file through
    const headers = new Headers();
    const ct = resp.headers.get('Content-Type');
    const cd = resp.headers.get('Content-Disposition');
    const cl = resp.headers.get('Content-Length');
    if (ct) headers.set('Content-Type', ct);
    if (cd) headers.set('Content-Disposition', cd);
    if (cl) headers.set('Content-Length', cl);
    return new Response(resp.body, { status: 200, headers }) as any;
  } catch (err) {
    return handleRouteError(c, err, 'File download') as any;
  }
});

// ── POST /:machineId/toolbox/files/upload — Upload file ─────────────────────

const uploadFileRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/files/upload',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Upload a file',
  description: 'Uploads content to a file on the machine. Creates parent directories automatically. Supports raw body or multipart form upload.',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'Target file path', example: '/root/app.py' }),
      mode: z.string().optional().openapi({ description: 'File permissions (octal, default: "644")', example: '644' }),
      overwrite: z.string().optional().openapi({ description: 'Overwrite if exists (default: "true")', example: 'true' }),
    }),
  },
  responses: {
    200: { description: 'File uploaded', content: { 'application/json': { schema: UploadFileResponseSchema } } },
    409: { description: 'File exists and overwrite=false', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    413: { description: 'File too large', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(uploadFileRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const query = c.req.valid('query');

  const result = await resolveMachine(c, machineId, accountId);
  if ('error' in result) return result.error as any;

  try {
    const params = new URLSearchParams();
    params.set('path', query.path);
    if (query.mode) params.set('mode', query.mode);
    if (query.overwrite) params.set('overwrite', query.overwrite);

    const body = await c.req.arrayBuffer();
    const contentType = c.req.header('Content-Type') || 'application/octet-stream';
    const resp = await proxyToToolbox(
      result.machine.slug, 'POST',
      `/toolbox/files/upload?${params}`,
      body,
      { 'Content-Type': contentType },
    );
    const data = await resp.json();
    return c.json(data, resp.status as any);
  } catch (err) {
    return handleRouteError(c, err, 'File upload') as any;
  }
});

// ── POST /:machineId/toolbox/files/folder — Create directory ────────────────

const createFolderRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/files/folder',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Create a directory',
  description: 'Creates a directory recursively (like `mkdir -p`).',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'Directory path to create', example: '/root/project/src' }),
      mode: z.string().optional().openapi({ description: 'Directory permissions (octal, default: "755")', example: '755' }),
    }),
  },
  responses: {
    200: { description: 'Directory created', content: { 'application/json': { schema: CreateFolderResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(createFolderRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const query = c.req.valid('query');
  const params = new URLSearchParams();
  params.set('path', query.path);
  if (query.mode) params.set('mode', query.mode);
  return proxyJSON(c, machineId, accountId, 'POST', `/toolbox/files/folder?${params}`) as any;
});

// ── DELETE /:machineId/toolbox/files — Delete file or directory ─────────────

const deleteFileRoute = createRoute({
  method: 'delete',
  path: '/{machineId}/toolbox/files',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Delete a file or directory',
  description: 'Deletes a file or directory. For non-empty directories, `recursive=true` is required.',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'Path to delete', example: '/root/old-file.txt' }),
      recursive: z.string().optional().openapi({ description: 'Delete non-empty dirs recursively (default: false)', example: 'false' }),
    }),
  },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: DeleteFileResponseSchema } } },
    403: { description: 'Protected path', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(deleteFileRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const query = c.req.valid('query');
  const params = new URLSearchParams();
  params.set('path', query.path);
  if (query.recursive) params.set('recursive', query.recursive);
  return proxyJSON(c, machineId, accountId, 'DELETE', `/toolbox/files?${params}`) as any;
});

// ── POST /:machineId/toolbox/files/move — Move or rename ────────────────────

const moveFileRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/files/move',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Move or rename a file/directory',
  request: {
    params: machineIdParam,
    query: z.object({
      source: z.string().openapi({ description: 'Source path', example: '/root/old.txt' }),
      destination: z.string().openapi({ description: 'Destination path', example: '/root/new.txt' }),
    }),
  },
  responses: {
    200: { description: 'Moved', content: { 'application/json': { schema: MoveFileResponseSchema } } },
    404: { description: 'Source not found', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(moveFileRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const query = c.req.valid('query');
  return proxyJSON(c, machineId, accountId, 'POST', `/toolbox/files/move?source=${encodeURIComponent(query.source)}&destination=${encodeURIComponent(query.destination)}`) as any;
});

// ── GET /:machineId/toolbox/files/find — Search text ────────────────────────

const findTextRoute = createRoute({
  method: 'get',
  path: '/{machineId}/toolbox/files/find',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Search text in files',
  description: 'Recursively searches for a regex pattern in files under the given path. Like `grep -rn`.',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'Directory to search in', example: '/root/project' }),
      pattern: z.string().openapi({ description: 'Regex pattern to match', example: 'TODO|FIXME' }),
      include: z.string().optional().openapi({ description: 'Glob filter for filenames', example: '*.go' }),
      max_results: z.string().optional().openapi({ description: 'Max matches to return (default: 100)', example: '100' }),
    }),
  },
  responses: {
    200: { description: 'Search results', content: { 'application/json': { schema: FindTextResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(findTextRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const query = c.req.valid('query');
  const params = new URLSearchParams();
  params.set('path', query.path);
  params.set('pattern', query.pattern);
  if (query.include) params.set('include', query.include);
  if (query.max_results) params.set('max_results', query.max_results);
  return proxyJSON(c, machineId, accountId, 'GET', `/toolbox/files/find?${params}`) as any;
});

// ── POST /:machineId/toolbox/files/replace — Find & replace ─────────────────

const replaceTextRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/files/replace',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Find and replace text in files',
  request: {
    params: machineIdParam,
    body: { required: true, content: { 'application/json': { schema: ReplaceTextRequestSchema } } },
  },
  responses: {
    200: { description: 'Replace results', content: { 'application/json': { schema: ReplaceTextResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(replaceTextRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const body = c.req.valid('json');
  return proxyJSON(c, machineId, accountId, 'POST', '/toolbox/files/replace', body) as any;
});

// ── POST /:machineId/toolbox/files/permissions — Set permissions ────────────

const setPermissionsRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/files/permissions',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Set file permissions',
  description: 'Change mode (chmod), owner, and/or group of a file or directory.',
  request: {
    params: machineIdParam,
    query: z.object({
      path: z.string().openapi({ description: 'File or directory path', example: '/root/script.sh' }),
    }),
    body: { required: true, content: { 'application/json': { schema: SetPermissionsRequestSchema } } },
  },
  responses: {
    200: { description: 'Permissions updated', content: { 'application/json': { schema: SetPermissionsResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(setPermissionsRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const { path } = c.req.valid('query');
  const body = c.req.valid('json');
  return proxyJSON(c, machineId, accountId, 'POST', `/toolbox/files/permissions?path=${encodeURIComponent(path)}`, body) as any;
});

// ── POST /:machineId/toolbox/files/bulk-download — Download as zip ──────────

const bulkDownloadRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/files/bulk-download',
  tags: ['Toolbox: Filesystem'],
  security: bearerSecurity,
  summary: 'Download multiple files as zip',
  request: {
    params: machineIdParam,
    body: { required: true, content: { 'application/json': { schema: BulkDownloadRequestSchema } } },
  },
  responses: {
    200: { description: 'Zip archive of requested files' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(bulkDownloadRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const body = c.req.valid('json');

  const result = await resolveMachine(c, machineId, accountId);
  if ('error' in result) return result.error as any;

  try {
    const resp = await proxyToToolbox(result.machine.slug, 'POST', '/toolbox/files/bulk-download', body, { 'Content-Type': 'application/json' });
    const headers = new Headers();
    headers.set('Content-Type', 'application/zip');
    headers.set('Content-Disposition', 'attachment; filename="download.zip"');
    return new Response(resp.body, { status: 200, headers }) as any;
  } catch (err) {
    return handleRouteError(c, err, 'Bulk download') as any;
  }
});


// ═════════════════════════════════════════════════════════════════════════════
//  PROCESS / EXEC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── POST /:machineId/toolbox/process/execute — Run command ──────────────────

const executeRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/process/execute',
  tags: ['Toolbox: Process'],
  security: bearerSecurity,
  summary: 'Execute a shell command',
  description: 'Runs a shell command synchronously on the machine and returns stdout, stderr, exit code, and duration.',
  request: {
    params: machineIdParam,
    body: { required: true, content: { 'application/json': { schema: ExecuteCommandRequestSchema } } },
  },
  responses: {
    200: { description: 'Command result', content: { 'application/json': { schema: ExecuteCommandResponseSchema } } },
    408: { description: 'Command timed out', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(executeRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const body = c.req.valid('json');
  return proxyJSON(c, machineId, accountId, 'POST', '/toolbox/process/execute', body) as any;
});

// ── POST /:machineId/toolbox/process/execute/stream — SSE streaming ─────────

const executeStreamRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/process/execute/stream',
  tags: ['Toolbox: Process'],
  security: bearerSecurity,
  summary: 'Execute command with streaming output',
  description: 'Runs a shell command and streams stdout/stderr as Server-Sent Events in real-time. Final event contains exit code.',
  request: {
    params: machineIdParam,
    body: { required: true, content: { 'application/json': { schema: ExecuteCommandRequestSchema } } },
  },
  responses: {
    200: { description: 'SSE event stream (text/event-stream)' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(executeStreamRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const body = c.req.valid('json');

  const result = await resolveMachine(c, machineId, accountId);
  if ('error' in result) return result.error as any;

  try {
    const resp = await proxyToToolbox(result.machine.slug, 'POST', '/toolbox/process/execute/stream', body, { 'Content-Type': 'application/json' });
    const headers = new Headers();
    headers.set('Content-Type', 'text/event-stream');
    headers.set('Cache-Control', 'no-cache');
    headers.set('Connection', 'keep-alive');
    return new Response(resp.body, { status: 200, headers }) as any;
  } catch (err) {
    return handleRouteError(c, err, 'Execute stream') as any;
  }
});

// ── POST /:machineId/toolbox/process/code-run — Run code snippet ────────────

const codeRunRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/process/code-run',
  tags: ['Toolbox: Process'],
  security: bearerSecurity,
  summary: 'Run a code snippet',
  description: 'Executes a code snippet in the specified language (python, node, bash, ruby, go). Auto-detects language if omitted.',
  request: {
    params: machineIdParam,
    body: { required: true, content: { 'application/json': { schema: CodeRunRequestSchema } } },
  },
  responses: {
    200: { description: 'Code execution result', content: { 'application/json': { schema: ExecuteCommandResponseSchema } } },
    408: { description: 'Execution timed out', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(codeRunRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const body = c.req.valid('json');
  return proxyJSON(c, machineId, accountId, 'POST', '/toolbox/process/code-run', body) as any;
});

// ── GET /:machineId/toolbox/process/list — List processes ───────────────────

const listProcessesRoute = createRoute({
  method: 'get',
  path: '/{machineId}/toolbox/process/list',
  tags: ['Toolbox: Process'],
  security: bearerSecurity,
  summary: 'List running processes',
  description: 'Returns all running processes on the machine with PID, command, state, memory usage, and user.',
  request: { params: machineIdParam },
  responses: {
    200: { description: 'Process list', content: { 'application/json': { schema: ListProcessesResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(listProcessesRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  return proxyJSON(c, machineId, accountId, 'GET', '/toolbox/process/list') as any;
});

// ── POST /:machineId/toolbox/process/kill — Kill process ────────────────────

const killProcessRoute = createRoute({
  method: 'post',
  path: '/{machineId}/toolbox/process/kill',
  tags: ['Toolbox: Process'],
  security: bearerSecurity,
  summary: 'Kill a process',
  description: 'Sends a signal to a process by PID. Supports SIGTERM, SIGKILL, SIGINT, SIGHUP.',
  request: {
    params: machineIdParam,
    body: { required: true, content: { 'application/json': { schema: KillProcessRequestSchema } } },
  },
  responses: {
    200: { description: 'Process killed', content: { 'application/json': { schema: KillProcessResponseSchema } } },
    403: { description: 'Protected process', content: { 'application/json': { schema: ToolboxErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

toolboxApp.openapi(killProcessRoute, async (c) => {
  const { machineId } = c.req.valid('param');
  const accountId = c.get('accountId');
  const body = c.req.valid('json');
  return proxyJSON(c, machineId, accountId, 'POST', '/toolbox/process/kill', body) as any;
});
