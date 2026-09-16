import { describe, expect, it } from "vitest";
import { sectionFor } from "./nav";

describe("sectionFor", () => {
  it.each([
    ["/", "/"],
    ["/companies", "/companies"],
    ["/companies/acme", "/companies"],
    ["/news", "/news"],
    ["/categories/industries/ai", "/categories"],
    ["/founders/jane-doe", undefined],
    ["/companiesx", undefined],
  ])("%s → %s", (pathname, section) => {
    expect(sectionFor(pathname)).toBe(section);
  });
});
