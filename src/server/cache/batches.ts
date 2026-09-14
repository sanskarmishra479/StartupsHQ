import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { isSlug } from "../../lib/slug";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import type { Batch } from "../dto/batch";
import { cacheTags } from "../lib/cache-tags";
import {
  type CachedLookup,
  NOT_FOUND,
  notFoundAsValue,
} from "../lib/cached-lookup";
import * as batches from "../services/batches";

// Cached public batch reads. See src/server/cache/startups.ts for the shape every file follows.

export async function getBatchPage(
  ctx: PublicReadContext,
  slug: string,
): Promise<CachedLookup<Batch>> {
  assertPublicRead(ctx);
  if (!isSlug(slug)) return NOT_FOUND;
  return batchPage(slug);
}

async function batchPage(slug: string): Promise<CachedLookup<Batch>> {
  "use cache";
  cacheLife("days");
  cacheTag(cacheTags.batch(slug));
  const result = await notFoundAsValue(batches.getBySlug(PUBLIC_READ, slug));
  if (result.kind === "redirect") cacheTag(cacheTags.batch(result.slug));
  return result;
}
