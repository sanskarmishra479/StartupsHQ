import { cx } from "@/lib/cx";
import { MARK_PARTS, MARK_VIEWBOX } from "./mark";

type LogoProps = Readonly<{
  /** Show "StartupsHQ" beside the mark. The visible name is then its accessible name too. */
  wordmark?: boolean;
  className?: string;
  /**
   * The accessible name of the mark on its own. Leave it out when a surrounding link or heading
   * already says "StartupsHQ", and the mark is hidden from assistive technology instead.
   */
  title?: string;
}>;

/**
 * The mark in `currentColor`, so it follows the theme and the text colour around it. The grey
 * halves are the current colour mixed into the page background: opaque, as the overlaps need.
 */
export function Logo({ wordmark = false, className, title }: LogoProps) {
  const label = wordmark ? undefined : title;
  return (
    <span
      className={cx(
        "inline-flex items-center",
        wordmark && "gap-[0.4em] font-semibold tracking-tight",
        className,
      )}
    >
      <svg
        viewBox={MARK_VIEWBOX}
        className="h-[1em] w-auto shrink-0"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        {MARK_PARTS.map(({ tone, rects }, part) => (
          <g
            // The parts are a fixed list in paint order.
            // biome-ignore lint/suspicious/noArrayIndexKey: never reordered.
            key={part}
            className={
              tone === "solid"
                ? "fill-current"
                : "fill-[color-mix(in_srgb,currentColor_38%,var(--bg))]"
            }
          >
            {rects.map((rect) => (
              <rect key={`${rect.width}-${rect.rx}`} {...rect} />
            ))}
          </g>
        ))}
      </svg>
      {wordmark && <span>StartupsHQ</span>}
    </span>
  );
}
