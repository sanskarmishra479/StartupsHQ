import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type StatTileProps = Readonly<{
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}>;

/** One headline figure: total raised, company count, rounds led. */
export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface p-4",
        className,
      )}
    >
      <span className="meta text-fg-subtle">{label}</span>
      <span className="truncate font-medium text-2xl text-fg tabular-nums tracking-tight">
        {value}
      </span>
      {hint && <span className="text-fg-muted text-xs">{hint}</span>}
    </div>
  );
}
