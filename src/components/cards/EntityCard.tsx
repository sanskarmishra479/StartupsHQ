import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import type { Image } from "@/types/public";
import { InitialsAvatar } from "../media/InitialsAvatar";
import { ResponsiveImage } from "../media/ResponsiveImage";
import { HoverPrefetchLink } from "../ui/HoverPrefetchLink";

export type EntityCardProps = Readonly<{
  href: string;
  name: string;
  logo: Image | null;
  /** Landscape at the OpenGraph ratio; the logo stands in on a neutral tile when absent. */
  cover: Image | null;
  /** Short facts in the bottom-left: stage, industry, work type. */
  chips?: readonly string[];
  /** The bottom-right corner: latest round, year or place. */
  corner?: ReactNode;
  /** The card's rendered width per breakpoint, for picking a cover variant. */
  sizes: string;
  /** Only for cards painted above the fold on first load. */
  priority?: boolean;
  className?: string;
}>;

/**
 * One cell of the grid, after the reference's anatomy: logo top-left, name top-right, cover in the
 * middle, chips bottom-left and a fact bottom-right, on hairline borders. The whole cell is one link
 * that prefetches on intent (NFR-11). Images are decorative: the name is in the link text.
 */
export function EntityCard({
  href,
  name,
  logo,
  cover,
  chips = [],
  corner,
  sizes,
  priority = false,
  className,
}: EntityCardProps) {
  return (
    <HoverPrefetchLink
      href={href}
      className={cx(
        "group @container flex min-w-0 flex-col gap-2.5 border border-border bg-bg p-2.5 sm:gap-3 sm:p-3",
        "transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-surface-hover",
        "focus-visible:relative focus-visible:z-10 focus-visible:outline-offset-[-2px]",
        className,
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-3">
        {logo ? (
          <ResponsiveImage
            image={logo}
            alt=""
            sizes="20px"
            fit="contain"
            className="size-5 shrink-0 rounded-xs"
          />
        ) : (
          <InitialsAvatar
            name={name}
            decorative
            shape="square"
            className="size-5 text-[0.5625rem]"
          />
        )}
        <h3 className="meta min-w-0 truncate text-right text-fg">{name}</h3>
      </div>

      <div className="relative aspect-(--aspect-cover) w-full overflow-hidden rounded-xs bg-placeholder">
        {cover ? (
          <ResponsiveImage
            image={cover}
            alt=""
            sizes={sizes}
            priority={priority}
            className="size-full"
          />
        ) : logo ? (
          <div className="flex size-full items-center justify-center p-[18%]">
            <ResponsiveImage
              image={logo}
              alt=""
              sizes="160px"
              fit="contain"
              priority={priority}
              className="max-h-full w-auto max-w-full"
            />
          </div>
        ) : (
          <div className="flex size-full items-center justify-center">
            <InitialsAvatar
              name={name}
              decorative
              shape="square"
              className="size-14 text-lg"
            />
          </div>
        )}
      </div>

      <div className="flex min-h-5 items-center justify-between gap-2">
        {/* One row: chips that do not fit wrap onto a hidden second row; one too wide for the
            row on its own is truncated with an ellipsis. */}
        <ul className="flex h-5 min-w-0 flex-wrap gap-1 overflow-hidden">
          {chips.map((chip) => (
            <li
              key={chip}
              className="meta inline-flex h-5 max-w-full shrink-0 items-center rounded-xs border border-border-strong px-1.5 text-fg-muted"
            >
              <span className="truncate">{chip}</span>
            </li>
          ))}
        </ul>
        {corner && (
          <span className="meta shrink-0 text-fg-muted tabular-nums">
            {corner}
          </span>
        )}
      </div>
    </HoverPrefetchLink>
  );
}
