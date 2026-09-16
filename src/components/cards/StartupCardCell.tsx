import type { StartupCard } from "@/types/public";
import { EntityCard } from "./EntityCard";
import { startupChips, startupCorner } from "./startup-card";

type StartupCardCellProps = Readonly<{
  card: StartupCard;
  sizes: string;
  priority?: boolean;
  className?: string;
}>;

/** A startup as a grid cell, on the landing and on /companies alike. */
export function StartupCardCell({ card, ...rest }: StartupCardCellProps) {
  return (
    <EntityCard
      href={`/companies/${card.slug}`}
      name={card.name}
      logo={card.logo}
      cover={card.cover}
      chips={startupChips(card)}
      corner={startupCorner(card)}
      {...rest}
    />
  );
}
