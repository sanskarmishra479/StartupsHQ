"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StartupCard } from "@/types/public";
import { Logo } from "../brand/Logo";
import { EmptyState } from "../data/EmptyState";
import { SectionNav } from "../layout/SectionNav";
import { SearchLauncher } from "../search/SearchLauncher";
import { IconToggle } from "../ui/IconToggle";
import { ArrowRightIcon, GridIcon, ListIcon } from "../ui/icons";
import { PillButton } from "../ui/PillButton";
import { ThemeToggle } from "../ui/ThemeToggle";
import { CurvedGrid, type Mode } from "./CurvedGrid";

export type LandingCounts = Readonly<{
  startups: number;
  founders: number;
  investors: number;
}>;

type View = "curved" | "flat";

const VIEW_KEY = "landing-view";
const number = new Intl.NumberFormat("en-US");

/**
 * The landing (FR-113): the curved grid with the reference's floating chrome — logo and search
 * along the top with the directory's counts between, and along the bottom the view toggle, the
 * section pill and a way to the full list.
 */
export function Landing({
  cards,
  counts,
}: Readonly<{ cards: readonly StartupCard[]; counts: LandingCounts }>) {
  const [view, setView] = useState<View>("curved");
  const [mode, setMode] = useState<Mode>("flat");
  // Whether the canvas has ever run here: without it (reduced motion, no WebGL) the toggle has
  // nothing to switch to.
  const [canvasAvailable, setCanvasAvailable] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "flat") setView("flat");
    } catch {
      // Storage blocked: the default view it is.
    }
  }, []);

  useEffect(() => {
    if (mode === "canvas") setCanvasAvailable(true);
  }, [mode]);

  const chooseView = (next: View) => {
    setView(next);
    if (next === "curved") setCanvasAvailable(false);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
  };

  const curved = mode === "canvas";

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-3 p-3 sm:p-4">
        <Link
          href="/"
          aria-label="StartupsHQ home"
          className="glass pointer-events-auto flex h-10 items-center rounded-pill px-4"
        >
          <Logo wordmark className="text-base" />
        </Link>
        <p className="meta glass hidden items-center rounded-pill px-4 py-2 text-fg lg:flex">
          {number.format(counts.startups)} startups ·{" "}
          {number.format(counts.founders)} founders ·{" "}
          {number.format(counts.investors)} investors
        </p>
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <SearchLauncher className="max-sm:size-10 max-sm:px-0" />
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <h1 className="sr-only">
          StartupsHQ — startups, founders, investors and accelerator batches
        </h1>
        {cards.length === 0 ? (
          <div className="flex min-h-dvh items-center justify-center px-4">
            <EmptyState title="The directory is being filled">
              No companies are published yet. Check back soon.
            </EmptyState>
          </div>
        ) : (
          <CurvedGrid
            cards={cards}
            view={view}
            onModeChange={setMode}
            listClassName="px-3 pt-20 pb-36 sm:px-4 sm:pb-24"
          />
        )}
      </main>

      <nav
        aria-label="Landing"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 p-3 sm:p-4"
      >
        {/* Phones: the section pill gets its own row, still within thumb reach. */}
        <SectionNav
          label="Sections"
          className="flex justify-center sm:hidden [&>ul]:pointer-events-auto"
        />
        <div className="flex items-end justify-between gap-2">
          <div className="pointer-events-auto">
            {(canvasAvailable || view === "flat") && (
              <IconToggle
                label="View"
                value={curved ? "curved" : view === "flat" ? "flat" : null}
                onChange={chooseView}
                options={[
                  { value: "curved", label: "Curved grid", icon: <GridIcon /> },
                  { value: "flat", label: "Plain grid", icon: <ListIcon /> },
                ]}
              />
            )}
          </div>
          <SectionNav
            label="Sections"
            className="pointer-events-auto hidden sm:block"
          />
          <PillButton
            href="/companies"
            variant="glass"
            className="pointer-events-auto"
          >
            Show all
            <ArrowRightIcon />
          </PillButton>
        </div>
      </nav>
    </>
  );
}
