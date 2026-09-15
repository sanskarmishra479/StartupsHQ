import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./client";
import { repairStartupDerived } from "./derived";
import { startups } from "./schema";
import { seed } from "./seed";

// ADR-009: derived startup columns can be repaired at any time (scripts/recompute-derived.ts).

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await seed(getDb());
  await closeDb();
});

const totals = async (slug: string) =>
  (
    await getDb()
      .select({
        raised: startups.totalRaisedUsd,
        debt: startups.totalDebtUsd,
        latestRoundId: startups.latestRoundId,
      })
      .from(startups)
      .where(eq(startups.slug, slug))
  )[0];

describe("repairStartupDerived", () => {
  it("changes nothing when every total is already right", async () => {
    expect(await repairStartupDerived(getDb())).toEqual({
      checked: 19,
      repaired: 0,
    });
  });

  it("repairs corrupted totals and reports how many were wrong", async () => {
    const kilnBefore = await totals("kiln-analytics");
    const solsticeBefore = await totals("solstice-grid");
    const pebbleBefore = await totals("pebble-notes");

    await getDb()
      .update(startups)
      .set({ totalRaisedUsd: 1, totalDebtUsd: 2 })
      .where(inArray(startups.slug, ["kiln-analytics", "solstice-grid"]));
    await getDb().execute(
      sql`update public.startups set latest_round_id = null where slug = 'pebble-notes'`,
    );

    expect(await repairStartupDerived(getDb())).toEqual({
      checked: 19,
      repaired: 3,
    });
    expect(await totals("kiln-analytics")).toEqual(kilnBefore);
    expect(await totals("solstice-grid")).toEqual(solsticeBefore);
    expect(await totals("pebble-notes")).toEqual(pebbleBefore);
  });
});
