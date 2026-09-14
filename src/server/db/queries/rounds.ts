import "server-only";

import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import type { ReadContext } from "../../auth/context";
import { visibilityFilter, visibleSql } from "../../auth/visibility";
import type { RoundRow } from "../../dto/startup";
import type { Cursor } from "../../lib/cursor";
import { cursorKey } from "../../lib/keyset";
import type { Database } from "../client";
import {
  fundingRounds,
  investments,
  investors,
  mediaAssets,
  startups,
} from "../schema";
import { mediaJson, subquery } from "./sql";

// The one query funding rounds come from (docs/API.md §7.3): the company timeline, the news feed
// and an investor's rounds led. A round is visible only when it and its startup both are, and
// each round lists only its visible investors (SEC-03.2).

/** Newest first, as the news feed and timelines show them (DM-13). */
export const ROUND_FEED_ORDER = [
  desc(fundingRounds.announcedOn),
  asc(fundingRounds.id),
];

/** Rounds strictly after a cursor minted from ROUND_FEED_ORDER. */
export function roundsAfter(cursor: Cursor): SQL {
  const announcedOn = cursorKey(cursor, "string");
  return sql`(${fundingRounds.announcedOn} < ${announcedOn}::date or (${fundingRounds.announcedOn} = ${announcedOn}::date and ${fundingRounds.id} > ${cursor.id}::uuid))`;
}

/**
 * Selects rounds visible to `ctx`, narrowed by `where`. Like selectStartupCards, the result has
 * no `.where()`, so callers cannot replace the visibility predicate.
 */
export function selectRounds(
  db: Database,
  ctx: ReadContext,
  where: SQL | undefined,
) {
  return db
    .select({
      id: fundingRounds.id,
      startupId: fundingRounds.startupId,
      roundType: fundingRounds.roundType,
      roundClass: fundingRounds.roundClass,
      announcedOn: fundingRounds.announcedOn,
      isUndisclosed: fundingRounds.isUndisclosed,
      currency: fundingRounds.currency,
      amountOriginal: fundingRounds.amountOriginal,
      amountUsd: fundingRounds.amountUsd,
      fxRate: fundingRounds.fxRate,
      fxRateDate: fundingRounds.fxRateDate,
      valuationUsd: fundingRounds.valuationUsd,
      sourceUrl: fundingRounds.sourceUrl,
      sourceTitle: fundingRounds.sourceTitle,
      investors: subquery<RoundRow["investors"]>(sql`
        select coalesce(json_agg(json_build_object('slug', ${investors.slug}, 'name', ${investors.name}, 'isLead', ${investments.isLead}, 'logo', ${mediaJson(mediaAssets)})
                 order by ${investments.isLead} desc, ${investors.name}), '[]'::json)
        from ${investments}
        inner join ${investors} on ${investors.id} = ${investments.investorId} and ${visibleSql(ctx, investors.status)}
        left join ${mediaAssets} on ${mediaAssets.id} = ${investors.logoAssetId}
        where ${investments.roundId} = ${fundingRounds.id}`),
    })
    .from(fundingRounds)
    .innerJoin(
      startups,
      and(
        eq(startups.id, fundingRounds.startupId),
        visibilityFilter(ctx, startups.status),
      ),
    )
    .where(and(visibilityFilter(ctx, fundingRounds.status), where));
}
