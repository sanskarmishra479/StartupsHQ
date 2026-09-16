import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import type { CategoryDirectory } from "../dto/category";
import { NotFoundError } from "../lib/errors";
import { contexts } from "../testing/authz";
import { getPage, listCategories } from "./taxonomy";

// docs/TEST_PLAN.md §6: taxonomy.getPage, and the /categories directory (FR-107, FR-108).

const { anonymous, publicRead, editor } = contexts;

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

describe("taxonomy.getPage", () => {
  it("uses editable copy when a taxonomy row exists", async () => {
    const page = await getPage(publicRead, "industries", "ai");
    expect(page).toMatchObject({
      kind: "industries",
      slug: "ai",
      heading: "AI startups",
      intro: "Companies building with machine learning.",
      seoTitle: "AI Startups | StartupsHQ",
      isGenerated: false,
      isIndexable: true,
      companyCount: 8,
    });
    expect(page.companies).toHaveLength(8);
  });

  it("fills fields missing from a copy row, without calling it generated", async () => {
    expect(await getPage(anonymous, "stages", "seed")).toMatchObject({
      heading: "Seed-stage startups",
      intro: null,
      seoTitle: "Seed-stage startups | StartupsHQ",
      isGenerated: false,
      companyCount: 6,
    });
  });

  it("generates copy for a real value without a row", async () => {
    expect(await getPage(anonymous, "work-type", "remote")).toMatchObject({
      heading: "Remote startups",
      intro: null,
      seoTitle: "Remote startups | StartupsHQ",
      seoDescription:
        "Remote startups: funding rounds, founders and investors on StartupsHQ.",
      isGenerated: true,
      isIndexable: true,
      companyCount: 8,
    });
  });

  it("marks a facet with fewer than 5 companies as not indexable", async () => {
    expect(await getPage(anonymous, "industries", "robotics")).toMatchObject({
      companyCount: 3,
      isIndexable: false,
      isGenerated: true,
    });
  });

  it.each([
    ["stages", "series-a", "Series A startups", 4],
    ["cities", "zurich-ch", "Startups in Zürich", 1],
    ["countries", "india", "Startups in India", 1],
  ])("resolves %s/%s", async (kind, slug, heading, companyCount) => {
    expect(await getPage(anonymous, kind, slug)).toMatchObject({
      heading,
      companyCount,
    });
  });

  it("counts acquired companies but not archived ones", async () => {
    const consumer = await getPage(anonymous, "industries", "consumer");
    expect(consumer.companyCount).toBe(3);
    expect(consumer.companies.map((card) => card.slug)).toContain(
      "pebble-notes",
    );
    expect((await getPage(editor, "industries", "consumer")).companyCount).toBe(
      4,
    );
  });

  it("paginates the companies", async () => {
    const first = await getPage(anonymous, "industries", "ai", { limit: 5 });
    const second = await getPage(anonymous, "industries", "ai", {
      limit: 5,
      cursor: first.pagination.nextCursor ?? undefined,
    });
    const slugs = [...first.companies, ...second.companies].map(
      (card) => card.slug,
    );
    expect(new Set(slugs).size).toBe(8);
    expect(second.pagination.hasMore).toBe(false);
  });

  it.each([
    ["industries", "anything-at-all"],
    ["industries", "quantum"], // exists, but only a draft company
    ["stages", "series_a"],
    ["stages", "unicorn"],
    ["work-type", "office"],
    ["cities", "india"], // a country row, not a city
    ["countries", "berlin-de"], // a city row, not a country
    ["countries", "united-states"],
    ["people", "ai"],
    ["industries", "AI"],
  ])("is NotFound for %s/%s", async (kind, slug) => {
    await expect(getPage(anonymous, kind, slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("shows a facet with only draft companies to an editor", async () => {
    expect((await getPage(editor, "industries", "quantum")).companyCount).toBe(
      1,
    );
  });

  it("exposes only documented fields", async () => {
    expect(
      Object.keys(await getPage(anonymous, "industries", "ai")).sort(),
    ).toEqual(
      [
        "companies",
        "companyCount",
        "heading",
        "iconUrl",
        "intro",
        "isGenerated",
        "isIndexable",
        "kind",
        "pagination",
        "seoDescription",
        "seoTitle",
        "slug",
      ].sort(),
    );
  });
});

describe("taxonomy.listCategories", () => {
  const entries = (directory: CategoryDirectory, kind: string) =>
    directory.find((group) => group.kind === kind)?.entries ?? [];

  it("lists every facet value with a published company, grouped by kind", async () => {
    const directory = await listCategories(anonymous);

    expect(directory.map((group) => group.kind)).toEqual([
      "industries",
      "stages",
      "work-type",
      "cities",
      "countries",
    ]);
    expect(entries(directory, "industries")).toContainEqual({
      slug: "ai",
      name: "AI",
      companyCount: 8,
      isIndexable: true,
    });
    expect(entries(directory, "industries")).toContainEqual({
      slug: "robotics",
      name: "Robotics",
      companyCount: 3,
      isIndexable: false,
    });
    expect(
      entries(directory, "industries").map((entry) => entry.slug),
    ).not.toContain("quantum");
    expect(entries(directory, "stages")).toContainEqual({
      slug: "series-a",
      name: "Series A",
      companyCount: 4,
      isIndexable: false,
    });
    expect(entries(directory, "work-type")).toEqual([
      { slug: "remote", name: "Remote", companyCount: 8, isIndexable: true },
      { slug: "onsite", name: "On-site", companyCount: 7, isIndexable: true },
      { slug: "hybrid", name: "Hybrid", companyCount: 2, isIndexable: false },
    ]);
    expect(entries(directory, "cities")).toContainEqual({
      slug: "zurich-ch",
      name: "Zürich",
      companyCount: 1,
      isIndexable: false,
    });
    expect(entries(directory, "countries")).toEqual([
      {
        slug: "india",
        name: "India",
        companyCount: 1,
        isIndexable: false,
        countryCode: "IN",
      },
    ]);
  });

  it("agrees with the category pages on every count", async () => {
    for (const group of await listCategories(anonymous)) {
      for (const entry of group.entries) {
        const page = await getPage(anonymous, group.kind, entry.slug);
        expect([group.kind, entry.slug, page.companyCount]).toEqual([
          group.kind,
          entry.slug,
          entry.companyCount,
        ]);
      }
    }
  });

  it("includes draft-only facets for an editor", async () => {
    expect(
      entries(await listCategories(editor), "industries").map(
        (entry) => entry.slug,
      ),
    ).toContain("quantum");
  });
});
