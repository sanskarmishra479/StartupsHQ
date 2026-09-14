import "server-only";

import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { importStatusEnum } from "./enums";

// docs/SRS.md §4.12 (DM-12)

/**
 * Append-only for the app role (SEC-11): a later migration revokes UPDATE/DELETE.
 * Personal-data fields are recorded by name only, never by value (ADR-019).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    /** Null for system jobs. Users with audit history are deactivated, not deleted. */
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    diff: jsonb("diff").notNull().default(sql`'{}'::jsonb`),
    /** Nulled after 90 days by the retention job. */
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "audit_log_action",
      sql`${t.action} in ('create', 'update', 'archive', 'restore', 'publish', 'unpublish', 'slug_change', 'hard_delete', 'erase')`,
    ),
    index("audit_log_entity_idx").on(
      t.entityType,
      t.entityId,
      t.createdAt.desc(),
    ),
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_actor_idx").on(t.actorId),
  ],
);

/** CSV imports: the dry-run's normalized rows are what commit applies (FR-402). */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    fileSha256: char("file_sha256", { length: 64 }).notNull(),
    status: importStatusEnum("status").notNull().default("dry_run"),
    rows: jsonb("rows").notNull().default(sql`'[]'::jsonb`),
    rowCount: integer("row_count").notNull().default(0),
    createCount: integer("create_count").notNull().default(0),
    updateCount: integer("update_count").notNull().default(0),
    skipCount: integer("skip_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (t) => [
    check("import_jobs_sha256_hex", sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check("import_jobs_row_count_range", sql`${t.rowCount} between 0 and 1000`),
    check(
      "import_jobs_counts_non_negative",
      sql`${t.createCount} >= 0 and ${t.updateCount} >= 0 and ${t.skipCount} >= 0 and ${t.errorCount} >= 0`,
    ),
    check(
      "import_jobs_committed_at_matches_status",
      sql`(${t.status} = 'committed') = (${t.committedAt} is not null)`,
    ),
    index("import_jobs_actor_created_at_idx").on(t.actorId, t.createdAt.desc()),
  ],
);

/** Proof an erasure happened, without retaining what was erased (FR-410). */
export const erasureLog = pgTable(
  "erasure_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityIdHash: char("entity_id_hash", { length: 64 }).notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    erasedAt: timestamp("erased_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("erasure_log_entity_type", sql`${t.entityType} in ('founder')`),
    check(
      "erasure_log_entity_id_hash_hex",
      sql`${t.entityIdHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
