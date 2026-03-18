import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './src/sdk/openapi.json',
  output: {
    path: './src/sdk/generated',
  },
  plugins: [
    {
      name: '@hey-api/typescript',
      enums: 'javascript',
    },
    {
      name: '@hey-api/sdk',
      operations: {
        nesting: 'operationId',
      },
    },
    {
      name: '@hey-api/client-fetch',
      bundle: true,
    },
  ],
});
