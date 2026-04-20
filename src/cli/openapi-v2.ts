import { readFile } from 'node:fs/promises';

export interface V2OpenApiOperation {
  resource: string;
  action: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  paramNames: string[];
  hasBody: boolean;
}

interface OpenApiOperationLike {
  summary?: string;
  description?: string;
  requestBody?: unknown;
}

interface OpenApiSpecLike {
  paths?: Record<string, Record<string, OpenApiOperationLike>>;
}

export function deriveV2DocsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  return `${url.origin}/api/docs/openapi-v2.json`;
}

function extractParamNames(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function deriveAction(method: string, path: string) {
  const segments = path.split('/').filter(Boolean);
  const offset = segments[0] === 'api' && segments[1] === 'v2' ? 2 : 0;
  const resource = segments[offset];
  const tail = segments.slice(offset + 1);
  const staticTail = tail.filter((segment) => !segment.startsWith('{'));
  const upperMethod = method.toUpperCase();

  if (tail.length === 0) {
    if (upperMethod === 'GET') return { resource, action: 'list' };
    if (upperMethod === 'POST') return { resource, action: 'create' };
  }

  if (tail.length === 1 && tail[0].startsWith('{')) {
    if (upperMethod === 'GET') return { resource, action: 'get' };
    if (upperMethod === 'DELETE') return { resource, action: 'delete' };
  }

  const action = staticTail.join('-') || upperMethod.toLowerCase();
  return { resource, action };
}

export function buildV2OpenApiOperations(spec: OpenApiSpecLike): V2OpenApiOperation[] {
  const paths = spec?.paths ?? {};
  const operations: V2OpenApiOperation[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
      if (!(path.startsWith('/api/v2/') || path.startsWith('/'))) continue;
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const { resource, action } = deriveAction(method, path);
      if (!resource || !action) continue;
      operations.push({
        resource,
        action,
        method: method.toUpperCase(),
        path,
        summary: operation?.summary ?? `${method.toUpperCase()} ${path}`,
        description: operation?.description,
        paramNames: extractParamNames(path),
        hasBody: Boolean(operation?.requestBody),
      });
    }
  }

  return operations.sort((a, b) => `${a.resource}:${a.action}`.localeCompare(`${b.resource}:${b.action}`));
}

export async function loadV2OpenApiSpec(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const fallbackSpec = {
    paths: {
      '/api/v2/machines': {
        get: { summary: 'List machines' },
        post: { summary: 'Create a machine', requestBody: { required: true } },
      },
      '/api/v2/machines/{id}': {
        get: { summary: 'Get a machine' },
        delete: { summary: 'Delete a machine' },
      },
      '/api/v2/machines/{id}/start': {
        post: { summary: 'Start a stopped machine' },
      },
      '/api/v2/machines/{id}/stop': {
        post: { summary: 'Stop a machine' },
      },
      '/api/v2/machines/{id}/reboot': {
        post: { summary: 'Reboot a machine' },
      },
      '/api/v2/machines/{id}/cancel': {
        post: { summary: 'Cancel a machine subscription' },
      },
      '/api/v2/machines/{id}/reactivate': {
        post: { summary: 'Reactivate a cancelled subscription' },
      },
      '/api/v2/machines/{id}/exec': {
        post: { summary: 'Execute a command in an instance', requestBody: { required: true } },
      },
    },
  };

  try {
    const localPath = new URL('../sdk/openapi-v2.json', import.meta.url);
    const raw = await readFile(localPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.paths && Object.keys(parsed.paths).length > 0) return parsed;
  } catch {
    // fall through to remote fetch
  }

  try {
    const docsUrl = deriveV2DocsUrl(baseUrl);
    const res = await fetchFn(docsUrl);
    if (!res.ok) {
      throw new Error(`Failed to load V2 OpenAPI spec from ${docsUrl}: HTTP ${res.status}`);
    }
    const parsed = await res.json();
    if (parsed?.paths && Object.keys(parsed.paths).length > 0) return parsed;
  } catch {
    // fallback below
  }

  return fallbackSpec;
}

export function findV2Operation(operations: V2OpenApiOperation[], resource: string, action: string) {
  return operations.find((operation) => operation.resource === resource && operation.action === action) ?? null;
}
