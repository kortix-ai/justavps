import path from 'node:path';
import type { NextConfig } from 'next';

// Static export, served by apps/v2-api at /admin-ui.
// trailingSlash:true so each route maps to <out>/<route>/index.html.
const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/admin-ui',
  assetPrefix: '/admin-ui',
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
