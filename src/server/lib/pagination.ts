import "server-only";

// Collection envelopes and page-size limits shared by every paginated read (docs/API.md §3,
// SEC-15).

export const DEFAULT_PAGE_LIMIT = 24;
export const MAX_PAGE_LIMIT = 48;

export type Pagination = Readonly<{
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}>;

export type Page<T> = Readonly<{ data: T[]; pagination: Pagination }>;

/** Clamps a requested page size into 1..max; a missing or unusable value becomes the default. */
export function clampLimit(
  limit: number | undefined,
  max: number = MAX_PAGE_LIMIT,
  fallback: number = DEFAULT_PAGE_LIMIT,
): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(limit)));
}

/** Builds a page from rows fetched with `limit + 1`: the extra row only proves there is more. */
export function toPage<Row, T>(
  rows: readonly Row[],
  limit: number,
  map: (row: Row) => T,
  nextCursor: (last: Row) => string,
): Page<T> {
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    data: pageRows.map(map),
    pagination: {
      nextCursor: hasMore && last !== undefined ? nextCursor(last) : null,
      hasMore,
      limit,
    },
  };
}
