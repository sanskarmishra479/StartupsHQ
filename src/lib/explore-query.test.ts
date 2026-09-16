import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  appendUnique,
  DEFAULT_EXPLORE_QUERY,
  exploreApiUrl,
  isDefaultExploreQuery,
  parseExploreQuery,
  toExploreSearchParams,
} from "./explore-query";

const parse = (query: string) => parseExploreQuery(new URLSearchParams(query));

describe("parseExploreQuery", () => {
  it("reads every facet, sort and search", () => {
    expect(
      parse(
        "stage=seed&stage=series_a&industry=ai&work_type=remote&city=berlin-de&country=de&batch=yc-w24&investor=a16z&founder=jane-doe&q=%20payments%20&include_acquired=true&sort=raised",
      ),
    ).toEqual({
      stage: ["seed", "series_a"],
      industry: ["ai"],
      workType: ["remote"],
      city: ["berlin-de"],
      country: "DE",
      batch: "yc-w24",
      investor: "a16z",
      founder: "jane-doe",
      q: "payments",
      includeAcquired: true,
      sort: "raised",
    });
  });

  it("drops malformed values instead of failing", () => {
    expect(
      parse(
        "stage=unicorn&stage=seed&industry=Not%20A%20Slug&work_type=mars&country=Germany&batch=__&q=a&sort=popular&include_acquired=yes",
      ),
    ).toEqual({ ...DEFAULT_EXPLORE_QUERY, stage: ["seed"] });
  });

  it("dedupes and caps repeated values", () => {
    const many = Array.from({ length: 30 }, (_, i) => `industry=i${i}`).join(
      "&",
    );
    expect(parse(`${many}&industry=i1`).industry).toHaveLength(20);
    expect(parse("stage=seed&stage=seed").stage).toEqual(["seed"]);
  });

  it("accepts Next.js searchParams records", () => {
    expect(
      parseExploreQuery({
        stage: ["seed", "growth"],
        sort: "name",
        other: "x",
      }),
    ).toMatchObject({ stage: ["growth", "seed"], sort: "name" });
  });
});

describe("toExploreSearchParams", () => {
  it("is canonical, so the same filters always give the same URL", () => {
    const a = parse(
      "sort=name&stage=seed&industry=fintech&stage=growth&industry=ai",
    );
    const b = parse(
      "industry=ai&stage=growth&industry=fintech&stage=seed&sort=name",
    );
    expect(toExploreSearchParams(a).toString()).toBe(
      "stage=growth&stage=seed&industry=ai&industry=fintech&sort=name",
    );
    expect(toExploreSearchParams(b).toString()).toBe(
      toExploreSearchParams(a).toString(),
    );
  });

  it("round-trips through parsing", () => {
    const query = parse(
      "stage=seed&work_type=hybrid&city=nairobi-ke&country=KE&q=solar%20power&include_acquired=true&sort=raised",
    );
    expect(parseExploreQuery(toExploreSearchParams(query))).toEqual(query);
  });

  it("leaves defaults out", () => {
    expect(toExploreSearchParams(DEFAULT_EXPLORE_QUERY).toString()).toBe("");
    expect(
      isDefaultExploreQuery(parse("sort=recent&include_acquired=false")),
    ).toBe(true);
    expect(isDefaultExploreQuery(parse("sort=name"))).toBe(false);
  });
});

describe("helpers", () => {
  it("counts filters, not sort or search", () => {
    expect(
      activeFilterCount(
        parse("stage=seed&stage=growth&country=IN&q=solar&sort=name"),
      ),
    ).toBe(3);
  });

  it("builds the API URL with the page size and cursor", () => {
    expect(exploreApiUrl(parse("stage=seed"), "abc")).toBe(
      "/api/v1/startups?stage=seed&limit=24&cursor=abc",
    );
    expect(exploreApiUrl(DEFAULT_EXPLORE_QUERY, null)).toBe(
      "/api/v1/startups?limit=24",
    );
  });

  it("never shows a card twice across pages", () => {
    const shown = [{ slug: "a" }, { slug: "b" }];
    expect(appendUnique(shown, [{ slug: "b" }, { slug: "c" }])).toEqual([
      { slug: "a" },
      { slug: "b" },
      { slug: "c" },
    ]);
  });
});
