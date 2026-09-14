import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import type { NewsItem } from "../dto/news";
import { NotFoundError, ValidationError } from "../lib/errors";
import { contexts } from "../testing/authz";
import { listForStartup, listRecent, type RoundFeedFilters } from "./rounds";

// docs/TEST_PLAN.md §6: the news feed and company timelines.

const { anonymous, publicRead, editor } = contexts;

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

const describeItem = ({ startup, round }: NewsItem) =>
  `${startup.slug} ${round.roundType} ${round.announcedOn}`;

async function everything(
  ctx: Parameters<typeof listRecent>[0],
  filters: RoundFeedFilters = {},
  limit = 48,
): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRecent(ctx, { filters, cursor, limit });
    items.push(...page.data);
    cursor = page.pagination.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

describe("rounds.listRecent", () => {
  it("lists visible rounds of visible startups, newest first", async () => {
    const items = await everything(publicRead);

    expect(items).toHaveLength(25);
    expect(items.slice(0, 3).map(describeItem)).toEqual([
      "fjordline-energy seed 2026-03-02",
      "baobab-pay seed 2026-01-20",
      "quiet-harbor-health series_a 2025-11-04",
    ]);
    const described = items.map(describeItem);
    expect(described).not.toContain("solstice-grid series_b 2026-02-01");
    expect(described).not.toContain("solstice-grid bridge 2023-01-01");
    expect(described.some((item) => item.startsWith("sunset-legacy"))).toBe(
      false,
    );
  });

  it("shows draft rounds and hidden companies to an editor", async () => {
    expect(await everything(editor)).toHaveLength(28);
  });

  it("returns items shaped { round, startup }", async () => {
    const [item] = (await listRecent(anonymous, { limit: 1 })).data;
    expect(Object.keys(item ?? {}).sort()).toEqual(["round", "startup"]);
    expect(item?.round).toMatchObject({
      currency: "EUR",
      amountOriginal: 4_500_000,
      amountUsd: 4_878_900,
    });
  });

  it("paginates without duplicates or gaps", async () => {
    const whole = (await everything(anonymous)).map(describeItem);
    const paged = (await everything(anonymous, {}, 4)).map(describeItem);
    expect(paged).toEqual(whole);
  });

  it.each<[string, RoundFeedFilters, number]>([
    ["round type", { roundType: ["debt", "grant"] }, 2],
    ["investor", { investor: "fjord-kapital" }, 4],
    ["industry", { industry: "climate" }, 7],
    ["from", { from: "2026-01-01" }, 2],
    ["to", { to: "2017-12-31" }, 1],
    ["a hidden investor", { investor: "quietwater-capital" }, 0],
  ])("filters by %s", async (_label, filters, count) => {
    expect(await everything(anonymous, filters)).toHaveLength(count);
  });

  it.each([
    "2026-13-01",
    "2026-02-30",
    "yesterday",
    "2026-1-1",
  ])("rejects the date %s", async (from) => {
    await expect(
      listRecent(anonymous, { filters: { from } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a cursor from the explore grid", async () => {
    const { list } = await import("./startups");
    const cursor = (await list(anonymous, { limit: 1 })).pagination.nextCursor;
    await expect(
      listRecent(anonymous, { cursor: cursor ?? "" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("rounds.listForStartup", () => {
  it("returns only published rounds to the public", async () => {
    const rounds = await listForStartup(anonymous, "solstice-grid");
    expect(rounds.map((round) => round.roundType)).toEqual([
      "secondary",
      "series_a",
      "debt",
      "grant",
      "seed",
    ]);
  });

  it("returns every round to an editor", async () => {
    expect(await listForStartup(editor, "solstice-grid")).toHaveLength(7);
  });

  it("is NotFound for a hidden startup", async () => {
    await expect(
      listForStartup(anonymous, "sunset-legacy"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
