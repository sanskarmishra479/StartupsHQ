import "server-only";

import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ReadContext } from "../../auth/context";
import { visibleSql } from "../../auth/visibility";
import { fundingRounds, investments, startups } from "../schema";

/**
 * Ids of the visible startups an investor backs, correlated on `investorId` (usually the outer
 * query's `investors.id`). Backing through a hidden round is itself hidden (ADR-005). A startup
 * backed in several rounds appears once per investment, so count it with `distinct`.
 */
export function portfolioStartupIds(
  ctx: ReadContext,
  investorId: AnyPgColumn,
): SQL {
  return sql`select ${investments.startupId}
    from ${investments}
    inner join ${startups} on ${startups.id} = ${investments.startupId} and ${visibleSql(ctx, startups.status)}
    left join ${fundingRounds} on ${fundingRounds.id} = ${investments.roundId}
    where ${investments.investorId} = ${investorId}
      and (${investments.roundId} is null or ${visibleSql(ctx, fundingRounds.status)})`;
}
