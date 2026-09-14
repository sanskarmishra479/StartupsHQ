import "server-only";

import { investorTypeLabel, stageLabel } from "../../lib/labels";
import type { MediaVariant } from "../db/schema/media";
import { type Image, type MediaFields, toImage } from "./image";
import type { InvestorType, StartupCard } from "./startup";

// docs/API.md §6.12, §7.9 (FR-109).

export type SearchGroup<T> = Readonly<{ results: readonly T[]; total: number }>;

export type FounderHit = Readonly<{
  slug: string;
  fullName: string;
  headline: string | null;
  photo: Image | null;
  startupCount: number;
}>;

export type InvestorHit = Readonly<{
  slug: string;
  name: string;
  investorType: InvestorType;
  logo: Image | null;
  portfolioCount: number;
}>;

export type BatchHit = Readonly<{
  slug: string;
  programName: string;
  label: string;
  year: number;
  companyCount: number;
}>;

export type SearchResults = Readonly<{
  data: Readonly<{
    startups: SearchGroup<StartupCard>;
    founders: SearchGroup<FounderHit>;
    investors: SearchGroup<InvestorHit>;
    batches: SearchGroup<BatchHit>;
  }>;
  meta: Readonly<{ query: string; matchType: "fulltext" | "trigram" }>;
}>;

export type SuggestionType = "startup" | "founder" | "investor" | "batch";

export type Suggestion = Readonly<{
  type: SuggestionType;
  slug: string;
  name: string;
  subtitle: string | null;
  logo: Image | null;
}>;

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────

export type FounderHitRow = Omit<FounderHit, "photo"> & {
  photoVariants: MediaVariant[] | null;
  photoBlur: string | null;
};

export type InvestorHitRow = Omit<InvestorHit, "logo"> & {
  logoVariants: MediaVariant[] | null;
  logoBlur: string | null;
};

/** One row of the suggest union; `part1..3` hold the per-type subtitle ingredients. */
export type SuggestionRow = {
  type: SuggestionType;
  slug: string;
  name: string;
  part1: string | null;
  part2: string | null;
  part3: string | null;
  logo: MediaFields;
};

// ── Mappers ──────────────────────────────────────────────────────────────────────────────────

export function toFounderHit(row: FounderHitRow): FounderHit {
  return {
    slug: row.slug,
    fullName: row.fullName,
    headline: row.headline,
    photo: toImage({ variants: row.photoVariants, blurDataUrl: row.photoBlur }),
    startupCount: row.startupCount,
  };
}

export function toInvestorHit(row: InvestorHitRow): InvestorHit {
  return {
    slug: row.slug,
    name: row.name,
    investorType: row.investorType,
    logo: toImage({ variants: row.logoVariants, blurDataUrl: row.logoBlur }),
    portfolioCount: row.portfolioCount,
  };
}

export function toBatchHit(row: BatchHit): BatchHit {
  return {
    slug: row.slug,
    programName: row.programName,
    label: row.label,
    year: row.year,
    companyCount: row.companyCount,
  };
}

const joinParts = (parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part)).join(" · ") || null;

export function toSuggestion(row: SuggestionRow): Suggestion {
  let subtitle: string | null;
  switch (row.type) {
    case "startup":
      // "Consumer · Series A · New York"
      subtitle = joinParts([
        row.part1,
        row.part2 === null ? null : stageLabel(row.part2),
        row.part3,
      ]);
      break;
    case "investor":
      subtitle = joinParts([
        row.part2 === null ? null : investorTypeLabel(row.part2),
        row.part3,
      ]);
      break;
    default:
      subtitle = row.part1;
  }
  return {
    type: row.type,
    slug: row.slug,
    name: row.name,
    subtitle,
    logo: toImage(row.logo),
  };
}
