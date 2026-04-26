import path from "node:path";
import type { NextConfig } from "next";

const V2_API_URL = (process.env.V2_API_URL || "http://localhost:4200").replace(/\/$/, "");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    return [
      // Serve the V2 admin SPA from the Next.js origin so visiting
      // http://localhost:4100/admin-ui/ "just works" alongside the V1 app.
      // The V2 API still owns the actual asset bundle (apps/admin-web/dist).
      { source: "/admin-ui", destination: `${V2_API_URL}/admin-ui/` },
      { source: "/admin-ui/", destination: `${V2_API_URL}/admin-ui/` },
      { source: "/admin-ui/:path*", destination: `${V2_API_URL}/admin-ui/:path*` },
    ];
  },
};

export default nextConfig;
