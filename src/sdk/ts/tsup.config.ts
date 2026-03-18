import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: '../index.ts',
    'generated/index': '../generated/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  treeshake: true,
});
