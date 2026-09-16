import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export type MetaItem = Readonly<{
  label: string;
  value: ReactNode;
  /** Every entity mention is a link (Phase 15). */
  href?: string;
}>;

/** A wrapping row of labelled facts: stage, location, founded, headcount… */
export function MetaRow({
  items,
  className,
}: Readonly<{ items: readonly MetaItem[]; className?: string }>) {
  const shown = items.filter(
    ({ value }) => value !== null && value !== undefined && value !== "",
  );
  if (shown.length === 0) return null;
  return (
    <dl className={cx("flex flex-wrap gap-x-6 gap-y-3", className)}>
      {shown.map(({ label, value, href }) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="meta text-fg-subtle">{label}</dt>
          <dd className="truncate text-fg text-sm">
            {href ? (
              <Link
                href={href}
                prefetch={false}
                className="underline decoration-border-strong underline-offset-4 hover:decoration-fg"
              >
                {value}
              </Link>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
