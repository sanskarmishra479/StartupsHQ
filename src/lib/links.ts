import { enumToSlug } from "./labels";

// Internal paths for every linkable entity mention (TODO Phase 15: every mention is a link).
// Client-safe.

export const paths = {
  company: (slug: string) => `/companies/${slug}`,
  founder: (slug: string) => `/founders/${slug}`,
  investor: (slug: string) => `/investors/${slug}`,
  batch: (slug: string) => `/batches/${slug}`,
  industry: (slug: string) => `/categories/industries/${slug}`,
  stage: (stage: string) => `/categories/stages/${enumToSlug(stage)}`,
  workType: (workType: string) =>
    `/categories/work-type/${enumToSlug(workType)}`,
  city: (locationSlug: string) =>
    `/categories/locations/cities/${locationSlug}`,
} as const;
