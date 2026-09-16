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
  const corner = startupCorner(card);
  return (
    <EntityCard
      href={`/companies/${card.slug}`}
      name={card.name}
      logo={card.logo}
      cover={card.cover}
      chips={startupChips(card)}
      corner={
        corner && (
          <>
            {corner.main}
            {corner.detail && (
              <span className="@max-[13rem]:hidden"> · {corner.detail}</span>
            )}
          </>
        )
      }
      {...rest}
    />
  );
}
