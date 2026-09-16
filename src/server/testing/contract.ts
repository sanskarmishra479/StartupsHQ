import "server-only";

import { z } from "zod";
import { isSlug } from "../../lib/slug";
import {
  founderRoleEnum,
  headcountBandEnum,
  investorTypeEnum,
  roundClassEnum,
  roundTypeEnum,
  stageEnum,
  workTypeEnum,
} from "../db/schema/enums";
import { CATEGORY_KINDS } from "../dto/category";

// Response schemas written from docs/API.md §3 and §7, for the contract tests (TEST_PLAN §9).
// Every object is strict: a renamed field fails a test, and so does any field the document does
// not list — which is how "public DTOs contain no admin-only fields" is checked (SEC-15).

const slug = z.string().refine(isSlug, "Not a slug.");
const text = z.string().min(1);
const https = z.url({ protocol: /^https$/ });
const date = z.iso.date();
const timestamp = z.iso.datetime();
const count = z.int().min(0);
const usd = z.int().min(0);
/** Totals of 0 read as unknown and are sent as null. */
const knownTotal = z.int().min(1).nullable();

const stage = z.enum(stageEnum.enumValues);
const roundType = z.enum(roundTypeEnum.enumValues);
const investorType = z.enum(investorTypeEnum.enumValues);

export const image = z.strictObject({
  url: https,
  blurDataUrl: z.string().startsWith("data:image/").nullable(),
  width: z.int().min(1),
  height: z.int().min(1),
  variants: z
    .array(z.strictObject({ width: z.int().min(1), url: https }))
    .min(1),
});

const location = z.strictObject({
  slug,
  city: text.nullable(),
  country: text,
  countryCode: z.string().regex(/^[A-Z]{2}$/),
});

export const pagination = z
  .strictObject({
    nextCursor: z.string().min(1).nullable(),
    hasMore: z.boolean(),
    limit: z.int().min(1).max(48),
  })
  .refine(
    (value) => (value.nextCursor === null) === !value.hasMore,
    "nextCursor is null exactly when hasMore is false.",
  );

export const startupCard = z.strictObject({
  slug,
  name: text,
  tagline: text.nullable(),
  logo: image.nullable(),
  cover: image.nullable(),
  stage: stage.nullable(),
  workType: z.enum(workTypeEnum.enumValues).nullable(),
  primaryIndustry: z
    .strictObject({ slug, name: text, iconUrl: https.nullable() })
    .nullable(),
  location: location.nullable(),
  latestRound: z
    .strictObject({
      roundType,
      amountUsd: usd.nullable(),
      isUndisclosed: z.boolean(),
      announcedOn: date,
    })
    .nullable(),
  totalRaisedUsd: knownTotal,
  acquiredBy: z.strictObject({ name: text, slug: slug.nullable() }).nullable(),
});

export const round = z
  .strictObject({
    id: z.uuid(),
    roundType,
    roundClass: z.enum(roundClassEnum.enumValues),
    announcedOn: date,
    isUndisclosed: z.boolean(),
    amountUsd: usd.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountOriginal: z.number().min(0).nullable(),
    fxRate: z.number().positive().nullable(),
    fxRateDate: date.nullable(),
    valuationUsd: usd.nullable(),
    sourceUrl: https,
    sourceTitle: text.nullable(),
    investors: z.array(
      z.strictObject({
        slug,
        name: text,
        logo: image.nullable(),
        isLead: z.boolean(),
      }),
    ),
  })
  .refine(
    (value) =>
      !value.isUndisclosed ||
      (value.amountUsd === null &&
        value.amountOriginal === null &&
        value.fxRate === null &&
        value.fxRateDate === null),
    "An undisclosed round carries no amounts (API.md §7.3).",
  );

const tenure = {
  role: z.enum(founderRoleEnum.enumValues),
  isCurrent: z.boolean(),
  joinedYear: z.int().nullable(),
  leftYear: z.int().nullable(),
};

export const startup = z.strictObject({
  ...startupCard.shape,
  description: text.nullable(),
  legalName: text.nullable(),
  websiteUrl: https.nullable(),
  careersUrl: https.nullable(),
  links: z.strictObject({
    linkedin: https.nullable(),
    x: https.nullable(),
    github: https.nullable(),
  }),
  foundedYear: z.int().nullable(),
  foundedOn: date.nullable(),
  headcountBand: z.enum(headcountBandEnum.enumValues).nullable(),
  isActive: z.boolean(),
  totalDebtUsd: knownTotal,
  industries: z.array(
    z.strictObject({ slug, name: text, isPrimary: z.boolean() }),
  ),
  founders: z.array(
    z.strictObject({
      slug,
      fullName: text,
      headline: text.nullable(),
      photo: image.nullable(),
      ...tenure,
    }),
  ),
  investors: z.array(
    z.strictObject({
      slug,
      name: text,
      investorType,
      logo: image.nullable(),
      isLead: z.boolean(),
    }),
  ),
  batches: z.array(
    z.strictObject({ slug, programName: text, label: text, year: z.int() }),
  ),
  rounds: z.array(round),
  acquiredOn: date.nullable(),
  acquiredAmountUsd: usd.nullable(),
  ogImageUrl: https.nullable(),
  updatedAt: timestamp,
});

export const founder = z.strictObject({
  slug,
  fullName: text,
  headline: text.nullable(),
  bio: text.nullable(),
  photo: image.nullable(),
  links: z.strictObject({
    linkedin: https.nullable(),
    x: https.nullable(),
    github: https.nullable(),
    personal: https.nullable(),
  }),
  location: location.nullable(),
  startups: z.array(z.strictObject({ startup: startupCard, ...tenure })),
  startupCount: count,
  ogImageUrl: https.nullable(),
  updatedAt: timestamp,
});

const industryCount = z.strictObject({
  slug,
  name: text,
  count: z.int().min(1),
});

export const investor = z.strictObject({
  slug,
  name: text,
  investorType,
  description: text.nullable(),
  logo: image.nullable(),
  websiteUrl: https.nullable(),
  foundedYear: z.int().nullable(),
  aumUsd: usd.nullable(),
  hqLocation: location.nullable(),
  portfolioCount: count,
  roundsLedCount: count,
  breakdown: z.strictObject({
    byStage: z.array(z.strictObject({ stage, count: z.int().min(1) })),
    byIndustry: z.array(industryCount),
  }),
  portfolio: z.array(startupCard),
  pagination,
  ogImageUrl: https.nullable(),
});

export const batch = z.strictObject({
  slug,
  programName: text,
  label: text,
  season: text.nullable(),
  year: z.int(),
  startsOn: date.nullable(),
  demoDayOn: date.nullable(),
  description: text.nullable(),
  logo: image.nullable(),
  investor: z
    .strictObject({ slug, name: text, investorType, logo: image.nullable() })
    .nullable(),
  stats: z.strictObject({
    companyCount: count,
    totalRaisedUsd: usd,
    topIndustries: z.array(industryCount),
  }),
  companies: z.array(startupCard),
  pagination,
});

export const newsItem = z.strictObject({ round, startup: startupCard });

export const categoryPage = z.strictObject({
  kind: z.enum(CATEGORY_KINDS),
  slug,
  heading: text,
  intro: text.nullable(),
  iconUrl: https.nullable(),
  seoTitle: text,
  seoDescription: text,
  isGenerated: z.boolean(),
  isIndexable: z.boolean(),
  companyCount: z.int().min(1),
  companies: z.array(startupCard),
  pagination,
});

const categoryEntry = z.strictObject({
  slug,
  name: text,
  companyCount: z.int().min(1),
  isIndexable: z.boolean(),
});

export const categoryDirectory = z.array(
  z.union([
    z.strictObject({
      kind: z.literal("countries"),
      entries: z.array(
        categoryEntry.extend({ countryCode: z.string().regex(/^[A-Z]{2}$/) }),
      ),
    }),
    z.strictObject({
      kind: z.enum(CATEGORY_KINDS).exclude(["countries"]),
      entries: z.array(categoryEntry),
    }),
  ]),
);

const group = <T extends z.ZodType>(item: T) =>
  z.strictObject({ results: z.array(item), total: count });

export const searchResults = z.strictObject({
  data: z.strictObject({
    startups: group(startupCard),
    founders: group(
      z.strictObject({
        slug,
        fullName: text,
        headline: text.nullable(),
        photo: image.nullable(),
        startupCount: count,
      }),
    ),
    investors: group(
      z.strictObject({
        slug,
        name: text,
        investorType,
        logo: image.nullable(),
        portfolioCount: count,
      }),
    ),
    batches: group(
      z.strictObject({
        slug,
        programName: text,
        label: text,
        year: z.int(),
        companyCount: count,
      }),
    ),
  }),
  meta: z.strictObject({
    query: text,
    matchType: z.enum(["fulltext", "trigram"]),
  }),
});

export const suggestion = z.strictObject({
  type: z.enum(["startup", "founder", "investor", "batch"]),
  slug,
  name: text,
  subtitle: text.nullable(),
  logo: image.nullable(),
});

// ── Envelopes (API.md §3) ────────────────────────────────────────────────────────────────────

export const single = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data });

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({ data: z.array(item), pagination });

export const errorBody = z.strictObject({
  error: z.strictObject({
    code: z.string().regex(/^[A-Z_]+$/),
    message: text,
    details: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .min(1)
      .optional(),
  }),
});
