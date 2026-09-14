import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isSlug } from "../../lib/slug";
import type { ReadContext } from "../auth/context";
import { visibilityFilter, visibleSql } from "../auth/visibility";
import { type Database, getDb } from "../db/client";
import {
  findRedirect,
  findVisibleId,
  type SlugLookup,
} from "../db/queries/slugs";
import {
  batches,
  industries,
  investors,
  mediaAssets,
  startupBatches,
  startupIndustries,
  startups,
} from "../db/schema";
import { type Batch, type BatchStats, toBatch } from "../dto/batch";
import { NotFoundError } from "../lib/errors";
import { list } from "./startups";

// Batch reads (docs/API.md §6.8, FR-105).

export type CohortInput = Readonly<{ cursor?: string; limit?: number }>;

export const TOP_INDUSTRIES = 5;

const batchLogo = alias(mediaAssets, "batch_logo");
const investorLogo = alias(mediaAssets, "investor_logo");

async function statsFor(
  db: Database,
  ctx: ReadContext,
  batchId: string,
): Promise<BatchStats> {
  const cohort = sql`select ${startupBatches.startupId}
    from ${startupBatches}
    inner join ${startups} on ${startups.id} = ${startupBatches.startupId} and ${visibleSql(ctx, startups.status)}
    where ${startupBatches.batchId} = ${batchId}`;

  const { rows } = await db.execute<{
    company_count: number;
    total_raised_usd: string;
    top_industries: BatchStats["topIndustries"];
  }>(sql`
    select
      (select count(*)::int from (${cohort}) c) as company_count,
      (select coalesce(sum(${startups.totalRaisedUsd}), 0)::text
         from ${startups} where ${startups.id} in (${cohort})) as total_raised_usd,
      (select coalesce(json_agg(json_build_object('slug', t.slug, 'name', t.name, 'count', t.count) order by t.count desc, t.name), '[]'::json)
         from (
           select ${industries.slug} as slug, ${industries.name} as name, count(*)::int as count
           from ${startupIndustries}
           inner join ${industries} on ${industries.id} = ${startupIndustries.industryId}
           where ${startupIndustries.startupId} in (${cohort})
           group by ${industries.id}
           order by count(*) desc, ${industries.name}
           limit ${TOP_INDUSTRIES}
         ) t) as top_industries`);

  const [row] = rows;
  return {
    companyCount: row?.company_count ?? 0,
    totalRaisedUsd: Number(row?.total_raised_usd ?? 0),
    topIndustries: row?.top_industries ?? [],
  };
}

/**
 * A batch with its organizer, stats and first cohort page. 3 round-trips. Unknown or hidden ⟹
 * NotFoundError; an old slug ⟹ a redirect.
 */
export async function getBySlug(
  ctx: ReadContext,
  slug: string,
  input: CohortInput = {},
): Promise<SlugLookup<Batch>> {
  if (!isSlug(slug)) throw new NotFoundError();
  const db = getDb();

  const [row] = await db
    .select({
      id: batches.id,
      slug: batches.slug,
      programName: batches.programName,
      label: batches.label,
      season: batches.season,
      year: batches.year,
      startsOn: batches.startsOn,
      demoDayOn: batches.demoDayOn,
      description: batches.description,
      logoVariants: batchLogo.variants,
      logoBlur: batchLogo.blurDataUrl,
      investorSlug: investors.slug,
      investorName: investors.name,
      investorType: investors.investorType,
      investorLogoVariants: investorLogo.variants,
      investorLogoBlur: investorLogo.blurDataUrl,
    })
    .from(batches)
    .leftJoin(batchLogo, eq(batchLogo.id, batches.logoAssetId))
    .leftJoin(
      investors,
      and(
        eq(investors.id, batches.investorId),
        visibilityFilter(ctx, investors.status),
      ),
    )
    .leftJoin(investorLogo, eq(investorLogo.id, investors.logoAssetId))
    .where(and(eq(batches.slug, slug), visibilityFilter(ctx, batches.status)))
    .limit(1);
  if (!row) {
    return {
      kind: "redirect",
      slug: await findRedirect(db, ctx, "batch", slug),
    };
  }

  const [stats, companies] = await Promise.all([
    statsFor(db, ctx, row.id),
    list(ctx, {
      filters: { batch: row.slug, includeAcquired: true },
      cursor: input.cursor,
      limit: input.limit,
    }),
  ]);
  return { kind: "found", value: toBatch(row, stats, companies) };
}

/** Company count, total raised and the top 5 industries of a batch's visible cohort. */
export async function getStats(
  ctx: ReadContext,
  slug: string,
): Promise<BatchStats> {
  const db = getDb();
  return statsFor(db, ctx, await findVisibleId(db, ctx, "batch", slug));
}
