import "server-only";

import { sql } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { visibleSql } from "../auth/visibility";
import { getDb } from "../db/client";
import {
  batches,
  founders,
  fundingRounds,
  investors,
  startups,
} from "../db/schema";

// Directory-wide counts: the public site's totals, and "counts per entity" on the admin
// dashboard (FR-202). Each count derives visibility from the context like any other read.

export type DirectoryCounts = Readonly<{
  startups: number;
  founders: number;
  investors: number;
  batches: number;
  /** Visible rounds of visible startups. */
  rounds: number;
}>;

/** Every count in one round-trip. */
export async function getCounts(ctx: ReadContext): Promise<DirectoryCounts> {
  const { rows } = await getDb().execute<DirectoryCounts>(sql`
    select
      (select count(*)::int from ${startups} where ${visibleSql(ctx, startups.status)}) as startups,
      (select count(*)::int from ${founders} where ${visibleSql(ctx, founders.status)}) as founders,
      (select count(*)::int from ${investors} where ${visibleSql(ctx, investors.status)}) as investors,
      (select count(*)::int from ${batches} where ${visibleSql(ctx, batches.status)}) as batches,
      (select count(*)::int
         from ${fundingRounds}
         inner join ${startups} on ${startups.id} = ${fundingRounds.startupId} and ${visibleSql(ctx, startups.status)}
         where ${visibleSql(ctx, fundingRounds.status)}) as rounds`);

  const [row] = rows;
  return {
    startups: row?.startups ?? 0,
    founders: row?.founders ?? 0,
    investors: row?.investors ?? 0,
    batches: row?.batches ?? 0,
    rounds: row?.rounds ?? 0,
  };
}
