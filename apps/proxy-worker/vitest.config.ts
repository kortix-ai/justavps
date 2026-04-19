import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Prevent vitest/vite from walking up to the root postcss.config.mjs
  // which requires @tailwindcss/postcss (a Next.js dep not installed here).
  css: { postcss: { plugins: [] } },
  test: {
    globals: true,
    environment: 'node',
  },
});