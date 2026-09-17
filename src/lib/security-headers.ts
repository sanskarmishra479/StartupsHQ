// Response headers for both origins (SEC-09, SEC-19). Pure, so `proxy.ts` stays a thin caller and
// every directive can be asserted in a unit test.
//
// The two origins get different script policies, deliberately (ADR-014):
//   admin  — dynamic anyway, so every response carries a fresh nonce and 'strict-dynamic'.
//   public — statically cached, so a per-request nonce is impossible without giving up caching.
//            Next.js stamps an integrity hash on the script files it emits (`experimental.sri`),
//            but it also writes inline scripts carrying each page's React payload, and those no
//            static policy can name. Inline scripts are therefore allowed here (ADR-022, the
//            fallback ADR-014 foresaw): no session or credential is valid on this origin.
// Both refuse objects, framing, foreign form targets and `<base>` rewriting, which is what stops
// the injection routes a directory site actually faces.

import { THEME_INIT_SCRIPT_HASH } from "./theme";

export type CspAudience = Readonly<{
  adminHost: boolean;
  /** Required for the admin origin; ignored on the public one. */
  nonce?: string | undefined;
  /** React needs `eval` for its development error overlay, never in production. */
  development?: boolean;
}>;

/** Blob is the only third-party origin any page loads from. */
const BLOB_HOSTS = [
  "https://*.public.blob.vercel-storage.com",
  // The stand-in used when no Blob token is configured (development and tests).
  "https://blob.startupshq.test",
];

/** A year. `preload` is deliberately absent until the domain has been stable (SEC-19). */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export function contentSecurityPolicy(audience: CspAudience): string {
  const scripts = audience.adminHost
    ? [
        "'self'",
        audience.nonce ? `'nonce-${audience.nonce}'` : "",
        // The root layout's theme script, the one inline script not rendered per request.
        THEME_INIT_SCRIPT_HASH,
        "'strict-dynamic'",
        audience.development ? "'unsafe-eval'" : "",
      ]
    : [
        "'self'",
        "'unsafe-inline'",
        audience.development ? "'unsafe-eval'" : "",
      ];

  const directives = [
    "default-src 'self'",
    `script-src ${scripts.filter(Boolean).join(" ")}`,
    // Next.js inlines the stylesheet it generates; a nonce cannot cover a cached public page, so
    // inline styles are allowed and scripts — the dangerous half — are not.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${BLOB_HOSTS.join(" ")}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

/** Everything `proxy.ts` adds to a response, whatever the route decided. */
export function securityHeaders(
  audience: CspAudience,
): Readonly<Record<string, string>> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(audience),
    "Strict-Transport-Security": STRICT_TRANSPORT_SECURITY,
    ...(audience.adminHost ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
  };
}
