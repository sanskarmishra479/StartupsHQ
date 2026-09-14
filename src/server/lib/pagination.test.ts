import { describe, expect, it } from "vitest";
import { clampLimit, MAX_PAGE_LIMIT, toPage } from "./pagination";

describe("clampLimit", () => {
  it.each([
    [undefined, 24],
    [Number.NaN, 24],
    [0, 1],
    [-5, 1],
    [12.9, 12],
    [1000, MAX_PAGE_LIMIT],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampLimit(input)).toBe(expected);
  });

  it("accepts a smaller maximum", () => {
    expect(clampLimit(50, 24, 12)).toBe(24);
    expect(clampLimit(undefined, 24, 12)).toBe(12);
  });
});

describe("toPage", () => {
  const cursorFor = (last: number) => `after-${last}`;

  it("uses the extra row only to detect more results", () => {
    expect(toPage([1, 2, 3], 2, String, cursorFor)).toEqual({
      data: ["1", "2"],
      pagination: { nextCursor: "after-2", hasMore: true, limit: 2 },
    });
  });

  it("has no cursor on the last page", () => {
    expect(toPage([1, 2], 2, String, cursorFor)).toEqual({
      data: ["1", "2"],
      pagination: { nextCursor: null, hasMore: false, limit: 2 },
    });
    expect(toPage([], 2, String, cursorFor).pagination.nextCursor).toBeNull();
  });
});
