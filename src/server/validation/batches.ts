import "server-only";

import { z } from "zod";
import { optionalText, slugInput, text } from "./shared";

// docs/API.md §8.1 for batches.

const fields = {
  investorId: z.uuid().nullable().optional(),
  programName: text(200),
  label: text(40),
  season: optionalText(40),
  year: z
    .int()
    .min(1990)
    .max(new Date().getUTCFullYear() + 2),
  startsOn: z.iso.date().nullable().optional(),
  demoDayOn: z.iso.date().nullable().optional(),
  description: optionalText(4000),
  logoAssetId: z.uuid().nullable().optional(),
};

export const createBatchSchema = z.strictObject({
  ...fields,
  slug: slugInput.optional(),
});

export const updateBatchSchema = z.strictObject(fields).partial();

export type CreateBatchInput = z.input<typeof createBatchSchema>;
export type UpdateBatchInput = z.input<typeof updateBatchSchema>;
