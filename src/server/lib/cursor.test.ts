import { describe, expect, it } from "vitest";
import {
  assertPageAllowed,
  type Cursor,
  cursorSecret,
  decodeCursor,
  encodeCursor,
  MAX_ANONYMOUS_PAGE_DEPTH,
} from "./cursor";
import { PaginationDepthError, ValidationError } from "./errors";

const SECRET = "test-cursor-secret-with-at-least-32-chars";
const OTHER_SECRET = "a-different-secret-also-32-characters-long";

const cursor: Cursor<"raised"> = {
  sort: "raised",
  key: [15_000_000],
  id: "4f1c9a2e-0000-4000-8000-000000000001",
  page: 3,
};

describe("cursors", () => {
  it("round-trips a signed cursor", () => {
    const token = encodeCursor(cursor, SECRET);
    expect(token.startsWith("v1.")).toBe(true);
    expect(decodeCursor(token, "raised", SECRET)).toEqual(cursor);
  });

  it("rejects a tampered payload", () => {
    const token = encodeCursor(cursor, SECRET);
    const [version, payload = "", signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ s: "raised", k: [0], i: cursor.id, p: 2 }),
    ).toString("base64url");

    expect(() =>
      decodeCursor(`${version}.${forged}.${signature}`, "raised", SECRET),
    ).toThrow(ValidationError);
    const flipped = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    expect(() =>
      decodeCursor(`${version}.${flipped}.${signature}`, "raised", SECRET),
    ).toThrow(ValidationError);
  });

  it("rejects a cursor signed with another secret", () => {
    const token = encodeCursor(cursor, OTHER_SECRET);
    expect(() => decodeCursor(token, "raised", SECRET)).toThrow(
      ValidationError,
    );
  });

  it("rejects a cursor minted for a different sort", () => {
    const token = encodeCursor(cursor, SECRET);
    expect(() => decodeCursor(token, "name", SECRET)).toThrow(ValidationError);
  });

  it.each([
    "",
    "garbage",
    "v2.abc.def",
    "v1..",
    "v1.bm90LWpzb24.sig",
    "v1.a.b.c",
  ])("rejects malformed input %j", (token) => {
    expect(() => decodeCursor(token, "raised", SECRET)).toThrow(
      ValidationError,
    );
  });

  it("rejects correctly signed payloads with invalid contents", () => {
    for (const bad of [
      { ...cursor, page: 1 },
      { ...cursor, page: 1.5 },
      { ...cursor, id: "" },
      { ...cursor, key: [1, 2, 3, 4, 5] },
    ]) {
      const token = encodeCursor(bad as Cursor<"raised">, SECRET);
      expect(() => decodeCursor(token, "raised", SECRET)).toThrow(
        ValidationError,
      );
    }
  });
});

describe("page depth (SEC-15)", () => {
  it("lets anonymous callers reach page 20 but not 21", () => {
    expect(() =>
      assertPageAllowed(MAX_ANONYMOUS_PAGE_DEPTH, false),
    ).not.toThrow();
    expect(() =>
      assertPageAllowed(MAX_ANONYMOUS_PAGE_DEPTH + 1, false),
    ).toThrow(PaginationDepthError);
  });

  it("does not limit authenticated editors", () => {
    expect(() => assertPageAllowed(500, true)).not.toThrow();
  });
});

describe("cursorSecret", () => {
  it("requires a secret of at least 32 characters", () => {
    expect(() => cursorSecret({})).toThrow();
    expect(() => cursorSecret({ CURSOR_SIGNING_SECRET: "short" })).toThrow();
    expect(cursorSecret({ CURSOR_SIGNING_SECRET: SECRET })).toBe(SECRET);
  });
});
