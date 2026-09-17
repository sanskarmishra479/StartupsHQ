// Host routing for the public and admin origins (ADR-014), layer 1 of 3 (SEC-03.5). Pure, so
// proxy.ts runs it without importing server modules, and it is unit-tested directly.
//
// This layer is never the only check: route handlers re-verify the session (requireEditor) and
// services re-assert the actor (assertEditor). A session cookie's presence is all it looks at.

export type RoutingRequest = Readonly<{
  host: string | null;
  method: string;
  pathname: string;
  hasSessionCookie: boolean;
}>;

export type RoutingDecision =
  | Readonly<{ kind: "continue"; adminHost: boolean }>
  | Readonly<{ kind: "not-found"; api: boolean }>
  | Readonly<{ kind: "redirect"; location: string }>;

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** The site icons (Next.js metadata files), served on both hosts so the admin tab has one too. */
const ICON_PATHS: ReadonlySet<string> = new Set([
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
]);

/** Admin pages a visitor without a session must still reach. */
const OPEN_ADMIN_PATHS: ReadonlySet<string> = new Set([
  "/admin/login",
  "/admin/reset-password",
]);

function hostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The path as the router will see it, for matching only: percent-decoded, lowercased and with
 * repeated slashes collapsed, so `/%61dmin` or `/ADMIN//x` cannot slip past a rule.
 */
function comparablePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
      .toLowerCase()
      .replace(/\/{2,}/g, "/");
  } catch {
    return null;
  }
}

const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

export function routeRequest(
  request: RoutingRequest,
  env: Readonly<{ adminOrigin?: string | undefined }>,
): RoutingDecision {
  const path = comparablePath(request.pathname);
  if (path === null) {
    return { kind: "not-found", api: request.pathname.startsWith("/api/") };
  }
  const api = under(path, "/api");

  // Any host that is not exactly the admin host is treated as public, including preview
  // hostnames and a missing configuration: admin surfaces fail closed.
  const adminHost = hostOf(env.adminOrigin);
  const onAdminHost =
    adminHost !== null && request.host?.toLowerCase() === adminHost;

  if (!onAdminHost) {
    const adminOnly =
      under(path, "/admin") ||
      under(path, "/api/auth") ||
      (under(path, "/api/v1") &&
        !READ_METHODS.has(request.method.toUpperCase()));
    return adminOnly
      ? { kind: "not-found", api }
      : { kind: "continue", adminHost: false };
  }

  // The admin host serves the admin UI, auth, the API and Next.js internals, nothing else.
  if (path === "/") return { kind: "redirect", location: "/admin" };
  if (
    under(path, "/api/auth") ||
    under(path, "/api/v1") ||
    under(path, "/_next") ||
    ICON_PATHS.has(path)
  ) {
    return { kind: "continue", adminHost: true };
  }
  if (under(path, "/admin")) {
    if (!request.hasSessionCookie && !OPEN_ADMIN_PATHS.has(path)) {
      return { kind: "redirect", location: "/admin/login" };
    }
    return { kind: "continue", adminHost: true };
  }
  return { kind: "not-found", api };
}
