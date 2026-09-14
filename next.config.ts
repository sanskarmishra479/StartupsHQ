import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 'use cache' + cacheTag for public reads (ADR-013).
  cacheComponents: true,

  // Image variants are pre-generated at upload and served directly from Blob,
  // so the Vercel image optimizer is never billed (ADR-012).
  images: { unoptimized: true },

  poweredByHeader: false,

  // Baseline headers on every route. CSP and HSTS are added in Phase 12 (SEC-09).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
