import { describe, expect, it } from "vitest";
import { parseExploreQuery } from "@/lib/explore-query";
import type { CategoryDirectory } from "@/types/public";
import { activeFilters } from "./explore-labels";

const directory: CategoryDirectory = [
  {
    kind: "industries",
    entries: [{ slug: "ai", name: "AI", companyCount: 8, isIndexable: true }],
  },
  {
    kind: "cities",
    entries: [
      {
        slug: "zurich-ch",
        name: "Zürich",
        companyCount: 1,
        isIndexable: false,
      },
    ],
  },
  {
    kind: "countries",
    entries: [
      {
        slug: "india",
        name: "India",
        companyCount: 1,
        isIndexable: false,
        countryCode: "IN",
      },
    ],
  },
];

describe("activeFilters", () => {
  const query = parseExploreQuery(
    new URLSearchParams(
      "stage=series_a&industry=ai&industry=quantum-computing&work_type=onsite&city=zurich-ch&country=in&investor=northwind-ventures&include_acquired=true&sort=name",
    ),
  );

  it("names every filter from the labels and the directory", () => {
    expect(activeFilters(query, directory).map((f) => f.label)).toEqual([
      "Series A",
      "AI",
      "quantum computing",
      "On-site",
      "Zürich",
      "India",
      "Backed by northwind ventures",
      "Including acquired",
    ]);
  });

  it("removes exactly one filter and keeps the rest, sort included", () => {
    const ai = activeFilters(query, directory).find(
      (f) => f.key === "industry:ai",
    );
    expect(ai?.without.industry).toEqual(["quantum-computing"]);
    expect(ai?.without.stage).toEqual(["series_a"]);
    expect(ai?.without.sort).toBe("name");
  });
});
