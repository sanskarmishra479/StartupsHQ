import "server-only";

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { investorTypeEnum } from "./enums";
import { locations } from "./locations";
import { mediaAssets } from "./media";
import {
  entityColumns,
  httpsUrl,
  lifecycleChecks,
  searchVector,
  slugFormat,
  tsvector,
} from "./shared";

// docs/SRS.md §4.4 (DM-04)
export const investors = pgTable(
  "investors",
  {
    ...entityColumns(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    investorType: investorTypeEnum("investor_type").notNull(),
    description: text("description"),
    logoAssetId: uuid("logo_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    ogAssetId: uuid("og_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    websiteUrl: text("website_url"),
    foundedYear: integer("founded_year"),
    hqLocationId: uuid("hq_location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    aumUsd: bigint("aum_usd", { mode: "number" }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      searchVector([
        ["name", "A"],
        ["description", "C"],
      ]),
    ),
  },
  (t) => [
    slugFormat("investors", t.slug),
    ...lifecycleChecks("investors", t),
    httpsUrl("investors_website_url_https", t.websiteUrl),
    check(
      "investors_description_length",
      sql`char_length(${t.description}) <= 4000`,
    ),
    check("investors_founded_year_min", sql`${t.foundedYear} >= 1900`),
    check("investors_aum_non_negative", sql`${t.aumUsd} >= 0`),
    index("investors_search_vector_idx").using("gin", t.searchVector),
    index("investors_name_trgm_idx").using(
      "gin",
      sql`public.immutable_unaccent(lower(${t.name})) gin_trgm_ops`,
    ),
    index("investors_status_created_at_idx").on(
      t.status,
      t.createdAt.desc(),
      t.id,
    ),
  ],
);
