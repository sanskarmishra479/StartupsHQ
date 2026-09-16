// Money presentation (ADR-007). Amounts are whole US dollars; formatting is the client's job.
// Client-safe.

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * "$30M", "$1.2B", "$750K", "Undisclosed" — or null when the amount is unknown, so the UI shows
 * nothing rather than a guess (PRD principle 5). Never renders "$0" for an undisclosed round.
 */
export function formatAmount(
  amountUsd: number | null | undefined,
  options: { isUndisclosed?: boolean } = {},
): string | null {
  if (options.isUndisclosed) return "Undisclosed";
  if (amountUsd === null || amountUsd === undefined) return null;
  if (!isWholeUsd(amountUsd)) return null;
  return compactUsd.format(amountUsd);
}

/** A non-negative whole number of dollars that a JavaScript number represents exactly. */
export function isWholeUsd(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * A non-USD amount in its own currency, compact: "€20M", "£750K", "¥1.5B". Null for USD (the USD
 * figure already says it), unknown amounts and unrecognised currency codes, so the UI simply omits
 * the original rather than showing something wrong.
 */
export function formatOriginalAmount(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return null;
  }
  if (amount < 0 || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  if (currency === "USD") return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return null;
  }
}
