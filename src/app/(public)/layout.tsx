import { SkipLink } from "@/components/layout/SkipLink";

// The public origin's pages (SRS §6.1). No cookie or header reads anywhere under here, so every
// page stays statically renderable (ADR-013).

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SkipLink />
      {children}
    </>
  );
}
