import "server-only";

import { sql } from "drizzle-orm";
import {
  char,
  check,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { slugFormat } from "./shared";

// docs/SRS.md §4.7 (DM-07). A country-level row has a null city.
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    city: text("city"),
    region: text("region"),
    country: text("country").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
  },
  (t) => [
    // NULLS NOT DISTINCT: exactly one country-level (null city) row per country.
    unique("locations_city_country_code_key")
      .on(t.city, t.countryCode)
      .nullsNotDistinct(),
    slugFormat("locations", t.slug),
    check(
      "locations_country_code_format",
      sql`${t.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check("locations_lat_range", sql`${t.lat} between -90 and 90`),
    check("locations_lng_range", sql`${t.lng} between -180 and 180`),
  ],
);
