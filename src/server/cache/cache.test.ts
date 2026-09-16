import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_READ } from "../auth/context";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import { NOT_FOUND } from "../lib/cached-lookup";
import { ValidationError } from "../lib/errors";
import * as startupService from "../services/startups";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { getBatchPage } from "./batches";
import { getCategoryDirectory, getCategoryPage } from "./categories";
import { getFounderPage } from "./founders";
import { getInvestorPage } from "./investors";
import { getNewsFirstPage } from "./rounds";
import { getPublishedSlugs } from "./slugs";
import {
  getLandingStartups,
  getSimilarStartups,
  getStartupPage,
  getStartupsFirstPage,
} from "./startups";
import { getDirectoryCounts } from "./stats";

// Cached public reads (ADR-013, NFR-02, SEC-03.6). `next/cache` is the recording test double
// from src/server/testing/next-cache.ts; the authz suite covers the context guard of every read.

beforeAll(async () => {
  await seed(getDb());
});

beforeEach(() => {
  resetCacheCalls();
});

afterAll(async () => {
  await closeDb();
});

const recorded = (fn: string) =>
  cacheCalls.filter((call) => call.fn === fn).flatMap((call) => call.args);

describe("cached reads", () => {
  it.each<[string, () => Promise<unknown>, string[], string]>([
    [
      "startup page",
      () => getStartupPage(PUBLIC_READ, "kiln-analytics"),
      ["startup:kiln-analytics"],
      "days",
    ],
    [
      "similar startups",
      () => getSimilarStartups(PUBLIC_READ, "kiln-analytics"),
      ["startup:kiln-analytics", "startups:list"],
      "days",
    ],
    [
      "explore first page",
      () => getStartupsFirstPage(PUBLIC_READ, "raised"),
      ["startups:list"],
      "hours",
    ],
    [
      "published founder slugs",
      () => getPublishedSlugs(PUBLIC_READ, "founder"),
      ["stats", "sitemap"],
      "hours",
    ],
    [
      "landing set",
      () => getLandingStartups(PUBLIC_READ),
      ["startups:list"],
      "hours",
    ],
    [
      "founder page",
      () => getFounderPage(PUBLIC_READ, "mira-okafor"),
      ["founder:mira-okafor"],
      "days",
    ],
    [
      "investor page",
      () => getInvestorPage(PUBLIC_READ, "northwind-ventures"),
      ["investor:northwind-ventures"],
      "days",
    ],
    [
      "batch page",
      () => getBatchPage(PUBLIC_READ, "parallel-w25"),
      ["batch:parallel-w25"],
      "days",
    ],
    ["news first page", () => getNewsFirstPage(PUBLIC_READ), ["news"], "hours"],
    [
      "category page",
      () => getCategoryPage(PUBLIC_READ, "industries", "ai"),
      ["category:industries:ai", "startups:list"],
      "days",
    ],
    [
      "category directory",
      () => getCategoryDirectory(PUBLIC_READ),
      ["categories", "startups:list"],
      "hours",
    ],
    [
      "directory counts",
      () => getDirectoryCounts(PUBLIC_READ),
      ["stats"],
      "hours",
    ],
  ])("%s: tagged, with an explicit lifetime and a serializable result", async (_label, read, tags, lifetime) => {
    const result = await read();
    expect(recorded("cacheTag")).toEqual(tags);
    expect(recorded("cacheLife")).toEqual([lifetime]);
    // Plain JSON survives the cache boundary unchanged: no Dates, class instances or undefined.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("returns what the service returns for a public reader", async () => {
    expect(await getStartupPage(PUBLIC_READ, "kiln-analytics")).toEqual(
      await startupService.getBySlug(PUBLIC_READ, "kiln-analytics"),
    );
    expect(await getStartupsFirstPage(PUBLIC_READ)).toEqual(
      await startupService.list(PUBLIC_READ),
    );
  });

  it("returns hidden records as a tagged not-found value", async () => {
    expect(await getStartupPage(PUBLIC_READ, "stealth-draft-co")).toEqual(
      NOT_FOUND,
    );
    expect(recorded("cacheTag")).toEqual(["startup:stealth-draft-co"]);

    for (const miss of [
      await getFounderPage(PUBLIC_READ, "unverified-founder"),
      await getInvestorPage(PUBLIC_READ, "old-mill-ventures"),
      await getBatchPage(PUBLIC_READ, "parallel-w26"),
      await getCategoryPage(PUBLIC_READ, "industries", "quantum"),
      await getSimilarStartups(PUBLIC_READ, "sunset-legacy"),
    ]) {
      expect(miss).toEqual(NOT_FOUND);
    }
  });

  it("tags a redirect with both the old and the current slug", async () => {
    expect(await getStartupPage(PUBLIC_READ, "kiln-data")).toEqual({
      kind: "redirect",
      slug: "kiln-analytics",
    });
    expect(recorded("cacheTag")).toEqual([
      "startup:kiln-data",
      "startup:kiln-analytics",
    ]);
  });

  it("rejects malformed input before it can reach the cache", async () => {
    expect(await getStartupPage(PUBLIC_READ, "Not A Slug")).toEqual(NOT_FOUND);
    expect(await getFounderPage(PUBLIC_READ, "../etc")).toEqual(NOT_FOUND);
    expect(await getCategoryPage(PUBLIC_READ, "people", "ai")).toEqual(
      NOT_FOUND,
    );
    await expect(
      getStartupsFirstPage(PUBLIC_READ, "popular" as never),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getPublishedSlugs(PUBLIC_READ, "users" as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(cacheCalls).toEqual([]);
  });
});

describe("cache key safety (ADR-013)", () => {
  const cacheDir = import.meta.dirname;
  const sources = readdirSync(cacheDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({
      file,
      source: readFileSync(join(cacheDir, file), "utf8"),
    }));

  it("finds the cached modules", () => {
    expect(sources.map(({ file }) => file).sort()).toEqual([
      "batches.ts",
      "categories.ts",
      "founders.ts",
      "investors.ts",
      "rounds.ts",
      "slugs.ts",
      "startups.ts",
      "stats.ts",
    ]);
  });

  it("gives every visitor the same context value", () => {
    expect(Object.isFrozen(PUBLIC_READ)).toBe(true);
    expect(JSON.stringify(PUBLIC_READ)).toBe('{"kind":"public-read"}');
  });

  it.each(
    sources.map(({ file, source }) => [file, source] as const),
  )("%s: no cached scope takes a context, and no export is cached itself", (_file, source) => {
    const cachedScopes = [
      ...source.matchAll(
        /(export\s+)?async\s+function\s+(\w+)\s*\(([^)]*)\)[^{]*\{\s*"use cache"/g,
      ),
    ];
    expect(cachedScopes.length).toBeGreaterThan(0);
    for (const [, exported, name, params] of cachedScopes) {
      // An exported cached function would put the caller's context into the cache key.
      expect({ name, exported: Boolean(exported) }).toEqual({
        name,
        exported: false,
      });
      expect({ name, params }).not.toEqual({
        name,
        params: expect.stringMatching(/ctx|context/i),
      });
    }
  });

  it.each(
    sources.map(({ file, source }) => [file, source] as const),
  )("%s: never reads request data", (_file, source) => {
    expect(source).not.toMatch(/from\s+"next\/(headers|server)"/);
    expect(source).not.toMatch(/\b(publicContext|authedContext)\b/);
  });
});
