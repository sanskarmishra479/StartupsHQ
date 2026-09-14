import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import {
  assertPublicRead,
  PUBLIC_READ,
  type PublicReadContext,
} from "../auth/context";
import { cacheTags } from "../lib/cache-tags";
import * as stats from "../services/stats";

// Cached public directory counts. See src/server/cache/startups.ts for the shape every file
// follows. Slight staleness is acceptable here (ARCHITECTURE §5), hence the hours lifetime.

export async function getDirectoryCounts(
  ctx: PublicReadContext,
): Promise<stats.DirectoryCounts> {
  assertPublicRead(ctx);
  return directoryCounts();
}

async function directoryCounts(): Promise<stats.DirectoryCounts> {
  "use cache";
  cacheLife("hours");
  cacheTag(cacheTags.stats());
  return stats.getCounts(PUBLIC_READ);
}
