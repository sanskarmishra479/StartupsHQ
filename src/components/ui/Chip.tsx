import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type ChipProps = Readonly<{
  children: ReactNode;
  /** Makes the chip a link, e.g. to its category page. */
  href?: string;
  className?: string;
}>;

const CHIP =
  "meta inline-flex h-5 items-center rounded-xs border border-border-strong px-1.5 text-fg-muted";

/** A small monospace tag: stage, industry, work type. */
export function Chip({ children, href, className }: ChipProps) {
  if (href) {
    return (
      <Link
        href={href}
        prefetch={false}
        className={cx(CHIP, "hover:border-fg-subtle hover:text-fg", className)}
      >
        {children}
      </Link>
    );
  }
  return <span className={cx(CHIP, className)}>{children}</span>;
}
