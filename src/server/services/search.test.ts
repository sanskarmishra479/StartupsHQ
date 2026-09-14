import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import { ValidationError } from "../lib/errors";
import { contexts } from "../testing/authz";
import { search, suggest } from "./search";

// docs/TEST_PLAN.md §6: search. FR-109 and /suggest (docs/API.md §6.11–6.12).

const { anonymous, publicRead, editor } = contexts;

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

const slugs = (results: readonly { slug: string }[]) =>
  results.map((result) => result.slug);

describe("search", () => {
  it("finds a company by name and a founder by headline, grouped", async () => {
    const { data, meta } = await search(anonymous, { q: "kiln" });
    expect(meta).toEqual({ query: "kiln", matchType: "fulltext" });
    expect(slugs(data.startups.results)).toEqual(["kiln-analytics"]);
    expect(data.startups.total).toBe(1);
    // "CTO at Kiln Analytics"
    expect(slugs(data.founders.results)).toEqual(["tomasz-wrobel"]);
    expect(data.founders.results[0]).toEqual({
      slug: "tomasz-wrobel",
      fullName: "Tomasz Wróbel",
      headline: "CTO at Kiln Analytics",
      photo: null,
      startupCount: 1,
    });
    expect(data.investors).toEqual({ results: [], total: 0 });
  });

  it("puts an exact name match first", async () => {
    const { data } = await search(anonymous, { q: "Lanternfish AI" });
    expect(data.startups.results[0]?.slug).toBe("lanternfish-ai");
  });

  it("searches taglines", async () => {
    const { data } = await search(anonymous, { q: "firmware" });
    expect(slugs(data.startups.results)).toEqual(["hollow-oak-security"]);
  });

  it("matches names without their diacritics", async () => {
    const { data, meta } = await search(anonymous, { q: "tomasz wrobel" });
    expect(meta.matchType).toBe("fulltext");
    expect(slugs(data.founders.results)).toEqual(["tomasz-wrobel"]);
  });

  it("finds investors and batches with their counts", async () => {
    const { data } = await search(publicRead, { q: "parallel" });
    expect(data.investors.results).toEqual([
      expect.objectContaining({
        slug: "parallel-accelerator",
        investorType: "accelerator",
        portfolioCount: 1,
      }),
    ]);
    // The draft W26 and archived S24 batches are not returned.
    expect(slugs(data.batches.results).sort()).toEqual([
      "parallel-s25",
      "parallel-w25",
    ]);
    expect(
      data.batches.results.find((batch) => batch.slug === "parallel-w25"),
    ).toMatchObject({ label: "W25", year: 2025, companyCount: 1 });
  });

  it.each([
    ["a misspelling", "brightpth", "brightpath-health"],
    ["a misspelling without diacritics", "wisla robotcs", "wisla-robotics"],
  ])("falls back to trigram for %s", async (_label, q, slug) => {
    const { data, meta } = await search(anonymous, { q });
    expect(meta.matchType).toBe("trigram");
    expect(slugs(data.startups.results)).toContain(slug);
  });

  it("never returns hidden records to the public", async () => {
    for (const q of ["stealth", "quietwater", "unverified", "sunset legacy"]) {
      const { data } = await search(anonymous, { q });
      expect(Object.values(data).every((group) => group.total === 0)).toBe(
        true,
      );
    }
  });

  it("returns hidden records to an editor", async () => {
    const { data } = await search(editor, { q: "stealth" });
    expect(slugs(data.startups.results)).toEqual(["stealth-draft-co"]);
  });

  it("restricts to one type when asked", async () => {
    const { data } = await search(anonymous, { q: "kiln", type: "founders" });
    expect(data.startups).toEqual({ results: [], total: 0 });
    expect(slugs(data.founders.results)).toEqual(["tomasz-wrobel"]);
  });

  it("limits each group but reports the full total", async () => {
    // `simple` keeps every word, and most fixture taglines say "… for …".
    const { data } = await search(anonymous, { q: "for", limit: 2 });
    expect(data.startups.results).toHaveLength(2);
    expect(data.startups.total).toBeGreaterThan(2);
  });

  it.each([
    `"(& | !:* '`,
    "); drop table startups; --",
    "%%__",
  ])("treats %j as plain text", async (q) => {
    await expect(search(anonymous, { q })).resolves.toMatchObject({
      meta: { query: q.trim() },
    });
  });

  it.each([
    [{ q: "a" }],
    [{ q: "   " }],
    [{ q: "x".repeat(101) }],
    [{ q: "kiln", type: "people" as never }],
  ])("rejects %j", async (input) => {
    await expect(search(anonymous, input)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("suggest", () => {
  it("ranks a name prefix first and describes each result", async () => {
    const [first] = await suggest(anonymous, "ki");
    expect(first).toEqual({
      type: "startup",
      slug: "kiln-analytics",
      name: "Kiln Analytics",
      subtitle: "Developer Tools · Series B · Berlin",
      logo: expect.objectContaining({
        url: "https://example.com/blob/fixtures/kiln-analytics-logo/256.webp",
      }),
    });
  });

  it("matches the start of a later word", async () => {
    expect(slugs(await suggest(anonymous, "robo"))).toContain("wisla-robotics");
  });

  it("covers every entity type", async () => {
    const northwind = (await suggest(anonymous, "northwind")).find(
      (item) => item.slug === "northwind-ventures",
    );
    expect(northwind).toMatchObject({
      type: "investor",
      subtitle: "VC · San Francisco",
    });
    expect(await suggest(anonymous, "parallel")).toContainEqual(
      expect.objectContaining({
        type: "batch",
        slug: "parallel-w25",
        name: "Parallel Accelerator W25",
        subtitle: "2025",
      }),
    );
    expect(await suggest(anonymous, "佐藤")).toContainEqual(
      expect.objectContaining({ type: "founder", slug: "sato-hanako" }),
    );
  });

  it("returns at most 8 results", async () => {
    expect((await suggest(anonymous, "a")).length).toBe(8);
  });

  it("never suggests hidden records to the public", async () => {
    expect(await suggest(anonymous, "stealth")).toEqual([]);
    expect(await suggest(publicRead, "quietwater")).toEqual([]);
    expect(slugs(await suggest(editor, "stealth"))).toEqual([
      "stealth-draft-co",
    ]);
  });

  it.each(["", "  ", "x".repeat(61)])("rejects %j", async (q) => {
    await expect(suggest(anonymous, q)).rejects.toBeInstanceOf(ValidationError);
  });
});
