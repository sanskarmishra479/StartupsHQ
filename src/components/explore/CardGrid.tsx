import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import type { StartupCard } from "@/types/public";
import { StartupCardCell } from "../cards/StartupCardCell";

/** One column on a phone, two on a tablet, three to four on a desktop (NFR-05). */
export const GRID_COLUMNS =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

const SIZES =
  "(min-width: 1536px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

export function CardGrid({
  cards,
  className,
  label = "Companies",
  headingLevel = 2,
}: Readonly<{
  cards: readonly StartupCard[];
  className?: string;
  label?: string;
  /** One below the heading the grid sits under. */
  headingLevel?: 2 | 3 | 4;
}>) {
  return (
    <ul aria-label={label} className={cx(GRID_COLUMNS, className)}>
      {cards.map((card, index) => (
        <li key={card.slug} className="-mr-px -mb-px flex">
          <StartupCardCell
            card={card}
            sizes={SIZES}
            priority={index < 2}
            headingLevel={headingLevel}
            className="w-full"
          />
        </li>
      ))}
    </ul>
  );
}

/** Placeholder cells in the card's exact shape, so nothing shifts when the cards arrive. */
export function CardGridSkeleton({
  count = 12,
  className,
  ...rest
}: Readonly<{ count?: number; className?: string; children?: ReactNode }> &
  Record<`data-${string}`, string>) {
  return (
    <div aria-hidden="true" className={cx(GRID_COLUMNS, className)} {...rest}>
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders.
          key={i}
          className="-mr-px -mb-px flex flex-col gap-3 border border-border p-3"
        >
          <div className="flex h-5 items-center justify-between">
            <span className="size-5 rounded-xs bg-surface-raised motion-safe:animate-pulse" />
            <span className="h-2.5 w-24 rounded-xs bg-surface-raised motion-safe:animate-pulse" />
          </div>
          <div className="aspect-(--aspect-cover) w-full rounded-xs bg-surface-raised motion-safe:animate-pulse" />
          <div className="flex h-5 items-center justify-between">
            <span className="h-5 w-28 rounded-xs bg-surface-raised motion-safe:animate-pulse" />
            <span className="h-2.5 w-16 rounded-xs bg-surface-raised motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
