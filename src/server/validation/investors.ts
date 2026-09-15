import "server-only";

import { z } from "zod";
import { investorTypeEnum } from "../db/schema";
import {
  httpsUrl,
  optionalText,
  slugInput,
  text,
  wholeUsd,
  year,
} from "./shared";

// docs/API.md §8.1 for investors.

const fields = {
  name: text(200),
  investorType: z.enum(investorTypeEnum.enumValues),
  description: optionalText(4000),
  logoAssetId: z.uuid().nullable().optional(),
  websiteUrl: httpsUrl().nullable().optional(),
  foundedYear: year().nullable().optional(),
  hqLocationId: z.uuid().nullable().optional(),
  aumUsd: wholeUsd().nullable().optional(),
};

export const createInvestorSchema = z.strictObject({
  ...fields,
  slug: slugInput.optional(),
});

export const updateInvestorSchema = z.strictObject(fields).partial();

export type CreateInvestorInput = z.input<typeof createInvestorSchema>;
export type UpdateInvestorInput = z.input<typeof updateInvestorSchema>;
