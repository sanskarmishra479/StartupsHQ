import "server-only";

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { roundClassEnum, roundTypeEnum } from "./enums";
import { entityColumns, httpsUrl, lifecycleChecks } from "./shared";
import { startups } from "./startups";

// docs/SRS.md §4.6 (DM-06). amount_usd, fx_rate, fx_rate_date and fx_source are set by the
// server from fx_rates, never by editors (FR-406).
export const fundingRounds = pgTable(
  "funding_rounds",
  {
    ...entityColumns(),
    startupId: uuid("startup_id")
      .notNull()
      .references(() => startups.id, { onDelete: "cascade" }),
    roundType: roundTypeEnum("round_type").notNull(),
    /** Generated from round_type; decides what counts toward totals (ADR-018). */
    roundClass: roundClassEnum("round_class").generatedAlwaysAs(
      sql.raw(
        `CASE "round_type" WHEN 'convertible' THEN 'convertible'::round_class WHEN 'bridge' THEN 'convertible'::round_class WHEN 'debt' THEN 'debt'::round_class WHEN 'grant' THEN 'non_dilutive'::round_class WHEN 'secondary' THEN 'secondary'::round_class ELSE 'equity'::round_class END`,
      ),
    ),
    announcedOn: date("announced_on").notNull(),
    isUndisclosed: boolean("is_undisclosed").notNull().default(false),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    amountOriginal: numeric("amount_original", { precision: 20, scale: 2 }),
    amountUsd: bigint("amount_usd", { mode: "number" }),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    fxRateDate: date("fx_rate_date"),
    fxSource: text("fx_source"),
    valuationUsd: bigint("valuation_usd", { mode: "number" }),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title"),
    notes: text("notes"),
  },
  (t) => [
    ...lifecycleChecks("funding_rounds", t),
    httpsUrl("funding_rounds_source_url_https", t.sourceUrl),
    // Undisclosed ⟺ no amounts (DM-06).
    check(
      "funding_rounds_undisclosed_has_no_amount",
      sql`(${t.isUndisclosed} and ${t.amountOriginal} is null and ${t.amountUsd} is null) or (not ${t.isUndisclosed} and ${t.amountOriginal} is not null and ${t.amountUsd} is not null)`,
    ),
    // A disclosed non-USD amount must record how it was converted.
    check(
      "funding_rounds_non_usd_has_fx",
      sql`${t.currency} = 'USD' or ${t.isUndisclosed} or (${t.fxRate} is not null and ${t.fxRateDate} is not null and ${t.fxSource} is not null)`,
    ),
    check("funding_rounds_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("funding_rounds_fx_source", sql`${t.fxSource} in ('ecb', 'manual')`),
    check("funding_rounds_fx_rate_positive", sql`${t.fxRate} > 0`),
    check(
      "funding_rounds_fx_rate_not_after_announcement",
      sql`${t.fxRateDate} <= ${t.announcedOn}`,
    ),
    check(
      "funding_rounds_amounts_non_negative",
      sql`coalesce(${t.amountOriginal}, 0) >= 0 and coalesce(${t.amountUsd}, 0) >= 0 and coalesce(${t.valuationUsd}, 0) >= 0`,
    ),
    // News feed: newest first (DM-13).
    index("funding_rounds_status_announced_on_idx").on(
      t.status,
      t.announcedOn.desc(),
      t.id,
    ),
    // Company timeline.
    index("funding_rounds_startup_announced_on_idx").on(
      t.startupId,
      t.announcedOn.desc(),
    ),
  ],
);
