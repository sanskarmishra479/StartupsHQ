import { describe, expect, it } from "vitest";
import { categoryCompaniesQuery, paths } from "./links";

describe("paths", () => {
  it("builds every category route shape", () => {
    expect(paths.category("industries", "ai")).toBe(
      "/categories/industries/ai",
    );
    expect(paths.category("stages", "series-a")).toBe(
      "/categories/stages/series-a",
    );
    expect(paths.category("work-type", "onsite")).toBe(
      "/categories/work-type/onsite",
    );
    expect(paths.category("cities", "berlin-de")).toBe(
      "/categories/locations/cities/berlin-de",
    );
    expect(paths.category("countries", "india")).toBe(
      "/categories/locations/countries/india",
    );
    expect(paths.stage("series_a")).toBe("/categories/stages/series-a");
  });
});

describe("categoryCompaniesQuery", () => {
  it.each([
    ["industries", "ai", undefined, "industry=ai&include_acquired=true"],
    ["stages", "pre-seed", undefined, "stage=pre_seed&include_acquired=true"],
    [
      "work-type",
      "onsite",
      undefined,
      "work_type=onsite&include_acquired=true",
    ],
    ["cities", "berlin-de", undefined, "city=berlin-de&include_acquired=true"],
    ["countries", "india", "IN", "country=IN&include_acquired=true"],
  ] as const)("%s/%s → %s", (kind, slug, code, expected) => {
    expect(categoryCompaniesQuery(kind, slug, code)).toBe(expected);
  });

  it("cannot continue a country without its code", () => {
    expect(categoryCompaniesQuery("countries", "india")).toBeNull();
  });
});
