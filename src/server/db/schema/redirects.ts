import "server-only";

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { slugFormat } from "./shared";

// docs/SRS.md §4.11 (DM-11), FR-409. Old slugs answer with a 301 to the entity's current slug.
export const slugRedirects = pgTable(
  "slug_redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    oldSlug: text("old_slug").notNull(),
    // Polymorphic reference, so no foreign key; the slug service keeps it consistent.
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("slug_redirects_entity_type_old_slug_key").on(
      t.entityType,
      t.oldSlug,
    ),
    check(
      "slug_redirects_entity_type",
      sql`${t.entityType} in ('startup', 'founder', 'investor', 'batch')`,
    ),
    slugFormat("slug_redirects_old", t.oldSlug),
    index("slug_redirects_entity_idx").on(t.entityType, t.entityId),
  ],
);
