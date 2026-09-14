import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authedContext, PUBLIC_READ, publicContext } from "../auth/context";
import { closeDb, getDb } from "../db/client";
import {
  batches,
  founders,
  investments,
  investors,
  startupBatches,
  startupFounders,
  startups,
} from "../db/schema";
import { seed } from "../db/seed";
import type { Startup } from "../dto/startup";
import { cursorSecret, encodeCursor } from "../lib/cursor";
import {
  NotFoundError,
  PaginationDepthError,
  ValidationError,
} from "../lib/errors";
import {
  getBySlug,
  list,
  listSimilar,
  type StartupFilters,
  type StartupSort,
} from "./startups";

// docs/TEST_PLAN.md §6: startups.getBySlug, startups.list, similar companies.

const anonymous = publicContext("203.0.113.9");
const editor = authedContext(
  { id: "00000000-0000-4000-8000-0000000000e1", role: "editor" },
  "203.0.113.10",
);

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

async function found(ctx: Parameters<typeof getBySlug>[0], slug: string) {
  const result = await getBySlug(ctx, slug);
  if (result.kind !== "found") throw new Error(`expected ${slug} to be found`);
  return result.value;
}

const slugsOf = (items: readonly { slug: string }[]) =>
  items.map((item) => item.slug);

describe("startups.getBySlug", () => {
  it("returns the full graph for a published startup", async () => {
    const kiln = await found(PUBLIC_READ, "kiln-analytics");

    expect(kiln).toMatchObject({
      slug: "kiln-analytics",
      name: "Kiln Analytics",
      stage: "series_b",
      totalRaisedUsd: 54_500_000,
      totalDebtUsd: null,
      location: {
        slug: "berlin-de",
        city: "Berlin",
        country: "Germany",
        countryCode: "DE",
      },
      primaryIndustry: { slug: "devtools", name: "Developer Tools" },
      latestRound: {
        roundType: "series_b",
        amountUsd: 40_000_000,
        isUndisclosed: false,
        announcedOn: "2024-10-03",
      },
      acquiredBy: null,
    });
    expect(kiln.logo).toEqual({
      url: "https://example.com/blob/fixtures/kiln-analytics-logo/256.webp",
      blurDataUrl: expect.stringMatching(/^data:image\/webp;base64,/),
      width: 256,
      height: 256,
      variants: [64, 128, 256].map((width) => ({
        width,
        url: `https://example.com/blob/fixtures/kiln-analytics-logo/${width}.webp`,
      })),
    });
    expect(kiln.industries).toEqual([
      { slug: "devtools", name: "Developer Tools", isPrimary: true },
      { slug: "ai", name: "AI", isPrimary: false },
    ]);
    // Mira Okafor left and came back, so she appears once per stint.
    expect(
      kiln.founders.map(({ slug, joinedYear }) => [slug, joinedYear]),
    ).toEqual([
      ["mira-okafor", 2024],
      ["mira-okafor", 2019],
      ["tomasz-wrobel", 2019],
    ]);
    expect(kiln.investors).toEqual([
      expect.objectContaining({ slug: "fjord-kapital", isLead: true }),
      expect.objectContaining({ slug: "harbor-capital", isLead: true }),
      // Led the seed round, followed on in the series B.
      expect.objectContaining({ slug: "northwind-ventures", isLead: true }),
    ]);
    expect(kiln.rounds.map((round) => round.roundType)).toEqual([
      "series_b",
      "series_a",
      "seed",
    ]);
    expect(kiln.rounds[0]?.investors).toEqual([
      {
        slug: "harbor-capital",
        name: "Harbor Capital",
        logo: null,
        isLead: true,
      },
      {
        slug: "northwind-ventures",
        name: "Northwind Ventures",
        logo: null,
        isLead: false,
      },
    ]);
  });

  it("exposes only documented fields (SEC-15)", async () => {
    const kiln = await found(anonymous, "kiln-analytics");
    expect(Object.keys(kiln).sort()).toEqual(
      [
        "acquiredAmountUsd",
        "acquiredBy",
        "acquiredOn",
        "batches",
        "careersUrl",
        "cover",
        "description",
        "founders",
        "foundedOn",
        "foundedYear",
        "headcountBand",
        "industries",
        "investors",
        "isActive",
        "latestRound",
        "legalName",
        "links",
        "location",
        "logo",
        "name",
        "ogImageUrl",
        "primaryIndustry",
        "rounds",
        "slug",
        "stage",
        "tagline",
        "totalDebtUsd",
        "totalRaisedUsd",
        "updatedAt",
        "websiteUrl",
        "workType",
      ].sort(),
    );
    expect(JSON.stringify({ ...kiln, rounds: [] })).not.toMatch(
      /"(id|status|createdBy|updatedBy)"/,
    );
  });

  it.each([
    "stealth-draft-co",
    "sunset-legacy",
    "no-such-company",
    "Not A Slug",
  ])("is NotFound for %s to public callers", async (slug) => {
    await expect(getBySlug(anonymous, slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getBySlug(PUBLIC_READ, slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("shows drafts to an editor", async () => {
    expect((await found(editor, "stealth-draft-co")).name).toBe(
      "Stealth Draft Co",
    );
  });

  it("redirects an old slug to the current one", async () => {
    expect(await getBySlug(anonymous, "kiln-data")).toEqual({
      kind: "redirect",
      slug: "kiln-analytics",
    });
  });

  it("counts only published rounds, and hides the others from the public", async () => {
    const publicView = await found(anonymous, "solstice-grid");
    expect(publicView).toMatchObject({
      totalRaisedUsd: 15_000_000,
      totalDebtUsd: 10_000_000,
    });
    expect(publicView.rounds.map((round) => round.roundType)).toEqual([
      "secondary",
      "series_a",
      "debt",
      "grant",
      "seed",
    ]);

    const editorView = await found(editor, "solstice-grid");
    expect(editorView.rounds.map((round) => round.roundType)).toEqual(
      expect.arrayContaining(["series_b", "bridge"]),
    );
  });

  it("maps undisclosed, USD and converted rounds", async () => {
    const quietHarbor = await found(anonymous, "quiet-harbor-health");
    expect(quietHarbor.latestRound).toEqual({
      roundType: "series_a",
      amountUsd: null,
      isUndisclosed: true,
      announcedOn: "2025-11-04",
    });
    expect(quietHarbor.rounds[0]).toMatchObject({
      isUndisclosed: true,
      amountUsd: null,
      amountOriginal: null,
      fxRate: null,
      fxRateDate: null,
      currency: "USD",
    });
    expect(quietHarbor.rounds[1]).toMatchObject({
      amountUsd: 3_000_000,
      amountOriginal: 3_000_000,
      currency: "USD",
      fxRate: 1,
      fxRateDate: "2021-01-19",
    });

    const [euroRound] = (await found(anonymous, "fjordline-energy")).rounds;
    expect(euroRound).toMatchObject({
      roundClass: "equity",
      currency: "EUR",
      amountOriginal: 4_500_000,
      fxRate: 1.0842,
      fxRateDate: "2026-03-02",
      amountUsd: 4_878_900,
    });
  });

  it("names the acquirer from the directory or from free text", async () => {
    expect((await found(anonymous, "pebble-notes")).acquiredBy).toEqual({
      name: "Kiln Analytics",
      slug: "kiln-analytics",
    });
    expect((await found(anonymous, "driftwood-maps")).acquiredBy).toEqual({
      name: "Globex Corporation",
      slug: null,
    });
  });

  it("returns empty relations and unknown totals rather than zeroes", async () => {
    expect((await found(anonymous, "hollow-oak-security")).founders).toEqual(
      [],
    );
    const paperCrane = await found(anonymous, "paper-crane-studio");
    expect(paperCrane).toMatchObject({
      rounds: [],
      investors: [],
      batches: [],
      latestRound: null,
      totalRaisedUsd: null,
    });
  });

  it("uses at most 3 round-trips on a cache miss (NFR-01)", async () => {
    // Database is typed without its driver client; at runtime it is the pg Pool.
    const { $client: pool } = getDb() as unknown as {
      $client: { query: (...args: unknown[]) => unknown };
    };
    const query = vi.spyOn(pool, "query");
    try {
      await found(PUBLIC_READ, "kiln-analytics");
      // Non-zero proves the spy sees the queries; the cap is the requirement.
      expect(query.mock.calls.length).toBeGreaterThan(0);
      expect(query.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      query.mockRestore();
    }
  });

  describe("hidden related records", () => {
    beforeAll(async () => {
      const db = getDb();
      const id = async (
        table:
          | typeof startups
          | typeof founders
          | typeof investors
          | typeof batches,
        slug: string,
      ) => {
        const [row] = await db
          .select({ id: table.id })
          .from(table)
          .where(eq(table.slug, slug));
        if (!row) throw new Error(`missing fixture ${slug}`);
        return row.id;
      };
      const kiln = await id(startups, "kiln-analytics");
      await db.insert(startupFounders).values({
        startupId: kiln,
        founderId: await id(founders, "unverified-founder"),
        role: "advisor",
        isCurrent: true,
        joinedYear: 2025,
      });
      await db.insert(investments).values({
        startupId: kiln,
        investorId: await id(investors, "quietwater-capital"),
      });
      await db.insert(startupBatches).values({
        startupId: kiln,
        batchId: await id(batches, "parallel-w26"),
      });
    });

    afterAll(async () => {
      await seed(getDb());
    });

    it("never shows a draft founder, investor or batch to the public", async () => {
      for (const ctx of [anonymous, PUBLIC_READ]) {
        const kiln: Startup = await found(ctx, "kiln-analytics");
        expect(slugsOf(kiln.founders)).not.toContain("unverified-founder");
        expect(slugsOf(kiln.investors)).not.toContain("quietwater-capital");
        expect(slugsOf(kiln.batches)).not.toContain("parallel-w26");
      }
    });

    it("shows them to an editor", async () => {
      const kiln = await found(editor, "kiln-analytics");
      expect(slugsOf(kiln.founders)).toContain("unverified-founder");
      expect(slugsOf(kiln.investors)).toContain("quietwater-capital");
      expect(slugsOf(kiln.batches)).toContain("parallel-w26");
    });

    it("does not let a hidden investor or batch match a public filter", async () => {
      expect(
        (await list(anonymous, { filters: { investor: "quietwater-capital" } }))
          .data,
      ).toEqual([]);
      expect(
        (await list(anonymous, { filters: { batch: "parallel-w26" } })).data,
      ).toEqual([]);
    });
  });
});

describe("startups.list", () => {
  const filtered = async (filters: StartupFilters) =>
    slugsOf((await list(anonymous, { filters, limit: 48 })).data).sort();

  it("excludes acquired companies by default, and hidden ones always", async () => {
    const byDefault = await filtered({});
    expect(byDefault).toHaveLength(15);
    expect(byDefault).not.toContain("pebble-notes");
    expect(byDefault).not.toContain("stealth-draft-co");
    expect(byDefault).not.toContain("sunset-legacy");

    const withAcquired = await filtered({ includeAcquired: true });
    expect(withAcquired).toHaveLength(17);
    expect(withAcquired).toEqual(
      expect.arrayContaining(["pebble-notes", "driftwood-maps"]),
    );
  });

  it.each<[string, StartupFilters, string[]]>([
    [
      "stage (OR within a facet)",
      { stage: ["series_b", "pre_seed"] },
      ["cafe-algorithmique", "kiln-analytics", "orbital-forms"],
    ],
    [
      "industry and work type (AND across facets)",
      { industry: ["climate"], workType: ["onsite"] },
      ["fjordline-energy", "solstice-grid", "tidewater-labs"],
    ],
    [
      "city",
      { city: ["new-york-us"] },
      ["orbital-forms", "quiet-harbor-health", "tidewater-labs"],
    ],
    ["country", { country: "sg" }, ["hollow-oak-security", "tidal-ledger"]],
    ["batch", { batch: "launchpad-sr1" }, ["lanternfish-ai"]],
    [
      "investor",
      { investor: "northwind-ventures", includeAcquired: true },
      ["kiln-analytics", "lanternfish-ai", "pebble-notes", "tidewater-labs"],
    ],
    [
      "founder",
      { founder: "mira-okafor" },
      ["kiln-analytics", "lanternfish-ai", "tidewater-labs"],
    ],
    ["full text on the tagline", { q: "firmware" }, ["hollow-oak-security"]],
    ["full text without diacritics", { q: "cafe" }, ["cafe-algorithmique"]],
  ])("filters by %s", async (_label, filters, expected) => {
    expect(await filtered(filters)).toEqual(expected);
  });

  it("clamps the page size", async () => {
    expect((await list(anonymous, { limit: 1000 })).pagination.limit).toBe(48);
  });

  describe.each<StartupSort>([
    "recent",
    "raised",
    "name",
  ])("sort %s", (sort) => {
    async function collect(
      limit: number,
      afterFirstPage?: () => Promise<void>,
    ): Promise<string[]> {
      const slugs: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await list(anonymous, { sort, cursor, limit });
        slugs.push(...slugsOf(page.data));
        cursor = page.pagination.nextCursor ?? undefined;
        pages += 1;
        if (pages === 1) await afterFirstPage?.();
      } while (cursor);
      return slugs;
    }

    it("paginates without duplicates or gaps while rows are inserted", async () => {
      const expected = await collect(48);
      const inserted = `inserted-during-${sort}`;
      try {
        const paged = await collect(4, async () => {
          await getDb().insert(startups).values({
            slug: inserted,
            name: "Mid Pagination Inserted",
            status: "published",
            firstPublishedAt: new Date(),
            totalRaisedUsd: 1_000_000,
          });
        });
        expect(new Set(paged).size).toBe(paged.length);
        expect(paged.filter((slug) => slug !== inserted)).toEqual(expected);
      } finally {
        await getDb().delete(startups).where(eq(startups.slug, inserted));
      }
    });

    it("rejects a cursor minted for another sort", async () => {
      const other: StartupSort = sort === "name" ? "recent" : "name";
      const { nextCursor } = (await list(anonymous, { sort: other, limit: 2 }))
        .pagination;
      await expect(
        list(anonymous, { sort, cursor: nextCursor ?? "" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  it("rejects a tampered cursor", async () => {
    const { nextCursor } = (await list(anonymous, { limit: 2 })).pagination;
    await expect(
      list(anonymous, { cursor: `${nextCursor}x` }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a validly signed cursor whose key has the wrong type", async () => {
    const cursor = encodeCursor(
      {
        sort: "raised",
        key: ["not-a-number"],
        id: "00000000-0000-4000-8000-000000000000",
        page: 2,
      },
      cursorSecret(),
    );
    await expect(
      list(anonymous, { sort: "raised", cursor }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("limits anonymous pagination depth, but not editors (SEC-15)", async () => {
    const deep = encodeCursor(
      {
        sort: "recent",
        key: ["2000-01-01 00:00:00+00"],
        id: "00000000-0000-4000-8000-000000000000",
        page: 21,
      },
      cursorSecret(),
    );
    await expect(list(anonymous, { cursor: deep })).rejects.toBeInstanceOf(
      PaginationDepthError,
    );
    await expect(list(PUBLIC_READ, { cursor: deep })).rejects.toBeInstanceOf(
      PaginationDepthError,
    );
    await expect(list(editor, { cursor: deep })).resolves.toMatchObject({
      data: [],
    });
  });

  it("returns cards with only documented fields", async () => {
    const [card] = (await list(anonymous, { filters: { q: "firmware" } })).data;
    expect(Object.keys(card ?? {}).sort()).toEqual(
      [
        "acquiredBy",
        "cover",
        "latestRound",
        "location",
        "logo",
        "name",
        "primaryIndustry",
        "slug",
        "stage",
        "tagline",
        "totalRaisedUsd",
        "workType",
      ].sort(),
    );
  });
});

describe("startups.listSimilar", () => {
  it("ranks primary industry over stage over city, and never the subject", async () => {
    const similar = slugsOf(await listSimilar(anonymous, "kiln-analytics"));
    // orbital-forms: industry + stage; driftwood-maps: industry only.
    expect(similar.slice(0, 2)).toEqual(["orbital-forms", "driftwood-maps"]);
    expect(similar).not.toContain("kiln-analytics");
    expect(similar.length).toBeLessThanOrEqual(9);
  });

  it("is NotFound for a hidden subject", async () => {
    await expect(
      listSimilar(anonymous, "stealth-draft-co"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never suggests a hidden company to the public", async () => {
    const hidden = await getDb()
      .select({ slug: startups.slug })
      .from(startups)
      .where(inArray(startups.status, ["draft", "archived"]));
    const similar = slugsOf(await listSimilar(anonymous, "cafe-algorithmique"));
    expect(hidden.length).toBeGreaterThan(0);
    for (const { slug } of hidden) expect(similar).not.toContain(slug);
  });
});
