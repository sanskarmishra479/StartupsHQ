import { describe, expect, it } from "vitest";
import { ForbiddenError, toErrorResponse } from "./errors";
import { clientIp } from "./ip";
import {
  assertMutationRequest,
  isAllowedMutationOrigin,
  isJsonContentType,
} from "./origin";

const ADMIN = "https://admin.startupshq.com";

describe("clientIp (SEC-14)", () => {
  const spoofed = new Headers({
    "x-real-ip": "198.51.100.66",
    "x-forwarded-for": "198.51.100.66, 10.0.0.1",
  });

  it("ignores every forwarding header when not running on Vercel", () => {
    expect(clientIp(spoofed, {})).toBe("127.0.0.1");
    expect(clientIp(spoofed, { VERCEL: "0" })).toBe("127.0.0.1");
  });

  it("uses Vercel's edge-set x-real-ip on Vercel", () => {
    expect(
      clientIp(new Headers({ "x-real-ip": "203.0.113.7" }), { VERCEL: "1" }),
    ).toBe("203.0.113.7");
    expect(
      clientIp(new Headers({ "x-real-ip": "2001:db8::7" }), { VERCEL: "1" }),
    ).toBe("2001:db8::7");
  });

  it("never passes a malformed value through", () => {
    expect(
      clientIp(new Headers({ "x-real-ip": "not-an-ip; DROP TABLE" }), {
        VERCEL: "1",
      }),
    ).toBe("0.0.0.0");
    expect(clientIp(new Headers(), { VERCEL: "1" })).toBe("0.0.0.0");
  });
});

describe("mutation origin checks (SEC-04)", () => {
  it.each([
    ["the admin origin", { origin: ADMIN }, true],
    [
      "the admin origin with a trailing slash in config",
      { origin: ADMIN },
      true,
    ],
    ["the public origin", { origin: "https://startupshq.com" }, false],
    ["a foreign origin", { origin: "https://evil.example" }, false],
    ["an opaque origin", { origin: "null" }, false],
    ["http instead of https", { origin: "http://admin.startupshq.com" }, false],
    [
      "no Origin but same-origin fetch metadata",
      { "sec-fetch-site": "same-origin" },
      true,
    ],
    [
      "no Origin and same-site fetch metadata",
      { "sec-fetch-site": "same-site" },
      false,
    ],
    [
      "no Origin and cross-site fetch metadata",
      { "sec-fetch-site": "cross-site" },
      false,
    ],
    ["no Origin and no fetch metadata", {}, false],
  ] as const)("%s → %s", (_label, headers, allowed) => {
    expect(isAllowedMutationOrigin(new Headers(headers), `${ADMIN}/`)).toBe(
      allowed,
    );
  });

  it("requires JSON for JSON endpoints", () => {
    expect(
      isJsonContentType(new Headers({ "content-type": "application/json" })),
    ).toBe(true);
    expect(
      isJsonContentType(
        new Headers({ "content-type": "Application/JSON; charset=utf-8" }),
      ),
    ).toBe(true);
    expect(
      isJsonContentType(new Headers({ "content-type": "text/plain" })),
    ).toBe(false);
    expect(
      isJsonContentType(
        new Headers({ "content-type": "application/x-www-form-urlencoded" }),
      ),
    ).toBe(false);
    expect(isJsonContentType(new Headers())).toBe(false);
  });

  it("fails a cross-origin request with 403 before checking the body type", () => {
    const headers = new Headers({
      origin: "https://evil.example",
      "content-type": "text/plain",
    });
    expect(() =>
      assertMutationRequest(headers, { allowedOrigin: ADMIN }),
    ).toThrow(ForbiddenError);
  });

  it("fails a same-origin non-JSON request with 415", () => {
    const headers = new Headers({
      origin: ADMIN,
      "content-type": "text/plain",
    });
    try {
      assertMutationRequest(headers, { allowedOrigin: ADMIN });
      expect.unreachable();
    } catch (error) {
      expect(toErrorResponse(error).status).toBe(415);
      expect(toErrorResponse(error).body.error.code).toBe(
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
  });

  it("lets multipart uploads skip the JSON requirement but not the origin check", () => {
    const upload = new Headers({
      origin: ADMIN,
      "content-type": "multipart/form-data; boundary=x",
    });
    expect(() =>
      assertMutationRequest(upload, {
        allowedOrigin: ADMIN,
        requireJson: false,
      }),
    ).not.toThrow();
  });
});
