"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { SegmentedNav } from "../ui/SegmentedNav";
import { SECTIONS, sectionFor } from "./nav";

type SectionNavProps = Readonly<{ label: string; className?: string }>;

/**
 * The section pill, marking the section the current page belongs to. The path is not known while
 * a dynamic route prerenders, so the pill renders unmarked there and marks itself in the browser.
 */
export function SectionNav(props: SectionNavProps) {
  return (
    <Suspense
      fallback={
        <SegmentedNav
          label={props.label}
          items={SECTIONS}
          className={props.className}
        />
      }
    >
      <CurrentSectionNav {...props} />
    </Suspense>
  );
}

function CurrentSectionNav({ label, className }: SectionNavProps) {
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
