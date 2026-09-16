import type { NextConfig } from "next";
import { STRICT_TRANSPORT_SECURITY } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // 'use cache' + cacheTag for public reads (ADR-013).
  cacheComponents: true,

  // Image variants are pre-generated at upload and served directly from Blob,
  // so the Vercel image optimizer is never billed (ADR-012).
  images: { unoptimized: true },

  poweredByHeader: false,

  // Subresource integrity on every script Next.js emits, so the public origin can enforce a CSP
  // without a per-request nonce and keep its pages statically cached (SEC-09, ADR-014).
  experimental: { sri: { algorithm: "sha256" } },

  // Headers identical on both origins. The Content-Security-Policy differs per origin and is set
  // in src/proxy.ts, which is the only place that knows which host answered (SEC-09).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: STRICT_TRANSPORT_SECURITY,
          },
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
