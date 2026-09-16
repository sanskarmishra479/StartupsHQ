import type {
  ROUND_TYPE_LABELS,
  STAGE_LABELS,
  WORK_TYPE_LABELS,
} from "@/lib/labels";

// The public DTO shapes components render (docs/API.md §7), declared here because nothing outside
// src/server may import from it (SEC-01). src/server/dto/public-types.test.ts fails the typecheck
// if these and the server's mappers ever disagree. Add a type here when a component first needs it.

export type Stage = keyof typeof STAGE_LABELS;
export type WorkType = keyof typeof WORK_TYPE_LABELS;
export type RoundType = keyof typeof ROUND_TYPE_LABELS;

/** docs/API.md §7.0. Served straight from Blob; `url` is the largest variant (ADR-012). */
export type Image = Readonly<{
  url: string;
  blurDataUrl: string | null;
  width: number;
  height: number;
  variants: readonly Readonly<{ width: number; url: string }>[];
}>;

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

/** docs/API.md §1: every paginated list. */
export type Pagination = Readonly<{
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}>;

export type Page<T> = Readonly<{ data: T[]; pagination: Pagination }>;

/** docs/API.md §6.10a. */
export type CategoryKind =
  | "industries"
  | "stages"
  | "work-type"
  | "cities"
  | "countries";

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
