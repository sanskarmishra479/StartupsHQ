import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as authRoute } from "./app/api/auth/[...all]/route";
import { type RoutingDecision, routeRequest } from "./lib/host-routing";
import { config, proxy } from "./proxy";
import { closeDb } from "./server/db/client";
import {
  createTestUser,
  deleteTestUsers,
  TEST_PASSWORD,
} from "./server/testing/auth";

// Layer 1 of 3 (SEC-03.5, ADR-014): host routing and the admin session gate, plus the auth route.

const ADMIN_ORIGIN = "https://admin.startupshq.test";
const ADMIN = "admin.startupshq.test";
const PUBLIC = "startupshq.test";

afterAll(async () => {
  await deleteTestUsers();
  await closeDb();
});

const decide = (
  host: string | null,
  method: string,
  pathname: string,
  hasSessionCookie = false,
  adminOrigin: string | undefined = ADMIN_ORIGIN,
) =>
  routeRequest({ host, method, pathname, hasSessionCookie }, { adminOrigin });

const notFound = (api: boolean): RoutingDecision => ({
  kind: "not-found",
  api,
});
const publicPage: RoutingDecision = { kind: "continue", adminHost: false };
const adminPage: RoutingDecision = { kind: "continue", adminHost: true };

describe("public host", () => {
  it.each<[string, string, RoutingDecision]>([
    ["GET", "/admin", notFound(false)],
    ["GET", "/admin/startups/new", notFound(false)],
    ["POST", "/api/auth/sign-in/email", notFound(true)],
    ["GET", "/api/auth/get-session", notFound(true)],
    ["POST", "/api/v1/startups", notFound(true)],
    ["PATCH", "/api/v1/startups/x", notFound(true)],
    ["DELETE", "/api/v1/startups/x", notFound(true)],
    ["OPTIONS", "/api/v1/startups", notFound(true)],
    ["GET", "/api/v1/startups", publicPage],
    ["HEAD", "/api/v1/startups", publicPage],
    ["GET", "/companies/kiln-analytics", publicPage],
    ["GET", "/administrators-guide", publicPage],
  ])("%s %s", (method, pathname, expected) => {
    expect(decide(PUBLIC, method, pathname)).toEqual(expected);
  });

  it.each([
    "/ADMIN",
    "/Admin/startups",
    "/%61dmin",
    "//admin",
    "/api//auth/sign-in/email",
  ])("cannot be tricked into admin routes by %s", (pathname) => {
    expect(decide(PUBLIC, "GET", pathname).kind).toBe("not-found");
  });

  it("refuses admin routes even with a session cookie", () => {
    expect(decide(PUBLIC, "GET", "/admin", true)).toEqual(notFound(false));
  });
});

describe("admin host", () => {
  it.each<[string, string, boolean, RoutingDecision]>([
    ["GET", "/", false, { kind: "redirect", location: "/admin" }],
    ["GET", "/admin", false, { kind: "redirect", location: "/admin/login" }],
    [
      "GET",
      "/admin/startups",
      false,
      { kind: "redirect", location: "/admin/login" },
    ],
    ["GET", "/admin/startups", true, adminPage],
    ["GET", "/admin/login", false, adminPage],
    ["GET", "/admin/reset-password", false, adminPage],
    ["POST", "/api/auth/sign-in/email", false, adminPage],
    ["POST", "/api/v1/startups", false, adminPage],
    ["GET", "/_next/data/build/admin.json", false, adminPage],
    ["GET", "/icon.svg", false, adminPage],
    ["GET", "/apple-icon.png", false, adminPage],
    ["GET", "/companies/kiln-analytics", false, notFound(false)],
    ["GET", "/robots.txt", false, notFound(false)],
    ["GET", "/api/other", false, notFound(true)],
  ])("%s %s (session cookie: %s)", (method, pathname, cookie, expected) => {
    expect(decide(ADMIN, method, pathname, cookie)).toEqual(expected);
  });

  it("matches the admin host case-insensitively, including its port", () => {
    expect(decide("ADMIN.startupshq.test", "GET", "/admin/login")).toEqual(
      adminPage,
    );
    expect(
      decide(
        "admin.localhost:3000",
        "GET",
        "/admin/login",
        false,
        "http://admin.localhost:3000",
      ),
    ).toEqual(adminPage);
    // Same hostname on another port is not the admin origin.
    expect(
      decide(
        "admin.localhost:4000",
        "GET",
        "/admin/login",
        false,
        "http://admin.localhost:3000",
      ),
    ).toEqual(notFound(false));
  });
});

describe("fails closed", () => {
  it.each([
    ["an unknown host (e.g. a preview hostname)", "preview-123.vercel.app"],
    ["a missing Host header", null],
  ])("treats %s as public", (_label, host) => {
    expect(decide(host, "GET", "/admin")).toEqual(notFound(false));
    expect(decide(host, "POST", "/api/auth/sign-in/email")).toEqual(
      notFound(true),
    );
  });

  it("treats every host as public when the admin origin is not configured", () => {
    // Called directly: passing undefined to decide() would fall back to its default origin.
    for (const adminOrigin of [undefined, "", "not a url"]) {
      expect(
        routeRequest(
          {
            host: ADMIN,
            method: "GET",
            pathname: "/admin",
            hasSessionCookie: true,
          },
          { adminOrigin },
        ),
      ).toEqual(notFound(false));
    }
  });

  it("rejects a path that cannot be decoded", () => {
    expect(decide(PUBLIC, "GET", "/%E0%A4%A")).toEqual(notFound(false));
  });
});

describe("proxy", () => {
  const request = (
    url: string,
    init: { method?: string; cookie?: string } = {},
  ) =>
    new NextRequest(url, {
      method: init.method ?? "GET",
      headers: {
        host: new URL(url).host,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
    });

  it("answers admin paths on the public host with a 404", async () => {
    const page = proxy(request(`https://${PUBLIC}/admin`));
    expect(page.status).toBe(404);

    const api = proxy(
      request(`https://${PUBLIC}/api/auth/sign-in/email`, { method: "POST" }),
    );
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Not found." },
    });
  });

  it("sends a visitor without a session to the admin login", () => {
    const response = proxy(request(`${ADMIN_ORIGIN}/admin/startups`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${ADMIN_ORIGIN}/admin/login`,
    );
  });

  it("lets a request with a session cookie through, marked noindex", () => {
    const response = proxy(
      request(`${ADMIN_ORIGIN}/admin/startups`, {
        cookie: "__Host-startupshq.session_token=opaque",
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("puts a policy, HSTS and a fresh nonce on every answer it gives", async () => {
    const onPublic = proxy(
      request(`https://${PUBLIC}/companies/kiln-analytics`),
    );
    expect(onPublic.headers.get("strict-transport-security")).toContain(
      "max-age=31536000",
    );
    expect(onPublic.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    // A cached public page cannot carry a per-request nonce (SEC-09).
    expect(onPublic.headers.get("content-security-policy")).not.toContain(
      "nonce-",
    );

    const admin = proxy(
      request(`${ADMIN_ORIGIN}/admin/startups`, {
        cookie: "__Host-startupshq.session_token=opaque",
      }),
    );
    const policy = admin.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(
      /script-src 'self' 'nonce-[0-9a-f]{32}' 'sha256-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
    );
    // The same policy is forwarded on the request, where Next.js looks for the nonce to stamp its
    // own scripts; without it nothing on the admin origin hydrates (Phase 18).
    expect(
      admin.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);

    const second = proxy(
      request(`${ADMIN_ORIGIN}/admin/startups`, {
        cookie: "__Host-startupshq.session_token=opaque",
      }),
    );
    expect(second.headers.get("content-security-policy")).not.toBe(policy);

    // Refusals and redirects are answers too, and carry the same headers.
    for (const response of [
      proxy(request(`https://${PUBLIC}/admin`)),
      proxy(request(`${ADMIN_ORIGIN}/`)),
    ]) {
      expect(response.headers.get("content-security-policy")).toContain(
        "object-src 'none'",
      );
      expect(response.headers.get("strict-transport-security")).toBeTruthy();
    }
  });

  it("does not run on static assets", () => {
    const [matcher = ""] = config.matcher;
    const pattern = new RegExp(`^${matcher}$`);
    expect(pattern.test("/_next/static/chunks/app.js")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
    expect(pattern.test("/admin")).toBe(true);
    expect(pattern.test("/api/auth/sign-in/email")).toBe(true);
  });
});

describe("/api/auth route", () => {
  it("serves Better Auth's endpoints", async () => {
    const { email } = await createTestUser();
    const response = await authRoute(
      new Request(`${ADMIN_ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ADMIN_ORIGIN,
          "x-real-ip": "198.18.0.9",
        },
        body: JSON.stringify({ email, password: TEST_PASSWORD }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(";")).toContain(
      "__Host-startupshq.session_token=",
    );
  });
});
