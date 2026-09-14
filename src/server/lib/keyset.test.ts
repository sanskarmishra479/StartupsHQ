import { describe, expect, it } from "vitest";
import { contexts } from "../testing/authz";
import { cursorSecret, decodeCursor, encodeCursor } from "./cursor";
import { PaginationDepthError, ValidationError } from "./errors";
import { beginPage, cursorKey, finishPage } from "./keyset";

const ID = "00000000-0000-4000-8000-000000000001";

describe("beginPage", () => {
  it("starts on page 1 with a clamped limit", () => {
    expect(beginPage(contexts.anonymous, "recent", undefined, 500)).toEqual({
      sort: "recent",
      cursor: undefined,
      limit: 48,
      page: 1,
    });
  });

  it("verifies the cursor against the sort", () => {
    const token = encodeCursor(
      { sort: "name", key: ["a"], id: ID, page: 2 },
      cursorSecret(),
    );
    expect(beginPage(contexts.anonymous, "name", token, 10).page).toBe(2);
    expect(() => beginPage(contexts.anonymous, "recent", token, 10)).toThrow(
      ValidationError,
    );
  });

  it("enforces the anonymous depth limit", () => {
    const deep = encodeCursor(
      { sort: "news", key: ["2026-01-01"], id: ID, page: 21 },
      cursorSecret(),
    );
    expect(() => beginPage(contexts.publicRead, "news", deep, 10)).toThrow(
      PaginationDepthError,
    );
    expect(beginPage(contexts.editor, "news", deep, 10).page).toBe(21);
  });
});

describe("finishPage", () => {
  it("mints a cursor for the next page from the last row returned", () => {
    const request = beginPage(contexts.anonymous, "news", undefined, 2);
    const rows = [
      { id: "a", day: "2026-03-02" },
      { id: ID, day: "2026-03-01" },
      { id: "c", day: "2026-02-28" },
    ];
    const page = finishPage(
      request,
      rows,
      (row) => row.day,
      (row) => ({ key: [row.day], id: row.id }),
    );
    expect(page.data).toEqual(["2026-03-02", "2026-03-01"]);
    const next = decodeCursor(
      page.pagination.nextCursor ?? "",
      "news",
      cursorSecret(),
    );
    expect(next).toEqual({
      sort: "news",
      key: ["2026-03-01"],
      id: ID,
      page: 2,
    });
  });
});

describe("cursorKey", () => {
  const cursor = (key: (string | number | null)[]) =>
    ({ sort: "s", key, id: ID, page: 2 }) as const;

  it("returns a single key of the expected type", () => {
    expect(cursorKey(cursor(["x"]), "string")).toBe("x");
    expect(cursorKey(cursor([5]), "number")).toBe(5);
  });

  it.each([
    [["x"], "number"],
    [[5], "string"],
    [[null], "string"],
    [["x", "y"], "string"],
    [[], "string"],
  ] as const)("rejects %j as a %s key", (key, type) => {
    expect(() => cursorKey(cursor([...key]), type)).toThrow(ValidationError);
  });
});
