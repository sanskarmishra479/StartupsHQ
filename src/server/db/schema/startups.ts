import "server-only";

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { headcountBandEnum, stageEnum, workTypeEnum } from "./enums";
import { locations } from "./locations";
import { mediaAssets } from "./media";
import { fundingRounds } from "./rounds";
import {
  entityColumns,
  httpsUrl,
  lifecycleChecks,
  searchVector,
  slugFormat,
  tsvector,
} from "./shared";

// docs/SRS.md §4.2 (DM-02). Money is whole USD in bigint (ADR-007); JS number mode is exact
// up to 2^53 dollars.
export const startups = pgTable(
  "startups",
  {
    ...entityColumns(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    tagline: text("tagline"),
    description: text("description"),
    websiteUrl: text("website_url"),
    careersUrl: text("careers_url"),
    linkedinUrl: text("linkedin_url"),
    xUrl: text("x_url"),
    githubUrl: text("github_url"),
    logoAssetId: uuid("logo_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    coverAssetId: uuid("cover_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    ogAssetId: uuid("og_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    stage: stageEnum("stage"),
    workType: workTypeEnum("work_type"),
    headcountBand: headcountBandEnum("headcount_band"),
    foundedYear: integer("founded_year"),
    foundedOn: date("founded_on"),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    isActive: boolean("is_active").notNull().default(true),
    acquiredByStartupId: uuid("acquired_by_startup_id").references(
      (): AnyPgColumn => startups.id,
      { onDelete: "set null" },
    ),
    /** Fallback when the acquirer is not in the database. */
    acquiredByName: text("acquired_by_name"),
    acquiredOn: date("acquired_on"),
    acquiredAmountUsd: bigint("acquired_amount_usd", { mode: "number" }),
    /** Derived: equity + convertible rounds only (FR-404, ADR-018). */
    totalRaisedUsd: bigint("total_raised_usd", { mode: "number" })
      .notNull()
      .default(0),
    /** Derived: debt rounds only. */
    totalDebtUsd: bigint("total_debt_usd", { mode: "number" })
      .notNull()
      .default(0),
    /** Derived: latest equity or convertible round. */
    latestRoundId: uuid("latest_round_id").references(
      (): AnyPgColumn => fundingRounds.id,
      { onDelete: "set null" },
    ),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      searchVector([
        ["name", "A"],
        ["tagline", "B"],
        ["description", "C"],
      ]),
    ),
  },
  (t) => [
    slugFormat("startups", t.slug),
    ...lifecycleChecks("startups", t),
    httpsUrl("startups_website_url_https", t.websiteUrl),
    httpsUrl("startups_careers_url_https", t.careersUrl),
    httpsUrl("startups_linkedin_url_https", t.linkedinUrl),
    httpsUrl("startups_x_url_https", t.xUrl),
    httpsUrl("startups_github_url_https", t.githubUrl),
    check("startups_tagline_length", sql`char_length(${t.tagline}) <= 120`),
    check(
      "startups_description_length",
      sql`char_length(${t.description}) <= 4000`,
    ),
    check("startups_founded_year_min", sql`${t.foundedYear} >= 1900`),
    check(
      "startups_founded_on_matches_year",
      sql`${t.foundedOn} is null or ${t.foundedYear} is null or extract(year from ${t.foundedOn}) = ${t.foundedYear}`,
    ),
    check(
      "startups_acquisition_has_acquirer",
      sql`${t.acquiredOn} is null or ${t.acquiredByStartupId} is not null or ${t.acquiredByName} is not null`,
    ),
    check(
      "startups_not_acquired_by_itself",
      sql`${t.acquiredByStartupId} <> ${t.id}`,
    ),
    check(
      "startups_amounts_non_negative",
      sql`${t.totalRaisedUsd} >= 0 and ${t.totalDebtUsd} >= 0 and coalesce(${t.acquiredAmountUsd}, 0) >= 0`,
    ),
    index("startups_search_vector_idx").using("gin", t.searchVector),
    index("startups_name_trgm_idx").using(
      "gin",
      sql`public.immutable_unaccent(lower(${t.name})) gin_trgm_ops`,
    ),
    // One keyset index per supported sort (DM-13, ADR-008).
    index("startups_status_created_at_idx").on(
      t.status,
      t.createdAt.desc(),
      t.id,
    ),
    index("startups_status_total_raised_idx").on(
      t.status,
      t.totalRaisedUsd.desc(),
      t.id,
    ),
    index("startups_status_name_idx").using(
      "btree",
      t.status,
      sql`lower(${t.name})`,
      t.id,
    ),
    index("startups_status_stage_idx").on(t.status, t.stage),
    index("startups_status_location_idx").on(t.status, t.locationId),
    index("startups_acquired_by_idx").on(t.acquiredByStartupId),
  ],
);
