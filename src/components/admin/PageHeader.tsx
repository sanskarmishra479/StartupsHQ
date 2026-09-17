import type { ReactNode } from "react";

/** A panel page's title, an optional line of context, and its primary actions. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}>) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="meta text-fg-subtle">{eyebrow}</div>}
        <h1 className="truncate font-medium text-2xl tracking-tight">
          {title}
        </h1>
        {description && <p className="text-fg-muted text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
