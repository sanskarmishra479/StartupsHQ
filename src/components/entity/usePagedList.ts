"use client";

import { useCallback, useRef, useState } from "react";
import type { Page } from "@/types/public";

type Status = "ready" | "loading" | "error";

type ApiError = { error?: { code?: string } };

/**
 * Load-more state for a list whose first page arrived server-rendered. Later pages come from
 * `endpoint` (a GET /api/v1 path, with or without a query) plus the signed cursor. Items are
 * de-duplicated by `keyOf`, and the anonymous depth limit (SEC-15) ends the list with a reason.
 */
export function usePagedList<T>(
  initial: Page<T>,
  endpoint: string,
  keyOf: (item: T) => string,
) {
  const [items, setItems] = useState<readonly T[]>(initial.data);
  const [cursor, setCursor] = useState(initial.pagination.nextCursor);
  const [hasMore, setHasMore] = useState(initial.pagination.hasMore);
  const [depthLimited, setDepthLimited] = useState(false);
  const [status, setStatus] = useState<Status>("ready");
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (!cursor || inFlight.current) return;
    inFlight.current = true;
    setStatus("loading");
    try {
      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set("limit", String(initial.pagination.limit));
      url.searchParams.set("cursor", cursor);
      const response = await fetch(`${url.pathname}${url.search}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        if (body.error?.code === "PAGINATION_DEPTH") {
          setHasMore(false);
          setDepthLimited(true);
          setStatus("ready");
          return;
        }
        setStatus("error");
        return;
      }
      const page = (await response.json()) as Page<T>;
      setItems((shown) => {
        const seen = new Set(shown.map(keyOf));
        return [
          ...shown,
          ...page.data.filter((item) => !seen.has(keyOf(item))),
        ];
      });
      setCursor(page.pagination.nextCursor);
      setHasMore(page.pagination.hasMore);
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [cursor, endpoint, initial.pagination.limit, keyOf]);

  return { items, hasMore, depthLimited, status, loadMore };
}
