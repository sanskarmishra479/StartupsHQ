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
