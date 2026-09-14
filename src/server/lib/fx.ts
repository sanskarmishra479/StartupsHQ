import "server-only";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { fxRates } from "../db/schema";
import { UnprocessableError } from "./errors";

// Server-side FX conversion (FR-406, ADR-018). Editors never type a rate or a USD amount.

/** A rate may be at most this many days older than the announcement (weekends, holidays). */
export const MAX_RATE_AGE_DAYS = 7;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

function parseDecimal(value: string): { units: bigint; scale: number } {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`Not a non-negative decimal: "${value}".`);
  const fraction = match[2] ?? "";
  return { units: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
}

/**
 * amount × rate, rounded half-up to whole US dollars, using exact decimal arithmetic.
 * Floating point would get cases like 0.29 × 100 wrong.
 */
export function convertToWholeUsd(
  amountOriginal: string,
  usdPerUnit: string,
): number {
  const amount = parseDecimal(amountOriginal);
  const rate = parseDecimal(usdPerUnit);
  const scale = 10n ** BigInt(amount.scale + rate.scale);
  const rounded = (amount.units * rate.units * 2n + scale) / (2n * scale);

  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UnprocessableError("That amount is too large to store.");
  }
  return Number(rounded);
}

type Reader = Pick<Database, "select">;

/** The latest rate on or before `onDate`, no older than MAX_RATE_AGE_DAYS. */
export async function findRate(
  db: Reader,
  currency: string,
  onDate: string,
): Promise<{ usdPerUnit: string; rateDate: string; source: string } | null> {
  const [row] = await db
    .select({
      usdPerUnit: fxRates.usdPerUnit,
      rateDate: fxRates.rateDate,
      source: fxRates.source,
    })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.currency, currency),
        lte(fxRates.rateDate, onDate),
        gte(
          fxRates.rateDate,
          sql`(${onDate}::date - ${MAX_RATE_AGE_DAYS}::int)`,
        ),
      ),
    )
    .orderBy(desc(fxRates.rateDate))
    .limit(1);

  return row ?? null;
}

export type Conversion = {
  amountUsd: number;
  fxRate: string | null;
  fxRateDate: string | null;
  fxSource: "ecb" | "manual" | null;
};

/** Converts a disclosed round amount to USD for storage. USD amounts carry no FX details. */
export async function convertRound(
  db: Reader,
  input: { currency: string; amountOriginal: string; announcedOn: string },
): Promise<Conversion> {
  if (input.currency === "USD") {
    return {
      amountUsd: convertToWholeUsd(input.amountOriginal, "1"),
      fxRate: null,
      fxRateDate: null,
      fxSource: null,
    };
  }

  const rate = await findRate(db, input.currency, input.announcedOn);
  if (!rate) {
    throw new UnprocessableError(
      `There is no ${input.currency} exchange rate within ${MAX_RATE_AGE_DAYS} days before ${input.announcedOn}. An admin can enter a manual rate.`,
    );
  }

  return {
    amountUsd: convertToWholeUsd(input.amountOriginal, rate.usdPerUnit),
    fxRate: rate.usdPerUnit,
    fxRateDate: rate.rateDate,
    fxSource: rate.source === "manual" ? "manual" : "ecb",
  };
}
