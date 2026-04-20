#!/usr/bin/env node
/**
 * Fetch the OpenAPI specs from the running dev server and save them to:
 * - src/sdk/openapi.json
 * - src/sdk/openapi-v2.json (when V2 docs are enabled)
 *
 * With @hono/zod-openapi the spec is auto-generated at runtime from route definitions.
 * This script fetches it from the live server so @hey-api/openapi-ts can generate the SDK.
 *
 * Usage: pnpm sdk:generate   (server must be running on localhost:4100)
 *   OR:  SDK_URL=https://justavps.com pnpm sdk:generate
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const BASE_URL = process.env.SDK_URL || 'http://localhost:4100';
const SPECS = [
  {
    name: 'v1',
    url: `${BASE_URL}/api/docs/openapi.json`,
    outPath: join(process.cwd(), 'src', 'sdk', 'openapi.json'),
  },
  {
    name: 'v2',
    url: `${BASE_URL}/api/docs/openapi-v2.json`,
    outPath: join(process.cwd(), 'src', 'sdk', 'openapi-v2.json'),
    optional: true,
  },
] as const;

console.log(`Fetching OpenAPI specs from ${BASE_URL}...`);

async function main() {
  let wroteAny = false;

  for (const specTarget of SPECS) {
    console.log(`→ ${specTarget.name}: ${specTarget.url}`);
    const res = await fetch(specTarget.url);
    if (!res.ok) {
      if ('optional' in specTarget && specTarget.optional) {
        console.warn(`  skipping ${specTarget.name}: ${res.status} ${res.statusText}`);
        continue;
      }
      console.error(`Failed to fetch ${specTarget.name} spec: ${res.status} ${res.statusText}`);
      console.error('Make sure the dev server is running: pnpm dev');
      process.exit(1);
    }

    const spec = await res.json();
    mkdirSync(dirname(specTarget.outPath), { recursive: true });
    writeFileSync(specTarget.outPath, JSON.stringify(spec, null, 2) + '\n');

    const paths = Object.keys(spec.paths || {});
    const schemas = Object.keys(spec.components?.schemas || {});
    console.log(`  ✓ written to ${specTarget.outPath}`);
    console.log(`    ${paths.length} paths, ${schemas.length} schemas`);
    wroteAny = true;
  }

  if (!wroteAny) {
    console.error('No OpenAPI specs were written');
    process.exit(1);
  }

  console.log('📐 Specs auto-generated from @hono/zod-openapi route definitions');
}

main();
