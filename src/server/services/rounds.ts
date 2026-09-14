import "server-only";

import { and, eq, exists, gte, inArray, lte, sql } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { visibilityFilter } from "../auth/visibility";
import { getDb } from "../db/client";
import {
  ROUND_FEED_ORDER,
  roundsAfter,
  selectRounds,
} from "../db/queries/rounds";
import { findVisibleId } from "../db/queries/slugs";
import { loadStartupCards } from "../db/queries/startup-cards";
import {
  fundingRounds,
  industries,
  investments,
  investors,
  startupIndustries,
} from "../db/schema";
import { type NewsItem, toNewsItem } from "../dto/news";
import { type Round, type RoundType, toRound } from "../dto/startup";
import { ValidationError } from "../lib/errors";
import { beginPage, finishPage } from "../lib/keyset";
import type { Page } from "../lib/pagination";

// Funding round reads (docs/API.md §6.9, FR-106).

export type RoundFeedFilters = Readonly<{
  roundType?: readonly RoundType[];
  /** Investor slug: rounds this investor took part in. */
  investor?: string;
  /** Industry slug of the round's startup. */
  industry?: string;
  /** Inclusive, YYYY-MM-DD. */
  from?: string;
  /** Inclusive, YYYY-MM-DD. */
  to?: string;
}>;

export type ListRecentInput = Readonly<{
  filters?: RoundFeedFilters;
  cursor?: string;
  limit?: number;
}>;

const one = sql`1`;

/** A calendar date bound; anything else is a 400 rather than a database cast error. */
function dateBound(value: string | undefined, path: string) {
  if (value === undefined) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : undefined;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new ValidationError([
      { path, message: "Must be a YYYY-MM-DD date." },
    ]);
  }
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError([{ path, message: "Must be a real date." }]);
  }
  return value;
}

/** The news feed: visible rounds of visible startups, newest first, paginated. */
export async function listRecent(
  ctx: ReadContext,
  input: ListRecentInput = {},
): Promise<Page<NewsItem>> {
  const filters = input.filters ?? {};
  const from = dateBound(filters.from, "from");
  const to = dateBound(filters.to, "to");
  const request = beginPage(ctx, "news", input.cursor, input.limit);
  const db = getDb();

  const rows = await selectRounds(
    db,
    ctx,
    and(
      filters.roundType?.length
        ? inArray(fundingRounds.roundType, [...filters.roundType])
        : undefined,
      from ? gte(fundingRounds.announcedOn, from) : undefined,
      to ? lte(fundingRounds.announcedOn, to) : undefined,
      filters.investor
        ? exists(
            db
              .select({ one })
              .from(investments)
              .innerJoin(
                investors,
                and(
                  eq(investors.id, investments.investorId),
                  visibilityFilter(ctx, investors.status),
                ),
              )
              .where(
                and(
                  eq(investments.roundId, fundingRounds.id),
                  eq(investors.slug, filters.investor),
                ),
              ),
          )
        : undefined,
      filters.industry
        ? exists(
            db
              .select({ one })
              .from(startupIndustries)
              .innerJoin(
                industries,
                eq(industries.id, startupIndustries.industryId),
              )
              .where(
                and(
                  eq(startupIndustries.startupId, fundingRounds.startupId),
                  eq(industries.slug, filters.industry),
                ),
              ),
          )
        : undefined,
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

/** A visible startup's visible rounds, newest first. */
export async function listForStartup(
  ctx: ReadContext,
  slug: string,
): Promise<Round[]> {
  const db = getDb();
  const startupId = await findVisibleId(db, ctx, "startup", slug);
  const rows = await selectRounds(
    db,
    ctx,
    eq(fundingRounds.startupId, startupId),
  ).orderBy(...ROUND_FEED_ORDER);
  return rows.map(toRound);
}
