import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaginationDepthError,
  PayloadTooLargeError,
  RateLimitedError,
  toErrorResponse,
  UnauthorizedError,
  UnprocessableError,
  UnsafeUrlError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "./errors";

// SEC-12: what a caller is allowed to learn from a failure. Every response body is built by one
// function, so this is where the promise is kept — no stack, no SQL, no table or column names, no
// internal ids, and no detail from the cause of an unexpected error.

const body = (error: unknown) => JSON.stringify(toErrorResponse(error).body);

describe("unexpected failures say nothing about the inside", () => {
  it("hides a driver error's query, parameters and stack", () => {
    // Shaped like what Drizzle throws when Postgres refuses a statement.
    const cause = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "startups_slug_unique"',
      ),
      { code: "23505", table: "startups", detail: "Key (slug)=(kiln) exists." },
    );
    const thrown = Object.assign(
      new Error(
        'Failed query: insert into "startups" ("slug","name") values ($1, $2)\nparams: kiln,Kiln',
      ),
      { cause },
    );

    const { status, body: shape } = toErrorResponse(thrown);
    expect(status).toBe(500);
    expect(shape).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong." },
    });

    const text = JSON.stringify(shape);
    for (const secret of [
      "startups",
      "slug",
      "insert into",
      "params",
      "23505",
      "constraint",
      "Failed query",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("says nothing more for a thrown string, object or null", () => {
    for (const thrown of ["boom", { secret: "s3cret" }, null, undefined, 42]) {
      expect(body(thrown)).toBe(
        '{"error":{"code":"INTERNAL","message":"Something went wrong."}}',
      );
    }
  });

  it("never carries a cause or a stack, whatever was attached", () => {
    const withCause = new AppError("CONFLICT", 409, "Already exists.", {
      cause: new Error("inner detail: user 9f1c has row 42"),
    });
    const text = body(withCause);
    expect(text).not.toContain("inner detail");
    expect(text).not.toContain("9f1c");
    expect(text).not.toContain("stack");
  });
});

describe("typed failures carry their documented code and status (API.md §4)", () => {
  it.each<[AppError, number, string]>([
    [
      new ValidationError([{ path: "name", message: "Required." }]),
      400,
      "VALIDATION_ERROR",
    ],
    [new PaginationDepthError(), 400, "PAGINATION_DEPTH"],
    [
      new UnsafeUrlError("it resolves to a private address."),
      400,
      "UNSAFE_URL",
    ],
    [new UnauthorizedError(), 401, "UNAUTHORIZED"],
    [new ForbiddenError(), 403, "FORBIDDEN"],
    [new NotFoundError(), 404, "NOT_FOUND"],
    [new ConflictError(), 409, "CONFLICT"],
    [new ConflictError("Stale.", "IMPORT_STALE"), 409, "IMPORT_STALE"],
    [new ConflictError("Expired.", "IMPORT_EXPIRED"), 409, "IMPORT_EXPIRED"],
    [new PayloadTooLargeError(), 413, "PAYLOAD_TOO_LARGE"],
    [new UnsupportedMediaTypeError(), 415, "UNSUPPORTED_MEDIA_TYPE"],
    [new UnprocessableError("No."), 422, "UNPROCESSABLE"],
    [
      new UnprocessableError("Too big.", "IMAGE_TOO_LARGE"),
      422,
      "IMAGE_TOO_LARGE",
    ],
    [new RateLimitedError(30), 429, "RATE_LIMITED"],
  ])("%s", (error, status, code) => {
    const response = toErrorResponse(error);
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.message.length).toBeGreaterThan(0);
  });

  it("attaches field details only to a validation failure", () => {
    const validation = toErrorResponse(
      new ValidationError([{ path: "foundedYear", message: "Too early." }]),
    );
    expect(validation.body.error.details).toEqual([
      { path: "foundedYear", message: "Too early." },
    ]);

    for (const error of [
      new NotFoundError(),
      new ConflictError(),
      new ForbiddenError(),
    ]) {
      expect(toErrorResponse(error).body.error).not.toHaveProperty("details");
    }
  });

  it("keeps a refused URL's reason free of the address it resolved to (SEC-05)", () => {
    const refusal = new UnsafeUrlError(
      "it resolves to a private or reserved address.",
    );
    expect(body(refusal)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
