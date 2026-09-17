"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cx } from "@/lib/cx";
import { investorTypeLabel } from "@/lib/labels";
import { paths } from "@/lib/links";
import {
  clearRecentSearches,
  normalizeSearchText,
  parseSearchQuery,
  readRecentSearches,
  rememberSearch,
  SEARCH_LIMIT,
  SEARCH_MAX,
  SEARCH_MIN,
  SEARCH_TAB_LABELS,
  SEARCH_TABS,
  type SearchTab,
  searchApiUrl,
  searchHref,
} from "@/lib/search";
import type { SearchResults } from "@/types/public";
import { EmptyState } from "../data/EmptyState";
import { EntityLogo } from "../entity/EntityLogo";
import { CardGrid, CardGridSkeleton } from "../explore/CardGrid";
import { ArrowRightIcon, ClockIcon, SearchIcon } from "../ui/icons";
import { PillButton } from "../ui/PillButton";

type Group = Exclude<SearchTab, "all">;
const GROUPS = SEARCH_TABS.filter((tab): tab is Group => tab !== "all");

/** How many of each group the All tab previews before "See all". */
const PREVIEW = { startups: 6, founders: 5, investors: 5, batches: 5 } as const;

const NOUNS: Record<Group, [string, string]> = {
  startups: ["company", "companies"],
  founders: ["founder", "founders"],
  investors: ["investor", "investors"],
  batches: ["batch", "batches"],
};

const count = (n: number, group: Group) =>
  `${n} ${NOUNS[group][n === 1 ? 0 : 1]}`;

type State =
  | Readonly<{ q: string; status: "loading" }>
  | Readonly<{ q: string; status: "error" }>
  | Readonly<{ q: string; status: "ready"; results: SearchResults }>;

/**
 * Full search results (FR-109), grouped by type with tabs. The URL holds `q` and `type`. Each query
 * is fetched once with every group at full size, so switching tabs is instant and every tab can
 * show its count. When full-text finds nothing and the trigram pass answers, the page says so.
 */
export function SearchView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { q, type } = useMemo(
    () => parseSearchQuery(searchParams),
    [searchParams],
  );
  const [state, setState] = useState<State>({ q: "", status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger; bumping it refetches the same query.
  useEffect(() => {
    if (q.length < SEARCH_MIN) return;
    setState({ q, status: "loading" });
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(searchApiUrl(q), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        const results = (await response.json()) as SearchResults;
        setState({ q, status: "ready", results });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ q, status: "error" });
      }
    })();
    return () => controller.abort();
  }, [q, attempt]);

  const submit = useCallback(
    (text: string) => {
      const next = normalizeSearchText(text);
      if (next.length >= SEARCH_MIN) rememberSearch(next);
      router.push(searchHref(next, type), { scroll: false });
    },
    [router, type],
  );

  const current = state.q === q ? state : { q, status: "loading" as const };

  return (
    <div className="flex flex-col gap-6">
      <SearchForm key={q} initial={q} onSubmit={submit} />

      {q.length < SEARCH_MIN ? (
        <Idle short={q.length > 0} />
      ) : (
        <>
          <Tabs
            q={q}
            type={type}
            pathname={pathname}
            results={current.status === "ready" ? current.results : null}
          />
          <output aria-live="polite" className="sr-only">
            {announce(current)}
          </output>
          {current.status === "loading" ? (
            <CardGridSkeleton count={6} />
          ) : current.status === "error" ? (
            <EmptyState
              title="Search is unavailable"
              action={
                <PillButton
                  variant="outline"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Try again
                </PillButton>
              }
            >
              Check your connection and try again.
            </EmptyState>
          ) : (
            <Results q={q} type={type} results={current.results} />
          )}
        </>
      )}
    </div>
  );
}

function announce(state: State): string {
  if (state.status === "loading") return "Searching…";
  if (state.status === "error") return "Search is unavailable.";
  const { data, meta } = state.results;
  const found = GROUPS.map((group) => count(data[group].total, group));
  const total = GROUPS.reduce((sum, group) => sum + data[group].total, 0);
  if (total === 0) return `No results for ${state.q}.`;
  const list = `${found.slice(0, -1).join(", ")} and ${found.at(-1)}`;
  return meta.matchType === "trigram"
    ? `No exact matches for ${state.q}. Showing close matches: ${list}.`
    : `Found ${list} for ${state.q}.`;
}

function SearchForm({
  initial,
  onSubmit,
}: Readonly<{ initial: string; onSubmit: (text: string) => void }>) {
  const [text, setText] = useState(initial);
  return (
    <search>
      {/* Without JavaScript this is a plain GET form to the same page. */}
      <form
        action="/search"
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(text);
        }}
      >
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">
            Search companies, founders, investors and batches
          </span>
          <SearchIcon className="pointer-events-none absolute left-4 size-4 text-fg-subtle" />
          <input
            type="search"
            name="q"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search companies, founders, investors…"
            maxLength={SEARCH_MAX}
            autoComplete="off"
            enterKeyHint="search"
            // biome-ignore lint/a11y/noAutofocus: the page exists to take a query; focus goes where the user will type.
            autoFocus={!initial}
            className="h-12 w-full rounded-pill border border-border-strong bg-surface pr-4 pl-10 text-base placeholder:text-fg-subtle"
          />
        </label>
        <PillButton type="submit" size="md" className="h-12 px-5">
          Search
        </PillButton>
      </form>
    </search>
  );
}

function Idle({ short }: Readonly<{ short: boolean }>) {
  const [recent, setRecent] = useState<readonly string[]>([]);
  useEffect(() => setRecent(readRecentSearches()), []);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-fg-muted text-sm">
        {short
          ? `Type at least ${SEARCH_MIN} characters.`
          : "Search by name, tagline or description. Misspellings and missing accents are fine."}
      </p>
      {recent.length > 0 && (
        <section
          aria-labelledby="recent-searches"
          className="flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-searches" className="meta text-fg-subtle">
              Recent searches
            </h2>
            <button
              type="button"
              onClick={() => {
                clearRecentSearches();
                setRecent([]);
              }}
              className="meta rounded-pill px-2 py-1 text-fg-muted hover:text-fg"
            >
              Clear
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recent.map((item) => (
              <li key={item}>
                <Link
                  href={searchHref(item)}
                  prefetch={false}
                  className="inline-flex h-9 items-center gap-2 rounded-pill border border-border-strong px-3.5 text-sm hover:bg-surface-hover"
                >
                  <ClockIcon className="size-3.5 text-fg-subtle" />
                  {item}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tabs({
  q,
  type,
  pathname,
  results,
}: Readonly<{
  q: string;
  type: SearchTab;
  pathname: string;
  results: SearchResults | null;
}>) {
  const totalOf = (tab: SearchTab) =>
    results === null
      ? null
      : tab === "all"
        ? GROUPS.reduce((sum, group) => sum + results.data[group].total, 0)
        : results.data[tab].total;

  return (
    <nav
      aria-label="Result types"
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max items-center gap-1 border-border border-b">
        {SEARCH_TABS.map((tab) => {
          const active = tab === type;
          const total = totalOf(tab);
          return (
            <li key={tab}>
              <Link
                href={searchHref(q, tab).replace("/search", pathname)}
                replace
                scroll={false}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm",
                  active
                    ? "border-fg text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {SEARCH_TAB_LABELS[tab]}
                {total !== null && (
                  <span className="meta text-fg-subtle tabular-nums">
                    {total}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Results({
  q,
  type,
  results,
}: Readonly<{ q: string; type: SearchTab; results: SearchResults }>) {
  const { data, meta } = results;
  const shown = type === "all" ? GROUPS : [type];
  const nonEmpty = shown.filter((group) => data[group].total > 0);

  return (
    <div className="flex flex-col gap-10">
      {meta.matchType === "trigram" && nonEmpty.length > 0 && (
        <p className="text-fg-muted text-sm">
          No exact matches for <q className="text-fg">{q}</q>. Showing results
          for names that look close.
        </p>
      )}

      {nonEmpty.length === 0 ? (
        <EmptyState
          title={
            type === "all"
              ? `Nothing found for “${q}”`
              : `No ${NOUNS[type as Group][1]} found for “${q}”`
          }
          action={
            <PillButton variant="outline" href="/companies">
              Browse all companies
            </PillButton>
          }
        >
          Check the spelling, try a shorter name, or browse by category.
        </EmptyState>
      ) : (
        nonEmpty.map((group) => {
          const preview = type === "all";
          const total = data[group].total;
          const limit = preview ? PREVIEW[group] : SEARCH_LIMIT;
          return (
            <section
              key={group}
              aria-labelledby={`results-${group}`}
              className="flex flex-col gap-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`results-${group}`} className="font-medium text-xl">
                  {SEARCH_TAB_LABELS[group]}
                  <span className="meta ml-2 text-fg-subtle tabular-nums">
                    {total}
                  </span>
                </h2>
                {preview && total > limit && (
                  <Link
                    href={searchHref(q, group)}
                    replace
                    scroll={false}
                    prefetch={false}
                    className="inline-flex items-center gap-1.5 text-fg-muted text-sm hover:text-fg"
                  >
                    See all {count(total, group)}
                    <ArrowRightIcon className="size-3.5" />
                  </Link>
                )}
              </div>
              <GroupResults group={group} results={results} limit={limit} />
              {!preview && total > SEARCH_LIMIT && (
                <p className="text-fg-muted text-sm">
                  Showing the best {SEARCH_LIMIT} of {total}. Refine your search
                  to narrow them down
                  {group === "startups" && meta.matchType === "fulltext" ? (
                    <>
                      , or{" "}
                      <Link
                        href={`/companies?${new URLSearchParams({ q })}`}
                        className="text-fg underline underline-offset-2"
                      >
                        browse every match in Companies
                      </Link>
                      .
                    </>
                  ) : (
                    "."
                  )}
                </p>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

const ROW =
  "flex items-center gap-3 rounded-md border border-border p-3 transition-colors duration-(--duration-fast) hover:bg-surface-hover";

function GroupResults({
  group,
  results,
  limit,
}: Readonly<{ group: Group; results: SearchResults; limit: number }>) {
  const { data } = results;
  if (group === "startups") {
    return (
      <CardGrid
        cards={data.startups.results.slice(0, limit)}
        label="Companies"
        headingLevel={3}
      />
    );
  }
  const rows =
    group === "founders"
      ? data.founders.results.slice(0, limit).map((hit) => ({
          key: hit.slug,
          href: paths.founder(hit.slug),
          name: hit.fullName,
          image: hit.photo,
          circle: true,
          detail: hit.headline,
          meta: `${hit.startupCount} ${hit.startupCount === 1 ? "company" : "companies"}`,
        }))
      : group === "investors"
        ? data.investors.results.slice(0, limit).map((hit) => ({
            key: hit.slug,
            href: paths.investor(hit.slug),
            name: hit.name,
            image: hit.logo,
            circle: false,
            detail: investorTypeLabel(hit.investorType),
            meta: `${hit.portfolioCount} in portfolio`,
          }))
        : data.batches.results.slice(0, limit).map((hit) => ({
            key: hit.slug,
            href: paths.batch(hit.slug),
            name: `${hit.programName} ${hit.label}`,
            image: null,
            circle: false,
            detail: String(hit.year),
            meta: `${hit.companyCount} ${hit.companyCount === 1 ? "company" : "companies"}`,
          }));

  return (
    <ul
      aria-label={SEARCH_TAB_LABELS[group]}
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
    >
      {rows.map((row) => (
        <li key={row.key}>
          <Link href={row.href} prefetch={false} className={ROW}>
            <EntityLogo
              name={row.name}
              image={row.image}
              size={40}
              shape={row.circle ? "circle" : "square"}
              className="size-10 text-sm"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-sm">{row.name}</span>
              {row.detail && (
                <span className="truncate text-fg-muted text-xs">
                  {row.detail}
                </span>
              )}
            </span>
            <span className="meta shrink-0 text-fg-subtle">{row.meta}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
