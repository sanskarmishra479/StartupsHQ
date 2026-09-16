import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { fxRates } from "./schema";

// Daily reference rates from the European Central Bank (FR-406, ADR-018).
//
// The ECB publishes rates against the euro; every round is converted in US dollars, so each rate
// is re-expressed as dollars per unit of the currency. The feed is a URL we chose ourselves, so it
// is fetched directly — SEC-05's safeFetch guards URLs supplied by other people.

export const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** `usd_per_unit` keeps 8 decimal places, as the column does. */
const SCALE = 8;

export type ParsedRates = Readonly<{
  rateDate: string;
  rates: readonly Readonly<{ currency: string; usdPerUnit: string }>[];
}>;

/**
 * Reads the ECB's daily cube. Written against the feed's shape rather than with an XML parser:
 * the document is three nested tags with no text content, and a parser would be one more
 * dependency handling input from the network.
 */
export function parseEcbRates(xml: string): ParsedRates {
  const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml);
  if (!day?.[1]) throw new Error("The ECB feed carried no date.");

  const perEuro = new Map<string, number>();
  const pattern =
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]*\.?[0-9]+)['"]/g;
  for (const match of xml.matchAll(pattern)) {
    const currency = match[1];
    const rate = Number(match[2]);
    if (currency && Number.isFinite(rate) && rate > 0) {
      perEuro.set(currency, rate);
    }
  }

  const usdPerEuro = perEuro.get("USD");
  if (!usdPerEuro) {
    throw new Error("The ECB feed carried no US dollar rate.");
  }

  const rates = [
    // The euro is the feed's own base, and the dollar is the unit we convert into.
    { currency: "EUR", usdPerUnit: usdPerEuro.toFixed(SCALE) },
    { currency: "USD", usdPerUnit: (1).toFixed(SCALE) },
    ...[...perEuro]
      .filter(([currency]) => currency !== "USD")
      .map(([currency, rate]) => ({
        currency,
        usdPerUnit: (usdPerEuro / rate).toFixed(SCALE),
      })),
  ];

  return { rateDate: day[1], rates };
}

export type FxImportResult = Readonly<{ rateDate: string; stored: number }>;

/** Idempotent: re-importing a day overwrites that day's rates and nothing else. */
export async function importFxRates(
  db: Database,
  xml: string,
): Promise<FxImportResult> {
  const { rateDate, rates } = parseEcbRates(xml);

  await db
    .insert(fxRates)
    .values(
      rates.map((rate) => ({
        currency: rate.currency,
        rateDate,
        usdPerUnit: rate.usdPerUnit,
        source: "ecb",
      })),
    )
    .onConflictDoUpdate({
      target: [fxRates.currency, fxRates.rateDate],
      set: {
        usdPerUnit: sql`excluded.usd_per_unit`,
        source: sql`excluded.source`,
      },
    });

  return { rateDate, stored: rates.length };
}
