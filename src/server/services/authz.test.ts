import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import * as cachedBatches from "../cache/batches";
import * as cachedCategories from "../cache/categories";
import * as cachedFounders from "../cache/founders";
import * as cachedInvestors from "../cache/investors";
import * as cachedRounds from "../cache/rounds";
import * as cachedStartups from "../cache/startups";
import * as cachedStats from "../cache/stats";
import { closeDb, getDb } from "../db/client";
import { seed } from "../db/seed";
import { NotFoundError } from "../lib/errors";
import {
  type AuthzRegistry,
  collectExportedFunctions,
  defineAuthzSuite,
} from "../testing/authz";
import { fixtureId, startups as startupsTable } from "../testing/fixtures";
import { ensureTestUsers } from "../testing/users";
import * as adminReads from "./admin-reads";
import * as batchWrites from "./batch-writes";
import * as batches from "./batches";
import * as categoryWrites from "./category-writes";
import * as founderWrites from "./founder-writes";
import * as founders from "./founders";
import * as investorWrites from "./investor-writes";
import * as investors from "./investors";
import * as lifecycle from "./lifecycle";
import * as media from "./media";
import * as prefill from "./prefill";
import * as privacy from "./privacy";
import * as relationWrites from "./relation-writes";
import * as roundWrites from "./round-writes";
import * as rounds from "./rounds";
import * as search from "./search";
import * as slugWrites from "./slug-writes";
import * as startupWrites from "./startup-writes";
import * as startups from "./startups";
import * as stats from "./stats";
import * as taxonomy from "./taxonomy";
import * as users from "./users";

// The authz conformance suite (docs/TEST_PLAN.md §7, SEC-03, NFR-10).
//
// Every exported function in src/server/services and src/server/cache must be registered here
// with its kind; an unregistered or stale entry fails the build. Reads run against the seeded
// fixtures, whose draft and archived records must stay invisible to public contexts.

beforeAll(async () => {
  await ensureTestUsers();
  await seed(getDb());
});

/** Mutations are exercised against a record that does not exist: authorized callers get past
 *  the guard and fail with NotFound or a validation error, so no fixture data changes. */
const NIL_UUID = "00000000-0000-4000-8000-000000000000";

/** The smallest thing the media pipeline accepts: a 1x1 PNG. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

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

/** Cached reads return `{ kind: "not-found" }` instead of throwing. */
const isFoundValue = (result: unknown) =>
  (result as { kind?: string }).kind !== "not-found";

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
  // ── Cached public reads: PUBLIC_READ only, and never a draft in the shared cache ──────────
  "cache/startups.ts#getStartupPage": {
    kind: "cached-read",
    invoke: (ctx) => cachedStartups.getStartupPage(ctx, "stealth-draft-co"),
    seesDraft: isFoundValue,
  },
  "cache/startups.ts#getSimilarStartups": {
    kind: "cached-read",
    invoke: (ctx) =>
      cachedStartups.getSimilarStartups(ctx, "cafe-algorithmique"),
    seesDraft: includesHiddenStartup,
  },
  "cache/startups.ts#getStartupsFirstPage": {
    kind: "cached-read",
    invoke: async (ctx) =>
      (await cachedStartups.getStartupsFirstPage(ctx, "name")).data,
    seesDraft: includesHiddenStartup,
  },
  "cache/founders.ts#getFounderPage": {
    kind: "cached-read",
    invoke: (ctx) => cachedFounders.getFounderPage(ctx, "unverified-founder"),
    seesDraft: isFoundValue,
  },
  "cache/investors.ts#getInvestorPage": {
    kind: "cached-read",
    invoke: (ctx) => cachedInvestors.getInvestorPage(ctx, "quietwater-capital"),
    seesDraft: isFoundValue,
  },
  "cache/batches.ts#getBatchPage": {
    kind: "cached-read",
    invoke: (ctx) => cachedBatches.getBatchPage(ctx, "parallel-w26"),
    seesDraft: isFoundValue,
  },
  "cache/rounds.ts#getNewsFirstPage": {
    kind: "cached-read",
    invoke: async (ctx) => (await cachedRounds.getNewsFirstPage(ctx)).data,
    seesDraft: includesHiddenRound,
  },
  "cache/categories.ts#getCategoryPage": {
    kind: "cached-read",
    invoke: (ctx) =>
      cachedCategories.getCategoryPage(ctx, "industries", "quantum"),
    seesDraft: isFoundValue,
  },
  "cache/categories.ts#getCategoryDirectory": {
    kind: "cached-read",
    invoke: (ctx) => cachedCategories.getCategoryDirectory(ctx),
    seesDraft: (result) =>
      (result as { entries: { slug: string }[] }[]).some((group) =>
        group.entries.some((entry) => entry.slug === "quantum"),
      ),
  },
  "cache/stats.ts#getDirectoryCounts": {
    kind: "cached-read",
    invoke: (ctx) => cachedStats.getDirectoryCounts(ctx),
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
  // ── Mutations: editors and admins; hard delete is admins only ────────────────────────────
  "services/startup-writes.ts#create": {
    kind: "mutation",
    invoke: (ctx) => startupWrites.create(ctx, {} as never),
  },
  "services/startup-writes.ts#update": {
    kind: "mutation",
    invoke: (ctx) => startupWrites.update(ctx, NIL_UUID, {}),
  },
  "services/lifecycle.ts#publish": {
    kind: "mutation",
    invoke: (ctx) => lifecycle.publish(ctx, "startup", NIL_UUID),
  },
  "services/lifecycle.ts#unpublish": {
    kind: "mutation",
    invoke: (ctx) => lifecycle.unpublish(ctx, "startup", NIL_UUID),
  },
  "services/lifecycle.ts#archive": {
    kind: "mutation",
    invoke: (ctx) => lifecycle.archive(ctx, "startup", NIL_UUID),
  },
  "services/lifecycle.ts#restore": {
    kind: "mutation",
    invoke: (ctx) => lifecycle.restore(ctx, "startup", NIL_UUID),
  },
  "services/founder-writes.ts#create": {
    kind: "mutation",
    invoke: (ctx) => founderWrites.create(ctx, {} as never),
  },
  "services/founder-writes.ts#update": {
    kind: "mutation",
    invoke: (ctx) => founderWrites.update(ctx, NIL_UUID, {}),
  },
  "services/investor-writes.ts#create": {
    kind: "mutation",
    invoke: (ctx) => investorWrites.create(ctx, {} as never),
  },
  "services/investor-writes.ts#update": {
    kind: "mutation",
    invoke: (ctx) => investorWrites.update(ctx, NIL_UUID, {}),
  },
  "services/batch-writes.ts#create": {
    kind: "mutation",
    invoke: (ctx) => batchWrites.create(ctx, {} as never),
  },
  "services/batch-writes.ts#update": {
    kind: "mutation",
    invoke: (ctx) => batchWrites.update(ctx, NIL_UUID, {}),
  },
  "services/round-writes.ts#create": {
    kind: "mutation",
    invoke: (ctx) => roundWrites.create(ctx, {} as never),
  },
  "services/round-writes.ts#update": {
    kind: "mutation",
    invoke: (ctx) => roundWrites.update(ctx, NIL_UUID, {}),
  },
  "services/relation-writes.ts#addFounder": {
    kind: "mutation",
    invoke: (ctx) => relationWrites.addFounder(ctx, NIL_UUID, {} as never),
  },
  "services/relation-writes.ts#removeFounder": {
    kind: "mutation",
    invoke: (ctx) => relationWrites.removeFounder(ctx, NIL_UUID, NIL_UUID),
  },
  "services/relation-writes.ts#addInvestor": {
    kind: "mutation",
    invoke: (ctx) => relationWrites.addInvestor(ctx, NIL_UUID, {} as never),
  },
  "services/relation-writes.ts#removeInvestor": {
    kind: "mutation",
    invoke: (ctx) => relationWrites.removeInvestor(ctx, NIL_UUID, NIL_UUID),
  },
  "services/relation-writes.ts#addBatch": {
    kind: "mutation",
    invoke: (ctx) => relationWrites.addBatch(ctx, NIL_UUID, {} as never),
  },
  "services/relation-writes.ts#removeBatch": {
    kind: "mutation",
    invoke: (ctx) => relationWrites.removeBatch(ctx, NIL_UUID, NIL_UUID),
  },
  "services/relation-writes.ts#setIndustries": {
    kind: "mutation",
    invoke: (ctx) =>
      relationWrites.setIndustries(ctx, NIL_UUID, { industries: [] }),
  },
  "services/category-writes.ts#updateCopy": {
    kind: "mutation",
    invoke: (ctx) =>
      categoryWrites.updateCopy(ctx, "industries", "anything-at-all", {}),
  },
  "services/slug-writes.ts#changeSlug": {
    kind: "admin-mutation",
    invoke: (ctx) =>
      slugWrites.changeSlug(ctx, "startup", NIL_UUID, { slug: "anything" }),
  },
  // Privacy is admin-only, reads included: the admin-mutation contract checks exactly that.
  "services/privacy.ts#recordRequest": {
    kind: "admin-mutation",
    invoke: (ctx) => privacy.recordRequest(ctx, {} as never),
  },
  "services/privacy.ts#listRequests": {
    kind: "admin-mutation",
    invoke: (ctx) => privacy.listRequests(ctx),
  },
  "services/privacy.ts#resolveRequest": {
    kind: "admin-mutation",
    invoke: (ctx) =>
      privacy.resolveRequest(ctx, NIL_UUID, { status: "completed" }),
  },
  "services/privacy.ts#eraseFounder": {
    kind: "admin-mutation",
    invoke: (ctx) =>
      privacy.eraseFounder(ctx, NIL_UUID, { confirm: "ERASE nobody" }),
  },
  "services/admin-reads.ts#listRecords": {
    kind: "editor-read",
    invoke: async (ctx) =>
      (await adminReads.listRecords(ctx, "startup", { limit: 48 })).data,
    seesDraft: includesHiddenStartup,
  },
  "services/admin-reads.ts#getRecord": {
    kind: "editor-read",
    invoke: async (ctx) =>
      adminReads.getRecord(
        ctx,
        "startup",
        await fixtureId(startupsTable, "stealth-draft-co"),
      ),
    seesDraft: (result) => (result as { status?: string }).status === "draft",
  },
  // Media (FR-408, FR-111). A 1x1 PNG is the smallest thing the pipeline accepts.
  "services/media.ts#upload": {
    kind: "mutation",
    invoke: (ctx) =>
      media.upload(ctx, {
        purpose: "logo",
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
          "base64",
        ),
      }),
  },
  "services/media.ts#storeRemoteImage": {
    kind: "mutation",
    invoke: (ctx) =>
      media.storeRemoteImage(ctx, {
        purpose: "logo",
        sourceUrl: "https://example.com/logo.png",
        bytes: Buffer.from(TINY_PNG, "base64"),
      }),
  },
  "services/prefill.ts#prefill": {
    kind: "mutation",
    // A loopback URL: an editor gets past the guard and is refused by safeFetch, with no socket.
    invoke: (ctx) => prefill.prefill(ctx, { url: "https://127.0.0.1/" }),
  },
  "services/media.ts#refreshOgImage": {
    kind: "mutation",
    invoke: (ctx) => media.refreshOgImage(ctx, "startup", NIL_UUID),
  },
  "services/media.ts#collectGarbage": {
    kind: "admin-mutation",
    invoke: (ctx) => media.collectGarbage(ctx),
  },
  // Staff accounts (FR-208): admin-only, reads included.
  "services/users.ts#listUsers": {
    kind: "admin-mutation",
    invoke: (ctx) => users.listUsers(ctx),
  },
  "services/users.ts#inviteUser": {
    kind: "admin-mutation",
    // A malformed address: an admin gets past the guard and fails validation, inviting nobody.
    invoke: (ctx) => users.inviteUser(ctx, { email: "nobody", role: "editor" }),
  },
  "services/users.ts#changeRole": {
    kind: "admin-mutation",
    invoke: (ctx) => users.changeRole(ctx, NIL_UUID, { role: "editor" }),
  },
  "services/users.ts#resetTwoFactor": {
    kind: "admin-mutation",
    invoke: (ctx) => users.resetTwoFactor(ctx, NIL_UUID),
  },
  "services/users.ts#deactivate": {
    kind: "admin-mutation",
    invoke: (ctx) => users.deactivate(ctx, NIL_UUID),
  },
  "services/users.ts#reactivate": {
    kind: "admin-mutation",
    invoke: (ctx) => users.reactivate(ctx, NIL_UUID),
  },
  "services/lifecycle.ts#hardDelete": {
    kind: "admin-mutation",
    invoke: (ctx) => lifecycle.hardDelete(ctx, "startup", NIL_UUID),
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
