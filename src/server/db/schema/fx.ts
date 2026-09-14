import "server-only";

import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  numeric,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

// docs/SRS.md §4.11 (DM-11). Daily reference rates used for server-side FX conversion (FR-406).
export const fxRates = pgTable(
  "fx_rates",
  {
    currency: char("currency", { length: 3 }).notNull(),
    rateDate: date("rate_date").notNull(),
    usdPerUnit: numeric("usd_per_unit", { precision: 18, scale: 8 }).notNull(),
    source: text("source").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.currency, t.rateDate] }),
    check("fx_rates_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("fx_rates_usd_per_unit_positive", sql`${t.usdPerUnit} > 0`),
    check("fx_rates_source", sql`${t.source} in ('ecb', 'manual')`),
  ],
);
