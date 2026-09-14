import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { startupBatches } from "../db/schema";
import { seed } from "../db/seed";
import { NotFoundError } from "../lib/errors";
import { contexts } from "../testing/authz";
import { batches, fixtureId, found, startups } from "../testing/fixtures";
import { getBySlug, getStats } from "./batches";

// docs/TEST_PLAN.md §6: batches.getStats and the cohort page.

const { anonymous, publicRead, editor } = contexts;

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

describe("batches.getBySlug", () => {
  it("returns the batch, its organizer, stats and cohort", async () => {
    const batch = await found(getBySlug(publicRead, "parallel-w25"));

    expect(batch).toMatchObject({
      programName: "Parallel Accelerator",
      label: "W25",
      season: "winter",
      investor: {
        slug: "parallel-accelerator",
        name: "Parallel Accelerator",
        investorType: "accelerator",
        logo: null,
      },
      stats: {
        companyCount: 1,
        totalRaisedUsd: 4_750_000,
        topIndustries: [
          { slug: "ai", name: "AI", count: 1 },
          { slug: "robotics", name: "Robotics", count: 1 },
        ],
      },
      pagination: { hasMore: false },
    });
    expect(batch.companies.map((card) => card.slug)).toEqual([
      "lanternfish-ai",
    ]);
  });

  it("exposes only documented fields (SEC-15)", async () => {
    const batch = await found(getBySlug(anonymous, "launchpad-sr1"));
    expect(Object.keys(batch).sort()).toEqual(
      [
        "companies",
        "demoDayOn",
        "description",
        "investor",
        "label",
        "logo",
        "pagination",
        "programName",
        "season",
        "slug",
        "startsOn",
        "stats",
        "year",
      ].sort(),
    );
  });

  it.each([
    "parallel-w26",
    "parallel-s24",
    "no-such-batch",
  ])("is NotFound for %s to public callers", async (slug) => {
    await expect(getBySlug(anonymous, slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getStats(publicRead, slug)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("shows a draft batch to an editor", async () => {
    expect((await found(getBySlug(editor, "parallel-w26"))).label).toBe("W26");
  });
});

describe("batches.getStats", () => {
  beforeAll(async () => {
    const batchId = await fixtureId(batches, "parallel-s25");
    const cohort = [
      "kiln-analytics",
      "quiet-harbor-health",
      "cafe-algorithmique",
      "brightpath-health",
      "tidal-ledger",
      "orbital-forms",
      "solstice-grid",
      "stealth-draft-co",
    ];
    await getDb()
      .insert(startupBatches)
      .values(
        await Promise.all(
          cohort.map(async (slug) => ({
            batchId,
            startupId: await fixtureId(startups, slug),
          })),
        ),
      );
  });

  afterAll(async () => {
    await seed(getDb());
  });

  it("counts, sums published totals and ranks the top 5 industries", async () => {
    expect(await getStats(anonymous, "parallel-s25")).toEqual({
      companyCount: 7,
      // 54.5M + 3M + 0.6M + 15M + 24M + 45M + 15M; the draft company adds nothing.
      totalRaisedUsd: 157_100_000,
      topIndustries: [
        { slug: "ai", name: "AI", count: 6 },
        { slug: "devtools", name: "Developer Tools", count: 2 },
        { slug: "fintech", name: "Fintech", count: 2 },
        { slug: "health", name: "Health", count: 2 },
        { slug: "climate", name: "Climate", count: 1 },
      ],
    });
  });

  it("includes the draft company for an editor", async () => {
    expect((await getStats(editor, "parallel-s25")).companyCount).toBe(8);
  });
});
