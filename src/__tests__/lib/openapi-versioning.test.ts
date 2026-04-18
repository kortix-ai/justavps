import { describe, expect, it } from 'vitest';

import { filterOpenApiDocumentForPrefix } from "@/server/core/openapi/versioning";

describe('filterOpenApiDocumentForPrefix', () => {
  it('keeps only paths under the requested prefix and rewrites them to docs-local paths', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'x', version: '1' },
      paths: {
        '/api/v1/machines': { get: { tags: ['Machines'] } },
        '/api/v2/machines': { get: { tags: ['Machines V2'] } },
        '/api/v2/images': { get: { tags: ['Images V2'] } },
      },
      tags: [
        { name: 'Machines' },
        { name: 'Machines V2' },
        { name: 'Images V2' },
      ],
    };

    const filtered = filterOpenApiDocumentForPrefix(doc as Parameters<typeof filterOpenApiDocumentForPrefix>[0], '/api/v2');
    expect(Object.keys(filtered.paths)).toEqual(['/machines', '/images']);
    expect(filtered.tags?.map((t: { name: string }) => t.name)).toEqual(['Machines V2', 'Images V2']);
  });
});
