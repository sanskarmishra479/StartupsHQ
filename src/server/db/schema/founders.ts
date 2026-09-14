import "server-only";

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
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

// docs/SRS.md §4.3 (DM-03). Founders are people: personal data rules apply (SEC-18, ADR-019).
export const founders = pgTable(
  "founders",
  {
    ...entityColumns(),
    slug: text("slug").notNull().unique(),
    fullName: text("full_name").notNull(),
    headline: text("headline"),
    bio: text("bio"),
    /** Only founder-supplied or licensed photos; initials avatar otherwise. */
    photoAssetId: uuid("photo_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    ogAssetId: uuid("og_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    linkedinUrl: text("linkedin_url"),
    xUrl: text("x_url"),
    githubUrl: text("github_url"),
    personalUrl: text("personal_url"),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      searchVector([
        ["full_name", "A"],
        ["headline", "B"],
        ["bio", "C"],
      ]),
    ),
  },
  (t) => [
    slugFormat("founders", t.slug),
    ...lifecycleChecks("founders", t),
    httpsUrl("founders_linkedin_url_https", t.linkedinUrl),
    httpsUrl("founders_x_url_https", t.xUrl),
    httpsUrl("founders_github_url_https", t.githubUrl),
    httpsUrl("founders_personal_url_https", t.personalUrl),
    check("founders_headline_length", sql`char_length(${t.headline}) <= 160`),
    check("founders_bio_length", sql`char_length(${t.bio}) <= 4000`),
    index("founders_search_vector_idx").using("gin", t.searchVector),
    index("founders_full_name_trgm_idx").using(
      "gin",
      sql`public.immutable_unaccent(lower(${t.fullName})) gin_trgm_ops`,
    ),
    index("founders_status_created_at_idx").on(
      t.status,
      t.createdAt.desc(),
      t.id,
    ),
  ],
);
