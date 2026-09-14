import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { investments } from "../db/schema";
import { seed } from "../db/seed";
import { NotFoundError } from "../lib/errors";
import { contexts } from "../testing/authz";
import {
  fixtureId,
  fixtureRoundId,
  found,
  investors,
  startups,
} from "../testing/fixtures";
import { getBySlug, getPortfolio, getRoundsLed } from "./investors";

// docs/TEST_PLAN.md §6: investors.getPortfolio, rounds led, breakdown.

const { anonymous, publicRead, editor } = contexts;

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

const slugs = (cards: readonly { slug: string }[]) =>
  cards.map((card) => card.slug);

describe("investors.getBySlug", () => {
  it("returns counts, breakdown and the first portfolio page", async () => {
    const northwind = await found(getBySlug(publicRead, "northwind-ventures"));

    expect(northwind).toMatchObject({
      name: "Northwind Ventures",
      investorType: "vc",
      portfolioCount: 4,
      roundsLedCount: 2,
      hqLocation: { slug: "san-francisco-us" },
      pagination: { hasMore: false, nextCursor: null },
    });
    expect(slugs(northwind.portfolio).sort()).toEqual([
      "kiln-analytics",
      "lanternfish-ai",
      "pebble-notes",
      "tidewater-labs",
    ]);
    // Ties keep stage order: seed, series B, acquired, dead.
    expect(northwind.breakdown.byStage).toEqual([
      { stage: "seed", count: 1 },
      { stage: "series_b", count: 1 },
      { stage: "acquired", count: 1 },
      { stage: "dead", count: 1 },
    ]);
    expect(northwind.breakdown.byIndustry).toEqual([
      { slug: "ai", name: "AI", count: 2 },
      { slug: "climate", name: "Climate", count: 1 },
      { slug: "consumer", name: "Consumer", count: 1 },
      { slug: "devtools", name: "Developer Tools", count: 1 },
      { slug: "robotics", name: "Robotics", count: 1 },
    ]);
  });

  it("counts a backer whose round is unknown (ADR-005)", async () => {
    const atlas = await found(getBySlug(anonymous, "atlas-growth"));
    expect(atlas.portfolioCount).toBe(3);
    expect(slugs(atlas.portfolio)).toContain("orbital-forms");
    expect(atlas.roundsLedCount).toBe(2);
  });

  it("exposes only documented fields (SEC-15)", async () => {
    const investor = await found(getBySlug(anonymous, "fjord-kapital"));
    expect(Object.keys(investor).sort()).toEqual(
      [
        "aumUsd",
        "breakdown",
        "description",
        "foundedYear",
        "hqLocation",
        "investorType",
        "logo",
        "name",
        "ogImageUrl",
        "pagination",
        "portfolio",
        "portfolioCount",
        "roundsLedCount",
        "slug",
        "websiteUrl",
      ].sort(),
    );
  });

  it.each([
    "quietwater-capital",
    "old-mill-ventures",
    "no-such-fund",
  ])("is NotFound for %s everywhere a public caller asks", async (slug) => {
    for (const read of [getBySlug, getPortfolio, getRoundsLed]) {
      await expect(read(anonymous, slug)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("shows a draft investor to an editor", async () => {
    expect((await found(getBySlug(editor, "quietwater-capital"))).name).toBe(
      "Quietwater Capital",
    );
  });
});

describe("investors.getPortfolio", () => {
  it("paginates distinct companies", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await getPortfolio(anonymous, "harbor-capital", {
        cursor,
        limit: 2,
      });
      seen.push(...slugs(page.data));
      cursor = page.pagination.nextCursor ?? undefined;
    } while (cursor);

    // Harbor Capital is in two Quiet Harbor Health rounds; the company appears once.
    expect(seen.sort()).toEqual([
      "hollow-oak-security",
      "kiln-analytics",
      "orbital-forms",
      "quiet-harbor-health",
    ]);
  });

  it("filters by stage and industry", async () => {
    expect(
      slugs(
        (
          await getPortfolio(anonymous, "harbor-capital", {
            stage: ["series_b"],
          })
        ).data,
      ).sort(),
    ).toEqual(["kiln-analytics", "orbital-forms"]);
    expect(
      slugs(
        (
          await getPortfolio(anonymous, "harbor-capital", {
            industry: ["health"],
          })
        ).data,
      ),
    ).toEqual(["quiet-harbor-health"]);
  });
});

describe("investors.getRoundsLed", () => {
  it("lists led rounds newest first with their companies", async () => {
    const { data } = await getRoundsLed(anonymous, "northwind-ventures");
    expect(
      data.map(({ round, startup }) => [
        startup.slug,
        round.roundType,
        round.announcedOn,
      ]),
    ).toEqual([
      ["lanternfish-ai", "seed", "2025-09-09"],
      ["kiln-analytics", "seed", "2019-05-14"],
    ]);
    expect(data[0]?.round.investors).toContainEqual(
      expect.objectContaining({ slug: "northwind-ventures", isLead: true }),
    );
  });

  it("paginates without duplicates", async () => {
    const first = await getRoundsLed(anonymous, "harbor-capital", { limit: 3 });
    const second = await getRoundsLed(anonymous, "harbor-capital", {
      limit: 3,
      cursor: first.pagination.nextCursor ?? undefined,
    });
    const ids = [...first.data, ...second.data].map(({ round }) => round.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(second.pagination.hasMore).toBe(false);
  });

  describe("with hidden rounds and companies", () => {
    beforeAll(async () => {
      const db = getDb();
      await db.insert(investments).values([
        // Fjord Kapital leads Solstice Grid's draft series B.
        {
          startupId: await fixtureId(startups, "solstice-grid"),
          investorId: await fixtureId(investors, "fjord-kapital"),
          roundId: await fixtureRoundId("solstice-grid", "series_b"),
          isLead: true,
        },
        // Northwind backs the archived Sunset Legacy.
        {
          startupId: await fixtureId(startups, "sunset-legacy"),
          investorId: await fixtureId(investors, "northwind-ventures"),
        },
      ]);
    });

    afterAll(async () => {
      await seed(getDb());
    });

    it("never counts or lists them for the public", async () => {
      const fjord = await found(getBySlug(anonymous, "fjord-kapital"));
      expect(fjord.roundsLedCount).toBe(4);
      expect(
        (await getRoundsLed(anonymous, "fjord-kapital")).data,
      ).toHaveLength(4);

      const northwind = await found(getBySlug(anonymous, "northwind-ventures"));
      expect(northwind.portfolioCount).toBe(4);
      expect(slugs(northwind.portfolio)).not.toContain("sunset-legacy");
    });

    it("counts and lists them for an editor", async () => {
      const fjord = await found(getBySlug(editor, "fjord-kapital"));
      expect(fjord.roundsLedCount).toBe(5);

      const northwind = await found(getBySlug(editor, "northwind-ventures"));
      expect(northwind.portfolioCount).toBe(5);
      expect(slugs(northwind.portfolio)).toContain("sunset-legacy");
    });
  });
});
