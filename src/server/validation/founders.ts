import "server-only";

import { z } from "zod";
import { httpsUrl, optionalText, slugInput, text } from "./shared";

// docs/API.md §8.1 for founders. Founders are people (ADR-019).

const fields = {
  fullName: text(200),
  headline: text(160).nullable().optional(),
  bio: optionalText(4000),
  photoAssetId: z.uuid().nullable().optional(),
  linkedinUrl: httpsUrl().nullable().optional(),
  xUrl: httpsUrl().nullable().optional(),
  githubUrl: httpsUrl().nullable().optional(),
  personalUrl: httpsUrl().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
};

export const createFounderSchema = z.strictObject({
  ...fields,
  slug: slugInput.optional(),
});

export const updateFounderSchema = z.strictObject(fields).partial();

/**
 * Recorded in audit rows by name only (DM-12). The slug is included because a founder's slug is
 * derived from their name.
 */
export const FOUNDER_PERSONAL_FIELDS: ReadonlySet<string> = new Set([
  "fullName",
  "slug",
  "headline",
  "bio",
  "photoAssetId",
  "linkedinUrl",
  "xUrl",
  "githubUrl",
  "personalUrl",
]);

export type CreateFounderInput = z.input<typeof createFounderSchema>;
export type UpdateFounderInput = z.input<typeof updateFounderSchema>;
