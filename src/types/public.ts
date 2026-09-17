import type {
  FOUNDER_ROLE_LABELS,
  INVESTOR_TYPE_LABELS,
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

export type InvestorType = keyof typeof INVESTOR_TYPE_LABELS;
export type FounderRole = keyof typeof FOUNDER_ROLE_LABELS;
export type RoundClass =
  | "equity"
  | "convertible"
  | "debt"
  | "non_dilutive"
  | "secondary";
export type HeadcountBand =
  | "1-10"
  | "11-50"
  | "51-200"
  | "201-500"
  | "501-1000"
  | "1000+";

/** docs/API.md §7.3. */
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

/** docs/API.md §7.2. */
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

/** docs/API.md §7.4. */
export type Founder = Readonly<{
  slug: string;
  fullName: string;
  headline: string | null;
  bio: string | null;
  photo: Image | null;
  links: Readonly<{
    linkedin: string | null;
    x: string | null;
    github: string | null;
    personal: string | null;
  }>;
  location: LocationSummary | null;
  startups: readonly Readonly<{
    startup: StartupCard;
    role: FounderRole;
    isCurrent: boolean;
    joinedYear: number | null;
    leftYear: number | null;
  }>[];
  startupCount: number;
  ogImageUrl: string | null;
  updatedAt: string;
}>;

export type InvestorBreakdown = Readonly<{
  byStage: readonly Readonly<{ stage: Stage; count: number }>[];
  byIndustry: readonly Readonly<{
    slug: string;
    name: string;
    count: number;
  }>[];
}>;

/** docs/API.md §7.5. */
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

export type BatchStats = Readonly<{
  companyCount: number;
  totalRaisedUsd: number;
  topIndustries: readonly Readonly<{
    slug: string;
    name: string;
    count: number;
  }>[];
}>;

/** docs/API.md §7.6. */
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

/** docs/API.md §7.7. */
export type NewsItem = Readonly<{ round: Round; startup: StartupCard }>;

/** docs/API.md §7.8. */
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

/** docs/API.md §6.11, §7.9. */
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

/** docs/API.md §6.12. */
export type SuggestionType = "startup" | "founder" | "investor" | "batch";

export type Suggestion = Readonly<{
  type: SuggestionType;
  slug: string;
  name: string;
  subtitle: string | null;
  logo: Image | null;
}>;
