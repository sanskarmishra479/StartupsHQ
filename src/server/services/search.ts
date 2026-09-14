import "server-only";

import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { visibilityFilter, visibleSql } from "../auth/visibility";
import { type Database, getDb } from "../db/client";
import { portfolioStartupIds } from "../db/queries/portfolio";
import { mediaJson, subquery } from "../db/queries/sql";
import { selectStartupCards } from "../db/queries/startup-cards";
import {
  batches,
  founders,
  industries,
  investors,
  locations,
  mediaAssets,
  startupBatches,
  startupFounders,
  startupIndustries,
  startups,
} from "../db/schema";
import {
  type BatchHit,
  type SearchGroup,
  type SearchResults,
  type Suggestion,
  type SuggestionRow,
  toBatchHit,
  toFounderHit,
  toInvestorHit,
  toSuggestion,
} from "../dto/search";
import { type StartupCard, toStartupCard } from "../dto/startup";
import { ValidationError } from "../lib/errors";
import { clampLimit } from "../lib/pagination";

// Search and suggest (docs/API.md §6.11–6.12, FR-109). Never cached per query: caching arbitrary
// strings would let anyone mint unbounded cache entries (ARCHITECTURE §3). User input only ever
// reaches SQL as a bound parameter, and `websearch_to_tsquery` accepts any string without error.

export const SEARCH_TYPES = [
  "all",
  "startups",
  "founders",
  "investors",
  "batches",
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export type SearchInput = Readonly<{
  q: string;
  type?: SearchType;
  limit?: number;
}>;

export const MAX_SUGGESTIONS = 8;
const MAX_SEARCH_LIMIT = 24;
const DEFAULT_SEARCH_LIMIT = 12;

type MatchMode = "fulltext" | "trigram";

type Matcher = { where: SQL; rank: SQL; exact: SQL };

function normalizeQuery(q: string, min: number, max: number): string {
  const value = typeof q === "string" ? q.normalize("NFC").trim() : "";
  const collapsed = value.replace(/\s+/g, " ");
  if (collapsed.length < min || collapsed.length > max) {
    throw new ValidationError([
      { path: "q", message: `Must be ${min} to ${max} characters.` },
    ]);
  }
  return collapsed;
}

/** Accent- and case-insensitive text, matching the trigram index expressions (DM-13). */
const folded = (value: SQL) => sql`public.immutable_unaccent(lower(${value}))`;

/**
 * Full-text: weighted `simple` vectors ranked by `ts_rank_cd`. Trigram: word similarity on the
 * folded name (index-backed `%>`), for misspellings. Either way an exact name match ranks first.
 */
function matcher(mode: MatchMode, q: string, vector: SQL, name: SQL): Matcher {
  const needle = folded(sql`${q}`);
  const hay = folded(name);
  const exact = sql`(${hay} = ${needle})`;
  if (mode === "fulltext") {
    const query = sql`websearch_to_tsquery('simple', public.immutable_unaccent(${q}))`;
    return {
      where: sql`${vector} @@ ${query}`,
      rank: sql`ts_rank_cd(${vector}, ${query})`,
      exact,
    };
  }
  return {
    where: sql`${hay} %> ${needle}`,
    rank: sql`word_similarity(${needle}, ${hay})`,
    exact,
  };
}

const total = subquery<number>(sql`count(*) over ()`);

async function searchStartups(
  db: Database,
  ctx: ReadContext,
  m: Matcher,
  limit: number,
): Promise<SearchGroup<StartupCard>> {
  const rows = await selectStartupCards(db, ctx, m.where, { total })
    .orderBy(desc(m.exact), desc(m.rank), asc(startups.name), asc(startups.id))
    .limit(limit);
  return {
    results: rows.map(toStartupCard),
    total: Number(rows[0]?.total ?? 0),
  };
}

async function searchFounders(
  db: Database,
  ctx: ReadContext,
  m: Matcher,
  limit: number,
) {
  const rows = await db
    .select({
      slug: founders.slug,
      fullName: founders.fullName,
      headline: founders.headline,
      photoVariants: mediaAssets.variants,
      photoBlur: mediaAssets.blurDataUrl,
      startupCount: subquery<number>(sql`
        select count(distinct ${startupFounders.startupId})::int
        from ${startupFounders}
        inner join ${startups} on ${startups.id} = ${startupFounders.startupId} and ${visibleSql(ctx, startups.status)}
        where ${startupFounders.founderId} = ${founders.id}`),
      total,
    })
    .from(founders)
    .leftJoin(mediaAssets, eq(mediaAssets.id, founders.photoAssetId))
    .where(and(visibilityFilter(ctx, founders.status), m.where))
    .orderBy(
      desc(m.exact),
      desc(m.rank),
      asc(founders.fullName),
      asc(founders.id),
    )
    .limit(limit);
  return {
    results: rows.map(toFounderHit),
    total: Number(rows[0]?.total ?? 0),
  };
}

async function searchInvestors(
  db: Database,
  ctx: ReadContext,
  m: Matcher,
  limit: number,
) {
  const rows = await db
    .select({
      slug: investors.slug,
      name: investors.name,
      investorType: investors.investorType,
      logoVariants: mediaAssets.variants,
      logoBlur: mediaAssets.blurDataUrl,
      portfolioCount: subquery<number>(
        sql`select count(distinct p.startup_id)::int from (${portfolioStartupIds(ctx, investors.id)}) p`,
      ),
      total,
    })
    .from(investors)
    .leftJoin(mediaAssets, eq(mediaAssets.id, investors.logoAssetId))
    .where(and(visibilityFilter(ctx, investors.status), m.where))
    .orderBy(
      desc(m.exact),
      desc(m.rank),
      asc(investors.name),
      asc(investors.id),
    )
    .limit(limit);
  return {
    results: rows.map(toInvestorHit),
    total: Number(rows[0]?.total ?? 0),
  };
}

async function searchBatches(
  db: Database,
  ctx: ReadContext,
  m: Matcher,
  limit: number,
): Promise<SearchGroup<BatchHit>> {
  const rows = await db
    .select({
      slug: batches.slug,
      programName: batches.programName,
      label: batches.label,
      year: batches.year,
      companyCount: subquery<number>(sql`
        select count(*)::int
        from ${startupBatches}
        inner join ${startups} on ${startups.id} = ${startupBatches.startupId} and ${visibleSql(ctx, startups.status)}
        where ${startupBatches.batchId} = ${batches.id}`),
      total,
    })
    .from(batches)
    .where(and(visibilityFilter(ctx, batches.status), m.where))
    .orderBy(desc(m.exact), desc(m.rank), desc(batches.year), asc(batches.id))
    .limit(limit);
  return {
    results: rows.map((row) => toBatchHit(row)),
    total: Number(rows[0]?.total ?? 0),
  };
}

const EMPTY = Object.freeze({ results: [], total: 0 });

async function runSearch(
  db: Database,
  ctx: ReadContext,
  q: string,
  mode: MatchMode,
  type: SearchType,
  limit: number,
): Promise<SearchResults["data"]> {
  const wants = (group: Exclude<SearchType, "all">) =>
    type === "all" || type === group;
  // Batches have no stored vector; the table is small, so it is computed per query.
  const batchName = sql`${batches.programName} || ' ' || ${batches.label}`;
  const batchVector = sql`to_tsvector('simple', public.immutable_unaccent(${batchName}))`;

  const [startupGroup, founderGroup, investorGroup, batchGroup] =
    await Promise.all([
      wants("startups")
        ? searchStartups(
            db,
            ctx,
            matcher(
              mode,
              q,
              sql`${startups.searchVector}`,
              sql`${startups.name}`,
            ),
            limit,
          )
        : EMPTY,
      wants("founders")
        ? searchFounders(
            db,
            ctx,
            matcher(
              mode,
              q,
              sql`${founders.searchVector}`,
              sql`${founders.fullName}`,
            ),
            limit,
          )
        : EMPTY,
      wants("investors")
        ? searchInvestors(
            db,
            ctx,
            matcher(
              mode,
              q,
              sql`${investors.searchVector}`,
              sql`${investors.name}`,
            ),
            limit,
          )
        : EMPTY,
      wants("batches")
        ? searchBatches(
            db,
            ctx,
            matcher(mode, q, batchVector, batchName),
            limit,
          )
        : EMPTY,
    ]);

  return {
    startups: startupGroup,
    founders: founderGroup,
    investors: investorGroup,
    batches: batchGroup,
  };
}

/**
 * Grouped search across the four entity types. Full-text first; when that finds nothing in any
 * requested group, a trigram pass catches misspellings (`meta.matchType` says which ran).
 */
export async function search(
  ctx: ReadContext,
  input: SearchInput,
): Promise<SearchResults> {
  const query = normalizeQuery(input.q, 2, 100);
  const type = input.type ?? "all";
  if (!(SEARCH_TYPES as readonly string[]).includes(type)) {
    throw new ValidationError([{ path: "type", message: "Unknown type." }]);
  }
  const limit = clampLimit(input.limit, MAX_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT);
  const db = getDb();

  const fulltext = await runSearch(db, ctx, query, "fulltext", type, limit);
  if (Object.values(fulltext).some((group) => group.total > 0)) {
    return { data: fulltext, meta: { query, matchType: "fulltext" } };
  }
  return {
    data: await runSearch(db, ctx, query, "trigram", type, limit),
    meta: { query, matchType: "trigram" },
  };
}

/**
 * Autocomplete: at most 8 results across all types in one round-trip. A name that starts with
 * the query ranks above one with a word that does, which ranks above a fuzzy match.
 */
export async function suggest(
  ctx: ReadContext,
  q: string,
): Promise<Suggestion[]> {
  const query = normalizeQuery(q, 1, 60);
  const db = getDb();
  const needle = folded(sql`${query}`);

  const scored = (name: SQL) => {
    const hay = folded(name);
    const prefix = sql`starts_with(${hay}, ${needle})`;
    const wordPrefix = sql`strpos(' ' || ${hay}, ' ' || ${needle}) > 0`;
    return {
      where: sql`(${prefix} or ${wordPrefix} or ${hay} %> ${needle})`,
      score: sql`((case when ${prefix} then 3 when ${wordPrefix} then 2 else 0 end) + word_similarity(${needle}, ${hay}))`,
    };
  };

  const startup = scored(sql`${startups.name}`);
  const founder = scored(sql`${founders.fullName}`);
  const investor = scored(sql`${investors.name}`);
  const batchName = sql`${batches.programName} || ' ' || ${batches.label}`;
  const batch = scored(batchName);

  const { rows } = await db.execute<SuggestionRow & { score: number }>(sql`
    select type, slug, name, part1, part2, part3, logo, score from (
      select 'startup' as type, ${startups.slug} as slug, ${startups.name} as name,
             ${industries.name} as part1, ${startups.stage}::text as part2, ${locations.city} as part3,
             ${mediaJson(mediaAssets)} as logo, ${startup.score} as score
      from ${startups}
      left join ${startupIndustries} on ${startupIndustries.startupId} = ${startups.id} and ${startupIndustries.isPrimary}
      left join ${industries} on ${industries.id} = ${startupIndustries.industryId}
      left join ${locations} on ${locations.id} = ${startups.locationId}
      left join ${mediaAssets} on ${mediaAssets.id} = ${startups.logoAssetId}
      where ${visibleSql(ctx, startups.status)} and ${startup.where}

      union all
      select 'founder', ${founders.slug}, ${founders.fullName},
             ${founders.headline}, null, null,
             ${mediaJson(mediaAssets)}, ${founder.score}
      from ${founders}
      left join ${mediaAssets} on ${mediaAssets.id} = ${founders.photoAssetId}
      where ${visibleSql(ctx, founders.status)} and ${founder.where}

      union all
      select 'investor', ${investors.slug}, ${investors.name},
             null, ${investors.investorType}::text, ${locations.city},
             ${mediaJson(mediaAssets)}, ${investor.score}
      from ${investors}
      left join ${locations} on ${locations.id} = ${investors.hqLocationId}
      left join ${mediaAssets} on ${mediaAssets.id} = ${investors.logoAssetId}
      where ${visibleSql(ctx, investors.status)} and ${investor.where}

      union all
      select 'batch', ${batches.slug}, ${batchName},
             ${batches.year}::text, null, null,
             ${mediaJson(mediaAssets)}, ${batch.score}
      from ${batches}
      left join ${mediaAssets} on ${mediaAssets.id} = ${batches.logoAssetId}
      where ${visibleSql(ctx, batches.status)} and ${batch.where}
    ) matches
    order by score desc, name asc
    limit ${MAX_SUGGESTIONS}`);

  return rows.map(toSuggestion);
}
