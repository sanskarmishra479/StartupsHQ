import "server-only";

import { pgEnum } from "drizzle-orm/pg-core";

// docs/SRS.md §4.1 (DM-01)

export const stageEnum = pgEnum("stage", [
  "bootstrapped",
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "series_d",
  "series_e",
  "series_f",
  "series_g",
  "growth",
  "public",
  "acquired",
  "dead",
]);

export const roundTypeEnum = pgEnum("round_type", [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "series_d",
  "series_e",
  "series_f",
  "series_g",
  "convertible",
  "bridge",
  "debt",
  "grant",
  "secondary",
]);

/** Derived from round_type; decides what counts toward totals (ADR-018). */
export const roundClassEnum = pgEnum("round_class", [
  "equity",
  "convertible",
  "debt",
  "non_dilutive",
  "secondary",
]);

export const workTypeEnum = pgEnum("work_type", ["remote", "onsite", "hybrid"]);

export const headcountBandEnum = pgEnum("headcount_band", [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1000+",
]);

export const investorTypeEnum = pgEnum("investor_type", [
  "vc",
  "accelerator",
  "angel",
  "corporate",
  "pe",
  "government",
  "crowdfunding",
]);

export const publishStatusEnum = pgEnum("publish_status", [
  "draft",
  "published",
  "archived",
]);

export const founderRoleEnum = pgEnum("founder_role", [
  "founder",
  "cofounder",
  "ceo",
  "cto",
  "operator",
  "advisor",
  "early_employee",
]);

export const taxonomyKindEnum = pgEnum("taxonomy_kind", [
  "industry",
  "stage",
  "work_type",
  "city",
  "country",
]);

export const userRoleEnum = pgEnum("user_role", ["admin", "editor"]);

export const mediaPurposeEnum = pgEnum("media_purpose", [
  "logo",
  "cover",
  "photo",
  "og",
]);

export const mediaStateEnum = pgEnum("media_state", ["staging", "attached"]);

export const importStatusEnum = pgEnum("import_status", [
  "dry_run",
  "committed",
  "expired",
  "failed",
]);
