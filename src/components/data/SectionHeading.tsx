import Link from "next/link";
import { cx } from "@/lib/cx";
import { ArrowRightIcon } from "../ui/icons";

type SectionHeadingProps = Readonly<{
  title: string;
  /** Rendered as an <h2> by default; pass 3 inside a section that already has one. */
  level?: 2 | 3;
  /** A count or short note beside the title, in the metadata style. */
  meta?: string;
  action?: Readonly<{ href: string; label: string }>;
  id?: string;
  className?: string;
}>;

export function SectionHeading({
  title,
  level = 2,
  meta,
  action,
  id,
  className,
}: SectionHeadingProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div
      className={cx(
        "flex items-end justify-between gap-4 border-border border-b pb-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <Heading
          id={id}
          className={cx(
            "truncate font-medium text-fg tracking-tight",
            level === 2 ? "text-xl" : "text-lg",
          )}
        >
          {title}
        </Heading>
        {meta && <span className="meta shrink-0 text-fg-subtle">{meta}</span>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="meta inline-flex shrink-0 items-center gap-1 text-fg-muted hover:text-fg"
        >
          {action.label}
          <ArrowRightIcon className="size-3" />
        </Link>
      )}
    </div>
  );
}
