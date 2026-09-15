import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import {
  auditLog,
  batches as batchesTable,
  founders as foundersTable,
  fundingRounds,
  industries as industriesTable,
  investments,
  investors as investorsTable,
  locations,
  startupFounders,
  startups as startupsTable,
} from "../db/schema";
import { seed } from "../db/seed";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, fixtureRoundId, found } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
import * as batchReads from "./batches";
import * as founderReads from "./founders";
import * as investorReads from "./investors";
import { publish } from "./lifecycle";
import {
  addBatch,
  addFounder,
  addInvestor,
  removeBatch,
  removeFounder,
  removeInvestor,
  setIndustries,
} from "./relation-writes";
import { create as createStartup } from "./startup-writes";
import * as startupReads from "./startups";

// docs/TEST_PLAN.md §6: relationship writes and nested startup creation. docs/API.md §8.1, §8.3.

const { anonymous, editor } = contexts;
const NIL = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  await ensureTestUsers();
  await seed(getDb());
});

beforeEach(() => {
  resetCacheCalls();
});

afterAll(async () => {
  await seed(getDb());
  await closeDb();
});

const expired = () =>
  cacheCalls
    .filter((call) => call.fn === "revalidateTag")
    .map((call) => call.args[0]);

async function industryId(slug: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: industriesTable.id })
    .from(industriesTable)
    .where(eq(industriesTable.slug, slug));
  if (!row) throw new Error(`Missing industry ${slug}`);
  return row.id;
}

async function lastAudit(entityId: string) {
  const rows = await getDb()
    .select({ action: auditLog.action, diff: auditLog.diff })
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(asc(auditLog.createdAt));
  return rows.at(-1);
}

const kiln = () => fixtureId(startupsTable, "kiln-analytics");
const kilnPage = async () =>
  found(startupReads.getBySlug(anonymous, "kiln-analytics"));

describe("founder links", () => {
  it("links and unlinks a founder, audited and expiring both pages", async () => {
    const startupId = await kiln();
    const graceId = await fixtureId(foundersTable, "grace-liu");

    const { id } = await addFounder(editor, startupId, {
      founderId: graceId,
      role: "advisor",
      joinedYear: 2025,
      sourceUrl: "https://example.com/about",
    });

    expect((await kilnPage()).founders.map((f) => f.slug)).toContain(
      "grace-liu",
    );
    const grace = await found(founderReads.getBySlug(anonymous, "grace-liu"));
    expect(grace.startups.map((stint) => stint.startup.slug)).toContain(
      "kiln-analytics",
    );
    expect(expired()).toEqual(
      expect.arrayContaining(["startup:kiln-analytics", "founder:grace-liu"]),
    );
    expect(await lastAudit(startupId)).toMatchObject({
      action: "update",
      diff: { founders: { added: { linkId: id, role: "advisor" } } },
    });

    // The same stint twice is a duplicate.
    await expect(
      addFounder(editor, startupId, {
        founderId: graceId,
        role: "advisor",
        joinedYear: 2025,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await removeFounder(editor, startupId, id);
    expect((await kilnPage()).founders.map((f) => f.slug)).not.toContain(
      "grace-liu",
    );
    await expect(removeFounder(editor, startupId, id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it.each<
    [string, Record<string, unknown>, abstract new (...args: never[]) => Error]
  >([
    [
      "leaving before joining",
      { joinedYear: 2020, leftYear: 2019, isCurrent: false },
      UnprocessableError,
    ],
    [
      "a current role with a year left",
      { isCurrent: true, leftYear: 2024 },
      UnprocessableError,
    ],
    ["an unknown founder", { founderId: NIL }, UnprocessableError],
  ])("refuses %s", async (_label, overrides, errorType) => {
    await expect(
      addFounder(editor, await kiln(), {
        founderId: await fixtureId(foundersTable, "grace-liu"),
        role: "operator",
        ...overrides,
      } as never),
    ).rejects.toBeInstanceOf(errorType);
  });

  it("will not remove another startup's link", async () => {
    const tidewater = await fixtureId(startupsTable, "tidewater-labs");
    const [stint] = await getDb()
      .select({ id: startupFounders.id })
      .from(startupFounders)
      .where(eq(startupFounders.startupId, tidewater));
    await expect(
      removeFounder(editor, await kiln(), stint?.id ?? NIL),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is NotFound for an unknown startup", async () => {
    await expect(
      addFounder(editor, NIL, {
        founderId: await fixtureId(foundersTable, "grace-liu"),
        role: "advisor",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("investor links", () => {
  it("links a backer to one of the startup's rounds", async () => {
    const startupId = await kiln();
    const { id } = await addInvestor(editor, startupId, {
      investorId: await fixtureId(investorsTable, "launchpad"),
      roundId: await fixtureRoundId("kiln-analytics", "seed"),
      isLead: true,
    });

    const led = await investorReads.getRoundsLed(anonymous, "launchpad");
    expect(
      led.data.map(
        ({ startup, round }) => `${startup.slug} ${round.roundType}`,
      ),
    ).toContain("kiln-analytics seed");
    expect(expired()).toEqual(
      expect.arrayContaining(["startup:kiln-analytics", "investor:launchpad"]),
    );

    await removeInvestor(editor, startupId, id);
    expect(
      (await investorReads.getRoundsLed(anonymous, "launchpad")).data.map(
        ({ startup }) => startup.slug,
      ),
    ).not.toContain("kiln-analytics");
  });

  it("refuses a round that belongs to another startup", async () => {
    await expect(
      addInvestor(editor, await kiln(), {
        investorId: await fixtureId(investorsTable, "launchpad"),
        roundId: await fixtureRoundId("pebble-notes", "seed"),
      }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it("refuses a second round-less link for the same backer (NULLS NOT DISTINCT)", async () => {
    await expect(
      addInvestor(editor, await fixtureId(startupsTable, "orbital-forms"), {
        investorId: await fixtureId(investorsTable, "atlas-growth"),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("batch links", () => {
  it("adds a startup to a cohort and removes it again", async () => {
    const startupId = await kiln();
    const batchId = await fixtureId(batchesTable, "parallel-s25");
    const cohort = async () =>
      (
        await found(batchReads.getBySlug(anonymous, "parallel-s25"))
      ).companies.map((card) => card.slug);

    await addBatch(editor, startupId, { batchId });
    expect(await cohort()).toContain("kiln-analytics");
    expect(expired()).toEqual(
      expect.arrayContaining(["batch:parallel-s25", "startup:kiln-analytics"]),
    );
    await expect(
      addBatch(editor, startupId, { batchId }),
    ).rejects.toBeInstanceOf(ConflictError);

    await removeBatch(editor, startupId, batchId);
    expect(await cohort()).not.toContain("kiln-analytics");
    await expect(
      removeBatch(editor, startupId, batchId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("industries", () => {
  it("replaces the set and its primary industry", async () => {
    const startupId = await kiln();
    await setIndustries(editor, startupId, {
      industries: [
        { id: await industryId("ai"), isPrimary: true },
        { id: await industryId("security") },
      ],
    });

    const page = await kilnPage();
    expect(page.primaryIndustry?.slug).toBe("ai");
    expect(page.industries.map((industry) => industry.slug)).toEqual([
      "ai",
      "security",
    ]);
    expect(expired()).toEqual(
      expect.arrayContaining(["startup:kiln-analytics", "categories"]),
    );
  });

  it.each([
    [
      "two primary industries",
      async () => [
        { id: await industryId("ai"), isPrimary: true },
        { id: await industryId("security"), isPrimary: true },
      ],
    ],
    [
      "an industry listed twice",
      async () => [
        { id: await industryId("ai") },
        { id: await industryId("ai") },
      ],
    ],
    ["an unknown industry", async () => [{ id: NIL }]],
  ])("refuses %s", async (_label, industries) => {
    await expect(
      setIndustries(editor, await kiln(), { industries: await industries() }),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });
});

describe("nested startup creation (docs/API.md §8.1)", () => {
  async function berlin() {
    const [row] = await getDb()
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, "berlin-de"));
    return row?.id ?? NIL;
  }

  it("creates a startup with its links and rounds in one transaction", async () => {
    const northwind = await fixtureId(investorsTable, "northwind-ventures");
    const created = await createStartup(editor, {
      name: "Graphite Labs",
      tagline: "Batteries from graphite waste.",
      locationId: await berlin(),
      industries: [{ id: await industryId("climate"), isPrimary: true }],
      founders: [
        {
          founderId: await fixtureId(foundersTable, "grace-liu"),
          role: "founder",
          joinedYear: 2026,
        },
      ],
      investors: [{ investorId: northwind }],
      batchIds: [await fixtureId(batchesTable, "parallel-s25")],
      rounds: [
        {
          roundType: "seed",
          announcedOn: "2026-03-02",
          currency: "EUR",
          amountOriginal: 2_000_000,
          sourceUrl: "https://example.com/news/graphite-seed",
          investors: [{ investorId: northwind, isLead: true }],
        },
      ],
    });

    await publish(editor, "startup", created.id);
    const [round] = await getDb()
      .select({ id: fundingRounds.id })
      .from(fundingRounds)
      .where(eq(fundingRounds.startupId, created.id));
    await publish(editor, "round", round?.id ?? NIL);

    const graphite = await found(
      startupReads.getBySlug(anonymous, "graphite-labs"),
    );
    expect(graphite).toMatchObject({
      primaryIndustry: { slug: "climate" },
      // 2,000,000 EUR × 1.0842
      totalRaisedUsd: 2_168_400,
      founders: [expect.objectContaining({ slug: "grace-liu" })],
      investors: [
        expect.objectContaining({ slug: "northwind-ventures", isLead: true }),
      ],
      batches: [expect.objectContaining({ slug: "parallel-s25" })],
    });
  });

  it("creates nothing when any part is invalid", async () => {
    await expect(
      createStartup(editor, {
        name: "Rollback Labs",
        founders: [
          {
            founderId: await fixtureId(foundersTable, "grace-liu"),
            role: "founder",
          },
        ],
        rounds: [
          {
            roundType: "seed",
            announcedOn: "2026-03-02",
            currency: "NGN",
            amountOriginal: 1_000_000,
            sourceUrl: "https://example.com/news/rollback",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(UnprocessableError);

    expect(
      await getDb()
        .select({ id: startupsTable.id })
        .from(startupsTable)
        .where(eq(startupsTable.slug, "rollback-labs")),
    ).toEqual([]);
    expect(expired()).toEqual([]);
  });

  it("keeps a nested manual rate admin-only", async () => {
    await expect(
      createStartup(editor, {
        name: "Manual Rate Labs",
        rounds: [
          {
            roundType: "seed",
            announcedOn: "2026-04-01",
            currency: "NGN",
            amountOriginal: 1_000_000,
            sourceUrl: "https://example.com/news/manual",
            manualFx: { rate: "0.0006", sourceNote: "Bank" },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a batch listed twice", async () => {
    const batchId = await fixtureId(batchesTable, "parallel-s25");
    await expect(
      createStartup(editor, {
        name: "Twice Labs",
        batchIds: [batchId, batchId],
      }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    expect(
      await getDb()
        .select({ id: investments.id })
        .from(investments)
        .innerJoin(
          startupsTable,
          and(eq(startupsTable.id, investments.startupId)),
        )
        .where(eq(startupsTable.slug, "twice-labs")),
    ).toEqual([]);
  });
});
