import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { StartupCardCell } from "@/components/cards/StartupCardCell";
import { EmptyState } from "@/components/data/EmptyState";
import { MetaRow } from "@/components/data/MetaRow";
import { Money } from "@/components/data/Money";
import { SectionHeading } from "@/components/data/SectionHeading";
import { StatTile } from "@/components/data/StatTile";
import { InitialsAvatar } from "@/components/media/InitialsAvatar";
import { Chip } from "@/components/ui/Chip";
import { FilterIcon, SearchIcon } from "@/components/ui/icons";
import { PillButton } from "@/components/ui/PillButton";
import { SegmentedNav } from "@/components/ui/SegmentedNav";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LoadMoreDemo, ViewToggleDemo } from "./demos";
import { SAMPLE_CARDS } from "./fixtures";

// Components gallery (TODO Phase 13): every primitive in the dark and the light theme, for review
// and for axe. Development only — a production build answers 404.

export const metadata: Metadata = {
  title: "Components gallery · StartupsHQ",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/news", label: "News" },
  { href: "/categories", label: "Categories" },
];

const SWATCHES = [
  "bg",
  "surface",
  "surface-raised",
  "surface-hover",
  "placeholder",
  "border",
  "border-strong",
  "fg",
  "fg-muted",
  "fg-subtle",
  "inverse-bg",
  "accent",
  "danger",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <SectionHeading title={title} level={3} />
      {children}
    </section>
  );
}

function ThemePanel({ theme }: { theme: "dark" | "light" }) {
  const label = theme === "dark" ? "Dark theme" : "Light theme";
  return (
    <div
      data-theme={theme}
      className="flex flex-col gap-14 bg-bg px-4 py-12 text-fg sm:px-8"
    >
      <h2 className="meta text-fg-muted">{label}</h2>

      <Section title="Colour tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SWATCHES.map((name) => (
            <li key={name} className="flex flex-col gap-1.5">
              <span
                className="h-12 rounded-md border border-border"
                style={{ background: `var(--${name})` }}
              />
              <span className="meta text-fg-muted">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-3">
          <p className="text-display">Every startup, connected.</p>
          <p className="text-3xl tracking-tight">Text 3xl — company name</p>
          <p className="text-2xl tracking-tight">Text 2xl — section title</p>
          <p className="text-xl">Text xl — lead paragraph</p>
          <p className="text-base text-fg-muted">
            Text base, muted — the calm body copy of a company page, kept to a
            readable measure so long descriptions stay comfortable.
          </p>
          <p className="text-fg-subtle text-sm">Text sm, subtle — secondary</p>
          <p className="meta text-fg-muted">
            Meta — Geist Mono caps for corners
          </p>
        </div>
      </Section>

      <Section title="Brand">
        <div className="flex flex-wrap items-center gap-8">
          <Logo title="StartupsHQ" className="text-4xl" />
          <Logo wordmark className="text-2xl" />
          <Logo wordmark className="text-base" />
          <span className="text-fg-muted">
            <Logo title="StartupsHQ" className="text-xl" />
          </span>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap items-center gap-3">
          <PillButton>
            <SearchIcon />
            Search
          </PillButton>
          <PillButton variant="glass">
            <FilterIcon />
            Filter
          </PillButton>
          <PillButton variant="outline">Show all</PillButton>
          <PillButton size="sm">Small solid</PillButton>
          <PillButton size="sm" variant="outline" disabled>
            Disabled
          </PillButton>
          <PillButton href="/" variant="glass" size="sm">
            A link
          </PillButton>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedNav label={`Sections (${label})`} items={NAV} current="/" />
          <ViewToggleDemo />
          <ThemeToggle />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>Series A</Chip>
          <Chip>Fintech</Chip>
          <Chip href="/categories/work-type/remote">Remote</Chip>
        </div>
      </Section>

      <Section title="Floating chrome">
        {/* Full-bleed on phones, as the real chrome spans the viewport. */}
        <div className="-mx-4 relative h-64 overflow-hidden border-border border-y sm:mx-0 sm:rounded-md sm:border bg-[repeating-linear-gradient(45deg,var(--surface-raised)_0_24px,var(--bg)_24px_48px)]">
          <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-3">
            <Logo wordmark className="text-base" />
            <span className="meta hidden text-fg sm:inline">
              1,204 startups · 3,410 founders · 812 investors
            </span>
            <PillButton size="sm">
              <SearchIcon />
              Search
            </PillButton>
          </div>
          <div className="absolute inset-x-2 bottom-3 flex items-center justify-between gap-1.5 sm:inset-x-3 sm:gap-2">
            <ViewToggleDemo />
            <SegmentedNav
              label={`Chrome sections (${label})`}
              items={NAV}
              current="/"
            />
            <PillButton
              variant="glass"
              size="sm"
              aria-label="Filter"
              className="max-sm:size-9 max-sm:px-0"
            >
              <FilterIcon />
              <span className="hidden sm:inline">Filter</span>
            </PillButton>
          </div>
        </div>
      </Section>

      <Section title="Data">
        <div className="flex flex-wrap items-center gap-6">
          <InitialsAvatar name="Ada Lovelace" />
          <InitialsAvatar name="Grace Hopper" shape="square" />
          <InitialsAvatar name="Linus" className="size-16 text-xl" />
          <Money amountUsd={30_000_000} />
          <Money
            amountUsd={21_684_000}
            currency="EUR"
            amountOriginal={20_000_000}
          />
          <Money amountUsd={null} isUndisclosed />
        </div>
        <MetaRow
          items={[
            {
              label: "Stage",
              value: "Series A",
              href: "/categories/stages/series-a",
            },
            { label: "Location", value: "Berlin, Germany" },
            { label: "Founded", value: "2021" },
            { label: "Team", value: "51–200" },
            { label: "Unknown", value: null },
          ]}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="Total raised"
            value={<Money amountUsd={48_500_000} />}
            hint="Across 4 rounds"
          />
          <StatTile label="Companies" value="128" />
          <StatTile label="Rounds led" value="37" hint="Since 2019" />
        </div>
      </Section>

      <Section title="Cards · /companies">
        <SectionHeading
          title="Recently added"
          meta="12 companies"
          action={{ href: "/", label: "Show all" }}
        />
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {SAMPLE_CARDS.map((card, index) => (
            <li key={card.slug} className="-mr-px -mb-px flex">
              <StartupCardCell
                card={card}
                sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                priority={theme === "dark" && index < 2}
                className="w-full"
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Cards · landing density">
        <ul className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          {SAMPLE_CARDS.map((card) => (
            <li key={card.slug} className="-mr-px -mb-px flex">
              <StartupCardCell
                card={card}
                sizes="(min-width: 1280px) 17vw, (min-width: 768px) 25vw, 50vw"
                className="w-full"
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="States">
        <EmptyState
          title="No companies match these filters"
          action={
            <PillButton variant="outline" size="sm" href="/">
              Clear filters
            </PillButton>
          }
        >
          Try removing a filter or searching by name instead.
        </EmptyState>
        <LoadMoreDemo />
        <LoadMoreDemo depthLimited />
      </Section>
    </div>
  );
}

export default function GalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-border border-b px-4 py-6 sm:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-medium text-2xl tracking-tight">
            Components gallery
          </h1>
          <p className="text-fg-muted text-sm">
            Phase 13 primitives in both themes. Development only.
          </p>
        </div>
        <ThemeToggle />
      </header>
      <ThemePanel theme="dark" />
      <ThemePanel theme="light" />
    </main>
  );
}
