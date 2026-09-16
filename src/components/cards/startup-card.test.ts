import { describe, expect, it } from "vitest";
import type { StartupCard } from "@/types/public";
import { startupChips, startupCorner } from "./startup-card";

const card = (overrides: Partial<StartupCard> = {}): StartupCard => ({
  slug: "acme",
  name: "Acme",
  tagline: null,
  logo: null,
  cover: null,
  stage: null,
  workType: null,
  primaryIndustry: null,
  location: null,
  latestRound: null,
  totalRaisedUsd: null,
  acquiredBy: null,
  ...overrides,
});

const round = (
  overrides: Partial<NonNullable<StartupCard["latestRound"]>> = {},
) => ({
  roundType: "series_a" as const,
  amountUsd: 12_000_000,
  isUndisclosed: false,
  announcedOn: "2025-03-04",
  ...overrides,
});

describe("startupCorner", () => {
  it("shows the latest disclosed amount and its year", () => {
    expect(startupCorner(card({ latestRound: round() }))).toEqual({
      main: "$12M",
      detail: "2025",
    });
  });

  it("shows only the year for an undisclosed round, never $0", () => {
    expect(
      startupCorner(
        card({ latestRound: round({ isUndisclosed: true, amountUsd: null }) }),
      ),
    ).toEqual({ main: "2025", detail: null });
  });

  it("falls back to acquisition, then city, then country", () => {
    const location = {
      slug: "berlin-de",
      city: "Berlin",
      country: "Germany",
      countryCode: "DE",
    };
    expect(
      startupCorner(
        card({ acquiredBy: { name: "Big", slug: null }, location }),
      ),
    ).toEqual({ main: "Acquired", detail: null });
    expect(startupCorner(card({ location }))).toEqual({
      main: "Berlin",
      detail: null,
    });
    expect(
      startupCorner(card({ location: { ...location, city: null } })),
    ).toEqual({ main: "Germany", detail: null });
    expect(startupCorner(card())).toBeNull();
  });
});

describe("startupChips", () => {
  it("lists stage, industry and work type, skipping the unknown", () => {
    expect(
      startupChips(
        card({
          stage: "series_a",
          workType: "remote",
          primaryIndustry: { slug: "fintech", name: "Fintech", iconUrl: null },
        }),
      ),
    ).toEqual(["Series A", "Fintech", "Remote"]);
    expect(startupChips(card({ workType: "onsite" }))).toEqual(["On-site"]);
  });
});
