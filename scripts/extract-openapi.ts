#!/usr/bin/env tsx
/**
 * Extract the OpenAPI spec from openapi.ts and write it as static JSON.
 * This is the source for all SDK code generation.
 *
 * Usage: pnpm tsx scripts/extract-openapi.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Import the spec generator directly — no server needed
import { generateOpenAPISpec } from '../src/server/openapi';

const spec = generateOpenAPISpec('/api/v1');
const outPath = join(process.cwd(), 'src', 'sdk', 'openapi.json');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');

console.log(`✓ OpenAPI spec written to ${outPath}`);
console.log(`  ${Object.keys(spec.paths).length} paths, ${Object.keys(spec.components.schemas).length} schemas`);
