import "server-only";

import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  customType,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { publishStatusEnum } from "./enums";

/**
 * Slugs are lowercase words separated by single hyphens, e.g. `y-combinator` (FR-403).
 * The constraint is named `<prefix>_slug_format`.
 */
export function slugFormat(prefix: string, column: AnyPgColumn) {
  return check(
    `${prefix}_slug_format`,
    sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
  );
}

/** Stored links must be https, so a value can never become `javascript:` in an href. */
export function httpsUrl(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^https://'`);
}

/** Postgres `tsvector`, for generated full-text search columns. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Weighted full-text vector over unaccented text, using the language-neutral `simple`
 * configuration because names and descriptions come from every country (DM-02..04).
 * Column names are constants from the schema, never user input.
 */
export function searchVector(
  parts: readonly (readonly [column: string, weight: "A" | "B" | "C"])[],
): SQL {
  return sql.raw(
    parts
      .map(
        ([column, weight]) =>
          `setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce("${column}", ''))), '${weight}')`,
      )
      .join(" || "),
  );
}

/** Columns shared by every editorial entity table (docs/SRS.md §4). */
export function entityColumns() {
  return {
    id: uuid("id").primaryKey().defaultRandom(),
    status: publishStatusEnum("status").notNull().default("draft"),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  };
}

/** Lifecycle invariants for entity tables (FR-407). */
export function lifecycleChecks(
  prefix: string,
  t: {
    status: AnyPgColumn;
    archivedAt: AnyPgColumn;
    firstPublishedAt: AnyPgColumn;
  },
) {
  return [
    check(
      `${prefix}_archived_at_matches_status`,
      sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`,
    ),
    check(
      `${prefix}_published_has_first_published_at`,
      sql`${t.status} <> 'published' or ${t.firstPublishedAt} is not null`,
    ),
  ];
}
