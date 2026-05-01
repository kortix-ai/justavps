import { defineConfig } from '@hey-api/openapi-ts';

// Reads the snapshotted spec at sdk/openapi.json (refreshed by the
// `v2api:sdk:gen` script before this runs) and emits a fully-typed
// fetch client + types into sdk/generated/. The hand-written ergonomic
// wrapper at sdk/client.ts layers on top so users get
// `client.machines.create({...})` instead of raw operation IDs.
export default defineConfig({
  input: './sdk/openapi.json',
  output: {
    path: './sdk/generated',
  },
  plugins: [
    { name: '@hey-api/typescript', enums: 'javascript' },
    { name: '@hey-api/sdk', operations: { nesting: 'operationId' } },
    { name: '@hey-api/client-fetch', bundle: true },
  ],
});
