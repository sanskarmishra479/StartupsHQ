import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import type { NewsItem } from "../dto/news";
import { cacheTags } from "../lib/cache-tags";
import type { Page } from "../lib/pagination";
import * as rounds from "../services/rounds";

// Cached public round reads. See src/server/cache/startups.ts for the shape every file follows.

/** The news feed's first page; filtered and later pages go through the API. */
export async function getNewsFirstPage(
  ctx: PublicReadContext,
): Promise<Page<NewsItem>> {
  assertPublicRead(ctx);
  return newsFirstPage();
}

async function newsFirstPage(): Promise<Page<NewsItem>> {
  "use cache";
  cacheLife("hours");
  cacheTag(cacheTags.news());
  return rounds.listRecent(PUBLIC_READ);
}
