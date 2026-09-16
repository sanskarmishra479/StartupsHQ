"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeFilterCount,
  appendUnique,
  EXPLORE_PENDING_ATTRIBUTE,
  EXPLORE_SORTS,
  type ExploreQuery,
  type ExploreSort,
  exploreApiUrl,
  isDefaultExploreQuery,
  parseExploreQuery,
  SORT_LABELS,
  toExploreSearchParams,
} from "@/lib/explore-query";
import type { CategoryDirectory, Page, StartupCard } from "@/types/public";
import { EmptyState } from "../data/EmptyState";
import { LoadMore } from "../data/LoadMore";
import { FilterIcon, SearchIcon } from "../ui/icons";
import { PillButton } from "../ui/PillButton";
import { CardGrid, CardGridSkeleton } from "./CardGrid";
import { activeFilters } from "./explore-labels";
import { FilterSheet } from "./FilterSheet";

type Status = "ready" | "loading" | "loading-more" | "error" | "error-more";

type GridState = Readonly<{
  /** The canonical query string these cards belong to. */
  key: string;
  cards: readonly StartupCard[];
  nextCursor: string | null;
  hasMore: boolean;
  depthLimited: boolean;
  status: Status;
}>;

type ApiError = { error?: { code?: string } };

const SEARCH_DEBOUNCE_MS = 350;

const fromPage = (key: string, page: Page<StartupCard>): GridState => ({
  key,
  cards: page.data,
  nextCursor: page.pagination.nextCursor,
  hasMore: page.pagination.hasMore,
  depthLimited: false,
  status: "ready",
});

/**
 * The explore grid (FR-101). The URL is the state: facets, search and sort live in its query
 * string under the API's own names, so a filtered view can be shared and restores exactly on
 * reload. The unfiltered first page arrives server-rendered; everything else — filters, sorts and
 * later pages — comes from GET /api/v1/startups, the rate-limited, WAF-fronted path (SEC-08).
 */
export function ExploreGrid({
  initialPage,
  directory,
}: Readonly<{ initialPage: Page<StartupCard>; directory: CategoryDirectory }>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseExploreQuery(searchParams), [searchParams]);
  const key = toExploreSearchParams(query).toString();

  const [state, setState] = useState<GridState>(() =>
    isDefaultExploreQuery(query)
      ? fromPage(key, initialPage)
      : { ...fromPage(key, initialPage), cards: [], status: "loading" },
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const request = useRef<AbortController | null>(null);

  // The server-rendered fallback is gone once this renders; drop the flag that hid it.
  useEffect(() => {
    document.documentElement.removeAttribute(EXPLORE_PENDING_ATTRIBUTE);
  }, []);

  const navigate = useCallback(
    (next: ExploreQuery) => {
      const search = toExploreSearchParams(next).toString();
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  const fetchPage = useCallback(
    async (target: ExploreQuery, cursor: string | null) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const response = await fetch(exploreApiUrl(target, cursor), {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        return { ok: false as const, code: body.error?.code ?? "UNKNOWN" };
      }
      return {
        ok: true as const,
        page: (await response.json()) as Page<StartupCard>,
      };
    },
    [],
  );

  const load = useCallback(async () => {
    if (isDefaultExploreQuery(query)) {
      request.current?.abort();
      setState(fromPage(key, initialPage));
      return;
    }
    setState((current) => ({
      ...current,
      key,
      cards: [],
      status: "loading",
      depthLimited: false,
    }));
    try {
      const result = await fetchPage(query, null);
      setState((current) =>
        current.key !== key
          ? current
          : result.ok
            ? fromPage(key, result.page)
            : { ...current, status: "error" },
      );
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setState((current) =>
        current.key !== key ? current : { ...current, status: "error" },
      );
    }
  }, [fetchPage, initialPage, key, query]);

  // Reload whenever the URL's query changes, including back and forward.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the canonical query string alone; `load` and `state` change with it.
  useEffect(() => {
    if (state.key !== key || state.status === "loading") void load();
  }, [key]);

  useEffect(() => () => request.current?.abort(), []);

  const loadMore = async () => {
    if (!state.nextCursor || state.status === "loading-more") return;
    const cursor = state.nextCursor;
    setState((current) => ({ ...current, status: "loading-more" }));
    try {
      const result = await fetchPage(query, cursor);
      setState((current) => {
        if (current.key !== key) return current;
        if (result.ok) {
          return {
            ...current,
            cards: appendUnique(current.cards, result.page.data),
            nextCursor: result.page.pagination.nextCursor,
            hasMore: result.page.pagination.hasMore,
            status: "ready",
          };
        }
        if (result.code === "PAGINATION_DEPTH") {
          return {
            ...current,
            hasMore: false,
            depthLimited: true,
            status: "ready",
          };
        }
        return { ...current, status: "error-more" };
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setState((current) => ({ ...current, status: "error-more" }));
    }
  };

  const filters = activeFilters(query, directory);
  const filterCount = activeFilterCount(query);

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        query={query}
        filterCount={filterCount}
        onQuery={navigate}
        onOpenFilters={() => setFiltersOpen(true)}
      />

      {filters.length > 0 && (
        <ul
          aria-label="Active filters"
          className="flex flex-wrap items-center gap-2"
        >
          {filters.map((filter) => (
            <li key={filter.key}>
              <button
                type="button"
                onClick={() => navigate(filter.without)}
                aria-label={`Remove filter: ${filter.label}`}
                className="inline-flex h-8 items-center gap-2 rounded-pill border border-border-strong px-3 text-sm hover:bg-surface-hover"
              >
                {filter.label}
                <span aria-hidden="true" className="text-fg-subtle">
                  ×
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() =>
                navigate({
                  ...query,
                  stage: [],
                  industry: [],
                  workType: [],
                  city: [],
                  country: null,
                  batch: null,
                  investor: null,
                  founder: null,
                  includeAcquired: false,
                })
              }
              className="meta px-2 text-fg-muted hover:text-fg"
            >
              Clear all
            </button>
          </li>
        </ul>
      )}

      <output aria-live="polite" className="sr-only">
        {state.status === "loading"
          ? "Loading companies…"
          : state.status === "error"
            ? "Companies could not be loaded."
            : `${state.cards.length} ${state.cards.length === 1 ? "company" : "companies"} shown.`}
      </output>

      {state.status === "loading" ? (
        <CardGridSkeleton />
      ) : state.status === "error" ? (
        <EmptyState
          title="Companies could not be loaded"
          action={
            <PillButton variant="outline" onClick={() => void load()}>
              Try again
            </PillButton>
          }
        >
          Check your connection and try again.
        </EmptyState>
      ) : state.cards.length === 0 ? (
        <EmptyState
          title="No companies match"
          action={
            <PillButton variant="outline" href={pathname}>
              Clear filters and search
            </PillButton>
          }
        >
          Try removing a filter, or search by another word.
        </EmptyState>
      ) : (
        <>
          <CardGrid cards={state.cards} />
          {state.status === "error-more" ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-fg-muted text-sm">
                More companies could not be loaded.
              </p>
              <PillButton variant="outline" onClick={() => void loadMore()}>
                Try again
              </PillButton>
            </div>
          ) : (
            <LoadMore
              shown={state.cards.length}
              pending={state.status === "loading-more"}
              hasMore={state.hasMore}
              depthLimited={state.depthLimited}
              onLoadMore={() => void loadMore()}
            />
          )}
        </>
      )}

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        query={query}
        directory={directory}
        onApply={(next) => {
          setFiltersOpen(false);
          navigate(next);
        }}
      />
    </div>
  );
}

function Toolbar({
  query,
  filterCount,
  onQuery,
  onOpenFilters,
}: Readonly<{
  query: ExploreQuery;
  filterCount: number;
  onQuery: (query: ExploreQuery) => void;
  onOpenFilters: () => void;
}>) {
  const [text, setText] = useState(query.q);
  const latest = useRef(query);
  latest.current = query;

  // Follow the URL when it changes from elsewhere: back, forward, a removed chip.
  useEffect(() => {
    setText(query.q);
  }, [query.q]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === latest.current.q || trimmed.length === 1) return;
    const timer = setTimeout(
      () => onQuery({ ...latest.current, q: trimmed }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [text, onQuery]);

  return (
    <search>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onQuery({ ...query, q: text.trim() });
        }}
      >
        <label className="relative flex min-w-0 flex-1 basis-full items-center sm:basis-64">
          <span className="sr-only">Search companies</span>
          <SearchIcon className="pointer-events-none absolute left-3 size-4 text-fg-subtle" />
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search companies"
            maxLength={100}
            className="h-10 w-full rounded-pill border border-border-strong bg-surface pr-4 pl-9 text-sm placeholder:text-fg-subtle"
          />
        </label>
        <label className="flex items-center">
          <span className="sr-only">Sort</span>
          <select
            value={query.sort}
            onChange={(event) =>
              onQuery({ ...query, sort: event.target.value as ExploreSort })
            }
            className="h-10 rounded-pill border border-border-strong bg-surface px-4 text-sm"
          >
            {EXPLORE_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>
        <PillButton
          variant="outline"
          onClick={onOpenFilters}
          aria-haspopup="dialog"
        >
          <FilterIcon />
          Filters
          {filterCount > 0 && (
            <span className="meta ml-0.5 inline-flex size-5 items-center justify-center rounded-pill bg-inverse-bg text-inverse-fg">
              {filterCount}
              <span className="sr-only"> active</span>
            </span>
          )}
        </PillButton>
      </form>
    </search>
  );
}
