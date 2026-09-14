import "server-only";

import {
  type Round,
  type RoundRow,
  type StartupCard,
  toRound,
} from "./startup";

// docs/API.md §7.7

export type NewsItem = Readonly<{ round: Round; startup: StartupCard }>;

export function toNewsItem(
  row: RoundRow & { startupId: string },
  cards: ReadonlyMap<string, StartupCard>,
): NewsItem {
  const startup = cards.get(row.startupId);
  // selectRounds only returns rounds of visible startups, and cards are loaded with the same
  // context, so a miss is a bug rather than a hidden record.
  if (!startup) {
    throw new Error("A visible round must belong to a visible startup.");
  }
  return { round: toRound(row), startup };
}
