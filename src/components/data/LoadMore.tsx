"use client";

import { PillButton } from "../ui/PillButton";

type LoadMoreProps = Readonly<{
  onLoadMore: () => void;
  pending: boolean;
  /** False once the last page is in. */
  hasMore: boolean;
  /**
   * True when anonymous paging reached its depth limit (SEC-15) rather than the end of the list:
   * the viewer is asked to narrow the filters instead.
   */
  depthLimited?: boolean;
  /** Total shown so far, announced after each page loads. */
  shown: number;
}>;

export function LoadMore({
  onLoadMore,
  pending,
  hasMore,
  depthLimited = false,
  shown,
}: LoadMoreProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      {/* Announces progress to screen readers without moving focus. */}
      <output aria-live="polite" className="meta text-fg-subtle">
        {pending ? "Loading…" : `${shown} shown`}
      </output>
      {depthLimited ? (
        <p className="max-w-sm text-center text-fg-muted text-sm">
          That is as far as this list goes. Narrow it with the filters to see
          more.
        </p>
      ) : (
        hasMore && (
          <PillButton
            variant="outline"
            onClick={onLoadMore}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Loading…" : "Load more"}
          </PillButton>
        )
      )}
    </div>
  );
}
