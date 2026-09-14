import "server-only";

import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { investors } from "./investors";
import { mediaAssets } from "./media";
import { entityColumns, lifecycleChecks, slugFormat } from "./shared";

// docs/SRS.md §4.5 (DM-05). An accelerator cohort such as Y Combinator W24.
export const batches = pgTable(
  "batches",
  {
    ...entityColumns(),
    slug: text("slug").notNull().unique(),
    /** Nullable: a batch may be recorded before its organizer is. */
    investorId: uuid("investor_id").references(() => investors.id, {
      onDelete: "set null",
    }),
    programName: text("program_name").notNull(),
    label: text("label").notNull(),
    season: text("season"),
    year: integer("year").notNull(),
    startsOn: date("starts_on"),
    demoDayOn: date("demo_day_on"),
    description: text("description"),
    logoAssetId: uuid("logo_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    ogAssetId: uuid("og_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    slugFormat("batches", t.slug),
    ...lifecycleChecks("batches", t),
    unique("batches_investor_label_year_key")
      .on(t.investorId, t.label, t.year)
      .nullsNotDistinct(),
    check("batches_year_min", sql`${t.year} >= 1990`),
    check(
      "batches_demo_day_after_start",
      sql`${t.demoDayOn} is null or ${t.startsOn} is null or ${t.demoDayOn} >= ${t.startsOn}`,
    ),
    check(
      "batches_description_length",
      sql`char_length(${t.description}) <= 4000`,
    ),
    index("batches_investor_idx").on(t.investorId),
    index("batches_program_name_trgm_idx").using(
      "gin",
      sql`public.immutable_unaccent(lower(${t.programName})) gin_trgm_ops`,
    ),
    index("batches_status_year_idx").on(t.status, t.year.desc(), t.id),
  ],
);
