import "server-only";

import { and, eq, exists, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isSlug } from "../../lib/slug";
import type { ReadContext } from "../auth/context";
import { visibilityFilter, visibleSql } from "../auth/visibility";
import { getDb } from "../db/client";
import {
  ROUND_FEED_ORDER,
  roundsAfter,
  selectRounds,
} from "../db/queries/rounds";
import {
  findRedirect,
  findVisibleId,
  type SlugLookup,
} from "../db/queries/slugs";
import { subquery } from "../db/queries/sql";
import { loadStartupCards } from "../db/queries/startup-cards";
import {
  fundingRounds,
  industries,
  investments,
  investors,
  locations,
  mediaAssets,
  startupIndustries,
  startups,
} from "../db/schema";
import type { MediaVariant } from "../db/schema/media";
import { type Investor, type InvestorRow, toInvestor } from "../dto/investor";
import { type NewsItem, toNewsItem } from "../dto/news";
import type { Stage, StartupCard } from "../dto/startup";
import { NotFoundError } from "../lib/errors";
import { beginPage, finishPage } from "../lib/keyset";
import type { Page } from "../lib/pagination";
import { list } from "./startups";

// Investor reads (docs/API.md §6.5–6.7, FR-104).

export type PortfolioInput = Readonly<{
  cursor?: string;
  limit?: number;
  stage?: readonly Stage[];
  /** Industry slugs. */
  industry?: readonly string[];
}>;

export type RoundsLedInput = Readonly<{ cursor?: string; limit?: number }>;

const logo = alias(mediaAssets, "investor_logo");

/**
 * Ids of the visible startups an investor backs, correlated on the outer `investors` row. Backing
 * through a hidden round is itself hidden (ADR-005).
 */
function portfolioStartupIds(ctx: ReadContext): SQL {
  return sql`select ${investments.startupId}
    from ${investments}
    inner join ${startups} on ${startups.id} = ${investments.startupId} and ${visibleSql(ctx, startups.status)}
    left join ${fundingRounds} on ${fundingRounds.id} = ${investments.roundId}
    where ${investments.investorId} = ${investors.id}
      and (${investments.roundId} is null or ${visibleSql(ctx, fundingRounds.status)})`;
}

function investorColumns(ctx: ReadContext) {
  const portfolio = portfolioStartupIds(ctx);
  return {
    id: investors.id,
    slug: investors.slug,
    name: investors.name,
    investorType: investors.investorType,
    description: investors.description,
    websiteUrl: investors.websiteUrl,
    foundedYear: investors.foundedYear,
    aumUsd: investors.aumUsd,
    logoVariants: logo.variants,
    logoBlur: logo.blurDataUrl,
    locationSlug: locations.slug,
    city: locations.city,
    country: locations.country,
    countryCode: locations.countryCode,
    ogVariants: subquery<MediaVariant[] | null>(
      sql`select ${mediaAssets.variants} from ${mediaAssets} where ${mediaAssets.id} = ${investors.ogAssetId}`,
    ),
    portfolioCount: subquery<number>(
      sql`select count(distinct p.startup_id)::int from (${portfolio}) p`,
    ),
    roundsLedCount: subquery<number>(sql`
      select count(distinct ${fundingRounds.id})::int
      from ${investments}
      inner join ${fundingRounds} on ${fundingRounds.id} = ${investments.roundId} and ${visibleSql(ctx, fundingRounds.status)}
      inner join ${startups} on ${startups.id} = ${fundingRounds.startupId} and ${visibleSql(ctx, startups.status)}
      where ${investments.investorId} = ${investors.id} and ${investments.isLead}`),
    // Stages in enum order after count, so the breakdown reads seed → series A → …
    byStage: subquery<InvestorRow["byStage"]>(sql`
      select coalesce(json_agg(json_build_object('stage', b.stage, 'count', b.count) order by b.count desc, b.stage), '[]'::json)
      from (
        select ${startups.stage} as stage, count(*)::int as count
        from ${startups}
        where ${startups.id} in (${portfolio}) and ${startups.stage} is not null
        group by ${startups.stage}
      ) b`),
    // Every industry link counts, so a company tagged AI and Fintech appears under both.
    byIndustry: subquery<InvestorRow["byIndustry"]>(sql`
      select coalesce(json_agg(json_build_object('slug', b.slug, 'name', b.name, 'count', b.count) order by b.count desc, b.name), '[]'::json)
      from (
        select ${industries.slug} as slug, ${industries.name} as name, count(*)::int as count
        from ${startupIndustries}
        inner join ${industries} on ${industries.id} = ${startupIndustries.industryId}
        where ${startupIndustries.startupId} in (${portfolio})
        group by ${industries.id}
      ) b`),
  };
}

/**
 * An investor with counts, breakdown and the first portfolio page. 2 round-trips. Unknown or
 * hidden ⟹ NotFoundError; an old slug ⟹ a redirect.
 */
export async function getBySlug(
  ctx: ReadContext,
  slug: string,
): Promise<SlugLookup<Investor>> {
  if (!isSlug(slug)) throw new NotFoundError();
  const db = getDb();

  const [row] = await db
    .select(investorColumns(ctx))
    .from(investors)
    .leftJoin(locations, eq(locations.id, investors.hqLocationId))
    .leftJoin(logo, eq(logo.id, investors.logoAssetId))
    .where(
      and(eq(investors.slug, slug), visibilityFilter(ctx, investors.status)),
    )
    .limit(1);
  if (!row) {
    return {
      kind: "redirect",
      slug: await findRedirect(db, ctx, "investor", slug),
    };
  }

  const portfolio = await list(ctx, {
    filters: { investor: row.slug, includeAcquired: true },
  });
  return { kind: "found", value: toInvestor(row, portfolio) };
}

/** An investor's portfolio: distinct visible companies, newest first, paginated. */
export async function getPortfolio(
  ctx: ReadContext,
  slug: string,
  input: PortfolioInput = {},
): Promise<Page<StartupCard>> {
  await findVisibleId(getDb(), ctx, "investor", slug);
  return list(ctx, {
    filters: {
      investor: slug,
      includeAcquired: true,
      stage: input.stage,
      industry: input.industry,
    },
    cursor: input.cursor,
    limit: input.limit,
  });
}

/** Visible rounds this investor led, newest first, paginated. */
export async function getRoundsLed(
  ctx: ReadContext,
  slug: string,
  input: RoundsLedInput = {},
): Promise<Page<NewsItem>> {
  const db = getDb();
  const investorId = await findVisibleId(db, ctx, "investor", slug);
  const request = beginPage(ctx, "rounds-led", input.cursor, input.limit);

  const rows = await selectRounds(
    db,
    ctx,
    and(
      exists(
        db
          .select({ one: sql`1` })
          .from(investments)
          .where(
            and(
              eq(investments.roundId, fundingRounds.id),
              eq(investments.investorId, investorId),
              eq(investments.isLead, true),
            ),
          ),
      ),
      request.cursor ? roundsAfter(request.cursor) : undefined,
    ),
  )
    .orderBy(...ROUND_FEED_ORDER)
    .limit(request.limit + 1);

  const cards = await loadStartupCards(
    db,
    ctx,
    rows.map((row) => row.startupId),
  );
  return finishPage(
    request,
    rows,
    (row) => toNewsItem(row, cards),
    (row) => ({ key: [row.announcedOn], id: row.id }),
  );
}
