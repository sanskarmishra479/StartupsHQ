import "server-only";

import { eq, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { isAuthedContext, type ReadContext } from "./context";

/**
 * The status predicate every read must apply (SEC-03.2).
 *
 * Public, public-read and unproven contexts only ever see published rows. An authenticated
 * editor gets no status restriction (undefined, which drizzle's `and()` ignores); admin screens
 * narrow by status explicitly.
 */
export function visibilityFilter(
  ctx: ReadContext,
  status: PgColumn,
): SQL | undefined {
  return isAuthedContext(ctx) ? undefined : eq(status, "published");
}

/** visibilityFilter as a boolean expression, for joins and subqueries written in raw SQL. */
export function visibleSql(ctx: ReadContext, status: PgColumn): SQL {
  return visibilityFilter(ctx, status) ?? sql`true`;
}
