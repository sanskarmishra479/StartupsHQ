import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { isSlug } from "../../lib/slug";
import type { ReadContext } from "../auth/context";
import { visibilityFilter } from "../auth/visibility";
import { getDb } from "../db/client";
import { findRedirect, type SlugLookup } from "../db/queries/slugs";
import { subquery } from "../db/queries/sql";
import { loadStartupCards } from "../db/queries/startup-cards";
import {
  founders,
  locations,
  mediaAssets,
  startupFounders,
  startups,
} from "../db/schema";
import type { MediaVariant } from "../db/schema/media";
import { type Founder, toFounder } from "../dto/founder";
import { NotFoundError } from "../lib/errors";

// Founder reads (docs/API.md §6.4, FR-103): the founder graph, startupsHQ's differentiator.

/**
 * A founder with every visible startup they worked on, newest stint first. At most 3
 * round-trips. Unknown or hidden ⟹ NotFoundError; an old slug ⟹ a redirect.
 */
export async function getBySlug(
  ctx: ReadContext,
  slug: string,
): Promise<SlugLookup<Founder>> {
  if (!isSlug(slug)) throw new NotFoundError();
  const db = getDb();

  const [row] = await db
    .select({
      id: founders.id,
      slug: founders.slug,
      fullName: founders.fullName,
      headline: founders.headline,
      bio: founders.bio,
      photoVariants: mediaAssets.variants,
      photoBlur: mediaAssets.blurDataUrl,
      linkedinUrl: founders.linkedinUrl,
      xUrl: founders.xUrl,
      githubUrl: founders.githubUrl,
      personalUrl: founders.personalUrl,
      locationSlug: locations.slug,
      city: locations.city,
      country: locations.country,
      countryCode: locations.countryCode,
      updatedAt: founders.updatedAt,
      ogVariants: subquery<MediaVariant[] | null>(
        sql`select og.variants from ${mediaAssets} og where og.id = ${founders.ogAssetId}`,
      ),
    })
    .from(founders)
    .leftJoin(locations, eq(locations.id, founders.locationId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, founders.photoAssetId))
    .where(and(eq(founders.slug, slug), visibilityFilter(ctx, founders.status)))
    .limit(1);
  if (!row) {
    return {
      kind: "redirect",
      slug: await findRedirect(db, ctx, "founder", slug),
    };
  }

  const stints = await db
    .select({
      startupId: startupFounders.startupId,
      role: startupFounders.role,
      isCurrent: startupFounders.isCurrent,
      joinedYear: startupFounders.joinedYear,
      leftYear: startupFounders.leftYear,
    })
    .from(startupFounders)
    .innerJoin(
      startups,
      and(
        eq(startups.id, startupFounders.startupId),
        visibilityFilter(ctx, startups.status),
      ),
    )
    .where(eq(startupFounders.founderId, row.id))
    .orderBy(
      sql`${startupFounders.joinedYear} desc nulls last`,
      asc(startupFounders.sortOrder),
      asc(startupFounders.id),
    );

  const cards = await loadStartupCards(
    db,
    ctx,
    stints.map((stint) => stint.startupId),
  );
  return { kind: "found", value: toFounder(row, stints, cards) };
}
