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
import * as startups from "./startups";

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

const HIDDEN_STARTUPS = new Set(["stealth-draft-co", "sunset-legacy"]);
const includesHiddenStartup = (cards: unknown) =>
  Array.isArray(cards) &&
  cards.some((card) => HIDDEN_STARTUPS.has((card as { slug: string }).slug));

const REGISTRY: AuthzRegistry = {
  "services/startups.ts#getBySlug": {
    kind: "read",
    invoke: (ctx) => orNull(startups.getBySlug(ctx, "stealth-draft-co")),
    seesDraft: (result) => result !== null,
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
