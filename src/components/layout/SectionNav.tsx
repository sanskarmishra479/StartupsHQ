"use client";

import { usePathname } from "next/navigation";
import { SegmentedNav } from "../ui/SegmentedNav";
import { SECTIONS, sectionFor } from "./nav";

/** The section pill, marking the section the current page belongs to. */
export function SectionNav({
  label,
  className,
}: Readonly<{ label: string; className?: string }>) {
  const pathname = usePathname();
  return (
    <SegmentedNav
      label={label}
      items={SECTIONS}
      current={sectionFor(pathname)}
      className={className}
    />
  );
}
