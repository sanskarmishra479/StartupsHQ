import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { isSlug } from "../../lib/slug";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import type { Investor } from "../dto/investor";
import { cacheTags } from "../lib/cache-tags";
import {
  type CachedLookup,
  NOT_FOUND,
  notFoundAsValue,
} from "../lib/cached-lookup";
import * as investors from "../services/investors";

// Cached public investor reads. See src/server/cache/startups.ts for the shape every file follows.

export async function getInvestorPage(
  ctx: PublicReadContext,
  slug: string,
): Promise<CachedLookup<Investor>> {
  assertPublicRead(ctx);
  if (!isSlug(slug)) return NOT_FOUND;
  return investorPage(slug);
}

async function investorPage(slug: string): Promise<CachedLookup<Investor>> {
  "use cache";
  cacheLife("days");
  cacheTag(cacheTags.investor(slug));
  const result = await notFoundAsValue(investors.getBySlug(PUBLIC_READ, slug));
  if (result.kind === "redirect") cacheTag(cacheTags.investor(result.slug));
  return result;
}
