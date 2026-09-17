import { describe, expect, it } from "vitest";
import {
  clearRecentSearches,
  MAX_RECENT_SEARCHES,
  parseSearchQuery,
  RECENT_SEARCHES_KEY,
  readRecentSearches,
  rememberSearch,
  SEARCH_LIMIT,
  searchApiUrl,
  searchHref,
  suggestApiUrl,
  suggestionHref,
} from "./search";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("parseSearchQuery", () => {
  it("reads q and a known type", () => {
    expect(
      parseSearchQuery(new URLSearchParams("q=  kiln   data &type=founders")),
    ).toEqual({ q: "kiln data", type: "founders" });
  });

  it("falls back to all for a missing or unknown type and bounds q", () => {
    expect(parseSearchQuery(new URLSearchParams("type=admins"))).toEqual({
      q: "",
      type: "all",
    });
    expect(
      parseSearchQuery(new URLSearchParams(`q=${"a".repeat(300)}`)).q,
    ).toHaveLength(100);
  });
});

describe("hrefs and API URLs", () => {
  it("builds canonical /search hrefs", () => {
    expect(searchHref("")).toBe("/search");
    expect(searchHref(" café  algo ")).toBe("/search?q=caf%C3%A9+algo");
    expect(searchHref("kiln", "investors")).toBe(
      "/search?q=kiln&type=investors",
    );
    expect(searchHref("kiln", "all")).toBe("/search?q=kiln");
  });

  it("encodes the query as a parameter, never as a path", () => {
    expect(searchApiUrl("a&type=x/../")).toBe(
      `/api/v1/search?q=a%26type%3Dx%2F..%2F&limit=${SEARCH_LIMIT}`,
    );
    expect(suggestApiUrl(`  ${"b".repeat(80)}`)).toBe(
      `/api/v1/suggest?q=${"b".repeat(60)}`,
    );
  });

  it("links every suggestion type to its page", () => {
    expect(suggestionHref({ type: "startup", slug: "kiln-analytics" })).toBe(
      "/companies/kiln-analytics",
    );
    expect(suggestionHref({ type: "founder", slug: "mira-okafor" })).toBe(
      "/founders/mira-okafor",
    );
    expect(suggestionHref({ type: "investor", slug: "launchpad" })).toBe(
      "/investors/launchpad",
    );
    expect(suggestionHref({ type: "batch", slug: "parallel-w25" })).toBe(
      "/batches/parallel-w25",
    );
  });
});

describe("recent searches", () => {
  it("keeps the newest first, without case-insensitive duplicates, capped", () => {
    const store = memoryStore();
    for (const q of ["kiln", "fjord", "baobab", "KILN", "a", "tidal", "orbit"])
      rememberSearch(q, store);
    expect(readRecentSearches(store)).toEqual([
      "orbit",
      "tidal",
      "KILN",
      "baobab",
      "fjord",
    ]);
    expect(readRecentSearches(store)).toHaveLength(MAX_RECENT_SEARCHES);
  });

  it("ignores malformed storage", () => {
    expect(
      readRecentSearches(memoryStore({ [RECENT_SEARCHES_KEY]: "{not json" })),
    ).toEqual([]);
    expect(
      readRecentSearches(
        memoryStore({ [RECENT_SEARCHES_KEY]: '{"q":"kiln"}' }),
      ),
    ).toEqual([]);
    expect(
      readRecentSearches(
        memoryStore({ [RECENT_SEARCHES_KEY]: '[1, null, "kiln", "x"]' }),
      ),
    ).toEqual(["kiln"]);
  });

  it("works without storage and when storage throws", () => {
    expect(readRecentSearches(null)).toEqual([]);
    // Still returned, so the list on screen updates for this view.
    expect(rememberSearch("kiln", null)).toEqual(["kiln"]);
    expect(readRecentSearches(throwing)).toEqual([]);
    expect(rememberSearch("kiln", throwing)).toEqual(["kiln"]);
    expect(() => clearRecentSearches(throwing)).not.toThrow();
  });

  it("clears", () => {
    const store = memoryStore();
    rememberSearch("kiln", store);
    clearRecentSearches(store);
    expect(readRecentSearches(store)).toEqual([]);
  });
});
