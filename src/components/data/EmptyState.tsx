import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

type EmptyStateProps = Readonly<{
  title: string;
  children?: ReactNode;
  /** A way out, e.g. a "Clear filters" pill. */
  action?: ReactNode;
  className?: string;
}>;

export function EmptyState({
  title,
  children,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-3 rounded-md border border-border border-dashed px-6 py-16 text-center",
        className,
      )}
    >
      <p className="font-medium text-fg text-lg">{title}</p>
      {children && (
        <div className="max-w-md text-fg-muted text-sm">{children}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
