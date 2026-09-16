import { isDeepStrictEqual } from "node:util";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_READ } from "../auth/context";
import { closeDb, getDb } from "../db/client";
import {
  batches,
  founders,
  industries,
  investors,
  locations,
  startups,
} from "../db/schema";
import { seed } from "../db/seed";
import * as batchWrites from "../services/batch-writes";
import * as categoryWrites from "../services/category-writes";
import * as founderWrites from "../services/founder-writes";
import * as investorWrites from "../services/investor-writes";
import * as lifecycle from "../services/lifecycle";
import * as privacy from "../services/privacy";
import * as relationWrites from "../services/relation-writes";
import * as roundWrites from "../services/round-writes";
import * as slugWrites from "../services/slug-writes";
import * as startupWrites from "../services/startup-writes";
import { contexts } from "../testing/authz";
import { fixtureId, fixtureRoundId } from "../testing/fixtures";
import { cacheCalls, resetCacheCalls } from "../testing/next-cache";
import { ensureTestUsers } from "../testing/users";
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

// Cache freshness (docs/TEST_PLAN.md §6 "caching", NFR-02): no write may leave a cached page
// stale. For each write, every cached page is read and its tags recorded; after the write, every
// page whose tags were not expired is read again and must be unchanged. A page that changed
// without being expired is exactly the page Next.js would keep serving stale.

const { editor, admin } = contexts;

const PAGES: readonly (readonly [string, () => Promise<unknown>])[] = [
  ...[
    "kiln-analytics",
    "pebble-notes",
    "lanternfish-ai",
    "solstice-grid",
    "quiet-harbor-health",
  ].map(
    (slug) =>
      [`startup ${slug}`, () => getStartupPage(PUBLIC_READ, slug)] as const,
  ),
  [
    "similar to kiln-analytics",
    () => getSimilarStartups(PUBLIC_READ, "kiln-analytics"),
  ],
  ...(["recent", "raised", "name"] as const).map(
    (sort) =>
      [
        `explore by ${sort}`,
        () => getStartupsFirstPage(PUBLIC_READ, sort),
      ] as const,
  ),
  ["landing set", () => getLandingStartups(PUBLIC_READ)],
  ...["mira-okafor", "tomasz-wrobel", "jose-nunez", "grace-liu"].map(
    (slug) =>
      [`founder ${slug}`, () => getFounderPage(PUBLIC_READ, slug)] as const,
  ),
  ...[
    "northwind-ventures",
    "harbor-capital",
    "fjord-kapital",
    "meridian-angels",
    "parallel-accelerator",
  ].map(
    (slug) =>
      [`investor ${slug}`, () => getInvestorPage(PUBLIC_READ, slug)] as const,
  ),
  ...["parallel-w25", "parallel-s25", "launchpad-sr1"].map(
    (slug) => [`batch ${slug}`, () => getBatchPage(PUBLIC_READ, slug)] as const,
  ),
  ["news", () => getNewsFirstPage(PUBLIC_READ)],
  ...[
    ["industries", "ai"],
    ["industries", "climate"],
    ["industries", "devtools"],
    ["stages", "seed"],
    ["work-type", "remote"],
    ["cities", "berlin-de"],
    ["countries", "india"],
  ].map(
    ([kind = "", slug = ""]) =>
      [
        `category ${kind}/${slug}`,
        () => getCategoryPage(PUBLIC_READ, kind, slug),
      ] as const,
  ),
  ["category directory", () => getCategoryDirectory(PUBLIC_READ)],
  ["directory counts", () => getDirectoryCounts(PUBLIC_READ)],
  ...(["startup", "founder", "investor", "batch"] as const).map(
    (entity) =>
      [
        `${entity} slugs`,
        () => getPublishedSlugs(PUBLIC_READ, entity),
      ] as const,
  ),
];

beforeAll(async () => {
  await ensureTestUsers();
});

beforeEach(async () => {
  await seed(getDb());
  resetCacheCalls();
});

afterAll(async () => {
  await seed(getDb());
  await closeDb();
});

/** Names of cached pages that changed after `write` without any of their tags expiring. */
async function stalePagesAfter(
  write: () => Promise<unknown>,
): Promise<string[]> {
  const cached: {
    name: string;
    read: () => Promise<unknown>;
    value: unknown;
    tags: string[];
  }[] = [];
  for (const [name, read] of PAGES) {
    resetCacheCalls();
    const value = await read();
    const tags = cacheCalls
      .filter((call) => call.fn === "cacheTag")
      .flatMap((call) => call.args as string[]);
    cached.push({ name, read, value, tags });
  }

  resetCacheCalls();
  await write();
  const expired = new Set(
    cacheCalls
      .filter((call) => call.fn === "revalidateTag")
      .map((call) => call.args[0] as string),
  );

  const stale: string[] = [];
  for (const page of cached) {
    if (page.tags.some((tag) => expired.has(tag))) continue;
    if (!isDeepStrictEqual(await page.read(), page.value))
      stale.push(page.name);
  }
  return stale;
}

const id = (table: Parameters<typeof fixtureId>[0], slug: string) =>
  fixtureId(table, slug);

async function lookupId(
  table: typeof industries | typeof locations,
  slug: string,
): Promise<string> {
  const [row] = await getDb()
    .select({ id: table.id })
    .from(table)
    .where(eq(table.slug, slug));
  if (!row) throw new Error(`Missing ${slug}`);
  return row.id;
}

describe("cache freshness after writes (NFR-02)", () => {
  it("detects a stale page when a change bypasses the services", async () => {
    // Proves the check itself: nothing expires, so the changed pages are reported.
    const stale = await stalePagesAfter(() =>
      getDb().execute(
        sql`update public.startups set tagline = 'Changed behind the cache' where slug = 'kiln-analytics'`,
      ),
    );
    expect(stale).toEqual(
      expect.arrayContaining(["startup kiln-analytics", "founder mira-okafor"]),
    );
  });

  it.each<[string, () => Promise<unknown>]>([
    [
      "renaming a startup that acquired another",
      async () =>
        startupWrites.update(editor, await id(startups, "kiln-analytics"), {
          name: "Kiln Analytics Group",
        }),
    ],
    [
      "creating and publishing a startup",
      async () => {
        const created = await startupWrites.create(editor, {
          name: "Fresh Co",
          tagline: "Brand new.",
          locationId: await lookupId(locations, "berlin-de"),
          industries: [
            { id: await lookupId(industries, "ai"), isPrimary: true },
          ],
        });
        await lifecycle.publish(editor, "startup", created.id);
      },
    ],
    [
      "archiving a startup",
      async () =>
        lifecycle.archive(
          editor,
          "startup",
          await id(startups, "lanternfish-ai"),
        ),
    ],
    [
      "changing a founder's headline",
      async () =>
        founderWrites.update(editor, await id(founders, "mira-okafor"), {
          headline: "Serial founder",
        }),
    ],
    [
      "renaming an investor",
      async () =>
        investorWrites.update(editor, await id(investors, "harbor-capital"), {
          name: "Harbor Capital Partners",
        }),
    ],
    [
      "archiving an investor",
      async () =>
        lifecycle.archive(
          editor,
          "investor",
          await id(investors, "northwind-ventures"),
        ),
    ],
    [
      "relabelling a batch",
      async () =>
        batchWrites.update(editor, await id(batches, "parallel-w25"), {
          label: "Winter 25",
        }),
    ],
    [
      "publishing a round",
      async () =>
        lifecycle.publish(
          editor,
          "round",
          await fixtureRoundId("solstice-grid", "series_b"),
        ),
    ],
    [
      "changing a round's amount",
      async () =>
        roundWrites.update(
          editor,
          await fixtureRoundId("kiln-analytics", "series_b"),
          {
            amountOriginal: 45_000_000,
          },
        ),
    ],
    [
      "linking a founder",
      async () =>
        relationWrites.addFounder(
          editor,
          await id(startups, "kiln-analytics"),
          {
            founderId: await id(founders, "grace-liu"),
            role: "advisor",
          },
        ),
    ],
    [
      "adding a startup to a batch",
      async () =>
        relationWrites.addBatch(editor, await id(startups, "kiln-analytics"), {
          batchId: await id(batches, "parallel-s25"),
        }),
    ],
    [
      "replacing a startup's industries",
      async () =>
        relationWrites.setIndustries(
          editor,
          await id(startups, "kiln-analytics"),
          {
            industries: [
              { id: await lookupId(industries, "security"), isPrimary: true },
            ],
          },
        ),
    ],
    [
      "changing a slug",
      async () =>
        slugWrites.changeSlug(
          admin,
          "startup",
          await id(startups, "kiln-analytics"),
          {
            slug: "kiln-insights",
          },
        ),
    ],
    [
      "editing category copy",
      () =>
        categoryWrites.updateCopy(editor, "industries", "ai", {
          heading: "Applied AI startups",
        }),
    ],
    [
      "erasing a founder",
      async () =>
        privacy.eraseFounder(admin, await id(founders, "tomasz-wrobel"), {
          confirm: "ERASE tomasz-wrobel",
        }),
    ],
  ])("leaves no page stale after %s", async (_label, write) => {
    expect(await stalePagesAfter(write)).toEqual([]);
  });
});
