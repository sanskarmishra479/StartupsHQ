import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PublicContext } from "../auth/context";
import { NOT_FOUND } from "../lib/cached-lookup";
import { ConflictError, RateLimitedError } from "../lib/errors";
import { errorBody } from "../testing/contract";
import {
  body,
  collection,
  fromLookup,
  orNotFound,
  publicRead,
  resource,
} from "./handler";

// SEC-12 (no internals in error bodies), SEC-14 (trusted IP only) and the envelopes of
// docs/API.md §3, for the wrapper every read endpoint shares.

const ORIGIN = "https://startupshq.test";
const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { headers });
const noParams = { params: Promise.resolve({}) };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publicRead envelopes", () => {
  it("wraps a resource, a page and a whole body", async () => {
    const one = publicRead(z.object({}), async () => resource({ slug: "a" }));
    expect(await (await one(request("/x"), noParams)).json()).toEqual({
      data: { slug: "a" },
    });

    const page = {
      data: [1],
      pagination: { nextCursor: null, hasMore: false, limit: 24 },
    };
    const many = publicRead(z.object({}), async () => collection(page));
    expect(await (await many(request("/x"), noParams)).json()).toEqual(page);

    const whole = publicRead(z.object({}), async () =>
      body({ data: {}, meta: { query: "q" } }),
    );
    expect(await (await whole(request("/x"), noParams)).json()).toEqual({
      data: {},
      meta: { query: "q" },
    });
  });

  it("answers an old slug with a 301 to the current path on the same origin", async () => {
    const route = publicRead(z.object({}), async () =>
      fromLookup(
        { kind: "redirect", slug: "new-slug" },
        (slug) => `/api/v1/things/${slug}`,
      ),
    );
    const response = await route(request("/api/v1/things/old-slug"), noParams);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/api/v1/things/new-slug`,
    );
  });

  it("turns absence into a 404", async () => {
    for (const read of [
      async () => fromLookup(NOT_FOUND, (slug) => `/${slug}`),
      async () => resource(orNotFound(NOT_FOUND)),
    ]) {
      const response = await publicRead(z.object({}), read)(
        request("/x"),
        noParams,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Not found." },
      });
    }
  });

  it("passes only string route params through", async () => {
    let seen: Readonly<Record<string, string>> = {};
    const route = publicRead(z.object({}), async ({ params }) => {
      seen = params;
      return resource(null);
    });
    await route(request("/x"), {
      params: Promise.resolve({ slug: "kiln", rest: ["a", "b"] }),
    });
    expect(seen).toEqual({ slug: "kiln" });
    // Routes without dynamic segments may be called without a context.
    expect((await route(request("/x"))).status).toBe(200);
  });
});

describe("publicRead errors (SEC-12)", () => {
  it("never leaks an unexpected error's message, SQL or stack", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = publicRead(z.object({}), async () => {
      throw new Error(
        'relation "startups" does not exist\n    at query (/app/src/server/db/client.ts:10:3)',
      );
    });

    const response = await route(request("/x"), noParams);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong." },
    });
    expect(text).not.toMatch(/startups|relation|client\.ts|at /);
    expect(log).toHaveBeenCalledOnce();
  });

  it("sends typed errors as they are, without logging them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = publicRead(z.object({}), async () => {
      throw new ConflictError();
    });
    const response = await route(request("/x"), noParams);
    expect(response.status).toBe(409);
    expect(errorBody.parse(await response.json()).error.code).toBe("CONFLICT");
    expect(log).not.toHaveBeenCalled();
  });

  it("adds Retry-After to a 429", async () => {
    const route = publicRead(z.object({}), async () => {
      throw new RateLimitedError(42);
    });
    const response = await route(request("/x"), noParams);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
  });
});

describe("publicRead query parsing", () => {
  const schema = z.object({
    tag: z.array(z.enum(["a", "b"])).optional(),
    sort: z.enum(["name", "recent"]).optional(),
  });
  const echo = publicRead(schema, async ({ query }) => resource(query));

  it("collects repeatable parameters and ignores unknown ones", async () => {
    const response = await echo(
      request("/x?tag=a&tag=b&sort=name&utm_source=mail"),
      noParams,
    );
    expect(await response.json()).toEqual({
      data: { tag: ["a", "b"], sort: "name" },
    });
  });

  it("rejects a single-valued parameter given twice", async () => {
    const response = await echo(request("/x?sort=name&sort=recent"), noParams);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters.",
        details: [{ path: "sort", message: "Pass this parameter once." }],
      },
    });
  });

  it("rejects an invalid value with field details", async () => {
    const response = await echo(request("/x?tag=z"), noParams);
    expect(response.status).toBe(400);
    const { error } = errorBody.parse(await response.json());
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details?.[0]?.path).toMatch(/^tag/);
  });
});

describe("publicRead context (SEC-14)", () => {
  it("builds a public context from the trusted IP, ignoring forwarding headers", async () => {
    let ctx: PublicContext | undefined;
    const route = publicRead(z.object({}), async (read) => {
      ctx = read.ctx;
      return resource(null);
    });
    await route(
      request("/x", {
        "x-forwarded-for": "198.51.100.66",
        "x-real-ip": "198.51.100.66",
        cookie: "__Host-startupshq.session_token=opaque",
      }),
      noParams,
    );
    expect(ctx).toEqual({ kind: "public", ip: "127.0.0.1" });
  });
});
