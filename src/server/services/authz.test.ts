import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import { NotFoundError } from "../lib/errors";
import {
  type AuthzRegistry,
  collectExportedFunctions,
  defineAuthzSuite,
} from "../testing/authz";
import * as batches from "./batches";
import * as founders from "./founders";
import * as investors from "./investors";
import * as rounds from "./rounds";
import * as search from "./search";
import * as startups from "./startups";
import * as stats from "./stats";
import * as taxonomy from "./taxonomy";

// The authz conformance suite (docs/TEST_PLAN.md §7, SEC-03, NFR-10).
//
// Every exported function in src/server/services and src/server/cache must be registered here
// with its kind; an unregistered or stale entry fails the build. Reads run against the seeded
// fixtures, whose draft and archived records must stay invisible to public contexts.

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

/** A hidden record is a 404 to public callers, which the read contract counts as "not seen". */
const orNull = async <T>(read: Promise<T>): Promise<T | null> => {
  try {
    return await read;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
};

const found = (result: unknown) => result !== null;

const HIDDEN_STARTUPS = new Set(["stealth-draft-co", "sunset-legacy"]);
const includesHiddenStartup = (cards: unknown) =>
  Array.isArray(cards) &&
  cards.some((card) => HIDDEN_STARTUPS.has((card as { slug: string }).slug));

/** Solstice Grid's draft series B and archived bridge, or any round of a hidden startup. */
const includesHiddenRound = (items: unknown) =>
  Array.isArray(items) &&
  items.some((item) => {
    const { round, startup } = item as {
      round: { roundType: string };
      startup: { slug: string };
    };
    return (
      HIDDEN_STARTUPS.has(startup.slug) ||
      (startup.slug === "solstice-grid" &&
        ["series_b", "bridge"].includes(round.roundType))
    );
  });

const REGISTRY: AuthzRegistry = {
  "services/startups.ts#getBySlug": {
    kind: "read",
    invoke: (ctx) => orNull(startups.getBySlug(ctx, "stealth-draft-co")),
    seesDraft: found,
  },
  "services/startups.ts#list": {
    kind: "read",
    invoke: async (ctx) =>
      (
        await startups.list(ctx, {
          filters: { includeAcquired: true },
          limit: 48,
        })
      ).data,
    seesDraft: includesHiddenStartup,
  },
  "services/startups.ts#listSimilar": {
    kind: "read",
    // Café Algorithmique shares its primary industry with the archived Sunset Legacy.
    invoke: (ctx) => startups.listSimilar(ctx, "cafe-algorithmique"),
    seesDraft: includesHiddenStartup,
  },
  "services/founders.ts#getBySlug": {
    kind: "read",
    invoke: (ctx) => orNull(founders.getBySlug(ctx, "unverified-founder")),
    seesDraft: found,
  },
  "services/investors.ts#getBySlug": {
    kind: "read",
    invoke: (ctx) => orNull(investors.getBySlug(ctx, "quietwater-capital")),
    seesDraft: found,
  },
  "services/investors.ts#getPortfolio": {
    kind: "read",
    invoke: (ctx) => orNull(investors.getPortfolio(ctx, "quietwater-capital")),
    seesDraft: found,
  },
  "services/investors.ts#getRoundsLed": {
    kind: "read",
    invoke: (ctx) => orNull(investors.getRoundsLed(ctx, "old-mill-ventures")),
    seesDraft: found,
  },
  "services/batches.ts#getBySlug": {
    kind: "read",
    invoke: (ctx) => orNull(batches.getBySlug(ctx, "parallel-w26")),
    seesDraft: found,
  },
  "services/batches.ts#getStats": {
    kind: "read",
    invoke: (ctx) => orNull(batches.getStats(ctx, "parallel-s24")),
    seesDraft: found,
  },
  "services/rounds.ts#listRecent": {
    kind: "read",
    invoke: async (ctx) => (await rounds.listRecent(ctx, { limit: 48 })).data,
    seesDraft: includesHiddenRound,
  },
  "services/startups.ts#count": {
    kind: "read",
    invoke: (ctx) => startups.count(ctx, { includeAcquired: true }),
    // 17 startups are published; the draft and archived ones make 19.
    seesDraft: (result) => (result as number) > 17,
  },
  "services/taxonomy.ts#getPage": {
    kind: "read",
    // Quantum Computing's only company is a draft.
    invoke: (ctx) => orNull(taxonomy.getPage(ctx, "industries", "quantum")),
    seesDraft: found,
  },
  "services/taxonomy.ts#listCategories": {
    kind: "read",
    invoke: (ctx) => taxonomy.listCategories(ctx),
    seesDraft: (result) =>
      (result as { entries: { slug: string }[] }[]).some((group) =>
        group.entries.some((entry) => entry.slug === "quantum"),
      ),
  },
  "services/search.ts#search": {
    kind: "read",
    invoke: (ctx) => search.search(ctx, { q: "stealth" }),
    seesDraft: (result) =>
      (result as { data: { startups: { total: number } } }).data.startups
        .total > 0,
  },
  "services/search.ts#suggest": {
    kind: "read",
    invoke: (ctx) => search.suggest(ctx, "sunset"),
    seesDraft: (result) => (result as unknown[]).length > 0,
  },
  "services/stats.ts#getCounts": {
    kind: "read",
    invoke: (ctx) => stats.getCounts(ctx),
    seesDraft: (result) => (result as { startups: number }).startups > 17,
  },
  "services/rounds.ts#listForStartup": {
    kind: "read",
    invoke: async (ctx) =>
      (await rounds.listForStartup(ctx, "solstice-grid")).map((round) => ({
        round,
        startup: { slug: "solstice-grid" },
      })),
    seesDraft: includesHiddenRound,
  },
};

const serverDir = join(import.meta.dirname, "..");

const exported = [
  ...(await collectExportedFunctions(join(serverDir, "services"))).map(
    (key) => `services/${key}`,
  ),
  ...(await collectExportedFunctions(join(serverDir, "cache"))).map(
    (key) => `cache/${key}`,
  ),
];

defineAuthzSuite(
  "authz conformance: services and cached reads",
  REGISTRY,
  exported,
);
