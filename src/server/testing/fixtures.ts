import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import type { SlugLookup } from "../db/queries/slugs";
import {
  batches,
  founders,
  fundingRounds,
  investors,
  startups,
} from "../db/schema";

// Helpers for integration tests that run against the seeded fixtures.

type SluggedTable =
  | typeof startups
  | typeof founders
  | typeof investors
  | typeof batches;

/** The id of a seeded fixture, for tests that link extra rows to it. */
export async function fixtureId(
  table: SluggedTable,
  slug: string,
): Promise<string> {
  const unified = table as unknown as typeof startups;
  const [row] = await getDb()
    .select({ id: unified.id })
    .from(unified)
    .where(eq(unified.slug, slug));
  if (!row) throw new Error(`Missing fixture: ${slug}`);
  return row.id;
}

/** The id of a startup's round of a given type. */
export async function fixtureRoundId(
  startupSlug: string,
  roundType: (typeof fundingRounds.roundType.enumValues)[number],
): Promise<string> {
  const [row] = await getDb()
    .select({ id: fundingRounds.id })
    .from(fundingRounds)
    .innerJoin(startups, eq(startups.id, fundingRounds.startupId))
    .where(
      and(
        eq(startups.slug, startupSlug),
        eq(fundingRounds.roundType, roundType),
      ),
    );
  if (!row)
    throw new Error(`Missing fixture round: ${startupSlug} ${roundType}`);
  return row.id;
}

/** Unwraps a slug lookup that must have found its record. */
export async function found<T>(lookup: Promise<SlugLookup<T>>): Promise<T> {
  const result = await lookup;
  if (result.kind !== "found") {
    throw new Error(`Expected a record, got a redirect to ${result.slug}`);
  }
  return result.value;
}

export { batches, founders, investors, startups };
