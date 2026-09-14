import "server-only";

import type {
  founderRoleEnum,
  headcountBandEnum,
  investorTypeEnum,
  roundClassEnum,
  roundTypeEnum,
  stageEnum,
  workTypeEnum,
} from "../db/schema";
import type { MediaVariant } from "../db/schema/media";
import { type Image, type MediaFields, toImage } from "./image";

// Public startup DTOs (docs/API.md §7.1–7.3). These mappers are the only place rows become JSON
// shapes: they choose every field explicitly, so internal ids, audit columns and statuses never
// reach a response (SEC-15). Round ids are the one documented exception, used for anchors.

export type Stage = (typeof stageEnum.enumValues)[number];
export type WorkType = (typeof workTypeEnum.enumValues)[number];
export type HeadcountBand = (typeof headcountBandEnum.enumValues)[number];
export type RoundType = (typeof roundTypeEnum.enumValues)[number];
export type RoundClass = (typeof roundClassEnum.enumValues)[number];
export type InvestorType = (typeof investorTypeEnum.enumValues)[number];
export type FounderRole = (typeof founderRoleEnum.enumValues)[number];

export type LocationSummary = Readonly<{
  slug: string;
  city: string | null;
  country: string;
  countryCode: string;
}>;

export type StartupCard = Readonly<{
  slug: string;
  name: string;
  tagline: string | null;
  logo: Image | null;
  cover: Image | null;
  stage: Stage | null;
  workType: WorkType | null;
  primaryIndustry: Readonly<{
    slug: string;
    name: string;
    iconUrl: string | null;
  }> | null;
  location: LocationSummary | null;
  latestRound: Readonly<{
    roundType: RoundType;
    amountUsd: number | null;
    isUndisclosed: boolean;
    announcedOn: string;
  }> | null;
  totalRaisedUsd: number | null;
  acquiredBy: Readonly<{ name: string; slug: string | null }> | null;
}>;

export type Round = Readonly<{
  id: string;
  roundType: RoundType;
  roundClass: RoundClass;
  announcedOn: string;
  isUndisclosed: boolean;
  amountUsd: number | null;
  currency: string;
  amountOriginal: number | null;
  fxRate: number | null;
  fxRateDate: string | null;
  valuationUsd: number | null;
  sourceUrl: string;
  sourceTitle: string | null;
  investors: readonly Readonly<{
    slug: string;
    name: string;
    logo: Image | null;
    isLead: boolean;
  }>[];
}>;

export type Startup = StartupCard &
  Readonly<{
    description: string | null;
    legalName: string | null;
    websiteUrl: string | null;
    careersUrl: string | null;
    links: Readonly<{
      linkedin: string | null;
      x: string | null;
      github: string | null;
    }>;
    foundedYear: number | null;
    foundedOn: string | null;
    headcountBand: HeadcountBand | null;
    isActive: boolean;
    totalDebtUsd: number | null;
    industries: readonly Readonly<{
      slug: string;
      name: string;
      isPrimary: boolean;
    }>[];
    founders: readonly Readonly<{
      slug: string;
      fullName: string;
      headline: string | null;
      photo: Image | null;
      role: FounderRole;
      isCurrent: boolean;
      joinedYear: number | null;
      leftYear: number | null;
    }>[];
    investors: readonly Readonly<{
      slug: string;
      name: string;
      investorType: InvestorType;
      logo: Image | null;
      isLead: boolean;
    }>[];
    batches: readonly Readonly<{
      slug: string;
      programName: string;
      label: string;
      year: number;
    }>[];
    rounds: readonly Round[];
    acquiredOn: string | null;
    acquiredAmountUsd: number | null;
    ogImageUrl: string | null;
    updatedAt: string;
  }>;

// ── Row shapes, as selected by src/server/db/queries and src/server/services ─────────────────

export type StartupCardRow = {
  slug: string;
  name: string;
  tagline: string | null;
  stage: Stage | null;
  workType: WorkType | null;
  totalRaisedUsd: number;
  acquiredByName: string | null;
  acquirerSlug: string | null;
  acquirerName: string | null;
  logoVariants: MediaVariant[] | null;
  logoBlur: string | null;
  coverVariants: MediaVariant[] | null;
  coverBlur: string | null;
  industrySlug: string | null;
  industryName: string | null;
  industryIconUrl: string | null;
  locationSlug: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  roundType: RoundType | null;
  roundAmountUsd: number | null;
  roundIsUndisclosed: boolean | null;
  roundAnnouncedOn: string | null;
};

export type StartupDetailRow = StartupCardRow & {
  description: string | null;
  legalName: string | null;
  websiteUrl: string | null;
  careersUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  githubUrl: string | null;
  foundedYear: number | null;
  foundedOn: string | null;
  headcountBand: HeadcountBand | null;
  isActive: boolean;
  totalDebtUsd: number;
  acquiredOn: string | null;
  acquiredAmountUsd: number | null;
  updatedAt: Date;
  ogVariants: MediaVariant[] | null;
  industries: Startup["industries"];
  batches: Startup["batches"];
  investors: (Omit<Startup["investors"][number], "logo"> & {
    logo: MediaFields;
  })[];
};

export type StartupFounderRow = Omit<Startup["founders"][number], "photo"> & {
  photoVariants: MediaVariant[] | null;
  photoBlur: string | null;
};

export type RoundRow = {
  id: string;
  roundType: RoundType;
  roundClass: RoundClass | null;
  announcedOn: string;
  isUndisclosed: boolean;
  currency: string;
  amountOriginal: string | null;
  amountUsd: number | null;
  fxRate: string | null;
  fxRateDate: string | null;
  valuationUsd: number | null;
  sourceUrl: string;
  sourceTitle: string | null;
  investors: (Omit<Round["investors"][number], "logo"> & {
    logo: MediaFields;
  })[];
};

// ── Mappers ──────────────────────────────────────────────────────────────────────────────────

/** A stored total of 0 means nothing disclosed has been counted, which reads as unknown. */
const knownAmount = (amount: number) => (amount > 0 ? amount : null);

export function toStartupCard(row: StartupCardRow): StartupCard {
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    logo: toImage({ variants: row.logoVariants, blurDataUrl: row.logoBlur }),
    cover: toImage({ variants: row.coverVariants, blurDataUrl: row.coverBlur }),
    stage: row.stage,
    workType: row.workType,
    primaryIndustry:
      row.industrySlug !== null && row.industryName !== null
        ? {
            slug: row.industrySlug,
            name: row.industryName,
            iconUrl: row.industryIconUrl,
          }
        : null,
    location:
      row.locationSlug !== null &&
      row.country !== null &&
      row.countryCode !== null
        ? {
            slug: row.locationSlug,
            city: row.city,
            country: row.country,
            countryCode: row.countryCode,
          }
        : null,
    latestRound:
      row.roundType !== null && row.roundAnnouncedOn !== null
        ? {
            roundType: row.roundType,
            amountUsd: row.roundIsUndisclosed ? null : row.roundAmountUsd,
            isUndisclosed: row.roundIsUndisclosed === true,
            announcedOn: row.roundAnnouncedOn,
          }
        : null,
    totalRaisedUsd: knownAmount(row.totalRaisedUsd),
    // The acquirer's name and slug are only present when it is visible to this context; a hidden
    // acquirer falls back to the free-text name, never to its own record.
    acquiredBy:
      row.acquirerSlug !== null && row.acquirerName !== null
        ? { name: row.acquirerName, slug: row.acquirerSlug }
        : row.acquiredByName !== null
          ? { name: row.acquiredByName, slug: null }
          : null,
  };
}

export function toRound(row: RoundRow): Round {
  if (row.roundClass === null) {
    throw new Error("funding_rounds.round_class is generated and never null.");
  }
  const disclosed = !row.isUndisclosed;
  const isUsd = row.currency === "USD";
  return {
    id: row.id,
    roundType: row.roundType,
    roundClass: row.roundClass,
    announcedOn: row.announcedOn,
    isUndisclosed: row.isUndisclosed,
    // When undisclosed, every amount and rate is null so nothing can render as "$0" (DM-06).
    amountUsd: disclosed ? row.amountUsd : null,
    currency: row.currency,
    amountOriginal:
      disclosed && row.amountOriginal !== null
        ? Number(row.amountOriginal)
        : null,
    fxRate: !disclosed
      ? null
      : isUsd
        ? 1
        : row.fxRate === null
          ? null
          : Number(row.fxRate),
    fxRateDate: !disclosed
      ? null
      : isUsd
        ? (row.fxRateDate ?? row.announcedOn)
        : row.fxRateDate,
    valuationUsd: row.valuationUsd,
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    investors: row.investors.map((investor) => ({
      slug: investor.slug,
      name: investor.name,
      logo: toImage(investor.logo),
      isLead: investor.isLead,
    })),
  };
}

export function toStartup(
  row: StartupDetailRow,
  founders: readonly StartupFounderRow[],
  rounds: readonly RoundRow[],
): Startup {
  return {
    ...toStartupCard(row),
    description: row.description,
    legalName: row.legalName,
    websiteUrl: row.websiteUrl,
    careersUrl: row.careersUrl,
    links: {
      linkedin: row.linkedinUrl,
      x: row.xUrl,
      github: row.githubUrl,
    },
    foundedYear: row.foundedYear,
    foundedOn: row.foundedOn,
    headcountBand: row.headcountBand,
    isActive: row.isActive,
    totalDebtUsd: knownAmount(row.totalDebtUsd),
    industries: row.industries.map(({ slug, name, isPrimary }) => ({
      slug,
      name,
      isPrimary,
    })),
    founders: founders.map((founder) => ({
      slug: founder.slug,
      fullName: founder.fullName,
      headline: founder.headline,
      photo: toImage({
        variants: founder.photoVariants,
        blurDataUrl: founder.photoBlur,
      }),
      role: founder.role,
      isCurrent: founder.isCurrent,
      joinedYear: founder.joinedYear,
      leftYear: founder.leftYear,
    })),
    investors: row.investors.map((investor) => ({
      slug: investor.slug,
      name: investor.name,
      investorType: investor.investorType,
      logo: toImage(investor.logo),
      isLead: investor.isLead,
    })),
    batches: row.batches.map(({ slug, programName, label, year }) => ({
      slug,
      programName,
      label,
      year,
    })),
    rounds: rounds.map(toRound),
    acquiredOn: row.acquiredOn,
    acquiredAmountUsd: row.acquiredAmountUsd,
    ogImageUrl:
      toImage({ variants: row.ogVariants, blurDataUrl: null })?.url ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
