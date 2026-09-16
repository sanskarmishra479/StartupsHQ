import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import type { SluggedEntity } from "../db/queries/slugs";
import { cacheTags } from "../lib/cache-tags";
import { ValidationError } from "../lib/errors";
import * as slugs from "../services/slugs";

// Cached public slug listings. See src/server/cache/startups.ts for the shape every file follows.
// Every entity write expires `stats`, so a publish, archive or slug change refreshes the lists.

export async function getPublishedSlugs(
  ctx: PublicReadContext,
  entity: SluggedEntity,
): Promise<string[]> {
  assertPublicRead(ctx);
  if (!slugs.SLUGGED_ENTITIES.includes(entity)) {
    throw new ValidationError([{ path: "entity", message: "Unknown entity." }]);
  }
  return publishedSlugs(entity);
}

async function publishedSlugs(entity: SluggedEntity): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(cacheTags.stats(), cacheTags.sitemap());
  return slugs.listSlugs(PUBLIC_READ, entity);
}
