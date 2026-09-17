import { cx } from "@/lib/cx";
import { MARK_ARTBOARD, MARK_PARTS, MARK_TONES } from "./mark";

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
 * The mark centred on its white square, as in the favicon, in both themes. The colours are fixed
 * (MARK_TONES); a hairline in the border token keeps the square visible on the light theme.
 */
export function Logo({ wordmark = false, className, title }: LogoProps) {
  const label = wordmark ? undefined : title;
  return (
    <span
      className={cx(
        "inline-flex items-center",
        wordmark && "gap-[0.5em] font-semibold tracking-tight",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${MARK_ARTBOARD} ${MARK_ARTBOARD}`}
        className="size-[1.5em] shrink-0 shadow-[0_0_0_1px_var(--border)]"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        <rect
          width={MARK_ARTBOARD}
          height={MARK_ARTBOARD}
          fill={MARK_TONES.tile}
        />
        {MARK_PARTS.map(({ tone, rects }, part) => (
          <g
            // The parts are a fixed list in paint order.
            // biome-ignore lint/suspicious/noArrayIndexKey: never reordered.
            key={part}
            fill={MARK_TONES[tone]}
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
