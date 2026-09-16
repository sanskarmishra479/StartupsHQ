import Link from "next/link";
import { cx } from "@/lib/cx";

export type SegmentedNavItem = Readonly<{ href: string; label: string }>;

type SegmentedNavProps = Readonly<{
  items: readonly SegmentedNavItem[];
  /** The href of the current section, marked for assistive technology as well as visually. */
  current?: string;
  label: string;
  className?: string;
}>;

/** The frosted pill of section links floating at the bottom of the reference. */
export function SegmentedNav({
  items,
  current,
  label,
  className,
}: SegmentedNavProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="glass flex items-center gap-0.5 rounded-pill p-1">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex h-8 items-center rounded-pill px-3.5 font-medium text-sm",
                  "transition-colors duration-(--duration-fast) ease-(--ease-out)",
                  active
                    ? "bg-inverse-bg text-inverse-fg"
                    : "text-fg hover:bg-surface-hover",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
