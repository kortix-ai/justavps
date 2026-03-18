#!/usr/bin/env tsx
/**
 * Fetch the OpenAPI spec from the running dev server and save it to src/sdk/openapi.json.
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
const SPEC_URL = `${BASE_URL}/api/docs/openapi.json`;
const OUT_PATH = join(process.cwd(), 'src', 'sdk', 'openapi.json');

console.log(`Fetching OpenAPI spec from ${SPEC_URL}...`);

const res = await fetch(SPEC_URL);
if (!res.ok) {
  console.error(`Failed to fetch spec: ${res.status} ${res.statusText}`);
  console.error('Make sure the dev server is running: pnpm dev');
  process.exit(1);
}

const spec = await res.json();

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(spec, null, 2) + '\n');

const paths = Object.keys(spec.paths || {});
const schemas = Object.keys(spec.components?.schemas || {});
console.log(`✓ OpenAPI spec written to ${OUT_PATH}`);
console.log(`  ${paths.length} paths, ${schemas.length} schemas`);
console.log(`  📐 Spec auto-generated from @hono/zod-openapi route definitions`);
