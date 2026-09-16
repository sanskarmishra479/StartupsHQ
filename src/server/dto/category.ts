import "server-only";

import type { Page, Pagination } from "../lib/pagination";
import type { StartupCard } from "./startup";

// docs/API.md §7.8 (FR-107, FR-108).

export const CATEGORY_KINDS = [
  "industries",
  "stages",
  "work-type",
  "cities",
  "countries",
] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const isCategoryKind = (value: string): value is CategoryKind =>
  (CATEGORY_KINDS as readonly string[]).includes(value);

/** Thinner facet pages render `noindex` and stay out of the sitemap (FR-108). */
export const MIN_INDEXABLE_COMPANIES = 5;

export type CategoryPage = Readonly<{
  kind: CategoryKind;
  slug: string;
  heading: string;
  intro: string | null;
  iconUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  isGenerated: boolean;
  isIndexable: boolean;
  companyCount: number;
  companies: readonly StartupCard[];
  pagination: Pagination;
}>;

export type CategoryEntry = Readonly<{
  slug: string;
  name: string;
  companyCount: number;
  isIndexable: boolean;
  /** Countries only: the ISO 3166-1 alpha-2 code `GET /startups?country=` takes. */
  countryCode?: string;
}>;

export type CategoryDirectory = readonly Readonly<{
  kind: CategoryKind;
  entries: readonly CategoryEntry[];
}>[];

/** Editable copy from `taxonomy_pages`; undefined when the facet value has no row. */
export type CategoryCopy =
  | {
      heading: string | null;
      intro: string | null;
      iconUrl: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
    }
  | undefined;

export type ResolvedFacet = Readonly<{
  heading: string;
  iconUrl: string | null;
}>;

export function toCategoryEntry(
  slug: string,
  name: string,
  companyCount: number,
): CategoryEntry {
  return {
    slug,
    name,
    companyCount,
    isIndexable: companyCount >= MIN_INDEXABLE_COMPANIES,
  };
}

export function toCategoryPage(args: {
  kind: CategoryKind;
  slug: string;
  facet: ResolvedFacet;
  copy: CategoryCopy;
  companyCount: number;
  companies: Page<StartupCard>;
}): CategoryPage {
  const { kind, slug, facet, copy, companyCount, companies } = args;
  // Missing copy degrades to generated text, field by field (DM-09).
  const heading = copy?.heading ?? facet.heading;
  return {
    kind,
    slug,
    heading,
    intro: copy?.intro ?? null,
    iconUrl: copy?.iconUrl ?? facet.iconUrl,
    seoTitle: copy?.seoTitle ?? `${heading} | StartupsHQ`,
    seoDescription:
      copy?.seoDescription ??
      `${heading}: funding rounds, founders and investors on StartupsHQ.`,
    isGenerated: copy === undefined,
    isIndexable: companyCount >= MIN_INDEXABLE_COMPANIES,
    companyCount,
    companies: companies.data,
    pagination: companies.pagination,
  };
}
