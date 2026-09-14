import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  enumToSlug,
  slugToEnum,
  stageLabel,
  workTypeLabel,
} from "../../lib/labels";
import { isSlug } from "../../lib/slug";
import type { ReadContext } from "../auth/context";
import { visibilityFilter } from "../auth/visibility";
import { type Database, getDb } from "../db/client";
import {
  industries,
  locations,
  stageEnum,
  startupIndustries,
  startups,
  taxonomyPages,
  workTypeEnum,
} from "../db/schema";
import {
  type CategoryDirectory,
  type CategoryKind,
  type CategoryPage,
  isCategoryKind,
  type ResolvedFacet,
  toCategoryEntry,
  toCategoryPage,
} from "../dto/category";
import { NotFoundError } from "../lib/errors";
import { count, list, type StartupFilters } from "./startups";

// Category pages and the category directory (docs/API.md §6.10, FR-107, FR-108). Facet values
// stay typed in the schema; `taxonomy_pages` only holds their copy (DM-09). A value that does
// not exist, or has no company visible to the caller, is a 404.

export type CategoryPageInput = Readonly<{ cursor?: string; limit?: number }>;

const TAXONOMY_KIND = {
  industries: "industry",
  stages: "stage",
  "work-type": "work_type",
  cities: "city",
  countries: "country",
} as const satisfies Record<CategoryKind, string>;

type Facet = ResolvedFacet & Readonly<{ filters: StartupFilters }>;

/** The facet value behind a category URL, or null when it does not exist. */
async function resolveFacet(
  db: Database,
  kind: CategoryKind,
  slug: string,
): Promise<Facet | null> {
  switch (kind) {
    case "industries": {
      const [row] = await db
        .select({ name: industries.name, iconUrl: industries.iconUrl })
        .from(industries)
        .where(eq(industries.slug, slug))
        .limit(1);
      return row
        ? {
            heading: `${row.name} startups`,
            iconUrl: row.iconUrl,
            filters: { industry: [slug] },
          }
        : null;
    }
    case "stages": {
      const stage = slugToEnum(slug, stageEnum.enumValues);
      if (!stage) return null;
      return {
        heading: `${stageLabel(stage) ?? stage} startups`,
        iconUrl: null,
        filters: { stage: [stage] },
      };
    }
    case "work-type": {
      const workType = slugToEnum(slug, workTypeEnum.enumValues);
      if (!workType) return null;
      return {
        heading: `${workTypeLabel(workType) ?? workType} startups`,
        iconUrl: null,
        filters: { workType: [workType] },
      };
    }
    case "cities": {
      const [row] = await db
        .select({ city: locations.city })
        .from(locations)
        .where(and(eq(locations.slug, slug), isNotNull(locations.city)))
        .limit(1);
      return row?.city
        ? {
            heading: `Startups in ${row.city}`,
            iconUrl: null,
            filters: { city: [slug] },
          }
        : null;
    }
    case "countries": {
      // A country page exists for each country-level location row (city is null).
      const [row] = await db
        .select({
          country: locations.country,
          countryCode: locations.countryCode,
        })
        .from(locations)
        .where(and(eq(locations.slug, slug), isNull(locations.city)))
        .limit(1);
      return row
        ? {
            heading: `Startups in ${row.country}`,
            iconUrl: null,
            filters: { country: row.countryCode },
          }
        : null;
    }
  }
}

/**
 * One category page: copy (or generated copy), indexability and the first page of companies.
 * Acquired companies are included, and counted, like every other published company.
 */
export async function getPage(
  ctx: ReadContext,
  kind: string,
  slug: string,
  input: CategoryPageInput = {},
): Promise<CategoryPage> {
  if (!isCategoryKind(kind) || !isSlug(slug)) throw new NotFoundError();
  const db = getDb();

  const facet = await resolveFacet(db, kind, slug);
  if (!facet) throw new NotFoundError();
  const filters: StartupFilters = { ...facet.filters, includeAcquired: true };

  const [[copy], companyCount] = await Promise.all([
    db
      .select({
        heading: taxonomyPages.heading,
        intro: taxonomyPages.intro,
        iconUrl: taxonomyPages.iconUrl,
        seoTitle: taxonomyPages.seoTitle,
        seoDescription: taxonomyPages.seoDescription,
      })
      .from(taxonomyPages)
      .where(
        and(
          eq(taxonomyPages.kind, TAXONOMY_KIND[kind]),
          eq(taxonomyPages.slug, slug),
        ),
      )
      .limit(1),
    count(ctx, filters),
  ]);
  if (companyCount === 0) throw new NotFoundError();

  const companies = await list(ctx, {
    filters,
    cursor: input.cursor,
    limit: input.limit,
  });
  return toCategoryPage({ kind, slug, facet, copy, companyCount, companies });
}

const companyCount = sql<number>`count(distinct ${startups.id})::int`;

/** Every facet value with at least one company visible to the caller, grouped by kind (FR-107). */
export async function listCategories(
  ctx: ReadContext,
): Promise<CategoryDirectory> {
  const db = getDb();
  const visible = visibilityFilter(ctx, startups.status);
  const countryRow = alias(locations, "country_row");

  const [industryRows, stageRows, workTypeRows, cityRows, countryRows] =
    await Promise.all([
      db
        .select({ slug: industries.slug, name: industries.name, companyCount })
        .from(industries)
        .innerJoin(
          startupIndustries,
          eq(startupIndustries.industryId, industries.id),
        )
        .innerJoin(
          startups,
          and(eq(startups.id, startupIndustries.startupId), visible),
        )
        .groupBy(industries.id)
        .orderBy(asc(industries.name)),
      db
        .select({ value: startups.stage, companyCount })
        .from(startups)
        .where(and(visible, isNotNull(startups.stage)))
        .groupBy(startups.stage)
        .orderBy(asc(startups.stage)),
      db
        .select({ value: startups.workType, companyCount })
        .from(startups)
        .where(and(visible, isNotNull(startups.workType)))
        .groupBy(startups.workType)
        .orderBy(asc(startups.workType)),
      db
        .select({ slug: locations.slug, name: locations.city, companyCount })
        .from(locations)
        .innerJoin(
          startups,
          and(eq(startups.locationId, locations.id), visible),
        )
        .where(isNotNull(locations.city))
        .groupBy(locations.id)
        .orderBy(asc(locations.city)),
      db
        .select({
          slug: countryRow.slug,
          name: countryRow.country,
          companyCount,
        })
        .from(countryRow)
        .innerJoin(locations, eq(locations.countryCode, countryRow.countryCode))
        .innerJoin(
          startups,
          and(eq(startups.locationId, locations.id), visible),
        )
        .where(isNull(countryRow.city))
        .groupBy(countryRow.id)
        .orderBy(asc(countryRow.country)),
    ]);

  return [
    {
      kind: "industries",
      entries: industryRows.map((row) =>
        toCategoryEntry(row.slug, row.name, row.companyCount),
      ),
    },
    {
      kind: "stages",
      entries: stageRows.flatMap((row) =>
        row.value === null
          ? []
          : [
              toCategoryEntry(
                enumToSlug(row.value),
                stageLabel(row.value) ?? row.value,
                row.companyCount,
              ),
            ],
      ),
    },
    {
      kind: "work-type",
      entries: workTypeRows.flatMap((row) =>
        row.value === null
          ? []
          : [
              toCategoryEntry(
                enumToSlug(row.value),
                workTypeLabel(row.value) ?? row.value,
                row.companyCount,
              ),
            ],
      ),
    },
    {
      kind: "cities",
      entries: cityRows.flatMap((row) =>
        row.name === null
          ? []
          : [toCategoryEntry(row.slug, row.name, row.companyCount)],
      ),
    },
    {
      kind: "countries",
      entries: countryRows.map((row) =>
        toCategoryEntry(row.slug, row.name, row.companyCount),
      ),
    },
  ];
}
