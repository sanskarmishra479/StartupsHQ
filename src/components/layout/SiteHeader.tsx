import Link from "next/link";
import { Logo } from "../brand/Logo";
import { SearchIcon } from "../ui/icons";
import { PillButton } from "../ui/PillButton";
import { ThemeToggle } from "../ui/ThemeToggle";
import { SectionNav } from "./SectionNav";

/**
 * The header on every public page except the landing, which floats its own chrome. On phones the
 * section pill moves to the bottom of the screen, within thumb reach, as on the landing.
 */
export function SiteHeader() {
  return (
    <>
      <header className="sticky top-0 z-30 border-border border-b bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            aria-label="StartupsHQ home"
            className="shrink-0 rounded-sm"
          >
            <Logo wordmark className="text-base" />
          </Link>
          <SectionNav label="Sections" className="hidden md:block" />
          <div className="flex items-center gap-2">
            <PillButton
              href="/search"
              size="sm"
              aria-label="Search"
              className="max-sm:size-8 max-sm:px-0"
            >
              <SearchIcon />
              <span className="hidden sm:inline">Search</span>
            </PillButton>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <SectionNav
        label="Sections"
        className="fixed inset-x-0 bottom-3 z-30 flex justify-center md:hidden"
      />
    </>
  );
}
