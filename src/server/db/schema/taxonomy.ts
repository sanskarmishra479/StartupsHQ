import "server-only";

import { integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { taxonomyKindEnum } from "./enums";
import { slugFormat } from "./shared";

// docs/SRS.md §4.9 (DM-09). Editable copy for facet values that exist elsewhere in the schema.
export const taxonomyPages = pgTable(
  "taxonomy_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: taxonomyKindEnum("kind").notNull(),
    slug: text("slug").notNull(),
    heading: text("heading"),
    intro: text("intro"),
    iconUrl: text("icon_url"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique("taxonomy_pages_kind_slug_key").on(t.kind, t.slug),
    slugFormat("taxonomy_pages", t.slug),
  ],
);
