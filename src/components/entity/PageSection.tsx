import { type ReactNode, useId } from "react";
import { SectionHeading } from "../data/SectionHeading";

/** A titled region of an entity page; the heading names the region for assistive technology. */
export function PageSection({
  title,
  meta,
  action,
  children,
}: Readonly<{
  title: string;
  meta?: string;
  action?: Readonly<{ href: string; label: string }>;
  children: ReactNode;
}>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <SectionHeading id={id} title={title} meta={meta} action={action} />
      {children}
    </section>
  );
}
