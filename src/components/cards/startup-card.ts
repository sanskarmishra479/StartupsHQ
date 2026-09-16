import { stageLabel, workTypeLabel } from "@/lib/labels";
import { formatAmount } from "@/lib/money";
import type { StartupCard } from "@/types/public";

// What a startup shows in the corners of its cell. Pure, so it is unit-tested apart from the markup.

/** The bottom-right fact: the latest disclosed amount and year, else acquisition, else place. */
export function startupCorner(card: StartupCard): string | null {
  if (card.latestRound) {
    const { amountUsd, isUndisclosed, announcedOn } = card.latestRound;
    const amount = isUndisclosed ? null : formatAmount(amountUsd);
    const year = announcedOn.slice(0, 4);
    return amount ? `${amount} · ${year}` : year;
  }
  if (card.acquiredBy) return "Acquired";
  return card.location?.city ?? card.location?.country ?? null;
}

export function startupChips(card: StartupCard): string[] {
  const chips = [
    card.stage ? stageLabel(card.stage) : undefined,
    card.primaryIndustry?.name,
    card.workType ? workTypeLabel(card.workType) : undefined,
  ];
  return chips.filter((chip): chip is string => Boolean(chip));
}
