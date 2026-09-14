import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { isSlug } from "../../lib/slug";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import type { Founder } from "../dto/founder";
import { cacheTags } from "../lib/cache-tags";
import {
  type CachedLookup,
  NOT_FOUND,
  notFoundAsValue,
} from "../lib/cached-lookup";
import * as founders from "../services/founders";

// Cached public founder reads. See src/server/cache/startups.ts for the shape every file follows.

export async function getFounderPage(
  ctx: PublicReadContext,
  slug: string,
): Promise<CachedLookup<Founder>> {
  assertPublicRead(ctx);
  if (!isSlug(slug)) return NOT_FOUND;
  return founderPage(slug);
}

async function founderPage(slug: string): Promise<CachedLookup<Founder>> {
  "use cache";
  cacheLife("days");
  cacheTag(cacheTags.founder(slug));
  const result = await notFoundAsValue(founders.getBySlug(PUBLIC_READ, slug));
  if (result.kind === "redirect") cacheTag(cacheTags.founder(result.slug));
  return result;
}
