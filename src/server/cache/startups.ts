import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { isSlug } from "../../lib/slug";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import type { Startup, StartupCard } from "../dto/startup";
import { cacheTags } from "../lib/cache-tags";
import {
  type CachedLookup,
  NOT_FOUND,
  type NotFound,
  notFoundAsValue,
} from "../lib/cached-lookup";
import { ValidationError } from "../lib/errors";
import type { Page } from "../lib/pagination";
import * as startups from "../services/startups";

// Cached public startup reads (ADR-013, NFR-02, SEC-03.6).
//
// Every file in src/server/cache follows one shape. The exported function accepts only
// PublicReadContext, checks it at runtime, and rejects malformed input before the cache, so junk
// URLs cannot mint entries. The private `'use cache'` function below it reads with PUBLIC_READ
// itself and is keyed by public arguments alone: every visitor shares one entry, and no request
// identity can ever reach a cached scope.

export async function getStartupPage(
  ctx: PublicReadContext,
  slug: string,
): Promise<CachedLookup<Startup>> {
  assertPublicRead(ctx);
  if (!isSlug(slug)) return NOT_FOUND;
  return startupPage(slug);
}

async function startupPage(slug: string): Promise<CachedLookup<Startup>> {
  "use cache";
  cacheLife("days");
  // Tagged by the requested slug even when it is not found, so publishing it expires the miss.
  cacheTag(cacheTags.startup(slug));
  const result = await notFoundAsValue(startups.getBySlug(PUBLIC_READ, slug));
  if (result.kind === "redirect") cacheTag(cacheTags.startup(result.slug));
  return result;
}

export async function getSimilarStartups(
  ctx: PublicReadContext,
  slug: string,
): Promise<StartupCard[] | NotFound> {
  assertPublicRead(ctx);
  if (!isSlug(slug)) return NOT_FOUND;
  return similarStartups(slug);
}

async function similarStartups(
  slug: string,
): Promise<StartupCard[] | NotFound> {
  "use cache";
  cacheLife("days");
  // Other companies publishing changes the list, so it also follows the directory-wide tag.
  cacheTag(cacheTags.startup(slug), cacheTags.startupsList());
  return notFoundAsValue(startups.listSimilar(PUBLIC_READ, slug));
}

/** The explore grid's first page for a sort; filtered and later pages go through the API. */
export async function getStartupsFirstPage(
  ctx: PublicReadContext,
  sort: startups.StartupSort = "recent",
): Promise<Page<StartupCard>> {
  assertPublicRead(ctx);
  if (!(startups.STARTUP_SORTS as readonly string[]).includes(sort)) {
    throw new ValidationError([{ path: "sort", message: "Unknown sort." }]);
  }
  return startupsFirstPage(sort);
}

async function startupsFirstPage(
  sort: startups.StartupSort,
): Promise<Page<StartupCard>> {
  "use cache";
  cacheLife("hours");
  cacheTag(cacheTags.startupsList());
  return startups.list(PUBLIC_READ, { sort });
}
