import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_READ } from "../auth/context";
import { closeDb, getDb } from "../db/client";
import {
  fundingRounds,
  investments,
  investors as investorsTable,
  startups as startupsTable,
} from "../db/schema";
import { seed } from "../db/seed";
import {
  ForbiddenError,
  UnprocessableError,
  ValidationError,
} from "../lib/errors";
import { contexts } from "../testing/authz";
import { fixtureId, fixtureRoundId, found } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
import { create, update } from "./round-writes";
import * as startupReads from "./startups";

// docs/TEST_PLAN.md §6: round writes. FR-404, FR-406, SEC-02.

const { editor, admin } = contexts;
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

async function stored(id: string) {
  const [row] = await getDb()
    .select({
      status: fundingRounds.status,
      currency: fundingRounds.currency,
      amountOriginal: fundingRounds.amountOriginal,
      amountUsd: fundingRounds.amountUsd,
      fxRate: fundingRounds.fxRate,
      fxRateDate: fundingRounds.fxRateDate,
      fxSource: fundingRounds.fxSource,
      notes: fundingRounds.notes,
    })
    .from(fundingRounds)
    .where(eq(fundingRounds.id, id));
  return row;
}

const totalRaised = async (slug: string) =>
  (await found(startupReads.getBySlug(PUBLIC_READ, slug))).totalRaisedUsd;

const kilnRound = async (overrides: Record<string, unknown> = {}) => ({
  startupId: await fixtureId(startupsTable, "kiln-analytics"),
  roundType: "series_c",
  announcedOn: "2026-03-02",
  amountOriginal: 1_000_000,
  sourceUrl: "https://example.com/news/kiln-series-c",
  ...overrides,
});

describe("round create", () => {
  it("converts at the latest ECB rate on or before a weekend announcement", async () => {
    // 2026-03-01 is a Sunday; the latest earlier rate is Friday 2026-02-27 at 1.0825.
    const round = await create(
      editor,
      (await kilnRound({
        announcedOn: "2026-03-01",
        currency: "EUR",
      })) as never,
    );

    expect(await stored(round.id)).toEqual({
      status: "draft",
      currency: "EUR",
      amountOriginal: "1000000.00",
      amountUsd: 1_082_500,
      fxRate: "1.08250000",
      fxRateDate: "2026-02-27",
      fxSource: "ecb",
      notes: null,
    });
    // A draft round never moves the public total.
    expect(await totalRaised("kiln-analytics")).toBe(54_500_000);
    expect(expired()).toContain("startup:kiln-analytics");
  });

  it("stores a USD amount without FX details, rounding half up", async () => {
    const round = await create(
      editor,
      (await kilnRound({ amountOriginal: "2500000.50" })) as never,
    );
    expect(await stored(round.id)).toMatchObject({
      amountUsd: 2_500_001,
      fxRate: null,
      fxRateDate: null,
      fxSource: null,
    });
  });

  it("records the participating investors", async () => {
    const round = await create(
      editor,
      (await kilnRound({
        investors: [
          {
            investorId: await fixtureId(investorsTable, "northwind-ventures"),
            isLead: true,
          },
          { investorId: await fixtureId(investorsTable, "harbor-capital") },
        ],
      })) as never,
    );
    const rows = await getDb()
      .select({ isLead: investments.isLead })
      .from(investments)
      .where(eq(investments.roundId, round.id));
    expect(rows.map((row) => row.isLead).sort()).toEqual([false, true]);
  });

  it("lets an admin enter a manual rate for a currency the ECB does not publish", async () => {
    const round = await create(
      admin,
      (await kilnRound({
        currency: "NGN",
        amountOriginal: "500000000",
        announcedOn: "2026-04-01",
        manualFx: {
          rate: 0.00061,
          sourceNote: "Central Bank of Nigeria, 2026-04-01",
        },
      })) as never,
    );
    expect(await stored(round.id)).toMatchObject({
      amountUsd: 305_000,
      fxRate: "0.00061000",
      fxRateDate: "2026-04-01",
      fxSource: "manual",
      notes: "FX rate source: Central Bank of Nigeria, 2026-04-01",
    });
  });

  it.each<
    [string, Record<string, unknown>, abstract new (...args: never[]) => Error]
  >([
    [
      "an undisclosed round with an amount",
      { isUndisclosed: true },
      UnprocessableError,
    ],
    [
      "a disclosed round without an amount",
      { amountOriginal: null },
      UnprocessableError,
    ],
    ["a client-computed USD amount", { amountUsd: 1_000_000 }, ValidationError],
    [
      "a client-supplied rate",
      { currency: "EUR", fxRate: "1.1" },
      ValidationError,
    ],
    [
      "an amount with fractions of a cent",
      { amountOriginal: "10.005" },
      ValidationError,
    ],
    [
      "an http source",
      { sourceUrl: "http://example.com/news" },
      ValidationError,
    ],
    [
      "a rate more than 7 days old",
      { currency: "GBP", announcedOn: "2026-03-15" },
      UnprocessableError,
    ],
    ["a currency without a rate", { currency: "NGN" }, UnprocessableError],
    ["an unknown startup", { startupId: NIL }, UnprocessableError],
  ])("refuses %s", async (_label, overrides, errorType) => {
    await expect(
      create(editor, (await kilnRound(overrides)) as never),
    ).rejects.toBeInstanceOf(errorType);
  });

  it("refuses an investor listed twice", async () => {
    const investorId = await fixtureId(investorsTable, "harbor-capital");
    await expect(
      create(
        editor,
        (await kilnRound({
          investors: [{ investorId }, { investorId, isLead: true }],
        })) as never,
      ),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });

  it("keeps manual rates admin-only and for currencies without an ECB rate", async () => {
    const manualFx = { rate: "1.2", sourceNote: "Bank" };
    await expect(
      create(editor, (await kilnRound({ currency: "NGN", manualFx })) as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      create(admin, (await kilnRound({ currency: "EUR", manualFx })) as never),
    ).rejects.toBeInstanceOf(UnprocessableError);
  });
});

describe("round update", () => {
  it("recomputes totals when a published round's amount changes", async () => {
    const seriesB = await fixtureRoundId("kiln-analytics", "series_b");
    await update(editor, seriesB, { amountOriginal: 50_000_000 });

    expect(await totalRaised("kiln-analytics")).toBe(64_500_000);
    expect(expired()).toEqual(
      expect.arrayContaining([
        "startup:kiln-analytics",
        "investor:harbor-capital",
        "news",
      ]),
    );
  });

  it("clears the amount when a round becomes undisclosed", async () => {
    const seed = await fixtureRoundId("pebble-notes", "seed");
    await update(editor, seed, { isUndisclosed: true });

    expect(await stored(seed)).toMatchObject({
      amountOriginal: null,
      amountUsd: null,
    });
    expect(await totalRaised("pebble-notes")).toBeNull();
  });

  it("refuses a currency change with no rate for the date", async () => {
    const seed = await fixtureRoundId("kiln-analytics", "seed");
    await expect(
      update(editor, seed, { currency: "GBP" }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    expect(expired()).toEqual([]);
  });
});
