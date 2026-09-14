import "server-only";

import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { slugFormat } from "./shared";

// docs/SRS.md §4.8 (DM-08)
export const industries = pgTable(
  "industries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    description: text("description"),
  },
  (t) => [slugFormat("industries", t.slug)],
);
