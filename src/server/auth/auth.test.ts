import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { startups } from "../db/schema";
import {
  ForbiddenError,
  toErrorResponse,
  ValidationError,
} from "../lib/errors";
import {
  type AuthedContext,
  assertPublicRead,
  authedContext,
  isAuthedContext,
  PUBLIC_READ,
  type PublicReadContext,
  publicContext,
  type ReadContext,
} from "./context";
import { assertAdmin, assertEditor } from "./guards";
import { visibilityFilter } from "./visibility";

// docs/SRS.md §5 (SEC-03), SEC-12.

const editor = authedContext(
  { id: "user-editor", role: "editor" },
  "203.0.113.1",
);
const admin = authedContext({ id: "user-admin", role: "admin" }, "203.0.113.2");
const anonymous = publicContext("203.0.113.3");

/** A structurally identical object that did not come from authedContext(). */
const forgedAdmin = {
  kind: "authed",
  actor: { id: "attacker", role: "admin" },
  ip: "198.51.100.9",
} as unknown as ReadContext;

const dialect = new PgDialect();

describe("contexts", () => {
  it("freezes every context", () => {
    expect(Object.isFrozen(anonymous)).toBe(true);
    expect(Object.isFrozen(editor)).toBe(true);
    expect(Object.isFrozen(editor.actor)).toBe(true);
    expect(Object.isFrozen(PUBLIC_READ)).toBe(true);
  });

  it("recognises only contexts built by authedContext()", () => {
    expect(isAuthedContext(editor)).toBe(true);
    expect(isAuthedContext(admin)).toBe(true);
    expect(isAuthedContext(forgedAdmin)).toBe(false);
    expect(isAuthedContext(JSON.parse(JSON.stringify(admin)))).toBe(false);
    // A copy of a genuine context stays genuine: only code already holding one can make it.
    expect(isAuthedContext({ ...admin })).toBe(true);
    expect(isAuthedContext(anonymous)).toBe(false);
    expect(isAuthedContext(PUBLIC_READ)).toBe(false);
    expect(isAuthedContext(null)).toBe(false);
  });

  it("refuses to build an authed context without a valid actor", () => {
    expect(() =>
      authedContext({ id: "", role: "editor" }, "203.0.113.1"),
    ).toThrow();
    expect(() =>
      authedContext({ id: "x", role: "owner" as "admin" }, "203.0.113.1"),
    ).toThrow();
  });

  it("keeps PUBLIC_READ identity-free and constant", () => {
    expect(PUBLIC_READ).toEqual({ kind: "public-read" });
    expect(Object.keys(PUBLIC_READ)).toEqual(["kind"]);
    expect(() => assertPublicRead(PUBLIC_READ)).not.toThrow();
  });

  it("rejects every other context in a cached public read at runtime", () => {
    expect(() => assertPublicRead(anonymous)).toThrow();
    expect(() => assertPublicRead(editor)).toThrow();
    expect(() =>
      assertPublicRead({ kind: "public-read", ip: "203.0.113.4" }),
    ).toThrow();
    expect(() => assertPublicRead(undefined)).toThrow();
  });

  it("rejects the wrong context at compile time", () => {
    const cachedRead = (ctx: PublicReadContext) => ctx.kind;

    // @ts-expect-error — a per-request context carries an IP and must never reach a cached read.
    expect(() => assertPublicRead(cachedRead(anonymous))).toThrow();
    // @ts-expect-error — an editor context would put drafts in a shared cache.
    expect(() => assertPublicRead(cachedRead(editor))).toThrow();

    // @ts-expect-error — an authed context cannot be written as a literal (SEC-03.4).
    const literal: AuthedContext = {
      kind: "authed",
      actor: { id: "a", role: "admin" },
      ip: "x",
    };
    expect(isAuthedContext(literal)).toBe(false);
  });
});

describe("guards", () => {
  it("assertEditor admits editors and admins only", () => {
    expect(() => assertEditor(editor)).not.toThrow();
    expect(() => assertEditor(admin)).not.toThrow();
    for (const ctx of [anonymous, PUBLIC_READ, forgedAdmin]) {
      expect(() => assertEditor(ctx)).toThrow(ForbiddenError);
    }
  });

  it("assertAdmin admits admins only", () => {
    expect(() => assertAdmin(admin)).not.toThrow();
    for (const ctx of [editor, anonymous, PUBLIC_READ, forgedAdmin]) {
      expect(() => assertAdmin(ctx)).toThrow(ForbiddenError);
    }
  });
});

describe("visibilityFilter", () => {
  const render = (ctx: ReadContext) => {
    const filter = visibilityFilter(ctx, startups.status);
    return filter ? dialect.sqlToQuery(filter) : undefined;
  };

  it.each([
    ["public", anonymous],
    ["public-read", PUBLIC_READ],
    ["forged admin", forgedAdmin],
  ] as const)("restricts a %s context to published rows", (_label, ctx) => {
    const query = render(ctx);
    expect(query?.sql).toBe('"startups"."status" = $1');
    expect(query?.params).toEqual(["published"]);
  });

  it("does not restrict an authenticated editor", () => {
    expect(render(editor)).toBeUndefined();
  });
});

describe("toErrorResponse (SEC-12)", () => {
  it("exposes only the code, message and field details of an AppError", () => {
    const { status, body } = toErrorResponse(
      new ValidationError([{ path: "slug", message: "Invalid slug." }]),
    );
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        details: [{ path: "slug", message: "Invalid slug." }],
      },
    });
  });

  it("hides everything about an unexpected error", () => {
    const leaky = new Error(
      'duplicate key value violates unique constraint "startups_slug_unique" (id=4f1c…)',
    );
    const { status, body } = toErrorResponse(leaky);
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong." },
    });
    expect(JSON.stringify(body)).not.toMatch(/startups|constraint|4f1c/);
  });
});
