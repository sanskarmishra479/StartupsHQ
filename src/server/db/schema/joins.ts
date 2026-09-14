import "server-only";

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { batches } from "./batches";
import { founderRoleEnum } from "./enums";
import { founders } from "./founders";
import { industries } from "./industries";
import { investors } from "./investors";
import { fundingRounds } from "./rounds";
import { httpsUrl } from "./shared";
import { startups } from "./startups";

// docs/SRS.md §4.10 (DM-10) — the graph.

/** Founder ↔ startup, one row per role and stint, so leaving and returning is representable. */
export const startupFounders = pgTable(
  "startup_founders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startupId: uuid("startup_id")
      .notNull()
      .references(() => startups.id, { onDelete: "cascade" }),
    founderId: uuid("founder_id")
      .notNull()
      .references(() => founders.id, { onDelete: "cascade" }),
    role: founderRoleEnum("role").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    joinedYear: integer("joined_year"),
    leftYear: integer("left_year"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Where this attribution came from (PRD principle 3, SEC-18). */
    sourceUrl: text("source_url"),
  },
  (t) => [
    unique("startup_founders_stint_key")
      .on(t.startupId, t.founderId, t.role, t.joinedYear)
      .nullsNotDistinct(),
    check(
      "startup_founders_left_after_joined",
      sql`${t.leftYear} is null or ${t.joinedYear} is null or ${t.leftYear} >= ${t.joinedYear}`,
    ),
    check(
      "startup_founders_current_has_not_left",
      sql`not (${t.isCurrent} and ${t.leftYear} is not null)`,
    ),
    httpsUrl("startup_founders_source_url_https", t.sourceUrl),
    // Founder → all their startups: the differentiating query.
    index("startup_founders_founder_joined_idx").on(
      t.founderId,
      t.joinedYear.desc(),
    ),
  ],
);

/**
 * Investor ↔ startup, optionally tied to a round (ADR-005).
 * "Backed by" = distinct investor_id per startup; round participants = rows for a round_id.
 */
export const investments = pgTable(
  "investments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startupId: uuid("startup_id")
      .notNull()
      .references(() => startups.id, { onDelete: "cascade" }),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => fundingRounds.id, {
      onDelete: "cascade",
    }),
    isLead: boolean("is_lead").notNull().default(false),
    amountUsd: bigint("amount_usd", { mode: "number" }),
  },
  (t) => [
    // Without NULLS NOT DISTINCT, Postgres would allow unlimited (startup, investor, NULL) rows.
    unique("investments_startup_investor_round_key")
      .on(t.startupId, t.investorId, t.roundId)
      .nullsNotDistinct(),
    check("investments_amount_non_negative", sql`${t.amountUsd} >= 0`),
    index("investments_investor_idx").on(t.investorId),
    index("investments_round_idx").on(t.roundId),
  ],
);

export const startupBatches = pgTable(
  "startup_batches",
  {
    startupId: uuid("startup_id")
      .notNull()
      .references(() => startups.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.startupId, t.batchId] }),
    index("startup_batches_batch_idx").on(t.batchId),
  ],
);

export const startupIndustries = pgTable(
  "startup_industries",
  {
    startupId: uuid("startup_id")
      .notNull()
      .references(() => startups.id, { onDelete: "cascade" }),
    industryId: uuid("industry_id")
      .notNull()
      .references(() => industries.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.startupId, t.industryId] }),
    // At most one primary industry per startup.
    uniqueIndex("startup_industries_one_primary_idx")
      .on(t.startupId)
      .where(sql`${t.isPrimary}`),
    index("startup_industries_industry_idx").on(t.industryId),
  ],
);
