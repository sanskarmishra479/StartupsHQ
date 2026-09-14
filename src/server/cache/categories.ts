import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { isSlug } from "../../lib/slug";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import {
  type CategoryDirectory,
  type CategoryKind,
  type CategoryPage,
  isCategoryKind,
} from "../dto/category";
import { cacheTags } from "../lib/cache-tags";
import {
  NOT_FOUND,
  type NotFound,
  notFoundAsValue,
} from "../lib/cached-lookup";
import * as taxonomy from "../services/taxonomy";

// Cached public category reads. See src/server/cache/startups.ts for the shape every file
// follows. A well-formed but nonexistent value (industries/anything-at-all) is cached as a miss;
// entries are LRU-bounded and tagged, so creating the value later expires the miss.

export async function getCategoryPage(
  ctx: PublicReadContext,
  kind: string,
  slug: string,
): Promise<CategoryPage | NotFound> {
  assertPublicRead(ctx);
  if (!isCategoryKind(kind) || !isSlug(slug)) return NOT_FOUND;
  return categoryPage(kind, slug);
}

async function categoryPage(
  kind: CategoryKind,
  slug: string,
): Promise<CategoryPage | NotFound> {
  "use cache";
  cacheLife("days");
  // The company list changes whenever any company does, not only when this facet's copy does.
  cacheTag(cacheTags.category(kind, slug), cacheTags.startupsList());
  return notFoundAsValue(taxonomy.getPage(PUBLIC_READ, kind, slug));
}

export async function getCategoryDirectory(
  ctx: PublicReadContext,
): Promise<CategoryDirectory> {
  assertPublicRead(ctx);
  return categoryDirectory();
}

async function categoryDirectory(): Promise<CategoryDirectory> {
  "use cache";
  cacheLife("hours");
  cacheTag(cacheTags.categories(), cacheTags.startupsList());
  return taxonomy.listCategories(PUBLIC_READ);
}
