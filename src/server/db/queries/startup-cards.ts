import "server-only";

import { and, eq, type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  alias,
  type SelectedFields,
} from "drizzle-orm/pg-core";
import type { ReadContext } from "../../auth/context";
import { visibilityFilter } from "../../auth/visibility";
import type { Database } from "../client";
import {
  fundingRounds,
  industries,
  locations,
  mediaAssets,
  startupIndustries,
  startups,
} from "../schema";

// The one query every startup card comes from (docs/API.md §7.1): the explore grid, similar
// companies, portfolios, cohorts and category pages. Visibility is applied to the startup and
// to every joined entity that has a status, so no caller can forget a hop (SEC-03.2).

const acquirer = alias(startups, "acquirer");
const latestRound = alias(fundingRounds, "latest_round");
const primaryLink = alias(startupIndustries, "primary_link");
const logo = alias(mediaAssets, "logo");
const cover = alias(mediaAssets, "cover");

/** The startup's primary industry, for callers that rank or filter on it. */
export const primaryIndustry = alias(industries, "primary_industry");

export const startupCardColumns = {
  id: startups.id,
  slug: startups.slug,
  name: startups.name,
  tagline: startups.tagline,
  stage: startups.stage,
  workType: startups.workType,
  totalRaisedUsd: startups.totalRaisedUsd,
  acquiredByName: startups.acquiredByName,
  acquirerSlug: acquirer.slug,
  acquirerName: acquirer.name,
  logoVariants: logo.variants,
  logoBlur: logo.blurDataUrl,
  coverVariants: cover.variants,
  coverBlur: cover.blurDataUrl,
  industrySlug: primaryIndustry.slug,
  industryName: primaryIndustry.name,
  industryIconUrl: primaryIndustry.iconUrl,
  locationSlug: locations.slug,
  city: locations.city,
  country: locations.country,
  countryCode: locations.countryCode,
  roundType: latestRound.roundType,
  roundAmountUsd: latestRound.amountUsd,
  roundIsUndisclosed: latestRound.isUndisclosed,
  roundAnnouncedOn: latestRound.announcedOn,
  // Keyset sort keys (DM-13). Timestamps travel as Postgres text so microseconds survive.
  sortCreatedAt: sql<string>`${startups.createdAt}::text`,
  sortName: sql<string>`lower(${startups.name})`,
};

/**
 * Selects startup cards visible to `ctx`, narrowed by `where`. The result has no `.where()`, so
 * a caller can order and limit it but cannot replace the visibility predicate.
 */
export function selectStartupCards<
  Extra extends SelectedFields = Record<never, never>,
>(db: Database, ctx: ReadContext, where: SQL | undefined, extra?: Extra) {
  return db
    .select({ ...startupCardColumns, ...(extra as Extra) })
    .from(startups)
    .leftJoin(locations, eq(locations.id, startups.locationId))
    .leftJoin(
      primaryLink,
      and(
        eq(primaryLink.startupId, startups.id),
        eq(primaryLink.isPrimary, true),
      ),
    )
    .leftJoin(primaryIndustry, eq(primaryIndustry.id, primaryLink.industryId))
    .leftJoin(
      latestRound,
      and(
        eq(latestRound.id, startups.latestRoundId),
        visibilityFilter(ctx, latestRound.status),
      ),
    )
    .leftJoin(logo, eq(logo.id, startups.logoAssetId))
    .leftJoin(cover, eq(cover.id, startups.coverAssetId))
    .leftJoin(
      acquirer,
      and(
        eq(acquirer.id, startups.acquiredByStartupId),
        visibilityFilter(ctx, acquirer.status),
      ),
    )
    .where(and(visibilityFilter(ctx, startups.status), where));
}

/** A media asset as JSON for aggregated subqueries; null when there is no asset. */
export function mediaJson(media: {
  id: AnyPgColumn;
  variants: AnyPgColumn;
  blurDataUrl: AnyPgColumn;
}): SQL {
  return sql`case when ${media.id} is null then null else json_build_object('variants', ${media.variants}, 'blurDataUrl', ${media.blurDataUrl}) end`;
}
