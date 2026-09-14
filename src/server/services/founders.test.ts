import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "../db/client";
import { startupFounders } from "../db/schema";
import { seed } from "../db/seed";
import { NotFoundError } from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, found, founders, startups } from "../testing/fixtures";
import { getBySlug } from "./founders";

// docs/TEST_PLAN.md §6: founders.getBySlug.

const { anonymous, publicRead, editor } = contexts;

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

describe("founders.getBySlug", () => {
  it("lists every startup, both stints included, newest first", async () => {
    const mira = await found(getBySlug(publicRead, "mira-okafor"));

    expect(
      mira.startups.map(({ startup, joinedYear, isCurrent }) => [
        startup.slug,
        joinedYear,
        isCurrent,
      ]),
    ).toEqual([
      ["kiln-analytics", 2024, true],
      ["lanternfish-ai", 2022, true],
      ["kiln-analytics", 2019, false],
      ["tidewater-labs", 2016, false],
    ]);
    expect(mira.startupCount).toBe(3);
    expect(mira).toMatchObject({
      fullName: "Mira Okafor",
      photo: null,
      links: { personal: "https://example.com/people/mira-okafor" },
      location: { slug: "san-francisco-us", countryCode: "US" },
    });
    expect(mira.startups[2]).toMatchObject({ role: "ceo", leftYear: 2021 });
  });

  it("exposes only documented fields (SEC-15)", async () => {
    const founder = await found(getBySlug(anonymous, "tomasz-wrobel"));
    expect(Object.keys(founder).sort()).toEqual(
      [
        "bio",
        "fullName",
        "headline",
        "links",
        "location",
        "ogImageUrl",
        "photo",
        "slug",
        "startupCount",
        "startups",
        "updatedAt",
      ].sort(),
    );
  });

  it("keeps names written in any script", async () => {
    expect((await found(getBySlug(anonymous, "sato-hanako"))).fullName).toBe(
      "佐藤 花子",
    );
  });

  it("includes acquired companies with their acquirer", async () => {
    const [stint] = (await found(getBySlug(anonymous, "jose-nunez"))).startups;
    expect(stint?.startup.acquiredBy).toEqual({
      name: "Kiln Analytics",
      slug: "kiln-analytics",
    });
  });

  it.each([
    "unverified-founder",
    "former-founder",
    "nobody-at-all",
  ])("is NotFound for %s to public callers", async (slug) => {
    await expect(getBySlug(anonymous, slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getBySlug(publicRead, slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("shows a draft founder to an editor", async () => {
    expect(
      (await found(getBySlug(editor, "unverified-founder"))).fullName,
    ).toBe("Unverified Founder");
  });

  it("uses at most 3 round-trips (NFR-01)", async () => {
    const { $client: pool } = getDb() as unknown as {
      $client: { query: (...args: unknown[]) => unknown };
    };
    const query = vi.spyOn(pool, "query");
    try {
      await found(getBySlug(publicRead, "mira-okafor"));
      expect(query.mock.calls.length).toBeGreaterThan(0);
      expect(query.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      query.mockRestore();
    }
  });

  describe("with a stint at a hidden startup", () => {
    beforeAll(async () => {
      await getDb()
        .insert(startupFounders)
        .values({
          startupId: await fixtureId(startups, "stealth-draft-co"),
          founderId: await fixtureId(founders, "mira-okafor"),
          role: "advisor",
          isCurrent: true,
          joinedYear: 2026,
        });
    });

    afterAll(async () => {
      await seed(getDb());
    });

    it("hides the stint and does not count it for the public", async () => {
      const mira = await found(getBySlug(anonymous, "mira-okafor"));
      expect(mira.startups.map(({ startup }) => startup.slug)).not.toContain(
        "stealth-draft-co",
      );
      expect(mira.startupCount).toBe(3);
    });

    it("shows it to an editor", async () => {
      const mira = await found(getBySlug(editor, "mira-okafor"));
      expect(mira.startups[0]?.startup.slug).toBe("stealth-draft-co");
      expect(mira.startupCount).toBe(4);
    });
  });
});
