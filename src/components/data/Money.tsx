import { formatAmount, formatOriginalAmount } from "@/lib/money";

type MoneyProps = Readonly<{
  amountUsd: number | null;
  isUndisclosed?: boolean;
  /** For a non-USD round: shown after the USD figure, e.g. "$21.7M (€20M)". */
  currency?: string | null;
  amountOriginal?: number | null;
  className?: string;
}>;

/**
 * A USD amount, with the original currency beside it when the round was not in dollars (FR-106).
 * Renders nothing when the amount is unknown, and "Undisclosed" — never "$0" — when it was not
 * disclosed (PRD principle 5).
 */
export function Money({
  amountUsd,
  isUndisclosed = false,
  currency,
  amountOriginal,
  className,
}: MoneyProps) {
  const usd = formatAmount(amountUsd, { isUndisclosed });
  if (usd === null) return null;
  const original = isUndisclosed
    ? null
    : formatOriginalAmount(amountOriginal, currency);
  return (
    <span className={className}>
      <span className="tabular-nums">{usd}</span>
      {original && (
        <span className="ml-1 text-fg-subtle tabular-nums">({original})</span>
      )}
    </span>
  );
}
