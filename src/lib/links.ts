import type { CategoryKind } from "@/types/public";
import { enumToSlug } from "./labels";

// Internal paths for every linkable entity mention (TODO Phase 15: every mention is a link).
// Client-safe.

/** Where each category kind lives under /categories (SRS FR-108). */
export const CATEGORY_SEGMENTS: Record<CategoryKind, string> = {
  industries: "industries",
  stages: "stages",
  "work-type": "work-type",
  cities: "locations/cities",
  countries: "locations/countries",
};

export const CATEGORY_TITLES: Record<CategoryKind, string> = {
  industries: "Industries",
  stages: "Stages",
  "work-type": "Work type",
  cities: "Cities",
  countries: "Countries",
};

export const paths = {
  company: (slug: string) => `/companies/${slug}`,
  founder: (slug: string) => `/founders/${slug}`,
  investor: (slug: string) => `/investors/${slug}`,
  batch: (slug: string) => `/batches/${slug}`,
  category: (kind: CategoryKind, slug: string) =>
    `/categories/${CATEGORY_SEGMENTS[kind]}/${slug}`,
  industry: (slug: string) => `/categories/industries/${slug}`,
  stage: (stage: string) => `/categories/stages/${enumToSlug(stage)}`,
  workType: (workType: string) =>
    `/categories/work-type/${enumToSlug(workType)}`,
  city: (locationSlug: string) =>
    `/categories/locations/cities/${locationSlug}`,
  country: (locationSlug: string) =>
    `/categories/locations/countries/${locationSlug}`,
} as const;

/**
 * The GET /startups query that continues a category page's company list (API §6.10): the same
 * facet, acquired companies included. Countries filter by ISO code, not by location slug.
 */
export function categoryCompaniesQuery(
  kind: CategoryKind,
  slug: string,
  countryCode?: string | null,
): string | null {
  const search = new URLSearchParams();
  switch (kind) {
    case "industries":
      search.set("industry", slug);
      break;
    case "stages":
      search.set("stage", slug.replaceAll("-", "_"));
      break;
    case "work-type":
      search.set("work_type", slug.replaceAll("-", "_"));
      break;
    case "cities":
      search.set("city", slug);
      break;
    case "countries":
      if (!countryCode) return null;
      search.set("country", countryCode);
      break;
  }
  search.set("include_acquired", "true");
  return search.toString();
}
