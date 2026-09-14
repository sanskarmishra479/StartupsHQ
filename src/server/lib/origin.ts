import "server-only";

import { ForbiddenError, UnsupportedMediaTypeError } from "./errors";

// CSRF defence for state-changing requests (SEC-04, ADR-014). Better Auth's origin checks cover
// its own routes only; every other non-GET handler must call assertMutationRequest().

type Env = Readonly<Record<string, string | undefined>>;

export function adminOrigin(env: Env = process.env): string {
  const value = env.ADMIN_ORIGIN;
  if (!value) throw new Error("ADMIN_ORIGIN is not set.");
  return new URL(value).origin;
}

/**
 * True when a browser request demonstrably comes from the admin origin: a matching Origin
 * header, or — when Origin is absent — Fetch Metadata saying same-origin.
 */
export function isAllowedMutationOrigin(
  headers: Headers,
  allowedOrigin: string,
): boolean {
  const origin = headers.get("origin");
  if (origin !== null) return origin === new URL(allowedOrigin).origin;
  return headers.get("sec-fetch-site") === "same-origin";
}

export function isJsonContentType(headers: Headers): boolean {
  const type = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

/** First checks in every non-GET handler: origin (403), then JSON content type (415). */
export function assertMutationRequest(
  headers: Headers,
  options: { allowedOrigin?: string; requireJson?: boolean } = {},
): void {
  const allowed = options.allowedOrigin ?? adminOrigin();
  if (!isAllowedMutationOrigin(headers, allowed)) throw new ForbiddenError();

  if (options.requireJson !== false && !isJsonContentType(headers)) {
    throw new UnsupportedMediaTypeError("Requests must be sent as JSON.");
  }
}
