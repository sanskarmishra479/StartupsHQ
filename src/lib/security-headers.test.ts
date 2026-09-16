import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  STRICT_TRANSPORT_SECURITY,
  securityHeaders,
} from "./security-headers";

// SEC-09 and SEC-19. The two origins differ only in how scripts are allowed; everything that
// stops injection, framing and form hijacking is identical on both.

const directives = (policy: string) =>
  new Map(
    policy.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name ?? "", values.join(" ")];
    }),
  );

describe("the content security policy", () => {
  const admin = directives(
    contentSecurityPolicy({ adminHost: true, nonce: "abc123" }),
  );
  const web = directives(contentSecurityPolicy({ adminHost: false }));

  it("gives the admin origin a nonce and strict-dynamic", () => {
    expect(admin.get("script-src")).toBe(
      "'self' 'nonce-abc123' 'strict-dynamic'",
    );
  });

  it("gives the public origin same-origin scripts and no inline, so pages stay cacheable", () => {
    expect(web.get("script-src")).toBe("'self'");
    expect(web.get("script-src")).not.toContain("nonce");
    expect(web.get("script-src")).not.toContain("unsafe-inline");
  });

  it.each([
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["default-src", "'self'"],
  ])("sets %s on both origins", (directive, value) => {
    expect(admin.get(directive)).toBe(value);
    expect(web.get(directive)).toBe(value);
  });

  it("allows images only from ourselves and the blob store", () => {
    expect(web.get("img-src")).toBe(
      "'self' data: https://*.public.blob.vercel-storage.com https://blob.startupshq.test",
    );
  });

  it("allows eval only while developing", () => {
    expect(
      contentSecurityPolicy({ adminHost: true, nonce: "n", development: true }),
    ).toContain("'unsafe-eval'");
    expect(
      contentSecurityPolicy({ adminHost: true, nonce: "n" }),
    ).not.toContain("'unsafe-eval'");
  });
});

describe("the other headers", () => {
  it("asks for a year of HTTPS, without preload (SEC-19)", () => {
    expect(STRICT_TRANSPORT_SECURITY).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(STRICT_TRANSPORT_SECURITY).not.toContain("preload");
  });

  it("keeps the admin origin out of search indexes, and only that origin", () => {
    expect(securityHeaders({ adminHost: true, nonce: "n" })).toHaveProperty(
      "X-Robots-Tag",
      "noindex, nofollow",
    );
    expect(securityHeaders({ adminHost: false })).not.toHaveProperty(
      "X-Robots-Tag",
    );
  });
});
