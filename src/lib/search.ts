import type { Suggestion, SuggestionType } from "@/types/public";
import { paths } from "./links";

// Search state and helpers shared by the ⌘K palette and /search (FR-109). The page's URL carries
// `q` and `type` under the API's own names (docs/API.md §6.11). Client-safe.

export const SEARCH_TABS = [
  "all",
  "startups",
  "founders",
  "investors",
  "batches",
] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export const SEARCH_TAB_LABELS: Record<SearchTab, string> = {
  all: "All",
  startups: "Companies",
  founders: "Founders",
  investors: "Investors",
  batches: "Batches",
};

/** The API's bounds: search takes 2–100 characters, suggest 1–60. */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
export const SUGGEST_MAX = 60;
/** Every group is fetched at this size once per query, so switching tabs never refetches. */
export const SEARCH_LIMIT = 24;
export const SUGGEST_DEBOUNCE_MS = 150;

export type SearchQuery = Readonly<{ q: string; type: SearchTab }>;

/** Collapses whitespace the way the API does, so the URL and the request agree. */
export const normalizeSearchText = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ");

export function parseSearchQuery(
  params: Pick<URLSearchParams, "get">,
): SearchQuery {
  const q = normalizeSearchText(params.get("q") ?? "").slice(0, SEARCH_MAX);
  const type = params.get("type");
  return {
    q,
    type: (SEARCH_TABS as readonly string[]).includes(type ?? "")
      ? (type as SearchTab)
      : "all",
  };
}

/** Canonical `/search` href: `q` first, `type` only when it is not the default. */
export function searchHref(q: string, type: SearchTab = "all"): string {
  const params = new URLSearchParams();
  const text = normalizeSearchText(q);
  if (text) params.set("q", text);
  if (type !== "all") params.set("type", type);
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

export const searchApiUrl = (q: string) =>
  `/api/v1/search?${new URLSearchParams({ q: normalizeSearchText(q), limit: String(SEARCH_LIMIT) })}`;

export const suggestApiUrl = (q: string) =>
  `/api/v1/suggest?${new URLSearchParams({ q: normalizeSearchText(q).slice(0, SUGGEST_MAX) })}`;

const SUGGESTION_PATHS: Record<SuggestionType, (slug: string) => string> = {
  startup: paths.company,
  founder: paths.founder,
  investor: paths.investor,
  batch: paths.batch,
};

export const suggestionHref = (suggestion: Pick<Suggestion, "type" | "slug">) =>
  SUGGESTION_PATHS[suggestion.type](suggestion.slug);

export const SUGGESTION_TYPE_LABELS: Record<SuggestionType, string> = {
  startup: "Company",
  founder: "Founder",
  investor: "Investor",
  batch: "Batch",
};

// ── Recent searches ──────────────────────────────────────────────────────────────────────────
// Kept only in this browser. Storage may be missing or throw (private windows, blocked site
// data), so every access is guarded and the feature quietly does nothing without it.

export const RECENT_SEARCHES_KEY = "recent-searches";
export const MAX_RECENT_SEARCHES = 5;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecentSearches(store = storage()): string[] {
  try {
    const parsed: unknown = JSON.parse(
      store?.getItem(RECENT_SEARCHES_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeSearchText(item).slice(0, SEARCH_MAX))
      .filter((item) => item.length >= SEARCH_MIN)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/** Puts `q` first, dropping an earlier copy that differs only in case. Returns the new list. */
export function rememberSearch(q: string, store = storage()): string[] {
  const text = normalizeSearchText(q).slice(0, SEARCH_MAX);
  const current = readRecentSearches(store);
  if (text.length < SEARCH_MIN) return current;
  const next = [
    text,
    ...current.filter((item) => item.toLowerCase() !== text.toLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);
  try {
    store?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Remembered for this view only.
  }
  return next;
}

export function clearRecentSearches(store = storage()): void {
  try {
    store?.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Nothing to clear.
  }
}
