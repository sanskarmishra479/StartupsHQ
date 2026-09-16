import { stageLabel, workTypeLabel } from "@/lib/labels";
import { formatAmount } from "@/lib/money";
import type { StartupCard } from "@/types/public";

// What a startup shows in the corners of its cell. Pure, so it is unit-tested apart from the markup.

export type Corner = Readonly<{
  /** Always shown. */
  main: string;
  /** Dropped when the cell is too narrow for both. */
  detail: string | null;
}>;

/** The bottom-right fact: the latest disclosed amount and year, else acquisition, else place. */
export function startupCorner(card: StartupCard): Corner | null {
  if (card.latestRound) {
    const { amountUsd, isUndisclosed, announcedOn } = card.latestRound;
    const amount = isUndisclosed ? null : formatAmount(amountUsd);
    const year = announcedOn.slice(0, 4);
    return amount
      ? { main: amount, detail: year }
      : { main: year, detail: null };
  }
  if (card.acquiredBy) return { main: "Acquired", detail: null };
  const place = card.location?.city ?? card.location?.country;
  return place ? { main: place, detail: null } : null;
}

export function startupChips(card: StartupCard): string[] {
  const chips = [
    card.stage ? stageLabel(card.stage) : undefined,
    card.primaryIndustry?.name,
    card.workType ? workTypeLabel(card.workType) : undefined,
  ];
  return chips.filter((chip): chip is string => Boolean(chip));
}
