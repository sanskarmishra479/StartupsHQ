import "server-only";

import type { MediaVariant } from "../db/schema/media";
import type { Page, Pagination } from "../lib/pagination";
import { type Image, toImage } from "./image";
import type { InvestorType, StartupCard } from "./startup";

// docs/API.md §7.6

export type BatchStats = Readonly<{
  companyCount: number;
  /** Sum of the cohort's derived totals: published equity and convertible rounds only. */
  totalRaisedUsd: number;
  topIndustries: readonly Readonly<{
    slug: string;
    name: string;
    count: number;
  }>[];
}>;

export type Batch = Readonly<{
  slug: string;
  programName: string;
  label: string;
  season: string | null;
  year: number;
  startsOn: string | null;
  demoDayOn: string | null;
  description: string | null;
  logo: Image | null;
  investor: Readonly<{
    slug: string;
    name: string;
    investorType: InvestorType;
    logo: Image | null;
  }> | null;
  stats: BatchStats;
  companies: readonly StartupCard[];
  pagination: Pagination;
}>;

export type BatchRow = {
  slug: string;
  programName: string;
  label: string;
  season: string | null;
  year: number;
  startsOn: string | null;
  demoDayOn: string | null;
  description: string | null;
  logoVariants: MediaVariant[] | null;
  logoBlur: string | null;
  investorSlug: string | null;
  investorName: string | null;
  investorType: InvestorType | null;
  investorLogoVariants: MediaVariant[] | null;
  investorLogoBlur: string | null;
};

export function toBatch(
  row: BatchRow,
  stats: BatchStats,
  companies: Page<StartupCard>,
): Batch {
  return {
    slug: row.slug,
    programName: row.programName,
    label: row.label,
    season: row.season,
    year: row.year,
    startsOn: row.startsOn,
    demoDayOn: row.demoDayOn,
    description: row.description,
    logo: toImage({ variants: row.logoVariants, blurDataUrl: row.logoBlur }),
    // The organizer is joined with its own visibility check; hidden ⟹ null.
    investor:
      row.investorSlug !== null &&
      row.investorName !== null &&
      row.investorType !== null
        ? {
            slug: row.investorSlug,
            name: row.investorName,
            investorType: row.investorType,
            logo: toImage({
              variants: row.investorLogoVariants,
              blurDataUrl: row.investorLogoBlur,
            }),
          }
        : null,
    stats: {
      companyCount: stats.companyCount,
      totalRaisedUsd: stats.totalRaisedUsd,
      topIndustries: stats.topIndustries.map(({ slug, name, count }) => ({
        slug,
        name,
        count,
      })),
    },
    companies: companies.data,
    pagination: companies.pagination,
  };
}
