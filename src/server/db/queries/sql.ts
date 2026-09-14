import "server-only";

import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Wraps a subquery so its columns stay table-qualified. Drizzle strips table names from columns
 * placed directly in a single-table selection, which would make a correlated subquery ambiguous.
 */
export function subquery<T>(inner: SQL): SQL<T> {
  return sql<T>`(${inner})`;
}

/** A media asset as JSON for aggregated subqueries; null when there is no asset. */
export function mediaJson(media: {
  id: AnyPgColumn;
  variants: AnyPgColumn;
  blurDataUrl: AnyPgColumn;
}): SQL {
  return sql`case when ${media.id} is null then null else json_build_object('variants', ${media.variants}, 'blurDataUrl', ${media.blurDataUrl}) end`;
}
