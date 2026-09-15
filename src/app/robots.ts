import type { MetadataRoute } from "next";

// SEC-15: crawlers stay out of the JSON API. The sitemap line arrives with Phase 19.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
  };
}
