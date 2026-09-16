import "server-only";

import { asc } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { visibilityFilter } from "../auth/visibility";
import { getDb } from "../db/client";
import type { SluggedEntity } from "../db/queries/slugs";
import { batches, founders, investors, startups } from "../db/schema";

// Slug listings for prerendering entity pages at build time, and for the sitemap (FR-110).
// Visibility comes from the context like every other read.

export const MAX_LISTED_SLUGS = 5000;

const TABLES = {
  startup: startups,
  founder: founders,
  investor: investors,
  batch: batches,
} as const;

export const SLUGGED_ENTITIES = Object.keys(TABLES) as SluggedEntity[];

/** Visible slugs of one entity type, alphabetically, so a list changes only when membership does. */
export async function listSlugs(
  ctx: ReadContext,
  entity: SluggedEntity,
  limit: number = MAX_LISTED_SLUGS,
): Promise<string[]> {
  // Every entity table has `slug`, `status` and `updatedAt`; the cast only unifies the types.
  const table = TABLES[entity] as unknown as typeof startups;
  const rows = await getDb()
    .select({ slug: table.slug })
    .from(table)
    .where(visibilityFilter(ctx, table.status))
    .orderBy(asc(table.slug))
    .limit(Math.min(MAX_LISTED_SLUGS, Math.max(1, Math.trunc(limit))));
  return rows.map((row) => row.slug);
}
