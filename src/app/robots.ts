import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/machines", "/billing", "/settings", "/keys", "/webhooks", "/admin", "/v2/"],
      },
    ],
    sitemap: "https://justavps.com/sitemap.xml",
  };
}
