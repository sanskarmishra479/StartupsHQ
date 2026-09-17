"use client";

import type { Page, StartupCard } from "@/types/public";
import { LoadMore } from "../data/LoadMore";
import { CardGrid } from "../explore/CardGrid";
import { PillButton } from "../ui/PillButton";
import { usePagedList } from "./usePagedList";

const slugOf = (card: StartupCard) => card.slug;

/** A grid of company cards with Load more: an investor's portfolio, a batch's cohort. */
export function PagedCardGrid({
  initialPage,
  endpoint,
  label,
  disableMore = false,
}: Readonly<{
  initialPage: Page<StartupCard>;
  endpoint: string;
  label: string;
  /** When later pages cannot be requested, show the first page only. */
  disableMore?: boolean;
}>) {
  const { items, hasMore, depthLimited, status, loadMore } = usePagedList(
    initialPage,
    endpoint,
    slugOf,
  );
  return (
    <div>
      <CardGrid cards={items} label={label} headingLevel={3} />
      {status === "error" ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-fg-muted text-sm">
            More companies could not be loaded.
          </p>
          <PillButton variant="outline" onClick={() => void loadMore()}>
            Try again
          </PillButton>
        </div>
      ) : (
        !disableMore &&
        (hasMore || depthLimited) && (
          <LoadMore
            shown={items.length}
            pending={status === "loading"}
            hasMore={hasMore}
            depthLimited={depthLimited}
            onLoadMore={() => void loadMore()}
          />
        )
      )}
    </div>
  );
}
