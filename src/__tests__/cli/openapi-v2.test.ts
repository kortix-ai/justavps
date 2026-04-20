import { describe, expect, it } from 'vitest';

import { buildV2OpenApiOperations, deriveV2DocsUrl, findV2Operation } from '@/cli/openapi-v2';

describe('V2 CLI OpenAPI helpers', () => {
  it('derives the V2 docs URL from a base API URL', () => {
    expect(deriveV2DocsUrl('http://localhost:4100/api/v2')).toBe('http://localhost:4100/api/docs/openapi-v2.json');
    expect(deriveV2DocsUrl('https://justavps.com/api/v2')).toBe('https://justavps.com/api/docs/openapi-v2.json');
  });

  it('builds generated CLI operations from V2 paths', () => {
    const spec = {
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
      },
    };

    const operations = buildV2OpenApiOperations(spec);
    expect(findV2Operation(operations, 'machines', 'list')).toMatchObject({
      method: 'GET',
      path: '/api/v2/machines',
      hasBody: false,
    });
    expect(findV2Operation(operations, 'machines', 'create')).toMatchObject({
      method: 'POST',
      path: '/api/v2/machines',
      hasBody: true,
    });
    expect(findV2Operation(operations, 'machines', 'get')).toMatchObject({
      paramNames: ['id'],
    });
    expect(findV2Operation(operations, 'machines', 'start')).toMatchObject({
      action: 'start',
      paramNames: ['id'],
    });
  });
});
