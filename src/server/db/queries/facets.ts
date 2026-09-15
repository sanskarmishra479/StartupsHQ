import "server-only";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { slugToEnum, stageLabel, workTypeLabel } from "../../../lib/labels";
import type { CategoryKind, ResolvedFacet } from "../../dto/category";
import type { StartupFilters } from "../../services/startups";
import type { Database } from "../client";
import { industries, locations, stageEnum, workTypeEnum } from "../schema";

// The facet value behind a category URL (FR-108, DM-09). Facet values stay typed in the schema;
// `taxonomy_pages` only holds copy for values that exist, so reads and copy writes both resolve
// the value here first.

export const TAXONOMY_KIND = {
  industries: "industry",
  stages: "stage",
  "work-type": "work_type",
  cities: "city",
  countries: "country",
} as const satisfies Record<CategoryKind, string>;

export type Facet = ResolvedFacet & Readonly<{ filters: StartupFilters }>;

/** The facet value for a category kind and slug, or null when it does not exist. */
export async function resolveFacet(
  db: Pick<Database, "select">,
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
