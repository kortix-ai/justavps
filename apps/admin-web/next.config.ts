import path from 'node:path';
import type { NextConfig } from 'next';

// Build mode (production): static export, served by apps/v2-api at /admin-ui.
// Dev mode: no basePath so routes live at /admin/* directly. Toggling on
// process.env.NODE_ENV keeps both modes clean — dev devs hit /admin, the
// built bundle deploys under /admin-ui without code changes.
const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  // Build-only options. `output: 'export'` is incompatible with API routes,
  // server actions, and dynamic routing — fine because admin-web has none.
  ...(isDev ? {} : {
    output: 'export',
    basePath: '/admin-ui',
    assetPrefix: '/admin-ui',
  }),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  typescript: { tsconfigPath: 'tsconfig.json' },
  // Pin the workspace root so Next doesn't traverse up into the parent
  // Next.js project at /justavps.com.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
