import { describe, expect, it } from "vitest";
import { formatAmount, formatOriginalAmount, isWholeUsd } from "./money";

describe("formatAmount", () => {
  it.each([
    [30_000_000, "$30M"],
    [550_000_000, "$550M"],
    [1_200_000_000, "$1.2B"],
    [4_878_900, "$4.9M"],
    [750_000, "$750K"],
    [915_000, "$915K"],
    [999, "$999"],
    [0, "$0"],
  ])("%d → %s", (amount, expected) => {
    expect(formatAmount(amount)).toBe(expected);
  });

  it("renders an undisclosed round as Undisclosed, never $0", () => {
    expect(formatAmount(null, { isUndisclosed: true })).toBe("Undisclosed");
    expect(formatAmount(0, { isUndisclosed: true })).toBe("Undisclosed");
  });

  it("returns null for unknown or invalid amounts", () => {
    expect(formatAmount(null)).toBeNull();
    expect(formatAmount(undefined)).toBeNull();
    expect(formatAmount(-5)).toBeNull();
    expect(formatAmount(1.5)).toBeNull();
    expect(formatAmount(Number.NaN)).toBeNull();
  });
});

describe("isWholeUsd", () => {
  it("accepts non-negative safe integers only", () => {
    expect(isWholeUsd(0)).toBe(true);
    expect(isWholeUsd(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isWholeUsd(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isWholeUsd(-1)).toBe(false);
    expect(isWholeUsd(2.5)).toBe(false);
  });
});

describe("formatOriginalAmount", () => {
  it.each([
    [20_000_000, "EUR", "€20M"],
    [750_000, "GBP", "£750K"],
    [1_500_000_000, "INR", "₹1.5B"],
  ])("%d %s → %s", (amount, currency, expected) => {
    expect(formatOriginalAmount(amount, currency)).toBe(expected);
  });

  it("omits USD, which the USD figure already shows", () => {
    expect(formatOriginalAmount(5_000_000, "USD")).toBeNull();
  });

  it("returns null for unknown amounts and malformed currencies", () => {
    expect(formatOriginalAmount(null, "EUR")).toBeNull();
    expect(formatOriginalAmount(5, null)).toBeNull();
    expect(formatOriginalAmount(-5, "EUR")).toBeNull();
    expect(formatOriginalAmount(Number.NaN, "EUR")).toBeNull();
    expect(formatOriginalAmount(5, "eur")).toBeNull();
    expect(formatOriginalAmount(5, "EURO")).toBeNull();
  });
});
