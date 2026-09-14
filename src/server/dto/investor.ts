import "server-only";

import type { MediaVariant } from "../db/schema/media";
import type { Page, Pagination } from "../lib/pagination";
import { type Image, toImage } from "./image";
import { type LocationFields, toLocationSummary } from "./location";
import type {
  InvestorType,
  LocationSummary,
  Stage,
  StartupCard,
} from "./startup";

// docs/API.md §7.5

export type InvestorBreakdown = Readonly<{
  byStage: readonly Readonly<{ stage: Stage; count: number }>[];
  byIndustry: readonly Readonly<{
    slug: string;
    name: string;
    count: number;
  }>[];
}>;

export type Investor = Readonly<{
  slug: string;
  name: string;
  investorType: InvestorType;
  description: string | null;
  logo: Image | null;
  websiteUrl: string | null;
  foundedYear: number | null;
  aumUsd: number | null;
  hqLocation: LocationSummary | null;
  portfolioCount: number;
  roundsLedCount: number;
  breakdown: InvestorBreakdown;
  portfolio: readonly StartupCard[];
  pagination: Pagination;
  ogImageUrl: string | null;
}>;

export type InvestorRow = LocationFields & {
  slug: string;
  name: string;
  investorType: InvestorType;
  description: string | null;
  logoVariants: MediaVariant[] | null;
  logoBlur: string | null;
  websiteUrl: string | null;
  foundedYear: number | null;
  aumUsd: number | null;
  portfolioCount: number;
  roundsLedCount: number;
  byStage: InvestorBreakdown["byStage"];
  byIndustry: InvestorBreakdown["byIndustry"];
  ogVariants: MediaVariant[] | null;
};

export function toInvestor(
  row: InvestorRow,
  portfolio: Page<StartupCard>,
): Investor {
  return {
    slug: row.slug,
    name: row.name,
    investorType: row.investorType,
    description: row.description,
    logo: toImage({ variants: row.logoVariants, blurDataUrl: row.logoBlur }),
    websiteUrl: row.websiteUrl,
    foundedYear: row.foundedYear,
    aumUsd: row.aumUsd,
    hqLocation: toLocationSummary(row),
    portfolioCount: row.portfolioCount,
    roundsLedCount: row.roundsLedCount,
    breakdown: {
      byStage: row.byStage.map(({ stage, count }) => ({ stage, count })),
      byIndustry: row.byIndustry.map(({ slug, name, count }) => ({
        slug,
        name,
        count,
      })),
    },
    portfolio: portfolio.data,
    pagination: portfolio.pagination,
    ogImageUrl:
      toImage({ variants: row.ogVariants, blurDataUrl: null })?.url ?? null,
  };
}
