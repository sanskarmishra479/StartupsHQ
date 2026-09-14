import "server-only";

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { mediaPurposeEnum, mediaStateEnum } from "./enums";
import { httpsUrl } from "./shared";

/** One pre-generated WebP rendition of an uploaded image (ADR-012). */
export type MediaVariant = {
  width: number;
  height: number;
  url: string;
  bytes: number;
};

// docs/SRS.md §4.11 (DM-11), FR-408.
// Uploads start as `staging` and become `attached` when an entity that references them is saved;
// the media GC job deletes stale staging assets and unreferenced attached ones.
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blobPrefix: text("blob_prefix").notNull().unique(),
    purpose: mediaPurposeEnum("purpose").notNull(),
    state: mediaStateEnum("state").notNull().default("staging"),
    variants: jsonb("variants")
      .$type<MediaVariant[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    blurDataUrl: text("blur_data_url"),
    /** Where a prefilled image was fetched from; null for direct uploads. */
    sourceUrl: text("source_url"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "media_assets_attached_at_matches_state",
      sql`(${t.state} = 'attached') = (${t.attachedAt} is not null)`,
    ),
    // Check SQL must not contain ';' — drizzle-kit truncates the expression there when it
    // generates migrations (guarded by schema.test.ts). The '.' matches the ';' before base64.
    check(
      "media_assets_blur_is_image_data_url",
      sql`${t.blurDataUrl} ~ '^data:image/(webp|jpeg|png).base64,'`,
    ),
    check(
      "media_assets_variants_is_array",
      sql`jsonb_typeof(${t.variants}) = 'array'`,
    ),
    httpsUrl("media_assets_source_url_https", t.sourceUrl),
    index("media_assets_state_created_at_idx").on(t.state, t.createdAt),
  ],
);
