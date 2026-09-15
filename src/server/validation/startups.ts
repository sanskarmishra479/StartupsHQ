import "server-only";

import { z } from "zod";
import { headcountBandEnum, stageEnum, workTypeEnum } from "../db/schema";
import {
  httpsUrl,
  optionalText,
  slugInput,
  text,
  wholeUsd,
  year,
} from "./shared";

// docs/API.md §8.1. Derived totals, status and audit columns are not fields a client can send.

const fields = {
  name: text(200),
  legalName: optionalText(200),
  tagline: text(120).nullable().optional(),
  description: optionalText(4000),
  websiteUrl: httpsUrl().nullable().optional(),
  careersUrl: httpsUrl().nullable().optional(),
  linkedinUrl: httpsUrl().nullable().optional(),
  xUrl: httpsUrl().nullable().optional(),
  githubUrl: httpsUrl().nullable().optional(),
  stage: z.enum(stageEnum.enumValues).nullable().optional(),
  workType: z.enum(workTypeEnum.enumValues).nullable().optional(),
  headcountBand: z.enum(headcountBandEnum.enumValues).nullable().optional(),
  foundedYear: year().nullable().optional(),
  foundedOn: z.iso.date().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  acquiredByStartupId: z.uuid().nullable().optional(),
  acquiredByName: optionalText(200),
  acquiredOn: z.iso.date().nullable().optional(),
  acquiredAmountUsd: wholeUsd().nullable().optional(),
  logoAssetId: z.uuid().nullable().optional(),
  coverAssetId: z.uuid().nullable().optional(),
};

export const createStartupSchema = z.strictObject({
  ...fields,
  slug: slugInput.optional(),
});

/** Partial; `slug` changes only through the admin slug action (FR-409). */
export const updateStartupSchema = z.strictObject(fields).partial();

export type CreateStartupInput = z.input<typeof createStartupSchema>;
export type UpdateStartupInput = z.input<typeof updateStartupSchema>;
