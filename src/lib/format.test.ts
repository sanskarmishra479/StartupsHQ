import { describe, expect, it } from "vitest";
import {
  displayHost,
  formatDate,
  formatHeadcount,
  formatMonth,
  formatTenure,
  safeExternalUrl,
} from "./format";

describe("dates", () => {
  it("formats ISO dates in UTC, whatever the local zone", () => {
    expect(formatDate("2026-09-10")).toBe("Sep 10, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatMonth("2026-09-10")).toBe("September 2026");
  });

  it("leaves anything that is not a date alone", () => {
    expect(formatDate("soon")).toBe("soon");
    expect(formatDate("2026-13-45")).toBe("2026-13-45");
  });
});

describe("formatTenure", () => {
  it.each([
    [2019, 2023, false, "2019–2023"],
    [2021, 2021, false, "2021"],
    [2021, null, true, "2021–present"],
    [2021, null, false, "Since 2021"],
    [null, 2020, false, "Until 2020"],
    [null, null, true, null],
  ])("%s–%s (current %s) → %s", (joined, left, current, expected) => {
    expect(formatTenure(joined, left, current)).toBe(expected);
  });
});

describe("links and bands", () => {
  it("allows only http(s) links", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,x")).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });

  it("shows hosts and team sizes readably", () => {
    expect(displayHost("https://www.highstock.com/about")).toBe(
      "highstock.com",
    );
    expect(formatHeadcount("51-200")).toBe("51–200 people");
    expect(formatHeadcount("1000+")).toBe("1000+ people");
    expect(formatHeadcount(null)).toBeNull();
  });
});
