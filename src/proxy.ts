import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAMES } from "./lib/auth-cookie";
import { routeRequest } from "./lib/host-routing";
import { securityHeaders } from "./lib/security-headers";

// Next.js 16 Proxy (formerly middleware): host routing and the /admin session gate, layer 1 of 3
// (SEC-03.5, ADR-014). It imports no server modules and never decides authorization on its own;
// see src/lib/host-routing.ts for the rules.

/** A fresh nonce per request, which is what makes a nonce worth having. */
const newNonce = () => crypto.randomUUID().replaceAll("-", "");

export function proxy(request: NextRequest): NextResponse {
  const decision = routeRequest(
    {
      host: request.headers.get("host"),
      method: request.method,
      pathname: request.nextUrl.pathname,
      hasSessionCookie: SESSION_COOKIE_NAMES.some((name) =>
        request.cookies.has(name),
      ),
    },
    { adminOrigin: process.env.ADMIN_ORIGIN },
  );

  const adminHost = decision.kind === "continue" && decision.adminHost;
  // Only the admin origin renders per request, so only it can carry a nonce (SEC-09).
  const nonce = adminHost ? newNonce() : undefined;
  const headers = securityHeaders({
    adminHost,
    nonce,
    development: process.env.NODE_ENV === "development",
  });

  const response = ((): NextResponse => {
    switch (decision.kind) {
      case "redirect":
        return NextResponse.redirect(
          new URL(decision.location, request.url),
          307,
        );
      case "not-found":
        return decision.api
          ? NextResponse.json(
              { error: { code: "NOT_FOUND", message: "Not found." } },
              { status: 404 },
            )
          : new NextResponse("Not found", {
              status: 404,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
      default: {
        if (nonce === undefined) return NextResponse.next();
        // Next.js reads the nonce from the policy on the *request* to stamp the scripts it renders;
        // x-nonce is for any script a page adds itself.
        const forwarded = new Headers(request.headers);
        forwarded.set("x-nonce", nonce);
        forwarded.set(
          "content-security-policy",
          headers["Content-Security-Policy"] ?? "",
        );
        return NextResponse.next({ request: { headers: forwarded } });
      }
    }
  })();

  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // Everything except static assets, which carry no credentials and must load on both hosts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
