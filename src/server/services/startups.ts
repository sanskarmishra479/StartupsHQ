import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { isSlug } from "../../lib/slug";
import { isAuthedContext, type ReadContext } from "../auth/context";
import { visibilityFilter, visibleSql } from "../auth/visibility";
import { type Database, getDb } from "../db/client";
import {
  mediaJson,
  primaryIndustry,
  selectStartupCards,
} from "../db/queries/startup-cards";
import {
  batches,
  founders,
  fundingRounds,
  industries,
  investments,
  investors,
  locations,
  mediaAssets,
  slugRedirects,
  startupBatches,
  startupFounders,
  startupIndustries,
  startups,
} from "../db/schema";
import type { MediaVariant } from "../db/schema/media";
import {
  type RoundRow,
  type Stage,
  type Startup,
  type StartupCard,
  type StartupDetailRow,
  type StartupFounderRow,
  toStartup,
  toStartupCard,
  type WorkType,
} from "../dto/startup";
import {
  assertPageAllowed,
  type Cursor,
  cursorSecret,
  decodeCursor,
  encodeCursor,
  type KeyValue,
} from "../lib/cursor";
import { NotFoundError, ValidationError } from "../lib/errors";
import { clampLimit, type Page, toPage } from "../lib/pagination";

// Startup reads (docs/API.md §6.1–6.3, FR-101, FR-102). Every function takes the context first
// and derives visibility from it at every hop (SEC-03.1, SEC-03.2).

export const STARTUP_SORTS = ["recent", "raised", "name"] as const;
export type StartupSort = (typeof STARTUP_SORTS)[number];

export type StartupFilters = Readonly<{
  stage?: readonly Stage[];
  /** Industry slugs. */
  industry?: readonly string[];
  workType?: readonly WorkType[];
  /** City location slugs. */
  city?: readonly string[];
  /** ISO 3166-1 alpha-2. */
  country?: string;
  batch?: string;
  investor?: string;
  founder?: string;
  /** Full-text filter over name, tagline and description. */
  q?: string;
  includeAcquired?: boolean;
}>;

export type ListStartupsInput = Readonly<{
  filters?: StartupFilters;
  sort?: StartupSort;
  cursor?: string;
  limit?: number;
}>;

/** A slug read either finds the entity or answers with its current slug (FR-409). */
export type SlugLookup<T> =
  | Readonly<{ kind: "found"; value: T }>
  | Readonly<{ kind: "redirect"; slug: string }>;

export const MAX_SIMILAR = 9;

// ── Filters ──────────────────────────────────────────────────────────────────────────────────

const one = sql`1`;

function filterConditions(
  db: Database,
  ctx: ReadContext,
  filters: StartupFilters,
): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [];

  if (filters.stage?.length) {
    conditions.push(inArray(startups.stage, [...filters.stage]));
  }
  if (filters.workType?.length) {
    conditions.push(inArray(startups.workType, [...filters.workType]));
  }
  if (filters.city?.length) {
    conditions.push(inArray(locations.slug, [...filters.city]));
  }
  if (filters.country) {
    conditions.push(eq(locations.countryCode, filters.country.toUpperCase()));
  }
  if (filters.industry?.length) {
    conditions.push(
      exists(
        db
          .select({ one })
          .from(startupIndustries)
          .innerJoin(
            industries,
            eq(industries.id, startupIndustries.industryId),
          )
          .where(
            and(
              eq(startupIndustries.startupId, startups.id),
              inArray(industries.slug, [...filters.industry]),
            ),
          ),
      ),
    );
  }
  if (filters.batch) {
    conditions.push(
      exists(
        db
          .select({ one })
          .from(startupBatches)
          .innerJoin(
            batches,
            and(
              eq(batches.id, startupBatches.batchId),
              visibilityFilter(ctx, batches.status),
            ),
          )
          .where(
            and(
              eq(startupBatches.startupId, startups.id),
              eq(batches.slug, filters.batch),
            ),
          ),
      ),
    );
  }
  if (filters.investor) {
    conditions.push(
      exists(
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
          .leftJoin(fundingRounds, eq(fundingRounds.id, investments.roundId))
          .where(
            and(
              eq(investments.startupId, startups.id),
              eq(investors.slug, filters.investor),
              // Backing through a hidden round is itself hidden.
              sql`(${investments.roundId} is null or ${visibleSql(ctx, fundingRounds.status)})`,
            ),
          ),
      ),
    );
  }
  if (filters.founder) {
    conditions.push(
      exists(
        db
          .select({ one })
          .from(startupFounders)
          .innerJoin(
            founders,
            and(
              eq(founders.id, startupFounders.founderId),
              visibilityFilter(ctx, founders.status),
            ),
          )
          .where(
            and(
              eq(startupFounders.startupId, startups.id),
              eq(founders.slug, filters.founder),
            ),
          ),
      ),
    );
  }
  const q = filters.q?.trim();
  if (q) {
    conditions.push(
      sql`${startups.searchVector} @@ plainto_tsquery('simple', public.immutable_unaccent(${q}))`,
    );
  }
  if (!filters.includeAcquired) {
    conditions.push(
      sql`(${startups.stage} is distinct from 'acquired' and ${startups.acquiredOn} is null)`,
    );
  }
  return conditions;
}

// ── Keyset sorts (DM-13, ADR-008) ────────────────────────────────────────────────────────────

type CardRow = Awaited<ReturnType<typeof selectStartupCards>>[number];

type SortSpec = {
  order: SQL[];
  key: (row: CardRow) => KeyValue[];
  /** Rows strictly after the cursor, in this sort's order. */
  after: (cursor: Cursor<StartupSort>) => SQL;
};

const invalidCursor = () =>
  new ValidationError([{ path: "cursor", message: "Invalid cursor." }]);

function keyOf<T extends "string" | "number">(
  cursor: Cursor<StartupSort>,
  type: T,
): T extends "string" ? string : number {
  const [value] = cursor.key;
  if (cursor.key.length !== 1 || typeof value !== type) throw invalidCursor();
  return value as T extends "string" ? string : number;
}

const SORTS: Record<StartupSort, SortSpec> = {
  recent: {
    order: [desc(startups.createdAt), asc(startups.id)],
    key: (row) => [row.sortCreatedAt],
    after: (cursor) => {
      const createdAt = keyOf(cursor, "string");
      return sql`(${startups.createdAt} < ${createdAt}::timestamptz or (${startups.createdAt} = ${createdAt}::timestamptz and ${startups.id} > ${cursor.id}::uuid))`;
    },
  },
  raised: {
    order: [desc(startups.totalRaisedUsd), asc(startups.id)],
    key: (row) => [row.totalRaisedUsd],
    after: (cursor) => {
      const raised = keyOf(cursor, "number");
      return sql`(${startups.totalRaisedUsd} < ${raised} or (${startups.totalRaisedUsd} = ${raised} and ${startups.id} > ${cursor.id}::uuid))`;
    },
  },
  name: {
    order: [asc(sql`lower(${startups.name})`), asc(startups.id)],
    key: (row) => [row.sortName],
    after: (cursor) =>
      sql`(lower(${startups.name}), ${startups.id}) > (${keyOf(cursor, "string")}, ${cursor.id}::uuid)`,
  },
};

// ── List ─────────────────────────────────────────────────────────────────────────────────────

/** The explore grid: faceted, sorted, keyset-paginated startup cards (FR-101). */
export async function list(
  ctx: ReadContext,
  input: ListStartupsInput = {},
): Promise<Page<StartupCard>> {
  const sort = input.sort ?? "recent";
  const spec = SORTS[sort];
  const limit = clampLimit(input.limit);
  const cursor =
    input.cursor === undefined
      ? undefined
      : decodeCursor(input.cursor, sort, cursorSecret());
  const page = cursor?.page ?? 1;
  assertPageAllowed(page, isAuthedContext(ctx));

  const db = getDb();
  const rows = await selectStartupCards(
    db,
    ctx,
    and(
      ...filterConditions(db, ctx, input.filters ?? {}),
      cursor ? spec.after(cursor) : undefined,
    ),
  )
    .orderBy(...spec.order)
    .limit(limit + 1);

  return toPage(rows, limit, toStartupCard, (last) =>
    encodeCursor(
      { sort, key: spec.key(last), id: last.id, page: page + 1 },
      cursorSecret(),
    ),
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────────────────────

/** Wraps a subquery so its columns stay table-qualified even in a single-table select. */
const subquery = <T>(inner: SQL) => sql<T>`(${inner})`;

function detailColumns(ctx: ReadContext) {
  return {
    description: startups.description,
    legalName: startups.legalName,
    websiteUrl: startups.websiteUrl,
    careersUrl: startups.careersUrl,
    linkedinUrl: startups.linkedinUrl,
    xUrl: startups.xUrl,
    githubUrl: startups.githubUrl,
    foundedYear: startups.foundedYear,
    foundedOn: startups.foundedOn,
    headcountBand: startups.headcountBand,
    isActive: startups.isActive,
    totalDebtUsd: startups.totalDebtUsd,
    acquiredOn: startups.acquiredOn,
    acquiredAmountUsd: startups.acquiredAmountUsd,
    updatedAt: startups.updatedAt,
    ogVariants: subquery<MediaVariant[] | null>(
      sql`select ${mediaAssets.variants} from ${mediaAssets} where ${mediaAssets.id} = ${startups.ogAssetId}`,
    ),
    industries: subquery<StartupDetailRow["industries"]>(sql`
      select coalesce(json_agg(json_build_object('slug', ${industries.slug}, 'name', ${industries.name}, 'isPrimary', ${startupIndustries.isPrimary})
               order by ${startupIndustries.isPrimary} desc, ${industries.name}), '[]'::json)
      from ${startupIndustries}
      inner join ${industries} on ${industries.id} = ${startupIndustries.industryId}
      where ${startupIndustries.startupId} = ${startups.id}`),
    batches: subquery<StartupDetailRow["batches"]>(sql`
      select coalesce(json_agg(json_build_object('slug', ${batches.slug}, 'programName', ${batches.programName}, 'label', ${batches.label}, 'year', ${batches.year})
               order by ${batches.year} desc, ${batches.label}), '[]'::json)
      from ${startupBatches}
      inner join ${batches} on ${batches.id} = ${startupBatches.batchId} and ${visibleSql(ctx, batches.status)}
      where ${startupBatches.startupId} = ${startups.id}`),
    // "Backed by": each visible investor once, lead if it led any visible round (ADR-005).
    investors: subquery<StartupDetailRow["investors"]>(sql`
      select coalesce(json_agg(json_build_object('slug', v.slug, 'name', v.name, 'investorType', v.investor_type, 'isLead', v.is_lead, 'logo', v.logo)
               order by v.is_lead desc, v.name), '[]'::json)
      from (
        select ${investors.slug} as slug, ${investors.name} as name, ${investors.investorType} as investor_type,
               bool_or(${investments.isLead}) as is_lead, ${mediaJson(mediaAssets)} as logo
        from ${investments}
        inner join ${investors} on ${investors.id} = ${investments.investorId} and ${visibleSql(ctx, investors.status)}
        left join ${fundingRounds} on ${fundingRounds.id} = ${investments.roundId}
        left join ${mediaAssets} on ${mediaAssets.id} = ${investors.logoAssetId}
        where ${investments.startupId} = ${startups.id}
          and (${investments.roundId} is null or ${visibleSql(ctx, fundingRounds.status)})
        group by ${investors.id}, ${mediaAssets.id}
      ) v`),
  };
}

function selectFounders(
  db: Database,
  ctx: ReadContext,
  startupId: string,
): Promise<StartupFounderRow[]> {
  return db
    .select({
      slug: founders.slug,
      fullName: founders.fullName,
      headline: founders.headline,
      photoVariants: mediaAssets.variants,
      photoBlur: mediaAssets.blurDataUrl,
      role: startupFounders.role,
      isCurrent: startupFounders.isCurrent,
      joinedYear: startupFounders.joinedYear,
      leftYear: startupFounders.leftYear,
    })
    .from(startupFounders)
    .innerJoin(
      founders,
      and(
        eq(founders.id, startupFounders.founderId),
        visibilityFilter(ctx, founders.status),
      ),
    )
    .leftJoin(mediaAssets, eq(mediaAssets.id, founders.photoAssetId))
    .where(eq(startupFounders.startupId, startupId))
    .orderBy(
      asc(startupFounders.sortOrder),
      sql`${startupFounders.joinedYear} desc nulls last`,
      asc(founders.fullName),
    );
}

function selectRounds(
  db: Database,
  ctx: ReadContext,
  startupId: string,
): Promise<RoundRow[]> {
  return db
    .select({
      id: fundingRounds.id,
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
    .where(
      and(
        eq(fundingRounds.startupId, startupId),
        visibilityFilter(ctx, fundingRounds.status),
      ),
    )
    .orderBy(desc(fundingRounds.announcedOn), asc(fundingRounds.id));
}

/** Resolves an old slug to the entity's current slug, or throws NotFoundError. */
async function findRedirect(
  db: Database,
  ctx: ReadContext,
  oldSlug: string,
): Promise<string> {
  const [row] = await db
    .select({ slug: startups.slug })
    .from(slugRedirects)
    .innerJoin(startups, eq(startups.id, slugRedirects.entityId))
    .where(
      and(
        eq(slugRedirects.entityType, "startup"),
        eq(slugRedirects.oldSlug, oldSlug),
        visibilityFilter(ctx, startups.status),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.slug;
}

/**
 * The company page (FR-102). At most 3 round-trips: the startup with its aggregates, then
 * founders and rounds in parallel (NFR-01). Unknown or hidden ⟹ NotFoundError; an old slug ⟹
 * a redirect to the current one.
 */
export async function getBySlug(
  ctx: ReadContext,
  slug: string,
): Promise<SlugLookup<Startup>> {
  if (!isSlug(slug)) throw new NotFoundError();
  const db = getDb();

  const [row] = await selectStartupCards(
    db,
    ctx,
    eq(startups.slug, slug),
    detailColumns(ctx),
  ).limit(1);
  if (!row) {
    return { kind: "redirect", slug: await findRedirect(db, ctx, slug) };
  }

  const [founderRows, roundRows] = await Promise.all([
    selectFounders(db, ctx, row.id),
    selectRounds(db, ctx, row.id),
  ]);
  return { kind: "found", value: toStartup(row, founderRows, roundRows) };
}

// ── Similar ──────────────────────────────────────────────────────────────────────────────────

/**
 * Up to 9 similar companies: same primary industry first, then stage, then city. Never the
 * subject itself; a hidden subject is NotFoundError.
 */
export async function listSimilar(
  ctx: ReadContext,
  slug: string,
  limit: number = MAX_SIMILAR,
): Promise<StartupCard[]> {
  if (!isSlug(slug)) throw new NotFoundError();
  const db = getDb();

  const [subject] = await db
    .select({
      id: startups.id,
      stage: startups.stage,
      locationId: startups.locationId,
      industryId: startupIndustries.industryId,
    })
    .from(startups)
    .leftJoin(
      startupIndustries,
      and(
        eq(startupIndustries.startupId, startups.id),
        eq(startupIndustries.isPrimary, true),
      ),
    )
    .where(and(eq(startups.slug, slug), visibilityFilter(ctx, startups.status)))
    .limit(1);
  if (!subject) throw new NotFoundError();

  const score = sql<number>`(
    (case when ${primaryIndustry.id} = ${subject.industryId} then 4 else 0 end) +
    (case when ${startups.stage} = ${subject.stage} then 2 else 0 end) +
    (case when ${startups.locationId} = ${subject.locationId} then 1 else 0 end))`;

  const rows = await selectStartupCards(
    db,
    ctx,
    and(ne(startups.id, subject.id), sql`${score} > 0`),
  )
    .orderBy(desc(score), desc(startups.totalRaisedUsd), asc(startups.id))
    .limit(clampLimit(limit, MAX_SIMILAR, MAX_SIMILAR));

  return rows.map(toStartupCard);
}
