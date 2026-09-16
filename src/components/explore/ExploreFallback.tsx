import type { Page, StartupCard } from "@/types/public";
import { FilterIcon, SearchIcon } from "../ui/icons";
import { CardGrid, CardGridSkeleton } from "./CardGrid";

/**
 * What the static HTML holds before the grid hydrates: the toolbar's shape, the unfiltered first
 * page as real links for search engines and no-JavaScript visitors, and a hidden skeleton that
 * EXPLORE_PENDING_SCRIPT swaps in when the URL is filtered.
 */
export function ExploreFallback({
  page,
}: Readonly<{ page: Page<StartupCard> }>) {
  return (
    <div className="flex flex-col gap-4">
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
        <div className="relative flex h-10 min-w-0 flex-1 basis-full items-center rounded-pill border border-border-strong bg-surface pl-9 text-fg-subtle text-sm sm:basis-64">
          <SearchIcon className="absolute left-3 size-4" />
          Search companies
        </div>
        <div className="flex h-10 items-center rounded-pill border border-border-strong bg-surface px-4 text-sm">
          Recently added
        </div>
        <div className="flex h-10 items-center gap-2 rounded-pill border border-border-strong px-4 font-medium text-sm">
          <FilterIcon />
          Filters
        </div>
      </div>
      <div data-explore-fallback="">
        <CardGrid cards={page.data} />
        {page.pagination.hasMore && (
          // The real Load more button arrives with the client grid; this only holds its space.
          <div
            aria-hidden="true"
            className="flex flex-col items-center gap-3 py-8"
          >
            <span className="meta text-fg-subtle">
              {page.data.length} shown
            </span>
            <span className="inline-flex h-10 items-center rounded-pill border border-border-strong px-4 font-medium text-sm">
              Load more
            </span>
          </div>
        )}
      </div>
      <CardGridSkeleton data-explore-skeleton="" />
    </div>
  );
}
