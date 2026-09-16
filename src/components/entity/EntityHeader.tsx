import type { ReactNode } from "react";

/** The top of an entity page: mark, name, a line beneath it, then any actions. */
export function EntityHeader({
  mark,
  title,
  eyebrow,
  subtitle,
  children,
}: Readonly<{
  mark: ReactNode;
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-center gap-4 sm:gap-5">
        {mark}
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow && <div className="meta text-fg-subtle">{eyebrow}</div>}
          <h1 className="font-medium text-2xl tracking-tight sm:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="text-base text-fg-muted sm:text-lg">{subtitle}</p>
          )}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}
