import type { Stage, WorkType } from "@/types/public";
import { STAGE_LABELS, WORK_TYPE_LABELS } from "./labels";
import { isSlug } from "./slug";

// The explore grid's state as URL parameters (FR-101). The names are exactly GET /startups's
// (docs/API.md §6.1), so a page URL and its API request share one query string. Parsing is
// forgiving — anything malformed is dropped rather than failing the page — and serialising is
// canonical, so the same filters always produce the same URL and reload restores them exactly.
// Client-safe.

export const EXPLORE_SORTS = ["recent", "raised", "name"] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];

export const SORT_LABELS: Record<ExploreSort, string> = {
  recent: "Recently added",
  raised: "Most raised",
  name: "Name A–Z",
};

export type ExploreQuery = Readonly<{
  stage: readonly Stage[];
  industry: readonly string[];
  workType: readonly WorkType[];
  city: readonly string[];
  country: string | null;
  batch: string | null;
  investor: string | null;
  founder: string | null;
  q: string;
  includeAcquired: boolean;
  sort: ExploreSort;
}>;

export const DEFAULT_EXPLORE_QUERY: ExploreQuery = {
  stage: [],
  industry: [],
  workType: [],
  city: [],
  country: null,
  batch: null,
  investor: null,
  founder: null,
  q: "",
  includeAcquired: false,
  sort: "recent",
};

/** Every parameter the grid reads; anything else in the URL is ignored, as the API does. */
export const EXPLORE_PARAMS = [
  "stage",
  "industry",
  "work_type",
  "city",
  "country",
  "batch",
  "investor",
  "founder",
  "q",
  "include_acquired",
  "sort",
] as const;

const MAX_VALUES = 20;
const Q_MIN = 2;
const Q_MAX = 100;

const isStage = (value: string): value is Stage =>
  Object.hasOwn(STAGE_LABELS, value);
const isWorkType = (value: string): value is WorkType =>
  Object.hasOwn(WORK_TYPE_LABELS, value);

function many<T extends string>(
  params: URLSearchParams,
  name: string,
  accept: (value: string) => value is T,
): T[] {
  const values = new Set<T>();
  for (const value of params.getAll(name)) {
    if (accept(value)) values.add(value);
    if (values.size === MAX_VALUES) break;
  }
  return [...values].sort();
}

const slugOrNull = (value: string | null) =>
  value !== null && isSlug(value) ? value : null;

const anySlug = (value: string): value is string => isSlug(value);

export function parseExploreQuery(
  params:
    | URLSearchParams
    | Readonly<Record<string, string | string[] | undefined>>,
): ExploreQuery {
  const search =
    params instanceof URLSearchParams ? params : toUrlSearchParams(params);
  const country = search.get("country");
  const q = (search.get("q") ?? "").trim();
  const sort = search.get("sort");
  return {
    stage: many(search, "stage", isStage),
    industry: many(search, "industry", anySlug),
    workType: many(search, "work_type", isWorkType),
    city: many(search, "city", anySlug),
    country:
      country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    batch: slugOrNull(search.get("batch")),
    investor: slugOrNull(search.get("investor")),
    founder: slugOrNull(search.get("founder")),
    q: q.length >= Q_MIN && q.length <= Q_MAX ? q : "",
    includeAcquired: search.get("include_acquired") === "true",
    sort: (EXPLORE_SORTS as readonly string[]).includes(sort ?? "")
      ? (sort as ExploreSort)
      : "recent",
  };
}

function toUrlSearchParams(
  record: Readonly<Record<string, string | string[] | undefined>>,
): URLSearchParams {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(record)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value]) {
      search.append(name, item);
    }
  }
  return search;
}

/** Canonical query string: fixed parameter order, sorted values, defaults left out. */
export function toExploreSearchParams(query: ExploreQuery): URLSearchParams {
  const search = new URLSearchParams();
  const add = (name: string, values: readonly string[]) => {
    for (const value of [...new Set(values)].sort()) search.append(name, value);
  };
  add("stage", query.stage);
  add("industry", query.industry);
  add("work_type", query.workType);
  add("city", query.city);
  if (query.country) search.set("country", query.country);
  if (query.batch) search.set("batch", query.batch);
  if (query.investor) search.set("investor", query.investor);
  if (query.founder) search.set("founder", query.founder);
  const q = query.q.trim();
  if (q.length >= Q_MIN && q.length <= Q_MAX) search.set("q", q);
  if (query.includeAcquired) search.set("include_acquired", "true");
  if (query.sort !== "recent") search.set("sort", query.sort);
  return search;
}

/** True when nothing narrows or reorders the grid, so the server-rendered first page applies. */
export function isDefaultExploreQuery(query: ExploreQuery): boolean {
  return toExploreSearchParams(query).size === 0;
}

/** How many filters are active, for the Filters button's badge. Sort and search are not filters. */
export function activeFilterCount(query: ExploreQuery): number {
  return (
    query.stage.length +
    query.industry.length +
    query.workType.length +
    query.city.length +
    (query.country ? 1 : 0) +
    (query.batch ? 1 : 0) +
    (query.investor ? 1 : 0) +
    (query.founder ? 1 : 0) +
    (query.includeAcquired ? 1 : 0)
  );
}

export const EXPLORE_PAGE_SIZE = 24;

/** The GET /startups URL for a query and an optional cursor. */
export function exploreApiUrl(
  query: ExploreQuery,
  cursor: string | null,
): string {
  const search = toExploreSearchParams(query);
  search.set("limit", String(EXPLORE_PAGE_SIZE));
  if (cursor) search.set("cursor", cursor);
  return `/api/v1/startups?${search}`;
}

/** Appends a page, skipping any card already shown, so a card never appears twice. */
export function appendUnique<T extends { slug: string }>(
  shown: readonly T[],
  page: readonly T[],
): T[] {
  const seen = new Set(shown.map((item) => item.slug));
  return [...shown, ...page.filter((item) => !seen.has(item.slug))];
}

/** Set on <html> before paint when the URL carries grid parameters (see EXPLORE_PENDING_SCRIPT). */
export const EXPLORE_PENDING_ATTRIBUTE = "data-explore-pending";

/**
 * Inlined before the server-rendered grid. That grid is the unfiltered first page; when the URL
 * asks for something else, this hides it behind a skeleton until the client has the right cards,
 * so a shared filtered link never flashes the wrong companies. Plain ES5 (ADR-022 allows inline).
 */
export const EXPLORE_PENDING_SCRIPT = `(function(){try{var p=new URLSearchParams(location.search),k=${JSON.stringify(
  EXPLORE_PARAMS,
)};for(var i=0;i<k.length;i++){if(p.has(k[i])){document.documentElement.setAttribute(${JSON.stringify(
  EXPLORE_PENDING_ATTRIBUTE,
)},"");return}}}catch(e){}})()`;
