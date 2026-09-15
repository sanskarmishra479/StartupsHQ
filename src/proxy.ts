import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAMES } from "./lib/auth-cookie";
import { routeRequest } from "./lib/host-routing";

// Next.js 16 Proxy (formerly middleware): host routing and the /admin session gate, layer 1 of 3
// (SEC-03.5, ADR-014). It imports no server modules and never decides authorization on its own;
// see src/lib/host-routing.ts for the rules.

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
    case "continue": {
      const response = NextResponse.next();
      // Nothing on the admin host belongs in a search index.
      if (decision.adminHost) {
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
      }
      return response;
    }
  }
}

export const config = {
  // Everything except static assets, which carry no credentials and must load on both hosts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
